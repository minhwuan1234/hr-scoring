import {isDeepStrictEqual} from 'node:util';
import {validateProfile} from './profile.mjs';
import {validateFileName} from './candidates.mjs';
import {DEFAULT_POSITION} from './positions.mjs';
import { SCORING_UNIT } from './sentences.mjs';
import { randomUUID } from 'node:crypto';
import { getBand } from './rubric.mjs';
import { SCORING_FORMULA, calculate, nearest, validateDecision, validateEvidence } from './engine.mjs';
import { EMBEDDING_MODEL, embed, extractEvidence, assessCeilings, LUNA_MODEL } from './openai.mjs';

class PlanningConflict extends Error {}
export const MATCH_THRESHOLD = Number(process.env.MATCH_THRESHOLD || 0.70);

export function createScoringService(store, provider = { embed, extractEvidence, assessCeilings }, embeddingModel = EMBEDDING_MODEL, position = DEFAULT_POSITION) {
  const rubric=position.rubric;
  let baseline;
  const threshold = MATCH_THRESHOLD;
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error('MATCH_THRESHOLD must be between 0 and 1.');

  async function initialReferences() {
    if (!baseline) baseline = (async () => {
      const records = rubric.flatMap(d => [...d.bands.map(([min,max,statement],band) => ({ id:`rubric-${d.id}-${band}`, dimension:d.id, band, cap:max, statement, source:'user-rubric', embeddingModel })),...(d.examples || []).map((example,index)=>({id:`example-${d.id}-${index}`,dimension:d.id,band:example.band,cap:example.cap,statement:example.statement,source:'user-rubric',embeddingModel}))]);
      const vectors = await provider.embed(records.map(record => record.statement));
      return records.map((record,index) => ({ ...record, vector:vectors[index] }));
    })().catch(error => { baseline = undefined; throw error; });
    return baseline;
  }

  async function assessApproved(job, references) {
    const pairs = job.evidence.filter(item => item.status === 'approved' && !item.assessment).map(item => {
      const match = nearest(item,references,embeddingModel);
      if (!match) throw Object.assign(new Error('The selected reference is unavailable. Please score the CV again.'), {status:409});
      return {id:item.id,quote:item.quote,dimension:item.dimension,reference:{id:match.ref.id,statement:match.ref.statement,band:match.ref.band,cap:match.ref.cap}};
    });
    if (!pairs.length) return;
    const assessments = await provider.assessCeilings(pairs,position);
    if (!Array.isArray(assessments) || assessments.length !== pairs.length) throw Object.assign(new Error('The model returned incomplete ceiling assessments. Please retry.'), {status:502});
    const expected = new Map(pairs.map(pair => [pair.id,pair]));
    const seen = new Set();
    for (const assessment of assessments) {
      if (!assessment || !expected.has(assessment.id) || seen.has(assessment.id) || !Number.isFinite(assessment.fulfillment) || assessment.fulfillment < 0 || assessment.fulfillment > 1 || typeof assessment.reason !== 'string' || !assessment.reason.trim() || assessment.reason.length > 2500) throw Object.assign(new Error('The model returned invalid ceiling assessments. Please retry.'), {status:502});
      seen.add(assessment.id);
    }
    for (const assessment of assessments) {
      const item = job.evidence.find(item => item.id === assessment.id);
      item.assessment = {referenceId:expected.get(item.id).reference.id,fulfillment:assessment.fulfillment,reason:assessment.reason,model:LUNA_MODEL};
    }
  }

  function publicJob(job) {
    const { details, pending, ...result } = job.result;
    return { ...result,...(job.candidateProfile?{candidateProfile:job.candidateProfile}:{}), position:{id:position.id,version:position.version,name:position.name,rubric:position.rubric.map(({id,title,max,bands})=>({id,title,max,bands}))}, pending: pending.map(({id,quote,statement,reason,dimension,band}) => ({id,quote,statement,reason,dimension,band,cap:getBand(dimension,band,rubric)[1]})) };
  }

  function assertJob(job,{review=false}={}){
    if(!job||Date.now()-job.createdAt>24*3600000)throw Object.assign(new Error('This review has expired. Please score the CV again.'),{status:404});
    if(job.scoringUnit!==SCORING_UNIT)throw Object.assign(new Error('Scoring now uses full sentences. Please upload and score this CV again.'),{status:409});
    if(job.scoringFormula!==SCORING_FORMULA)throw Object.assign(new Error('Scoring rules changed. Please upload and score this CV again.'),{status:409});
    if(review&&job.embeddingModel!==embeddingModel)throw Object.assign(new Error('The embedding configuration changed. Please score the CV again.'),{status:409});
  }
  const modelRefs=state=>state.references.filter(ref=>ref.embeddingModel===embeddingModel);
  function assertPlan(state,snapshot,keys){
    if(!isDeepStrictEqual(modelRefs(state),modelRefs(snapshot))||keys.some(key=>!isDeepStrictEqual(state.mappings[key],snapshot.mappings[key])))throw new PlanningConflict();
  }
  const busy=()=>Object.assign(new Error('Scoring data changed during processing. Please retry.'),{status:409});

  async function analyze(workspace,text,metadata={}){
    const fileName=validateFileName(metadata.fileName);
    if(typeof text!=='string'||text.trim().length<10||text.length>100000)throw Object.assign(new Error('Use a CV containing 10–100,000 characters of readable text.'),{status:400});
    const extracted=await provider.extractEvidence(text,position),candidateProfile=validateProfile(extracted.candidateProfile,text),output=validateEvidence(extracted,text,rubric);
    const vectors=await provider.embed(output.map(item=>item.statement));
    const id=randomUUID(),createdAt=Date.now(),items=output.map((item,index)=>({...item,id:randomUUID(),vector:vectors[index]})),keys=items.map(item=>item.key);
    for(let attempt=0;attempt<3;attempt++){
      const snapshot=await store.readScoring(workspace,{embeddingModel,mappingKeys:keys});
      const existing=modelRefs(snapshot),seeds=existing.length?[]:await initialReferences(),references=existing.length?existing:structuredClone(seeds);
      const job={id,candidateProfile,...(fileName?{fileName}:{}),scoringUnit:SCORING_UNIT,scoringFormula:SCORING_FORMULA,createdAt,position:structuredClone(position),embeddingModel,referenceVersion:snapshot.version,evidence:items.map(item=>{
        const mapping=snapshot.mappings[item.key],evidence={...item,status:'pending'};
        if(mapping?.action==='reject')return {...evidence,status:'rejected'};
        if(mapping?.dimension)evidence.dimension=mapping.dimension;
        const match=nearest(evidence,references,embeddingModel);
        if(match)evidence.band=match.ref.band;
        if(match&&match.similarity>0&&match.similarity>=threshold){evidence.status='approved';evidence.referenceId=match.ref.id;}
        return evidence;
      })};
      // Network I/O finishes before entering the short commit transaction.
      await assessApproved(job,references);
      try{return await store.update(workspace,state=>{
        assertPlan(state,snapshot,keys);
        if(state.deletedCandidates?.[id])throw Object.assign(new Error('This CV was deleted.'),{status:404});
        if(!modelRefs(state).length)state.references.push(...structuredClone(seeds));
        const now=Date.now();for(const [jobId,stored] of Object.entries(state.jobs))if(now-stored.createdAt>24*3600000)delete state.jobs[jobId];
        const jobs=Object.values(state.jobs).sort((a,b)=>a.createdAt-b.createdAt);while(jobs.length>=20)delete state.jobs[jobs.shift().id];
        job.referenceVersion=state.version;job.result=calculate(job,state.references,embeddingModel,rubric);state.jobs[id]=job;return publicJob(job);
      });}catch(error){if(!(error instanceof PlanningConflict))throw error;}
    }
    throw busy();
  }

  async function review(workspace,jobId,input){
    if(!Array.isArray(input)||!input.length||input.length>36)throw Object.assign(new Error('Provide review decisions.'),{status:400});
    const decisions=structuredClone(input);decisions.forEach(decision=>validateDecision(decision,rubric));
    if(new Set(decisions.map(d=>d.id)).size!==decisions.length)throw Object.assign(new Error('Duplicate decisions are not allowed.'),{status:400});
    const approved=decisions.filter(d=>d.action==='approve');let prepared;
    for(let attempt=0;attempt<3;attempt++){
      const snapshot=await store.readScoring(workspace,{jobId,embeddingModel}),original=snapshot.jobs[jobId];assertJob(original,{review:true});
      if(decisions.some(d=>!original.evidence.some(e=>e.id===d.id&&e.status==='pending')))throw Object.assign(new Error('This review changed. Reload the result and try again.'),{status:409});
      if(!prepared){const vectors=await provider.embed(approved.map(d=>d.statement.trim()));prepared=approved.map((d,index)=>({id:randomUUID(),dimension:d.dimension,band:d.band,cap:d.cap,statement:d.statement.trim(),vector:vectors[index],embeddingModel,source:'human',sourceJobId:jobId,approvedAt:new Date().toISOString()}));}
      const job=structuredClone(original),references=[...modelRefs(snapshot),...prepared],mappings={};
      for(const d of decisions){const item=job.evidence.find(e=>e.id===d.id);item.status=d.action==='approve'?'approved':'rejected';
        if(d.action==='approve'){const ref=prepared[approved.indexOf(d)];item.dimension=d.dimension;item.band=d.band;item.referenceId=ref.id;mappings[item.key]={action:'approve',sourceJobId:jobId,dimension:d.dimension,referenceId:ref.id};}
        else mappings[item.key]={action:'reject',sourceJobId:jobId};
      }
      await assessApproved(job,references);
      try{return await store.update(workspace,state=>{
        const current=state.jobs[jobId];assertJob(current,{review:true});
        if(!isDeepStrictEqual(current,original))throw new PlanningConflict();
        assertPlan(state,snapshot,Object.keys(mappings));
        state.references.push(...structuredClone(prepared));Object.assign(state.mappings,mappings);state.version++;job.referenceVersion=state.version;
        job.result=calculate(job,state.references,embeddingModel,rubric);state.jobs[jobId]=job;return publicJob(job);
      });}catch(error){if(!(error instanceof PlanningConflict))throw error;}
    }
    throw busy();
  }

  async function get(workspace,id){const job=await store.readJob(workspace,id);assertJob(job);return publicJob(job);}
  return { analyze, review, get };
}

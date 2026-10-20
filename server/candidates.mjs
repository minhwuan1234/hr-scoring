import {emptyProfile} from './profile.mjs';
import {isDeepStrictEqual} from 'node:util';
import {DEFAULT_POSITION,positionScope} from './positions.mjs';

// Keep lightweight score snapshots independently of expiring review jobs.
export function archiveCandidates(state){
 state.candidates??={};
 for(const [id,details] of Object.entries(state.deletedCandidates || {})){
  delete state.jobs?.[id];delete state.candidates[id];
  for(const key of details?.sentenceKeys || [])delete state.mappings[key];
  const refs=new Set(details?.referenceIds || []);state.references=state.references.filter(r=>!refs.has(r.id));
 }
 for(const m of Object.values(state.mappings))if(state.deletedCandidates?.[m.sourceJobId])delete m.sourceJobId;
 for(const job of Object.values(state.jobs || {})){
  if(!job.result || !Array.isArray(job.result.dimensions))continue;
  const p=job.position || DEFAULT_POSITION,old=state.candidates[job.id];
  const snapshot={id:job.id,cvAvailable:old?.cvAvailable || false,candidateProfile:job.candidateProfile || old?.candidateProfile || emptyProfile(),fileName:job.fileName || old?.fileName || 'Previously scored CV',positionId:p.id,positionVersion:p.version,positionName:p.name,createdAt:job.createdAt,state:job.result.state,total:job.result.total,pendingCount:job.result.pending?.length || 0,dimensions:job.result.dimensions.map(d=>({...d,title:p.rubric.find(c=>c.id===d.id)?.title || d.id}))};
  const {updatedAt,...before}=old || {};
  state.candidates[job.id]={...snapshot,updatedAt:isDeepStrictEqual(snapshot,before)?updatedAt:Date.now()};
 }
}
export function validateFileName(value){
 if(value===undefined)return undefined;
 if(typeof value!=='string'||!value.trim()||value.length>255||/[\u0000-\u001f]/.test(value))throw Object.assign(new Error('Use a CV filename containing 1–255 characters.'),{status:400});
 return value.trim();
}
export async function fileCandidates(store,owner){
 const templates=await store.update(owner,state=>Object.values(state.positions || {}).flat());
 const scopes=new Set([owner,...templates.map(p=>positionScope(owner,p))]);
 const results=[];
 for(const scope of scopes)results.push(...await store.update(scope,state=>Object.values(state.candidates || {})));
 return results.sort((a,b)=>b.createdAt-a.createdAt || a.id.localeCompare(b.id));
}
export function candidateRow(row){return {id:row.job_id,cvAvailable:row.cv_available || false,candidateProfile:{name:row.candidate_name || null,phone:row.phone || null,email:row.email || null,linkedinUrl:row.linkedin_url || null},fileName:row.file_name,positionId:row.position_id,positionVersion:row.position_version,positionName:row.position_name,createdAt:Number(row.created_at_ms),updatedAt:Number(row.updated_at_ms),state:row.result_state,total:Number(row.total),pendingCount:row.pending_count,dimensions:row.dimensions};}

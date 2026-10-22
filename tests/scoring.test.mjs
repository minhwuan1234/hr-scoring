import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cosine, calculate, validateDecision, validateEvidence } from '../server/engine.mjs';
import { createStore, workspaceId } from '../server/store.mjs';
import { cvSentences, sentenceKey, MAX_EVIDENCE_SENTENCES, SCORING_UNIT } from '../server/sentences.mjs';
import { createScoringService } from '../server/service.mjs';

const model = 'test-embedding';
const fullAssessment = async pairs => pairs.map(pair=>({id:pair.id,fulfillment:1,reason:'All ceiling requirements demonstrated.'}));
const ref = { id:'ref', dimension:'learning-drive', cap:30, band:2, statement:'Repeated independent learning applied to concrete outputs.', vector:[1,0], embeddingModel:model };
const ev = { id:'e',key:'self taught',keyword:'self taught',quote:'self taught Excel',statement:'Applied self-directed learning',dimension:'learning-drive',band:2,vector:[0.8,0.6],status:'approved',assessment:{referenceId:'ref',fulfillment:0.4,reason:'Partial ceiling fulfillment.'} };

test('retrieval match 80 percent and independent fulfillment 40 percent produce 24.6, not 28.2', () => {
  assert.equal(cosine([0.8,0.6],[1,0]),0.8);
  const result=calculate({id:'job',evidence:[ev],referenceVersion:1},[ref],model);
  assert.equal(result.total,24.6);
  assert.equal(result.dimensions[0].score,24.6);
  assert.equal(result.state,'complete');
});

test('unapproved or rejected evidence never earns points', () => {
  const result=calculate({id:'job',evidence:[{...ev,status:'pending'},{...ev,id:'e2',key:'other',status:'rejected'}]},[ref],model);
  assert.equal(result.total,0); assert.equal(result.state,'review');
});

test('the same sentence cannot earn points in two houses even with different fragment keys', () => {
  const result=calculate({id:'job',evidence:[ev,{...ev,key:'different fragment',dimension:'tools'}]},[ref,{...ref,id:'tool',dimension:'tools',cap:3}],model);
  assert.equal(result.total,24.6); assert.equal(result.dimensions.find(d=>d.id==='tools').score,0);
});

test('a full sentence stays intact and cannot become multiple fragment reviews', () => {
  const source='Project leader of two communication campaigns: managed a 5-designer team, designed core media assets, and supervised timelines and quality standards for all deliverables.';
  const record={sentenceId:'s1',statement:'Led campaign delivery and team coordination.',reason:'Project ownership.',dimension:'process',band:2};
  const records=validateEvidence({evidence:[record,{...record,dimension:'execution'},{...record,dimension:'employer-branding'}]},source);
  assert.equal(records.length,1); assert.equal(records[0].quote,source);
  assert.equal(records[0].dimension,'process');
});

test('identical sentences across bullets and PDF line wrapping share one key', () => {
  const source='• Learned Sheets and built a tracker.\n• Learned Sheets and\nbuilt a tracker.\n• Learned Excel and built a tracker.';
  const sentences=cvSentences(source);
  assert.equal(sentences.length,3);
  assert.equal(sentences[0].key,sentences[1].key);
  assert.notEqual(sentences[0].key,sentences[2].key);
  const record=sentenceId=>({sentenceId,statement:'Applied learning.',reason:'Evidence.',dimension:'learning-drive',band:1});
  assert.equal(validateEvidence({evidence:sentences.map(s=>record(s.sentenceId))},source).length,2);
  assert.equal(sentenceKey('Learned Sheets.'),sentenceKey('learned Sheets'));
});

test('omits unpunctuated bullets and keeps only complete period-terminated sentences', () => {
  const source='• Managed a team, built trackers; followed up weekly\n• Learned a tool and applied it\n\nI wrote content. I scheduled interviews.';
  assert.deepEqual(cvSentences(source).map(s=>s.quote),['I wrote content.','I scheduled interviews.']);
});

test('rejects invented sentence IDs and keyword-only provider output', () => {
  const item={sentenceId:'s99',statement:'Claim.',reason:'Reason.',dimension:'tools',band:1};
  assert.throws(()=>validateEvidence({evidence:[item]},'Actual CV text'),/verified/);
  assert.throws(()=>validateEvidence({evidence:[{...ev,reason:'x'}]},'Actual CV text'),/invalid sentence/);
});

test('honors a human-selected reference cap even when a seeded reference is identical', () => {
  const references=[ref,{...ref,id:'human',cap:18,band:1}];
  const result=calculate({id:'job',evidence:[{...ev,vector:[1,0],referenceId:'human',assessment:{referenceId:'human',fulfillment:1}}]},references,model);
  assert.equal(result.total,18);
});

test('does not inflate a dimension by adding many overlapping evidence matches', () => {
  const result=calculate({id:'job',evidence:[ev,{...ev,key:'other sentence',quote:'Learned Sheets and applied it in a project.',vector:[1,0],assessment:{referenceId:'ref',fulfillment:1}}]},[ref],model);
  assert.equal(result.total,30);
});

test('caps must fall within the exact original rubric band', () => {
  assert.throws(()=>validateDecision({id:'e',action:'approve',dimension:'learning-drive',band:1,cap:21,statement:'x'}),/inside/);
  assert.throws(()=>validateDecision({id:'e',action:'approve',dimension:'process',band:2,cap:3,statement:'x'}),/inside/);
  validateDecision({id:'e',action:'approve',dimension:'process',band:2,cap:4,statement:'x'});
});

test('embedding models and vector lengths cannot be mixed', () => {
  assert.throws(()=>cosine([1,0],[1]),/Incompatible/);
  assert.equal(calculate({id:'job',evidence:[ev]},[ref],'another-model').total,0);
});

test('human decisions persist and can be reused without sending raw CV text to storage', async () => {
  const directory=await mkdtemp(join(tmpdir(),'hr-scoring-test-'));
  const store=createStore({databaseUrl:null,directory});
  const workspace=workspaceId('a'.repeat(64));
  const provider={assessCeilings:fullAssessment,
    embed:async texts=>texts.map(text=>text === 'Applied independent learning to a tracker.' ? [1,0] : [0,1]),
    extractEvidence:async()=>({evidence:[{sentenceId:'s1',statement:'Applied independent learning to a tracker.',reason:'Learned and applied.',dimension:'learning-drive',band:1}]}),
  };
  try {
    const service=createScoringService(store,provider,model);
    const job=await service.analyze(workspace,'I self taught Excel and built a tracker.');
    assert.equal(job.state,'review'); assert.equal(job.total,0);
    assert.equal('vector' in job.pending[0],false);
    const decision={...job.pending[0],action:'approve',dimension:'learning-drive',band:1,cap:18};
    const reviewed=await service.review(workspace,job.id,[decision]);
    assert.equal(reviewed.state,'complete'); assert.equal(reviewed.total,18);
    await assert.rejects(()=>service.review(workspace,job.id,[decision]),error=>error.status===409);
    const reopened=createScoringService(createStore({databaseUrl:null,directory}),provider,model);
    const next=await reopened.analyze(workspace,'I self taught Excel and built a tracker.');
    assert.equal(next.state,'complete'); assert.equal(next.total,18);
    await assert.rejects(()=>reopened.get(workspaceId('b'.repeat(64)),job.id),error=>error.status===404);
    const saved=await service.get(workspace,job.id);
    assert.equal(saved.version,reviewed.version); assert.equal(saved.total,18);
    await store.update(workspace,state=>{ delete state.jobs[job.id].scoringFormula; });
    await assert.rejects(()=>service.get(workspace,job.id),error=>error.status===409 && /rules changed/.test(error.message));
    await assert.rejects(()=>service.review(workspace,job.id,[decision]),error=>error.status===409 && /rules changed/.test(error.message));
    await store.update(workspace,state=>{ delete state.jobs[job.id].scoringUnit; });
    await assert.rejects(()=>service.get(workspace,job.id),error=>error.status===409 && /Sentence extraction rules changed/.test(error.message));
    await assert.rejects(()=>service.review(workspace,job.id,[decision]),error=>error.status===409 && /Sentence extraction rules changed/.test(error.message));
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test('rejection completes review with zero points and is remembered', async () => {
  const directory=await mkdtemp(join(tmpdir(),'hr-reject-test-'));
  const store=createStore({databaseUrl:null,directory});
  const provider={assessCeilings:fullAssessment,embed:async texts=>texts.map(text=>text === 'Exposure to Excel.' ? [1,0] : [0,1]),extractEvidence:async()=>({evidence:[{sentenceId:'s1',statement:'Exposure to Excel.',reason:'Tool exposure.',dimension:'tools',band:1}]})};
  try {
    const service=createScoringService(store,provider,model);
    const job=await service.analyze('workspace','Used Excel for a school task.');
    const result=await service.review('workspace',job.id,[{id:job.pending[0].id,action:'reject'}]);
    assert.equal(result.total,0); assert.equal(result.state,'complete');
    assert.equal((await service.analyze('workspace','Used Excel for a school task.')).state,'complete');
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('workspace capability tokens must be cryptographically sized',()=>{
  assert.throws(()=>workspaceId('short'),/workspace/);
  assert.notEqual(workspaceId('a'.repeat(64)),workspaceId('b'.repeat(64)));
});

test('band interpolation respects floors, human caps and zero-width bands', () => {
  const score = (fulfillment,reference) => calculate({id:'job',evidence:[{...ev,referenceId:reference.id,dimension:reference.dimension,assessment:{referenceId:reference.id,fulfillment}}]},[reference],model).total;
  assert.equal(score(0,ref),21);
  assert.equal(score(1,ref),30);
  assert.equal(score(0.8,{...ref,cap:18,band:1}),16.4);
  assert.equal(score(0.8,{...ref,dimension:'process',cap:4,band:2}),4);
  assert.equal(score(0.8,{...ref,dimension:'tools',cap:0,band:0}),0);
});

test('selects the most similar reference, not the highest cap or model-suggested band', () => {
  const refs=[ref,{...ref,id:'closest',vector:[0.8,0.6],band:1,cap:18}];
  const result=calculate({id:'job',evidence:[{...ev,assessment:{referenceId:'closest',fulfillment:1}}]},refs,model);
  assert.equal(result.details[0].referenceId,'closest');
  assert.equal(result.total,18);
});

test('new sentences auto-score above the threshold and request review below it, including zero', async () => {
  const directory=await mkdtemp(join(tmpdir(),'hr-auto-match-'));
  const store=createStore({databaseUrl:null,directory});
  let vector=[0.9,Math.sqrt(0.19)];
  let assessmentCalls=0;
  const provider={assessCeilings:async pairs=>{assessmentCalls++;return pairs.map(pair=>({id:pair.id,fulfillment:0.4,reason:'Partial execution evidence.'}));},embed:async texts=>texts.map(()=>vector),extractEvidence:async()=>({evidence:[{sentenceId:'s1',statement:'Applied learning.',reason:'Evidence.',dimension:'learning-drive',band:0}]})};
  try {
    const service=createScoringService(store,provider,model);
    await store.update('workspace',state=>{state.references=[ref];});
    const automatic=await service.analyze('workspace','Learned a tool and applied it.');
    assert.equal(automatic.state,'complete'); assert.equal(automatic.total,24.6); assert.equal(automatic.pending.length,0);
    vector=[0.70,Math.sqrt(1-0.70**2)];
    assert.equal((await service.analyze('workspace','Built a tracker after learning Sheets.')).state,'complete');
    for(const similarity of [0.699,0]) {
      vector=[similarity,Math.sqrt(1-similarity**2)];
      const pending=await service.analyze('workspace','Practiced a new tool in a project.');
      assert.equal(pending.state,'review'); assert.equal(pending.total,0); assert.equal(pending.pending.length,1);
      assert.equal(assessmentCalls,2);
    }
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('a known sentence searches all references in its approved house instead of staying on an old cap', async () => {
  const directory=await mkdtemp(join(tmpdir(),'hr-nearest-cap-'));
  const store=createStore({databaseUrl:null,directory});
  const text='Learned Sheets and applied it in a project.';
  const provider={assessCeilings:fullAssessment,embed:async texts=>texts.map(()=>[1,0]),extractEvidence:async()=>({evidence:[{sentenceId:'s1',statement:'Applied learning.',reason:'Evidence.',dimension:'tools',band:0}]})};
  try {
    await store.update('workspace',state=>{
      state.references=[ref,{...ref,id:'old-human',cap:18,band:1,vector:[0,1]}];
      state.mappings[sentenceKey(text)]={action:'approve',dimension:'learning-drive',referenceId:'old-human'};
    });
    const result=await createScoringService(store,provider,model).analyze('workspace',text);
    assert.equal(result.state,'complete'); assert.equal(result.total,30);
    const stored=await store.update('workspace',state=>state.jobs[result.id]);
    assert.equal(stored.evidence[0].referenceId,'ref');
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('retrieval similarity cannot substitute for a missing or stale ceiling assessment',()=>{
  for(const assessment of [undefined,{referenceId:'another',fulfillment:0.4},{referenceId:'ref',fulfillment:1.1}]) {
    assert.throws(()=>calculate({id:'job',evidence:[{...ev,vector:[1,0],assessment}]},[ref],model),/separate ceiling assessment/);
  }
  for(const vector of [[1,0],[0.8,0.6],[0.7,Math.sqrt(0.51)]]) {
    assert.equal(calculate({id:'job',evidence:[{...ev,vector}]},[ref],model).total,24.6);
  }
});

test('human approval gets a separate ceiling assessment and saves the independent result',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'hr-human-ceiling-'));
  const store=createStore({databaseUrl:null,directory});
  const quote='I learned Sheets and applied it to a tracker.';
  let calls=0;
  const provider={
    embed:async texts=>texts.map(text=>text === 'Applied learning.' || text === 'Built a tracker independently.' ? [1,0] : [0,1]),
    extractEvidence:async()=>({evidence:[{sentenceId:'s1',statement:'Applied learning.',reason:'Evidence.',dimension:'learning-drive',band:1}]}),
    assessCeilings:async pairs=>{calls++;assert.equal(pairs[0].quote,quote);assert.equal(pairs[0].reference.statement,'Built a tracker independently.');assert.equal('similarity' in pairs[0],false);return pairs.map(pair=>({id:pair.id,fulfillment:0.25,reason:'Limited demonstrated scope.'}));},
  };
  try {
    const service=createScoringService(store,provider,model);
    const pending=await service.analyze('workspace',quote);
    assert.equal(calls,0);
    const result=await service.review('workspace',pending.id,[{...pending.pending[0],action:'approve',dimension:'learning-drive',band:1,cap:18,statement:'Built a tracker independently.'}]);
    assert.equal(result.total,12); assert.equal(calls,1);
    const saved=await store.update('workspace',state=>state.jobs[result.id]);
    assert.equal(saved.evidence[0].assessment.fulfillment,0.25);
    assert.equal(saved.result.details[0].similarity,1);
    assert.equal((await service.get('workspace',result.id)).total,12);assert.equal(calls,1);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('invalid separate assessments fail atomically rather than falling back to retrieval similarity',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'hr-invalid-ceiling-'));
  const store=createStore({databaseUrl:null,directory});
  const provider={embed:async texts=>texts.map(()=>[1,0]),extractEvidence:async()=>({evidence:[{sentenceId:'s1',statement:'Applied learning.',reason:'Evidence.',dimension:'learning-drive',band:2}]})};
  try {
    await store.update('workspace',state=>{state.references=[ref];});
    const cases=[()=>[],pairs=>[{id:'invented',fulfillment:0.4,reason:'x'}],pairs=>[{id:pairs[0].id,fulfillment:1.5,reason:'x'}],pairs=>[{id:pairs[0].id,fulfillment:NaN,reason:'x'}],pairs=>[{id:pairs[0].id,fulfillment:0.4,reason:''}]];
    for(const invalid of cases) {
      const service=createScoringService(store,{...provider,assessCeilings:async pairs=>invalid(pairs)},model);
      await assert.rejects(()=>service.analyze('workspace','Learned and applied a new tool.'),error=>error.status===502);
      assert.equal(await store.update('workspace',state=>Object.keys(state.jobs).length),0);
    }
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('period extraction preserves wrapped clauses, abbreviations, numbers and closing quotes',()=>{
 const first='Dr. Lee supported U.S. campaigns, e.g. email content; increased conversion by 3.5% and\nreported results at example.com.';
 const source=`• ${first}\n• "Learned Sheets, built a tracker, and followed up weekly."\n• Unfinished activity without a period`;
 assert.deepEqual(cvSentences(source).map(s=>s.quote),[first.replace(/\s+/g,' '),'"Learned Sheets, built a tracker, and followed up weekly."']);
 assert.deepEqual(cvSentences('Managed a team!\n\nLearned a tool?\n\nUnfinished tail'),[]);
 assert.deepEqual(cvSentences('First complete sentence. second complete sentence. Unfinished tail').map(s=>s.quote),['First complete sentence.','second complete sentence.']);
});
test('selection is capped at ten relevant sentences, without discarding later source sentences',()=>{
 const cv=Array.from({length:15},(_,i)=>`Delivered project ${i+1}, documented output and coordinated delivery.`).join(' '),sentences=cvSentences(cv);
 assert.equal(sentences.length,15);assert.equal(MAX_EVIDENCE_SENTENCES,10);
 const evidence=sentences.slice(5).map(s=>({sentenceId:s.sentenceId,statement:'Coordinated delivery and documented output.',reason:'Project evidence.',dimension:'learning-drive',band:1}));
 const selected=validateEvidence({evidence},cv);assert.equal(selected.length,10);assert.equal(selected.at(-1).quote,sentences[14].quote);
 assert.throws(()=>validateEvidence({evidence:[{...evidence[0],sentenceId:'s1'},...evidence]},cv),e=>e.code==='MODEL_EVIDENCE_INVALID');
});
test('long complete sentences retain the ending context and existing reusable decision keys',()=>{
 const cv='Coordinated campaign deliverables, '.repeat(120)+'but did not own the hiring process.';
 const [sentence]=cvSentences(cv);assert.equal(sentence.quote,cv);
 const [selected]=validateEvidence({evidence:[{sentenceId:sentence.sentenceId,statement:'Supported campaign execution without hiring ownership.',reason:'Explicitly limited scope.',dimension:'employer-branding',band:1}]},cv);
 assert.equal(selected.quote,cv);assert.match(selected.quote,/but did not own the hiring process\.$/);
 assert.equal(SCORING_UNIT,'sentence-period-v2');assert.match(selected.key,/^sentence-v1:/);
});
test('a CV with ten selected whole sentences can ask at most ten human review questions',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'sentence-limit-')),store=createStore({databaseUrl:null,directory});
 const text=Array.from({length:12},(_,i)=>`Learned tool ${i+1}, applied it to a project and documented the result.`).join(' ');
 const provider={extractEvidence:async()=>({evidence:cvSentences(text).slice(2).map(s=>({sentenceId:s.sentenceId,statement:'Applied a newly learned tool.',reason:'Learning applied.',dimension:'learning-drive',band:1}))}),embed:async values=>values.map(v=>v==='Applied a newly learned tool.'?[1,0]:[0,1]),assessCeilings:fullAssessment};
 try{
  const result=await createScoringService(store,provider,'test-model').analyze('owner',text);
  assert.equal(result.pending.length,10);assert.equal(new Set(result.pending.map(p=>p.quote)).size,10);assert.ok(result.pending.every(p=>p.quote.endsWith('.')&&p.quote.includes('documented the result')));
  assert.equal(Object.keys((await store.readScoring('owner')).jobs).length,1);
 }finally{await store.close();await rm(directory,{recursive:true,force:true});}
});

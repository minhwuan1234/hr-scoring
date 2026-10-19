import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cosine, calculate, validateDecision, validateEvidence } from '../server/engine.mjs';
import { createStore, workspaceId } from '../server/store.mjs';
import { createScoringService } from '../server/service.mjs';

const model = 'test-embedding';
const ref = { id:'ref', dimension:'learning-drive', cap:30, band:2, vector:[1,0], embeddingModel:model };
const ev = { id:'e',key:'self taught',keyword:'self taught',quote:'self taught Excel',statement:'Applied self-directed learning',dimension:'learning-drive',band:2,vector:[0.8,0.6],status:'approved' };

test('computes percentage of the selected reference cap, rounded once per dimension', () => {
  assert.equal(cosine([0.8,0.6],[1,0]),0.8);
  const result=calculate({id:'job',evidence:[ev],referenceVersion:1},[ref],model);
  assert.equal(result.total,24);
  assert.equal(result.dimensions[0].score,24);
  assert.equal(result.state,'complete');
});

test('unapproved or rejected evidence never earns points', () => {
  const result=calculate({id:'job',evidence:[{...ev,status:'pending'},{...ev,id:'e2',key:'other',status:'rejected'}]},[ref],model);
  assert.equal(result.total,0); assert.equal(result.state,'review');
});

test('the same exact phrase cannot earn points in two houses', () => {
  const result=calculate({id:'job',evidence:[ev,{...ev,dimension:'tools'}]},[ref,{...ref,id:'tool',dimension:'tools',cap:3}],model);
  assert.equal(result.total,24); assert.equal(result.dimensions.find(d=>d.id==='tools').score,0);
});

test('synonyms remain separate while duplicate exact phrases are removed', () => {
  const source='I self taught Excel. I studied independently. I self taught Excel.';
  const record=(keyword,quote)=>({keyword,quote,statement:'Applied learning',reason:'Direct quote',dimension:'learning-drive',band:1});
  const records=validateEvidence({evidence:[record('self taught','I self taught Excel.'),record('studied independently','I studied independently.'),record('self taught','I self taught Excel.')]},source);
  assert.equal(records.length,2); assert.notEqual(records[0].key,records[1].key);
});

test('rejects model evidence that was not present in the CV', () => {
  assert.throws(()=>validateEvidence({evidence:[{...ev,reason:'x',quote:'Fabricated claim'}]},'Actual CV text'),/verified/);
});

test('honors a human-selected reference cap even when a seeded reference is identical', () => {
  const references=[ref,{...ref,id:'human',cap:18,band:1}];
  const result=calculate({id:'job',evidence:[{...ev,vector:[1,0],referenceId:'human'}]},references,model);
  assert.equal(result.total,18);
});

test('does not inflate a dimension by adding many overlapping evidence matches', () => {
  const result=calculate({id:'job',evidence:[ev,{...ev,key:'synonym',vector:[1,0]}]},[ref],model);
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
  const provider={
    embed:async texts=>texts.map(()=>[1,0]),
    extractEvidence:async()=>({evidence:[{keyword:'self taught',quote:'I self taught Excel and built a tracker.',statement:'Applied independent learning to a tracker.',reason:'Learned and applied.',dimension:'learning-drive',band:1}]}),
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
  } finally { await rm(directory,{recursive:true,force:true}); }
});

test('rejection completes review with zero points and is remembered', async () => {
  const directory=await mkdtemp(join(tmpdir(),'hr-reject-test-'));
  const store=createStore({databaseUrl:null,directory});
  const provider={embed:async texts=>texts.map(()=>[1,0]),extractEvidence:async()=>({evidence:[{keyword:'Excel',quote:'Used Excel for a school task.',statement:'Exposure to Excel.',reason:'Tool exposure.',dimension:'tools',band:1}]})};
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

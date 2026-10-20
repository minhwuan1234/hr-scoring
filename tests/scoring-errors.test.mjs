import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStore,workspaceId} from '../server/store.mjs';
import {createScoringService} from '../server/service.mjs';
import {validateEvidence} from '../server/engine.mjs';
import {failureReport} from '../server/failure-report.mjs';

const text='Learned Sheets and applied it to a project tracker.';
const item={sentenceId:'s1',dimension:'learning-drive',band:1,statement:'Applied self-directed learning.',reason:'Learned and applied.'};
async function fixture(run){
 const directory=await mkdtemp(join(tmpdir(),'hr-recovery-')),store=createStore({databaseUrl:null,directory}),workspace=workspaceId('a'.repeat(64));
 try{await run({store,workspace,directory});}finally{await store.close();await rm(directory,{recursive:true,force:true});}
}
test('unknown sentences and invalid criterion-band combinations are typed 502 failures',()=>{
 for(const invalid of [{...item,sentenceId:'s999'},{...item,dimension:'missing'},{...item,band:99}]){
  assert.throws(()=>validateEvidence({evidence:[invalid]},text),e=>e.status===502&&e.code.startsWith('MODEL_'));
 }
});
test('invalid extraction regenerates once and saves only the verified sentence',()=>fixture(async({store,workspace})=>{
 let calls=0;
 const provider={extractEvidence:async()=>({evidence:[++calls===1?{...item,sentenceId:'s999'}:item]}),embed:async texts=>texts.map(()=>[1,0]),assessCeilings:async pairs=>pairs.map(p=>({id:p.id,fulfillment:0.5,reason:'Partial demonstrated application.'}))};
 const result=await createScoringService(store,provider,'test').analyze(workspace,text);
 assert.equal(calls,2);assert.equal(result.total,4.5);
 const rows=await store.candidates(workspace);assert.equal(rows.length,1);
}));
test('repeated invalid evidence stops after two attempts and never creates a score',()=>fixture(async({store,workspace,directory})=>{
 let calls=0,embeddings=0;
 const provider={extractEvidence:async()=>{calls++;return {evidence:[{...item,sentenceId:'s999'}]};},embed:async()=>{embeddings++;return []}};
 await assert.rejects(()=>createScoringService(store,provider,'test').analyze(workspace,text),e=>e.status===502&&e.stage==='evidence-extraction'&&e.code==='MODEL_SENTENCE_INVALID');
 assert.equal(calls,2);assert.equal(embeddings,0);
 await assert.rejects(()=>readFile(join(directory,`${workspace}.json`)),e=>e.code==='ENOENT');
}));
test('incomplete assessments regenerate once without accepting invented or duplicate IDs',()=>fixture(async({store,workspace})=>{
 let calls=0;
 const provider={extractEvidence:async()=>({evidence:[item]}),embed:async texts=>texts.map(()=>[1,0]),assessCeilings:async pairs=>++calls===1?[{id:'invented',fulfillment:1,reason:'Wrong ID.'}]:pairs.map(p=>({id:p.id,fulfillment:0.5,reason:'Partial demonstrated application.'}))};
 const result=await createScoringService(store,provider,'test').analyze(workspace,text);assert.equal(calls,2);assert.equal(result.total,4.5);
}));
test('failure diagnostics identify stage and request without logging private input or SQL',()=>{
 const error=Object.assign(new Error('CV: Private Name; SQL values; secret-key'),{code:'23505',stage:'scoring-commit',detail:'Private Name',query:'private SQL'});
 const report=failureReport(error,{url:'/api/jobs/private-cv-id/review?token=private-key'},'synthetic-request',17);
 assert.equal(report.status,500);assert.equal(report.log.route,'/api/jobs/:id/review');assert.equal(report.log.code,'23505');assert.equal(report.log.stage,'scoring-commit');
 assert.equal(report.data.requestId,'synthetic-request');
 assert.doesNotMatch(JSON.stringify(report),/Private Name|private-key|private-cv-id|secret-key|SQL values/);
});

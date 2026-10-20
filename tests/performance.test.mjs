import test from 'node:test';
import assert from 'node:assert/strict';
import {createStore} from '../server/store.mjs';
import {createPositionService} from '../server/positions.mjs';
import {createScoringService} from '../server/service.mjs';
import {deleteCandidates} from '../server/candidate-deletion.mjs';
import {sentenceKey} from '../server/sentences.mjs';
import {postgresPool} from './helpers/pglite.mjs';

const cv='Learned a tool and applied it to a project.';
const draft={name:'Account',rubric:[{title:'Delivery',max:100,bands:[[0,100,'Delivered projects.']],examples:[]}]};
const gate=()=>{let release;const promise=new Promise(resolve=>{release=resolve;});return {promise,release};};
async function deadline(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('An unrelated read waited on the model.')),2000);})]);}finally{clearTimeout(timer);}}
async function fixture(){
 const pg=await postgresPool(),sql=[];let active=0;
 const pool={query:(query,args)=>{sql.push(query);return pg.pool.query(query,args);},connect:async()=>{const c=await pg.pool.connect();active++;return {query:(query,args)=>{sql.push(query);return c.query(query,args);},release:()=>{active--;c.release();}};},end:()=>pg.pool.end()};
 const store=createStore({databaseUrl:null,pool});await store.initialize();const positions=createPositionService(store);await positions.list('owner');
 return {...pg,store,positions,sql,active:()=>active};
}
const evidence=()=>({evidence:[{sentenceId:'s1',statement:'Applied learning.',reason:'Applied a tool.',dimension:'learning-drive',band:1}]});

test('role, dashboard and one-CV reads remain responsive while assessment is waiting, with zero model-held connections',async t=>{
 const f=await fixture(),started=gate(),finish=gate();let block=false,seedCalls=0;
 const provider={extractEvidence:async()=>{assert.equal(f.active(),0);return evidence();},embed:async texts=>{assert.equal(f.active(),0);if(texts.length>1)seedCalls++;return texts.map(()=>[1,0]);},assessCeilings:async pairs=>{assert.equal(f.active(),0);if(block){started.release();await finish.promise;}return pairs.map(p=>({id:p.id,fulfillment:0.5,reason:'Partial evidence.'}));}};
 try{
  const service=createScoringService(f.store,provider,'test'),first=await service.analyze('owner',cv);block=true;
  const inFlight=service.analyze('owner',cv);await deadline(started.promise);assert.equal(f.active(),0);
  f.sql.length=0;
  const [roles,position,rows,saved]=await deadline(Promise.all([f.positions.list('owner'),f.positions.get('owner','hr-intern',1),f.store.candidates('owner'),service.get('owner',first.id)]));
  assert.equal(roles.length,1);assert.equal(position.name,'HR Intern');assert.equal(rows.length,1);assert.equal(saved.total,first.total);
  assert.equal(f.sql.length,4);assert.ok(f.sql.every(sql=>!sql.includes('hr_scoring_references')&&!sql.includes('pg_advisory')&&!sql.includes('embedding')&&!sql.includes('workspace_state')));
  t.diagnostic('Four UI reads use four narrow SELECTs; model waiting holds zero PostgreSQL leases.');
  finish.release();await inFlight;block=false;
  await createScoringService(f.store,provider,'test').analyze('owner',cv);
  assert.equal(seedCalls,1,'an existing embedding space must not be re-embedded after a service restart');
 }finally{finish.release();await f.store.close();}
});

test('a matching decision changed during a model call is replanned instead of committing a stale score',async()=>{
 const f=await fixture(),started=gate(),finish=gate();let calls=0;
 const provider={extractEvidence:async()=>evidence(),embed:async texts=>{assert.equal(f.active(),0);return texts.map(()=>[1,0]);},assessCeilings:async pairs=>{assert.equal(f.active(),0);calls++;started.release();await finish.promise;return pairs.map(p=>({id:p.id,fulfillment:1,reason:'Complete.'}));}};
 try{const task=createScoringService(f.store,provider,'test').analyze('owner',cv);await deadline(started.promise);
  await deadline(f.store.update('owner',s=>{s.mappings[sentenceKey(cv)]={action:'reject'};s.version++;}));finish.release();
  const result=await task;assert.equal(result.total,0);assert.equal(result.state,'complete');assert.equal(calls,1);
 }finally{finish.release();await f.store.close();}
});

test('deletion during review embedding completes immediately and a late model response cannot recreate the CV',async()=>{
 const f=await fixture(),started=gate(),finish=gate();let hold=false;
 const provider={extractEvidence:async()=>evidence(),embed:async texts=>{assert.equal(f.active(),0);if(hold){started.release();await finish.promise;}return texts.map(t=>t==='Applied learning.'?[1,0]:[0,1]);},assessCeilings:async pairs=>{assert.equal(f.active(),0);return pairs.map(p=>({id:p.id,fulfillment:1,reason:'Complete.'}));}};
 try{const service=createScoringService(f.store,provider,'test'),pending=await service.analyze('owner',cv);assert.equal(pending.state,'review');hold=true;
  const reviewing=service.review('owner',pending.id,[{...pending.pending[0],action:'approve',statement:'Applied learning.'}]);const failed=assert.rejects(reviewing,e=>e.status===404);
  await deadline(started.promise);await deadline(deleteCandidates(f.store,f.positions,'owner',[{id:pending.id,positionId:'hr-intern',positionVersion:1}]));finish.release();await failed;
  assert.equal((await f.store.candidates('owner')).length,0);assert.equal((await f.store.update('owner',s=>s.references.filter(r=>r.source==='human'))).length,0);
 }finally{finish.release();await f.store.close();}
});

test('two reviews of the same sentence have one winner without holding the lock while waiting for either model',async()=>{
 const f=await fixture(),started=gate(),finish=gate();
 const provider={extractEvidence:async()=>evidence(),embed:async texts=>{assert.equal(f.active(),0);return texts.map(t=>['Applied learning.','Human A','Human B'].includes(t)?[1,0]:[0,1]);},assessCeilings:async pairs=>{assert.equal(f.active(),0);if(pairs.some(p=>p.reference.statement==='Human A')){started.release();await finish.promise;}return pairs.map(p=>({id:p.id,fulfillment:0.5,reason:'Partial.'}));}};
 try{const service=createScoringService(f.store,provider,'test'),pending=await service.analyze('owner',cv),base={...pending.pending[0],action:'approve',dimension:'learning-drive',band:1,cap:18};
  const first=service.review('owner',pending.id,[{...base,statement:'Human A'}]),loser=assert.rejects(first,e=>e.status===409);await deadline(started.promise);
  const winner=await deadline(service.review('owner',pending.id,[{...base,statement:'Human B'}]));finish.release();await loser;
  assert.equal(winner.total,14);const refs=await f.store.update('owner',s=>s.references.filter(r=>r.source==='human'));assert.equal(refs.length,1);assert.equal(refs[0].statement,'Human B');
 }finally{finish.release();await f.store.close();}
});

test('editing the position catalog preserves legacy scoring writes and does not scan scoring tables',async()=>{
 const f=await fixture();
 try{
  await f.store.update('owner',s=>{s.mappings.existing={action:'reject'};});
  const legacy=(await f.db.query('SELECT payload FROM hr_scoring_workspace_state WHERE workspace_id=$1',['owner'])).rows[0].payload;legacy.mappings.fromLegacy={action:'reject'};
  await f.db.query('UPDATE hr_scoring_workspace_state SET payload=$2 WHERE workspace_id=$1',['owner',JSON.stringify(legacy)]);
  f.sql.length=0;const created=await f.positions.create('owner',draft);
  assert.ok(f.sql.every(sql=>!sql.includes('FROM hr_scoring_references')&&!sql.includes('FROM hr_scoring_evidence')&&!sql.includes('FROM hr_scoring_jobs')));
  assert.deepEqual(await f.store.update('owner',s=>s.mappings.fromLegacy),{action:'reject'});
  assert.equal((await f.positions.get('owner',created.id)).name,'Account');
 }finally{await f.store.close();}
});

test('ordinary writes do not rerun deletion and backup scrubbing for old tombstones',async()=>{
 const f=await fixture();
 try{
  await f.store.update('owner',s=>{s.candidates??={};s.candidates.example={id:'example',fileName:'Example.pdf',positionId:'hr-intern',positionVersion:1,positionName:'HR Intern',createdAt:Date.now(),updatedAt:Date.now(),state:'complete',total:0,pendingCount:0,dimensions:[]};});
  await deleteCandidates(f.store,f.positions,'owner',[{id:'example',positionId:'hr-intern',positionVersion:1}]);
  f.sql.length=0;await f.store.update('owner',s=>{s.version++;});
  assert.ok(f.sql.every(sql=>!sql.startsWith('UPDATE hr_scoring_schema_backups')&&!sql.startsWith('UPDATE hr_scoring_test_data_archive')&&!sql.startsWith('INSERT INTO hr_scoring_deleted_candidates')&&!sql.startsWith('DELETE FROM hr_scoring_candidates')));
 }finally{await f.store.close();}
});

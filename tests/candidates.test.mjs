import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../server/store.mjs';
import {createPositionService,positionScope} from '../server/positions.mjs';
import {createScoringService} from '../server/service.mjs';
import {postgresPool} from './helpers/pglite.mjs';

const draft={name:'Account',rubric:[{title:'Client delivery',max:100,bands:[[0,100,'Delivered client projects.']],examples:[]}]};
const cv='Delivered a client project and documented the outcome.';
for(const backend of ['file','postgresql'])test(`${backend}: dashboard history spans roles and versions, updates after review and survives job retention`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'candidate-history-'));
 const pg=backend==='postgresql'?await postgresPool():null;
 const store=createStore({databaseUrl:null,directory,...(pg?{pool:pg.pool}:{})});
 try{
  await store.initialize();const positions=createPositionService(store);
  const a=await positions.create('owner',draft),b=await positions.create('owner',{...draft,name:'Business Development'});
  let pending=false;
  const provider={embed:async texts=>texts.map(t=>t==='A new context.'?[0,1]:[1,0]),extractEvidence:async(text,p)=>({evidence:[{sentenceId:'s1',statement:pending?'A new context.':'Delivered client projects.',reason:'Demonstrated project delivery.',dimension:p.rubric[0].id,band:0}]}),assessCeilings:async pairs=>pairs.map(p=>({id:p.id,fulfillment:0.7,reason:'Demonstrated most of the required delivery.'}))};
  const scope=positionScope('owner',a),service=createScoringService(store,provider,'test-model',a);
  const first=await service.analyze(scope,cv,{fileName:'Candidate A.pdf'});
  assert.equal(first.total,70);
  await createScoringService(store,provider,'test-model',b).analyze(positionScope('owner',b),cv,{fileName:'Candidate B.pdf'});
  let rows=await store.candidates('owner');assert.equal(rows.length,2);assert.equal(rows.find(c=>c.id===first.id).fileName,'Candidate A.pdf');
  assert.deepEqual(await store.candidates('stranger'),[]);
  const before=structuredClone(rows);rows=await store.candidates('owner');assert.deepEqual(rows,before,'reading history must not change timestamps');
  pending=true;const review=await service.analyze(scope,cv,{fileName:'Pending.pdf'});assert.equal(review.state,'review');
  rows=await store.candidates('owner');assert.equal(rows.find(c=>c.id===review.id).state,'review');assert.equal(rows.find(c=>c.id===review.id).pendingCount,1);
  await service.review(scope,review.id,[{...review.pending[0],action:'approve',statement:'A new context.'}]);
  rows=await store.candidates('owner');assert.equal(rows.find(c=>c.id===review.id).state,'complete');assert.equal(rows.find(c=>c.id===review.id).total,70);assert.equal(rows.find(c=>c.id===review.id).pendingCount,0);
  const updated=await positions.update('owner',a.id,{...a,name:'Account II'});
  pending=false;await createScoringService(store,provider,'test-model',updated).analyze(positionScope('owner',updated),cv,{fileName:'New version.pdf'});
  rows=await store.candidates('owner');assert.deepEqual(rows.filter(c=>c.positionId===a.id).map(c=>c.positionVersion).sort(),[1,1,2]);
  for(let i=0;i<21;i++)await service.analyze(scope,cv,{fileName:`Batch ${i}.pdf`});
  assert.equal((await store.update(scope,s=>Object.keys(s.jobs))).length,20);
  rows=await store.candidates('owner');assert.equal(rows.length,25);assert.ok(rows.some(c=>c.id===first.id));
  assert.equal(rows.find(c=>c.id===first.id).dimensions[0].title,'Client delivery');
  assert.ok(rows.every(c=>!('quote' in c)&&!('evidence' in c)&&!('vector' in c)));
  if(pg){assert.equal((await pg.db.query('SELECT count(*)::int AS n FROM hr_scoring_candidates')).rows[0].n,25);}
  // The endpoint reads durable snapshots, independently of the review-job TTL.
  if(pg)await pg.db.query('UPDATE hr_scoring_jobs SET created_at_ms=$1 WHERE workspace_id=$2',[Date.now()-25*3600000,scope]);
  else await store.update(scope,s=>{for(const job of Object.values(s.jobs))job.createdAt=Date.now()-25*3600000;});
  await service.analyze(scope,cv,{fileName:'After expiry.pdf'});
  assert.equal((await store.update(scope,s=>Object.keys(s.jobs))).length,1);
  assert.equal((await store.candidates('owner')).length,26);
 }finally{await store.close();await rm(directory,{recursive:true,force:true});}
});

test('invalid filenames fail before sending a CV to the provider',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'candidate-filename-'));let called=false;
 try{const service=createScoringService(createStore({databaseUrl:null,directory}),{extractEvidence:async()=>{called=true;}});
 await assert.rejects(()=>service.analyze('owner',cv,{fileName:'bad\u0000.pdf'}),e=>e.status===400);assert.equal(called,false);
 }finally{await rm(directory,{recursive:true,force:true});}
});

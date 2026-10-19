import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DEFAULT_POSITION,validatePosition,createPositionService,positionScope} from '../server/positions.mjs';
import {createStore} from '../server/store.mjs';
import {createScoringService} from '../server/service.mjs';
import {postgresPool} from './helpers/pglite.mjs';

const draft=()=>({name:'AI Engineer',description:'Review applied engineering skills.',generalRules:'Value demonstrated practical learning.',rubric:[{title:'Applied engineering',max:100,bands:[[0,24,'Limited tool exposure.'],[25,49,'Applied a tool to a task.'],[50,74,'Owned a technical project.'],[75,100,'Repeated independent engineering delivery.']],examples:[{band:3,cap:100,statement:'Applied engineering in an AI product.'},{band:3,cap:100,statement:'Applied engineering in a data platform.'}]}]});

test('users choose the criterion count, band count and repeated ceiling contexts',()=>{
 const one=validatePosition(draft());assert.equal(one.rubric.length,1);assert.equal(one.rubric[0].bands.length,4);assert.equal(one.rubric[0].examples.length,2);
 const input=draft();input.rubric=Array.from({length:13},(_,i)=>({title:`Criterion ${i+1}`,max:i===12?40:5,bands:[[0,i===12?40:5,'Relevant demonstrated work.']],examples:[]}));
 const many=validatePosition(input);assert.equal(many.rubric.length,13);assert.equal(new Set(many.rubric.map(d=>d.id)).size,13);
 assert.notEqual(validatePosition(input).rubric[0].id,many.rubric[0].id);
});

test('invalid weights, bands, contexts and malformed criteria are rejected',()=>{
 for(const mutate of [d=>{d.rubric[0].max=90;},d=>{d.rubric[0].bands[1][0]=24;},d=>{d.rubric[0].bands[0][0]=1;},d=>{d.rubric[0].examples[0].cap=110;},d=>{d.rubric[0]=null;},d=>{d.rubric[0].examples=[null];}]){
  const input=draft();mutate(input);assert.throws(()=>validatePosition(input),error=>error.status===400);
 }
});

test('position templates persist, clone independently and reject stale edits',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hr-positions-'));
 try{
  const store=createStore({databaseUrl:null,directory}),service=createPositionService(store);
  assert.equal((await service.list('owner'))[0].name,'HR Intern');
  const a=await service.create('owner',draft()),b=await service.create('owner',{...a,name:'Data Engineer'});
  assert.notEqual(a.id,b.id);assert.notEqual(a.rubric[0].id,b.rubric[0].id);assert.notEqual(positionScope('owner',a),positionScope('owner',b));
  const updated=await service.update('owner',a.id,{...a,name:'Senior AI Engineer'});assert.equal(updated.version,2);assert.notEqual(updated.rubric[0].id,a.rubric[0].id);
  await assert.rejects(()=>service.update('owner',a.id,{...a,name:'Stale'}),error=>error.status===409);
  assert.equal((await service.get('owner',a.id,1)).name,'AI Engineer');assert.equal((await service.get('owner',a.id)).name,'Senior AI Engineer');
  await assert.rejects(()=>service.get('other',a.id),error=>error.status===404);
  const reopened=createPositionService(createStore({databaseUrl:null,directory}));assert.equal((await reopened.list('owner')).length,3);
  assert.equal(positionScope('owner',DEFAULT_POSITION),'owner');
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('custom positions persist in PostgreSQL and use the common scoring algorithm without HR-specific criteria',async()=>{
 const {pool,db}=await postgresPool();
 try{
  const store=createStore({databaseUrl:null,pool});await store.initialize();
  const positions=createPositionService(store),a=await positions.create('owner',draft()),b=await positions.create('owner',{...draft(),name:'Data Engineer'});
  const provider={
   embed:async texts=>texts.map(text=>text==='Evidence of engineering delivery.'||text==='Repeated independent engineering delivery.'?[1,0]:[0,1]),
   extractEvidence:async(text,p)=>{assert.notEqual(p.id,'hr-intern');return {evidence:[{sentenceId:'s1',statement:'Evidence of engineering delivery.',reason:'Demonstrated delivery.',dimension:p.rubric[0].id,band:0}]};},
   assessCeilings:async(pairs,p)=>{assert.equal(pairs[0].dimension,p.rubric[0].id);assert.equal(pairs[0].reference.band,3);return pairs.map(pair=>({id:pair.id,fulfillment:0.4,reason:'Partial advanced delivery.'}));},
  };
  const sa=createScoringService(store,provider,'test-model',a),sb=createScoringService(store,provider,'test-model',b);
  const result=await sa.analyze(positionScope('owner',a),'Built and delivered an engineering project.');
  assert.equal(result.state,'complete');assert.equal(result.total,85);assert.equal(result.dimensions.length,1);assert.equal(result.position.name,'AI Engineer');
  assert.deepEqual(await sa.get(positionScope('owner',a),result.id),result);
  await assert.rejects(()=>sb.get(positionScope('owner',b),result.id),error=>error.status===404);
  const count=(await db.query('SELECT count(*)::int AS n FROM hr_scoring_references WHERE workspace_id=$1',[positionScope('owner',a)])).rows[0].n;assert.equal(count,6);
  const stored=(await db.query('SELECT position_snapshot FROM hr_scoring_jobs WHERE workspace_id=$1',[positionScope('owner',a)])).rows[0];assert.equal(stored.position_snapshot.id,a.id);
  const updated=await positions.update('owner',a.id,{...a,name:'AI Engineer II'});assert.equal(updated.version,2);
  assert.equal((await sa.get(positionScope('owner',a),result.id)).total,85);
  const restored=await positions.get('owner',a.id,1);assert.deepEqual(restored,a);
  const rows=(await db.query('SELECT version FROM hr_scoring_positions WHERE workspace_id=$1 AND position_id=$2 ORDER BY version',['owner',a.id])).rows;assert.deepEqual(rows.map(r=>r.version),[1,2]);
 }finally{await pool.end();}
});

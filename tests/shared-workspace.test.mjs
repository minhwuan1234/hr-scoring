import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createStore} from '../server/store.mjs';
import {createPositionService,positionScope} from '../server/positions.mjs';
import {postgresPool} from './helpers/pglite.mjs';
for(const backend of ['file','postgresql'])test(`${backend}: shared workspace adopts main owner's full role history and stays fixed after restart`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hr-shared-team-')),pg=backend==='postgresql'?await postgresPool():null;
 const options={databaseUrl:null,directory,...(pg?{pool:pg.pool}:{})},store=createStore(options);
 const main='a'.repeat(64),other='b'.repeat(64);
 try{
  const positions=createPositionService(store);await positions.list(main);await positions.list(other);
  const role=await positions.create(main,{name:'Social Media',rubric:[{title:'Delivery',max:100,bands:[[0,100,'Delivered work.']],examples:[]}]});
  const scope=positionScope(main,role);
  const candidate=(id,p='hr-intern')=>({id,fileName:'Synthetic.pdf',positionId:p,positionVersion:1,positionName:p,createdAt:1,updatedAt:1,state:'complete',total:75,pendingCount:0,dimensions:[]});
  await store.update(main,state=>{state.candidates={one:candidate('one')};});
  await store.update(scope,state=>{state.candidates={two:candidate('two',role.id),three:candidate('three',role.id)};});
  await store.update(other,state=>{state.candidates={other:candidate('other')};});
  const pdf=Buffer.from('%PDF-1.7\nSynthetic\n%%EOF');await store.cvFiles.save(scope,'two',pdf);
  assert.deepEqual(await Promise.all([store.sharedWorkspace(),store.sharedWorkspace()]),[main,main]);
  assert.equal((await store.candidatePage(await store.sharedWorkspace(),{})).total,3);
  assert.equal((await positions.list(await store.sharedWorkspace())).length,2);
  assert.deepEqual((await store.cvFiles.get(scope,'two')).bytes,pdf);
  assert.equal((await store.candidates(other)).length,1,'other browser histories are preserved, never merged or erased');
  await store.update(other,state=>{for(let i=0;i<10;i++)state.candidates[`later-${i}`]=candidate(`later-${i}`);});
  const restarted=createStore(options);assert.equal(await restarted.sharedWorkspace(),main,'persisted choice cannot be replaced by a later visitor or higher count');
  if(pg)assert.equal((await pg.db.query('SELECT count(*) AS count FROM hr_scoring_shared_workspace')).rows[0].count,1);
 }finally{await store.close();await rm(directory,{recursive:true,force:true});}
});
test('a fresh install gets the same fixed workspace across restarts',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'hr-shared-empty-'));
 const first=createStore({databaseUrl:null,directory}),second=createStore({databaseUrl:null,directory});
 try{assert.equal(await first.sharedWorkspace(),await second.sharedWorkspace());}finally{await first.close();await second.close();await rm(directory,{recursive:true,force:true});}
});

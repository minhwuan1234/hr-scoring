import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createStore} from '../server/store.mjs';
import {createPositionService,positionScope} from '../server/positions.mjs';
import {createScoringService} from '../server/service.mjs';
import {deleteCandidates,validateSelection} from '../server/candidate-deletion.mjs';
import {postgresPool} from './helpers/pglite.mjs';
const draft={name:'Account',rubric:[{title:'Delivery',max:100,bands:[[0,100,'Delivery standard.']],examples:[]}]};
const cv='Applied a tool to a client project.';
const pdf=Buffer.from('%PDF-1.7\nCandidate original\n%%EOF');
for(const backend of ['file','postgresql'])test(`${backend}: selected CV deletion purges profiles, PDFs, evidence, scores and exclusive learned data without touching other roles`,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'cv-delete-')),pg=backend==='postgresql'?await postgresPool():null,store=createStore({databaseUrl:null,directory,...(pg?{pool:pg.pool}:{})});
 try{
  const positions=createPositionService(store),a=await positions.create('owner',draft),b=await positions.create('owner',{...draft,name:'HR'}),scope=positionScope('owner',a);
  const provider={embed:async texts=>texts.map(t=>t==='Delivery standard.'?[0,1]:[1,0]),extractEvidence:async(text,p)=>({candidateProfile:{name:null,phone:null,email:null,linkedinUrl:null},evidence:[{sentenceId:'s1',statement:'Applied a tool.',reason:'Output.',dimension:p.rubric[0].id,band:0}]}),assessCeilings:async pairs=>pairs.map(p=>({id:p.id,fulfillment:0.7,reason:'Evidence.'}))};
  const service=createScoringService(store,provider,'test',a),first=await service.analyze(scope,cv,{fileName:'Delete me.pdf'});
  const completed=await service.review(scope,first.id,[{...first.pending[0],action:'approve',statement:'Applied a tool.'}]);
  await store.cvFiles.save(scope,first.id,pdf);
  const other=await createScoringService(store,provider,'test',b).analyze(positionScope('owner',b),cv,{fileName:'Keep me.pdf'});
  const original=await store.update(scope,s=>structuredClone(s)),selection=[{id:completed.id,positionId:a.id,positionVersion:1}];
  if(pg)await pg.db.query('INSERT INTO hr_scoring_schema_backups(schema_version,workspace_id,payload) VALUES($1,$2,$3)',['deletion-fixture',scope,JSON.stringify(original)]);
  await assert.rejects(()=>deleteCandidates(store,positions,'stranger',selection),e=>e.status===404);assert.equal((await store.candidates('owner')).length,2);
  await deleteCandidates(store,positions,'owner',selection);
  const rows=await store.candidates('owner');assert.equal(rows.length,1);assert.equal(rows[0].id,other.id);
  await assert.rejects(()=>service.get(scope,first.id),e=>e.status===404);await assert.rejects(()=>store.cvFiles.get(scope,first.id),e=>e.status===404);
  const state=await store.update(scope,s=>s);assert.equal(Object.keys(state.jobs).length,0);assert.equal(Object.keys(state.mappings).length,0);assert.ok(state.references.every(r=>r.source==='user-rubric'));
  if(pg){
   for(const table of ['hr_scoring_candidates','hr_scoring_candidate_files','hr_scoring_jobs','hr_scoring_evidence','hr_scoring_dimension_scores'])assert.equal((await pg.db.query(`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id=$1`,[scope])).rows[0].n,0);
   const backup=(await pg.db.query('SELECT payload FROM hr_scoring_schema_backups WHERE workspace_id=$1 AND schema_version=$2',[scope,'deletion-fixture'])).rows[0].payload;assert.equal(backup.jobs[first.id],undefined);assert.equal(backup.candidates[first.id],undefined);assert.equal(Object.keys(backup.mappings).length,0);assert.ok(backup.references.every(r=>r.source==='user-rubric'));
   // A stale replica must not restore the removed record or its learned evidence.
   await pg.db.query('UPDATE hr_scoring_workspace_state SET payload=$2 WHERE workspace_id=$1',[scope,JSON.stringify(original)]);await store.update(scope,()=>null);
   assert.equal((await store.candidates('owner')).length,1);assert.equal((await store.update(scope,s=>s.references)).length,1);
  }else await assert.rejects(()=>access(join(directory,'cvs',scope,`${first.id}.pdf`)));
  await deleteCandidates(store,positions,'owner',selection);assert.equal((await store.candidates('owner')).length,1);
 }finally{await store.close();await rm(directory,{recursive:true,force:true});}
});
test('bulk selection rejects malformed and duplicate IDs before mutation',()=>{
 for(const value of [[],null,[{id:'../x',positionId:'hr-intern',positionVersion:1}],[{id:'__proto__',positionId:'hr-intern',positionVersion:1}],[{id:'a',positionId:'hr-intern',positionVersion:0}]])assert.throws(()=>validateSelection(value),e=>e.status===400);
 const item={id:'a',positionId:'hr-intern',positionVersion:1};assert.throws(()=>validateSelection([item,item]),e=>e.status===400);
});

test('PostgreSQL bulk deletion is atomic across roles and shared standards survive until their last dependent CV is deleted',async()=>{
 const {pool,db}=await postgresPool(),store=createStore({databaseUrl:null,pool});
 try{
  const positions=createPositionService(store),a=await positions.create('owner',draft),b=await positions.create('owner',{...draft,name:'Other'}),sa=positionScope('owner',a),sb=positionScope('owner',b);
  const provider={embed:async texts=>texts.map(t=>t==='Delivery standard.'?[0,1]:[1,0]),extractEvidence:async(text,p)=>({evidence:[{sentenceId:'s1',statement:'Applied a tool.',reason:'Output.',dimension:p.rubric[0].id,band:0}]}),assessCeilings:async pairs=>pairs.map(p=>({id:p.id,fulfillment:0.7,reason:'Evidence.'}))};
  const service=createScoringService(store,provider,'test',a),x=await service.analyze(sa,cv);await service.review(sa,x.id,[{...x.pending[0],action:'approve',statement:'Applied a tool.'}]);
  const shared=await service.analyze(sa,cv),other=await createScoringService(store,provider,'test',b).analyze(sb,cv);
  const selections=[{id:x.id,positionId:a.id,positionVersion:1},{id:other.id,positionId:b.id,positionVersion:1}];
  await db.exec(`CREATE FUNCTION block_fixture_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture rollback'; END $$; CREATE TRIGGER fixture_delete_guard BEFORE DELETE ON hr_scoring_candidates FOR EACH ROW EXECUTE FUNCTION block_fixture_delete();`);
  await assert.rejects(()=>deleteCandidates(store,positions,'owner',selections),/fixture rollback/);
  assert.equal((await store.candidates('owner')).length,3);assert.equal((await db.query('SELECT count(*)::int AS n FROM hr_scoring_deleted_candidates')).rows[0].n,0);
  await db.exec('DROP TRIGGER fixture_delete_guard ON hr_scoring_candidates; DROP FUNCTION block_fixture_delete();');
  await deleteCandidates(store,positions,'owner',selections);assert.equal((await store.candidates('owner')).length,1);assert.equal((await service.get(sa,shared.id)).total,70);
  assert.equal((await store.update(sa,s=>s.references.filter(r=>r.source==='human'))).length,1);
  await deleteCandidates(store,positions,'owner',[{id:shared.id,positionId:a.id,positionVersion:1}]);
  assert.equal((await store.candidates('owner')).length,0);assert.equal((await store.update(sa,s=>s.references.filter(r=>r.source==='human'))).length,0);
 }finally{await store.close();}
});

test('expired legacy CVs are purged using backed-up evidence when provenance was not yet stored',async()=>{
 const {pool,db}=await postgresPool(),store=createStore({databaseUrl:null,pool});
 try{
  const positions=createPositionService(store),p=await positions.create('owner',draft),scope=positionScope('owner',p);
  const provider={embed:async texts=>texts.map(t=>t==='Delivery standard.'?[0,1]:[1,0]),extractEvidence:async()=>({evidence:[{sentenceId:'s1',statement:'Applied a tool.',reason:'Output.',dimension:p.rubric[0].id,band:0}]}),assessCeilings:async pairs=>pairs.map(p=>({id:p.id,fulfillment:0.7,reason:'Evidence.'}))};
  const service=createScoringService(store,provider,'test',p),job=await service.analyze(scope,cv);await service.review(scope,job.id,[{...job.pending[0],action:'approve',statement:'Applied a tool.'}]);
  const original=await store.update(scope,s=>structuredClone(s));
  await db.query('INSERT INTO hr_scoring_schema_backups(schema_version,workspace_id,payload) VALUES($1,$2,$3)',['legacy-expired',scope,JSON.stringify(original)]);
  await store.update(scope,s=>{s.jobs={};for(const r of s.references)delete r.sourceJobId;for(const m of Object.values(s.mappings))delete m.sourceJobId;});
  await deleteCandidates(store,positions,'owner',[{id:job.id,positionId:p.id,positionVersion:1}]);
  const remaining=await store.update(scope,s=>s);assert.equal(Object.keys(remaining.candidates).length,0);assert.equal(Object.keys(remaining.mappings).length,0);assert.equal(remaining.references.filter(r=>r.source==='human').length,0);
 }finally{await store.close();}
});

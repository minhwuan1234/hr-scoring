import test, {before,after} from 'node:test';
import assert from 'node:assert/strict';
import { postgresPool } from './helpers/pglite.mjs';
import { DATASET_VERSION, initializePostgres } from '../server/database.mjs';
import { SCHEMA_VERSION } from '../server/relational-store.mjs';
import { createStore } from '../server/store.mjs';
import { createScoringService } from '../server/service.mjs';
import { calculate, SCORING_FORMULA } from '../server/engine.mjs';
import { sentenceKey, SCORING_UNIT } from '../server/sentences.mjs';

const workspace='migration-fixture',model='test-embedding';
const quote='Learned Sheets and applied it to a project tracker.';
const references=[
 {id:'tools-context',dimension:'learning-drive',band:2,cap:30,statement:'Repeated self-directed tool learning applied to concrete outputs.',vector:[1,0],source:'human',embeddingModel:model,approvedAt:'2026-10-19T01:00:00.000Z'},
 {id:'hiring-context',dimension:'learning-drive',band:2,cap:30,statement:'Independently learned hiring processes and applied them in projects.',vector:[0,1],source:'human',embeddingModel:model,approvedAt:'2026-10-19T01:00:00.000Z'},
 {id:'tools-context',dimension:'learning-drive',band:2,cap:30,statement:'Tool learning in a separate embedding model space.',vector:[1,0,0],source:'user-rubric',embeddingModel:'other-embedding'},
];
const evidence=[
 {id:'e1',sentenceId:'s1',key:sentenceKey(quote),quote,statement:'Applied learning.',reason:'Evidence.',dimension:'learning-drive',band:2,vector:[0.8,0.6],status:'approved',referenceId:'tools-context',assessment:{referenceId:'tools-context',fulfillment:0.4,reason:'Partial fulfillment.',model:'gpt-5.6-luna'}},
 {id:'e2',sentenceId:'s2',key:sentenceKey('Used an unfamiliar office tool.'),quote:'Used an unfamiliar office tool.',statement:'Office tool exposure.',reason:'Evidence.',dimension:'tools',band:1,vector:[0.5,0.5],status:'pending'},
];
const job={id:'legacy-job',createdAt:Date.now(),embeddingModel:model,referenceVersion:3,scoringUnit:SCORING_UNIT,scoringFormula:SCORING_FORMULA,evidence};
job.result=calculate(job,references,model);
const original={version:3,references,mappings:{[sentenceKey(quote)]:{action:'approve',dimension:'learning-drive',referenceId:'tools-context'},[sentenceKey('Rejected sentence.')]:{action:'reject'}},jobs:{[job.id]:job}};
let db,pool,store;
async function legacyDataset(connection,state=original) {
 await connection.exec(`CREATE TABLE hr_scoring_workspace_state(workspace_id TEXT PRIMARY KEY,payload JSONB NOT NULL);
 CREATE TABLE hr_scoring_data_migrations(dataset_version TEXT PRIMARY KEY,applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),archived_workspaces INTEGER NOT NULL);`);
 await connection.query('INSERT INTO hr_scoring_data_migrations(dataset_version,archived_workspaces) VALUES($1,0)',[DATASET_VERSION]);
 await connection.query('INSERT INTO hr_scoring_workspace_state(workspace_id,payload) VALUES($1,$2)',[workspace,JSON.stringify(state)]);
}
before(async()=>{
 ({db,pool}=await postgresPool());
 await legacyDataset(db);
 await initializePostgres(pool);
 store=createStore({databaseUrl:null,pool});
});
after(async()=>{await pool.end();});

test('migrates actual PostgreSQL rows without merging equal-cap references or different model spaces',async()=>{
 const refs=(await db.query('SELECT reference_id,context,embedding_model,cap FROM hr_scoring_references WHERE workspace_id=$1 ORDER BY sort_order',[workspace])).rows;
 assert.equal(refs.length,3);assert.equal(Number(refs[0].cap),30);assert.equal(Number(refs[1].cap),30);assert.notEqual(refs[0].context,refs[1].context);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM hr_scoring_dimensions')).rows[0].n,9);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM hr_scoring_bands')).rows[0].n,27);
 assert.deepEqual((await db.query('SELECT payload FROM hr_scoring_schema_backups WHERE schema_version=$1 AND workspace_id=$2',[SCHEMA_VERSION,workspace])).rows[0].payload,original);
 const {candidates,...restored}=await store.update(workspace,state=>state);
 assert.deepEqual(restored,original);
 assert.equal(candidates['legacy-job'].total,24.6);
 assert.equal(candidates['legacy-job'].fileName,'Previously scored CV');
});

test('typed evidence rows retain selection match separately from independent ceiling fulfillment',async()=>{
 const row=(await db.query('SELECT match_similarity,ceiling_fulfillment,score_floor,score_cap,score,reference_id FROM hr_scoring_evidence WHERE workspace_id=$1 AND evidence_id=$2',[workspace,'e1'])).rows[0];
 assert.equal(row.match_similarity,0.8);assert.equal(row.ceiling_fulfillment,0.4);assert.equal(Number(row.score),24.6);assert.equal(Number(row.score_floor),21);assert.equal(Number(row.score_cap),30);assert.equal(row.reference_id,'tools-context');
});

test('the application reads normalized reference rows, not the compatibility JSON snapshot',async()=>{
 await db.query('UPDATE hr_scoring_references SET context=$1 WHERE workspace_id=$2 AND reference_id=$3 AND embedding_model=$4',['Updated normalized context.',workspace,'hiring-context',model]);
 const loaded=await store.update(workspace,state=>state);
 assert.equal(loaded.references[1].statement,'Updated normalized context.');
 assert.notEqual((await db.query('SELECT payload FROM hr_scoring_workspace_state WHERE workspace_id=$1',[workspace])).rows[0].payload.references[1].statement,'Updated normalized context.');
 await db.query('UPDATE hr_scoring_references SET context=$1 WHERE workspace_id=$2 AND reference_id=$3 AND embedding_model=$4',[references[1].statement,workspace,'hiring-context',model]);
});

let scoredJob;
test('human review and repeated scoring work end-to-end through normalized PostgreSQL tables',async()=>{
 const provider={
  embed:async texts=>texts.map(text=>text==='Applied learning.' || text==='Built a tracker independently.' ? [1,0] : [0,1]),
  extractEvidence:async()=>({evidence:[{sentenceId:'s1',statement:'Applied learning.',reason:'Evidence.',dimension:'learning-drive',band:1}]}),
  assessCeilings:async pairs=>pairs.map(pair=>({id:pair.id,fulfillment:0.25,reason:'Limited demonstrated scope.'})),
 };
 const service=createScoringService(store,provider,model);
 const pending=await service.analyze('workflow',quote);
 assert.equal(pending.state,'review');
 const result=await service.review('workflow',pending.id,[{...pending.pending[0],action:'approve',dimension:'learning-drive',band:1,cap:18,statement:'Built a tracker independently.'}]);
 assert.equal(result.total,12);assert.equal(result.state,'complete');
 assert.deepEqual(await service.get('workflow',result.id),result);
 const again=await service.analyze('workflow',quote);
 assert.equal(again.state,'complete');assert.equal(again.total,12);
 const row=(await db.query('SELECT match_similarity,ceiling_fulfillment,score FROM hr_scoring_evidence WHERE workspace_id=$1 AND job_id=$2',['workflow',again.id])).rows[0];
 assert.equal(row.match_similarity,1);assert.equal(row.ceiling_fulfillment,0.25);assert.equal(Number(row.score),12);
 await assert.rejects(()=>service.get('different-workspace',result.id),error=>error.status===404);
 scoredJob=result.id;
});

test('database constraints reject duplicate sentences, out-of-band caps and cross-workspace references',async()=>{
 await assert.rejects(()=>db.query('UPDATE hr_scoring_evidence SET sentence_key=$1 WHERE workspace_id=$2 AND evidence_id=$3',[evidence[0].key,workspace,'e2']),error=>error.code==='23505');
 await assert.rejects(()=>db.query('UPDATE hr_scoring_references SET cap=31 WHERE workspace_id=$1 AND reference_id=$2 AND embedding_model=$3',[workspace,'tools-context',model]),error=>error.code==='23514');
 await assert.rejects(()=>db.query('UPDATE hr_scoring_evidence SET reference_id=$1 WHERE workspace_id=$2 AND job_id=$3',['tools-context','workflow',scoredJob]),error=>error.code==='23503');
 await assert.rejects(()=>db.query('UPDATE hr_scoring_evidence SET ceiling_fulfillment=1.1 WHERE workspace_id=$1',[workspace]),error=>error.code==='23514');
 await assert.rejects(()=>db.query('UPDATE hr_scoring_evidence SET ceiling_fulfillment=0.8 WHERE workspace_id=$1 AND evidence_id=$2',[workspace,'e1']),error=>error.code==='23514');
});

test('rolling-deployment legacy writes are imported safely and later restarts do not reset data',async()=>{
 const current=(await db.query('SELECT payload FROM hr_scoring_workspace_state WHERE workspace_id=$1',[workspace])).rows[0].payload;
 current.version++;
 current.references.push({...references[0],id:'in-flight-reference',statement:'A reference written by the old deployment.'});
 await db.query('UPDATE hr_scoring_workspace_state SET payload=$1 WHERE workspace_id=$2',[JSON.stringify(current),workspace]);
 const loaded=await store.update(workspace,state=>state);
 assert.equal(loaded.references.at(-1).id,'in-flight-reference');assert.equal(loaded.jobs[job.id].result.total,24.6);
 await initializePostgres(pool);
 assert.deepEqual(await store.update(workspace,state=>state),loaded);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM hr_scoring_schema_backups')).rows[0].n,1);
});

test('expired job deletion cascades to evidence and scores while preserving reusable references',async()=>{
 await store.update('workflow',state=>{state.jobs={};});
 assert.equal((await db.query('SELECT count(*)::int AS n FROM hr_scoring_evidence WHERE workspace_id=$1',['workflow'])).rows[0].n,0);
 assert.equal((await db.query('SELECT count(*)::int AS n FROM hr_scoring_dimension_scores WHERE workspace_id=$1',['workflow'])).rows[0].n,0);
 assert.ok((await db.query('SELECT count(*)::int AS n FROM hr_scoring_references WHERE workspace_id=$1',['workflow'])).rows[0].n>0);
});

test('a failed migration rolls back the entire schema and preserves the original legacy payload',async()=>{
 const isolated=await postgresPool();
 try {
  const invalid=structuredClone(original);invalid.references[0].cap=31;
  await legacyDataset(isolated.db,invalid);
  await assert.rejects(()=>initializePostgres(isolated.pool),error=>error.code==='23514');
  assert.deepEqual((await isolated.db.query('SELECT payload FROM hr_scoring_workspace_state')).rows[0].payload,invalid);
  assert.equal((await isolated.db.query("SELECT to_regclass('hr_scoring_references') AS table_name")).rows[0].table_name,null);
 } finally {await isolated.pool.end();}
});

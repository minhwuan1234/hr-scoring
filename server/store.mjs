import {createSharedWorkspace} from './shared-workspace.mjs';
import {reviewerName} from './reviewers.mjs';
import {candidateQuery,fileCandidatePage,postgresCandidatePage} from './candidate-pages.mjs';
import {readPositionCatalog,persistPositionCatalog} from './position-store.mjs';
import {readPublicJob} from './job-reader.mjs';
import {createCvFiles} from './cv-files.mjs';
import {isDeepStrictEqual} from 'node:util';
import {archiveCandidates,fileCandidates,candidateRow} from './candidates.mjs';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { DATASET_VERSION, initializePostgres } from './database.mjs';
import { SCHEMA_VERSION, loadRelationalWorkspace, writeRelationalWorkspace } from './relational-store.mjs';

export function workspaceId(token) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) throw Object.assign(new Error('Reload the page to initialize your workspace.'), { status: 401 });
  return createHash('sha256').update(token).digest('hex');
}

export function createStore({ databaseUrl = process.env.DATABASE_URL, directory = process.env.SCORING_DATA_DIR || '.data', pool:injectedPool = null } = {}) {
  if (process.env.RAILWAY_PROJECT_ID && !databaseUrl) throw new Error('DATABASE_URL is required on Railway. Connect the Postgres service before starting.');
  const pool = injectedPool || (databaseUrl ? new pg.Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 10000 }) : null);
  const locks = new Map();
  let schema;
  async function initialize() {
    if (pool) {
      schema ||= initializePostgres(pool).catch(error => {schema=undefined;throw error;});
      await schema;
    }
  }
  async function update(id, change) {
    const previous = locks.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const initial = () => ({ version: 1, references: [], mappings: {}, jobs: {} });
      if (pool) {
        await initialize();
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
          const state = await loadRelationalWorkspace(client,id);
          const before = structuredClone(state);
          archiveCandidates(state);
          const output = await change(state);
          archiveCandidates(state);
          if (!isDeepStrictEqual(before,state)) await writeRelationalWorkspace(client,id,state,before);
          await client.query('COMMIT');
          return output;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      }
      await mkdir(directory, { recursive: true, mode:0o700 });
      const path = resolve(directory, `${id}.json`);
      let state;
      try { state = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; state = initial(); }
      archiveCandidates(state);
      const output = await change(state);
      archiveCandidates(state);
      const temporary = path + '.tmp';
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
      await rename(temporary,path);
      return output;
    });
    locks.set(id, next);
    try { return await next; } finally { if (locks.get(id) === next) locks.delete(id); }
  }
  async function readFileState(id){try{return JSON.parse(await readFile(resolve(directory,`${id}.json`),'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;return {version:1,references:[],mappings:{},jobs:{}};}}
  async function positions(owner){if(!pool)return (await readFileState(owner)).positions || {};await initialize();return readPositionCatalog(pool,owner);}
  async function position(owner,id,version){
    if(!pool){const versions=(await positions(owner))[id];return version===undefined?versions?.at(-1):versions?.find(p=>p.version===version);}
    await initialize();return (await pool.query(`SELECT definition FROM hr_scoring_positions WHERE workspace_id=$1 AND position_id=$2${version===undefined?'':' AND version=$3'} ORDER BY version DESC LIMIT 1`,version===undefined?[owner,id]:[owner,id,version])).rows[0]?.definition;
  }
  async function changePositions(owner,change){
    if(!pool)return update(owner,state=>{state.positions??={};return change(state.positions);});
    await initialize();const client=await pool.connect();
    try{await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[owner]);
      await client.query('INSERT INTO hr_scoring_workspaces(workspace_id,version) VALUES($1,1) ON CONFLICT DO NOTHING',[owner]);
      const before=(await client.query('SELECT w.legacy_fingerprint,md5(s.payload::text) AS mirror_fingerprint FROM hr_scoring_workspaces w LEFT JOIN hr_scoring_workspace_state s USING(workspace_id) WHERE w.workspace_id=$1',[owner])).rows[0];
      const catalog=await readPositionCatalog(client,owner),output=await change(catalog);
      await persistPositionCatalog(client,owner,catalog);
      await client.query(`INSERT INTO hr_scoring_workspace_state(workspace_id,payload) VALUES($1,jsonb_build_object('version',1,'references','[]'::jsonb,'mappings','{}'::jsonb,'jobs','{}'::jsonb,'positions',$2::jsonb)) ON CONFLICT(workspace_id) DO UPDATE SET payload=jsonb_set(hr_scoring_workspace_state.payload,'{positions}',$2::jsonb)`,[owner,JSON.stringify(catalog)]);
      if(before.legacy_fingerprint===before.mirror_fingerprint)await client.query('UPDATE hr_scoring_workspaces SET legacy_fingerprint=(SELECT md5(payload::text) FROM hr_scoring_workspace_state WHERE workspace_id=$1) WHERE workspace_id=$1',[owner]);
      await client.query('COMMIT');return output;
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async function readScoring(id,{jobId,embeddingModel,mappingKeys}={}){
    if(!pool){const state=await readFileState(id);archiveCandidates(state);return state;}
    await initialize();const client=await pool.connect();
    try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const state=await loadRelationalWorkspace(client,id,{syncLegacy:false,scoringOnly:true,jobId,embeddingModel,mappingKeys});await client.query('COMMIT');return state;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async function readJob(workspace,id){if(!pool){const state=await readFileState(workspace);archiveCandidates(state);return state.jobs[id];}await initialize();return readPublicJob(pool,workspace,id);}
  async function candidate(scope,id){if(!pool)return (await readFileState(scope)).candidates?.[id];await initialize();const {rows}=await pool.query('SELECT * FROM hr_scoring_candidates WHERE workspace_id=$1 AND job_id=$2',[scope,id]);return rows[0]?candidateRow(rows[0]):undefined;}
  async function decideCandidate(scope,id,decision,receiver){
    if(!['accept','denied'].includes(decision))throw Object.assign(new Error('Choose Accept or Denied.'),{status:400});
    const name=reviewerName(receiver);if(!name)throw Object.assign(new Error('Unknown reviewer.'),{status:400});
    return update(scope,state=>{const c=state.candidates?.[id];if(!c||state.deletedCandidates?.[id])throw Object.assign(new Error('This CV is no longer available.'),{status:404});c.reviewerDecisions??={};if(c.reviewerDecisions[receiver]?.decision!==decision){const decidedAt=Math.max(Date.now(),(c.reviewerDecisions[receiver]?.decidedAt||0)+1);c.reviewerDecisions[receiver]={name,decision,decidedAt};c.updatedAt=decidedAt;}return structuredClone(c);});
  }
  async function candidatePage(owner,input,exportAll=false){const query=candidateQuery(input);if(!pool)return fileCandidatePage(await fileCandidates({update},owner),query,owner,exportAll);await initialize();return postgresCandidatePage(pool,owner,query,exportAll);}
  async function candidates(owner,selection){
    if(!pool){const rows=await fileCandidates({update},owner);if(!selection)return rows;const keys=new Set(selection.map(c=>JSON.stringify([c.positionId,c.positionVersion,c.id])));return rows.filter(c=>keys.has(JSON.stringify([c.positionId,c.positionVersion,c.id])));}
    await initialize();
    if(selection){const requested=selection.map(c=>({job_id:c.id,position_id:c.positionId,position_version:c.positionVersion}));const {rows}=await pool.query(`WITH owned AS (SELECT $1::text AS workspace_id UNION SELECT scoring_workspace_id FROM hr_scoring_position_scopes WHERE owner_workspace_id=$1) SELECT c.* FROM hr_scoring_candidates c JOIN owned USING(workspace_id) JOIN jsonb_to_recordset($2::jsonb) AS s(job_id text,position_id text,position_version integer) USING(job_id,position_id,position_version) ORDER BY c.created_at_ms DESC,c.job_id`,[owner,JSON.stringify(requested)]);return rows.map(candidateRow);}
    const {rows}=await pool.query(`SELECT c.* FROM hr_scoring_candidates c WHERE c.workspace_id=$1 OR c.workspace_id IN (SELECT scoring_workspace_id FROM hr_scoring_position_scopes WHERE owner_workspace_id=$1) ORDER BY c.created_at_ms DESC,c.job_id`,[owner]);
    return rows.map(candidateRow);
  }
  async function removeCandidates(groups){
    const ordered=[...groups].sort((a,b)=>a.scope.localeCompare(b.scope));
    function remove(state,ids,expired={}){
      state.deletedCandidates??={};const selected=new Set(ids),remainingJobs=Object.values(state.jobs).filter(j=>!selected.has(j.id));
      const sharedKeys=new Set(remainingJobs.flatMap(j=>j.evidence.map(e=>e.key)));
      for(const id of ids){
        if(state.deletedCandidates[id])continue;
        const job=state.jobs[id] || expired[id],keys=[...new Set([...(job?.evidence || []).map(e=>e.key),...Object.entries(state.mappings).filter(([,m])=>m.sourceJobId===id).map(([key])=>key)])].filter(key=>!sharedKeys.has(key));
        const selectedRefs=new Set((job?.evidence || []).map(e=>e.referenceId));
        for(const key of keys)delete state.mappings[key];
        const usedRefs=new Set([...remainingJobs.flatMap(j=>j.evidence.map(e=>e.referenceId)),...Object.values(state.mappings).map(m=>m.referenceId)]);
        const referenceIds=state.references.filter(r=>r.source==='human'&&!usedRefs.has(r.id)&&(r.sourceJobId===id||state.deletedCandidates[r.sourceJobId]||(!r.sourceJobId&&job&&selectedRefs.has(r.id)&&Date.parse(r.approvedAt)>=job.createdAt))).map(r=>r.id);
        state.deletedCandidates[id]={referenceIds,sentenceKeys:keys};delete state.jobs[id];delete state.candidates?.[id];
      }
      archiveCandidates(state);
    }
    if(pool){
      await initialize();const client=await pool.connect();
      try{await client.query('BEGIN');for(const group of ordered)await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',[group.scope]);
        for(const {scope,ids} of ordered){const state=await loadRelationalWorkspace(client,scope),before=structuredClone(state),expired={};for(const id of ids)if(!state.jobs[id]){const rows=(await client.query("SELECT payload->'jobs'->$2::text AS job FROM hr_scoring_schema_backups WHERE workspace_id=$1 AND payload->'jobs' ? $2 ORDER BY created_at DESC LIMIT 1",[scope,id])).rows;if(rows[0]?.job)expired[id]=rows[0].job;}remove(state,ids,expired);await writeRelationalWorkspace(client,scope,state,before);}await client.query('COMMIT');
      }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
    }else{
      for(const {scope,ids} of ordered){await update(scope,state=>remove(state,ids));for(const id of ids){try{await unlink(resolve(directory,'cvs',scope,`${id}.pdf`));}catch(error){if(error.code!=='ENOENT')throw error;}}}
    }
  }
  const sharedWorkspace=createSharedWorkspace({pool,directory,initialize});
  const cvFiles=createCvFiles({pool,directory,initialize,update});
  return { update, initialize, sharedWorkspace, positions, position, changePositions, readScoring, readJob, candidate, decideCandidate, candidates, candidatePage, cvFiles, removeCandidates, backend:pool ? 'postgresql' : 'file', datasetVersion:DATASET_VERSION, schemaVersion:pool ? SCHEMA_VERSION : null, persistent: !!pool || !!process.env.SCORING_DATA_DIR, close: () => pool?.end() };
}

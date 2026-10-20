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
  async function candidates(owner){
    if(!pool)return fileCandidates({update},owner);
    await initialize();
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
  const cvFiles=createCvFiles({pool,directory,initialize,update});
  return { update, initialize, candidates, cvFiles, removeCandidates, backend:pool ? 'postgresql' : 'file', datasetVersion:DATASET_VERSION, schemaVersion:pool ? SCHEMA_VERSION : null, persistent: !!pool || !!process.env.SCORING_DATA_DIR, close: () => pool?.end() };
}

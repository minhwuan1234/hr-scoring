import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
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
          const output = await change(state);
          if (JSON.stringify(before) !== JSON.stringify(state)) await writeRelationalWorkspace(client,id,state,before);
          await client.query('COMMIT');
          return output;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
        finally { client.release(); }
      }
      await mkdir(directory, { recursive: true, mode:0o700 });
      const path = resolve(directory, `${id}.json`);
      let state;
      try { state = JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; state = initial(); }
      const output = await change(state);
      const temporary = path + '.tmp';
      await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
      await rename(temporary,path);
      return output;
    });
    locks.set(id, next);
    try { return await next; } finally { if (locks.get(id) === next) locks.delete(id); }
  }
  return { update, initialize, backend:pool ? 'postgresql' : 'file', datasetVersion:DATASET_VERSION, schemaVersion:pool ? SCHEMA_VERSION : null, persistent: !!pool || !!process.env.SCORING_DATA_DIR, close: () => pool?.end() };
}

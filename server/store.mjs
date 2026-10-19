import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

export function workspaceId(token) {
  if (!/^[a-f0-9]{64}$/.test(token || '')) throw Object.assign(new Error('Reload the page to initialize your workspace.'), { status: 401 });
  return createHash('sha256').update(token).digest('hex');
}

export function createStore({ databaseUrl = process.env.DATABASE_URL, directory = process.env.SCORING_DATA_DIR || '.data' } = {}) {
  const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl, max: 5, connectionTimeoutMillis: 10000 }) : null;
  const locks = new Map();
  let schema;
  async function update(id, change) {
    const previous = locks.get(id) || Promise.resolve();
    const next = previous.catch(() => {}).then(async () => {
      const initial = () => ({ version: 1, references: [], mappings: {}, jobs: {} });
      if (pool) {
        schema ||= pool.query('CREATE TABLE IF NOT EXISTS hr_scoring_workspace_state (workspace_id TEXT PRIMARY KEY, payload JSONB NOT NULL)').catch(error => {schema=undefined;throw error;});
        await schema;
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [id]);
          const result = await client.query('SELECT payload FROM hr_scoring_workspace_state WHERE workspace_id = $1', [id]);
          const state = result.rows[0]?.payload || initial();
          const output = await change(state);
          await client.query('INSERT INTO hr_scoring_workspace_state (workspace_id,payload) VALUES ($1,$2) ON CONFLICT (workspace_id) DO UPDATE SET payload = EXCLUDED.payload', [id, JSON.stringify(state)]);
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
  return { update, persistent: !!pool || !!process.env.SCORING_DATA_DIR, close: () => pool?.end() };
}

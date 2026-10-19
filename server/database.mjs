import { initializeRelationalSchema } from './relational-store.mjs';

// One-time clean start requested after prototype testing. Keep the previous
// dataset outside the active table so this reset can be reversed if needed.
export const DATASET_VERSION = 'clean-start-2026-10-19';

export async function initializePostgres(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('hr-scoring:dataset-migrations'))");
    await client.query('CREATE TABLE IF NOT EXISTS hr_scoring_workspace_state (workspace_id TEXT PRIMARY KEY, payload JSONB NOT NULL)');
    await client.query('CREATE TABLE IF NOT EXISTS hr_scoring_data_migrations (dataset_version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), archived_workspaces INTEGER NOT NULL)');
    const existing = await client.query('SELECT dataset_version FROM hr_scoring_data_migrations WHERE dataset_version = $1', [DATASET_VERSION]);
    if (!existing.rows.length) {
      await client.query('LOCK TABLE hr_scoring_workspace_state IN ACCESS EXCLUSIVE MODE');
      await client.query('CREATE TABLE IF NOT EXISTS hr_scoring_test_data_archive (dataset_version TEXT NOT NULL, workspace_id TEXT NOT NULL, payload JSONB NOT NULL, archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (dataset_version, workspace_id))');
      const archived = await client.query('INSERT INTO hr_scoring_test_data_archive (dataset_version, workspace_id, payload) SELECT $1, workspace_id, payload FROM hr_scoring_workspace_state', [DATASET_VERSION]);
      await client.query('DELETE FROM hr_scoring_workspace_state');
      await client.query('INSERT INTO hr_scoring_data_migrations (dataset_version, archived_workspaces) VALUES ($1, $2)', [DATASET_VERSION, archived.rowCount]);
    }
    await initializeRelationalSchema(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

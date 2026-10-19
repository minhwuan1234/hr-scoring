ALTER TABLE hr_scoring_jobs ADD COLUMN IF NOT EXISTS file_name TEXT;
CREATE TABLE IF NOT EXISTS hr_scoring_candidates (
 workspace_id TEXT NOT NULL REFERENCES hr_scoring_workspaces(workspace_id),job_id TEXT NOT NULL,
 file_name TEXT NOT NULL,position_id TEXT NOT NULL,position_version INTEGER NOT NULL,position_name TEXT NOT NULL,
 created_at_ms BIGINT NOT NULL,updated_at_ms BIGINT NOT NULL,
 result_state TEXT NOT NULL CHECK(result_state IN ('review','complete')),
 total NUMERIC NOT NULL CHECK(total BETWEEN 0 AND 100),pending_count INTEGER NOT NULL CHECK(pending_count>=0),
 dimensions JSONB NOT NULL,PRIMARY KEY(workspace_id,job_id)
);
CREATE INDEX IF NOT EXISTS hr_scoring_candidates_recent ON hr_scoring_candidates(workspace_id,created_at_ms DESC);

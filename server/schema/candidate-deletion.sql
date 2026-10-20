CREATE TABLE IF NOT EXISTS hr_scoring_deleted_candidates (
 workspace_id TEXT NOT NULL REFERENCES hr_scoring_workspaces(workspace_id),job_id TEXT NOT NULL,
 details JSONB NOT NULL DEFAULT '{}',deleted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(workspace_id,job_id)
);

ALTER TABLE hr_scoring_references ADD COLUMN IF NOT EXISTS source_job_id TEXT;
ALTER TABLE hr_scoring_sentence_decisions ADD COLUMN IF NOT EXISTS source_job_id TEXT;

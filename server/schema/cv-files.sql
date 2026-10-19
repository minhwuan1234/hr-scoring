ALTER TABLE hr_scoring_candidates ADD COLUMN IF NOT EXISTS cv_available BOOLEAN NOT NULL DEFAULT FALSE;
CREATE TABLE IF NOT EXISTS hr_scoring_candidate_files (
 workspace_id TEXT NOT NULL,job_id TEXT NOT NULL,pdf BYTEA NOT NULL CHECK(octet_length(pdf)>0 AND octet_length(pdf)<=20971520),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(workspace_id,job_id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES hr_scoring_candidates(workspace_id,job_id) ON DELETE CASCADE
);

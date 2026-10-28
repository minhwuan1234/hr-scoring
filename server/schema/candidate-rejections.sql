CREATE TABLE IF NOT EXISTS hr_scoring_candidate_rejections (
 workspace_id TEXT NOT NULL, job_id TEXT NOT NULL, request_id TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision='reject'),
 reviewer_id TEXT NOT NULL, reviewer_name TEXT NOT NULL,
 reject_reason TEXT CHECK(reject_reason IS NULL OR length(reject_reason)<=2000),
 reviewed_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(workspace_id,job_id,request_id),
 FOREIGN KEY(workspace_id,job_id) REFERENCES hr_scoring_candidates(workspace_id,job_id) ON DELETE CASCADE
);

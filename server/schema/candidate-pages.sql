-- Cover stable page ordering and per-role history without loading PDFs/evidence.
CREATE INDEX IF NOT EXISTS hr_scoring_candidates_page_recent ON hr_scoring_candidates(workspace_id,created_at_ms DESC,job_id) INCLUDE(position_id,result_state,total);
CREATE INDEX IF NOT EXISTS hr_scoring_candidates_page_position ON hr_scoring_candidates(workspace_id,position_id,created_at_ms DESC,job_id) INCLUDE(result_state,total);

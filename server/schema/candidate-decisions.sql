ALTER TABLE hr_scoring_candidates ADD COLUMN IF NOT EXISTS manual_decision TEXT CHECK(manual_decision IN ('accept','denied'));
ALTER TABLE hr_scoring_candidates ADD COLUMN IF NOT EXISTS decision_at_ms BIGINT;
ALTER TABLE hr_scoring_candidates ADD COLUMN IF NOT EXISTS reviewer_decisions JSONB NOT NULL DEFAULT '{}'::jsonb;

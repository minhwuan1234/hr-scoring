ALTER TABLE hr_scoring_jobs ADD COLUMN IF NOT EXISTS candidate_profile JSONB;
ALTER TABLE hr_scoring_candidates ADD COLUMN IF NOT EXISTS candidate_name TEXT;
ALTER TABLE hr_scoring_candidates ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE hr_scoring_candidates ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE hr_scoring_candidates ADD COLUMN IF NOT EXISTS linkedin_url TEXT;

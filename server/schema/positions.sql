DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='hr_scoring_bands_band_range_v2' AND conrelid='hr_scoring_bands'::regclass) THEN
  ALTER TABLE hr_scoring_bands DROP CONSTRAINT IF EXISTS hr_scoring_bands_band_check;
  ALTER TABLE hr_scoring_bands ADD CONSTRAINT hr_scoring_bands_band_range_v2 CHECK(band >= 0 AND band < 12);
 END IF;
END $$;
CREATE TABLE IF NOT EXISTS hr_scoring_positions (
 workspace_id TEXT NOT NULL REFERENCES hr_scoring_workspaces(workspace_id), position_id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version > 0), name TEXT NOT NULL, definition JSONB NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(workspace_id,position_id,version)
);
CREATE INDEX IF NOT EXISTS hr_scoring_positions_latest ON hr_scoring_positions(workspace_id,position_id,version DESC);
CREATE TABLE IF NOT EXISTS hr_scoring_position_scopes (
 owner_workspace_id TEXT NOT NULL, position_id TEXT NOT NULL, position_version INTEGER NOT NULL,
 scoring_workspace_id TEXT NOT NULL UNIQUE REFERENCES hr_scoring_workspaces(workspace_id),
 PRIMARY KEY(owner_workspace_id,position_id,position_version), UNIQUE(scoring_workspace_id,position_id,position_version),
 FOREIGN KEY(owner_workspace_id,position_id,position_version) REFERENCES hr_scoring_positions(workspace_id,position_id,version)
);
ALTER TABLE hr_scoring_jobs ADD COLUMN IF NOT EXISTS position_id TEXT;
ALTER TABLE hr_scoring_jobs ADD COLUMN IF NOT EXISTS position_version INTEGER;
ALTER TABLE hr_scoring_jobs ADD COLUMN IF NOT EXISTS position_snapshot JSONB;

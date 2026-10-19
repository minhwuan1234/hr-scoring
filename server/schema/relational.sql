CREATE TABLE IF NOT EXISTS hr_scoring_schema_migrations (
  schema_version TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS hr_scoring_schema_backups (
  schema_version TEXT NOT NULL, workspace_id TEXT NOT NULL, payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(schema_version,workspace_id)
);
CREATE TABLE IF NOT EXISTS hr_scoring_dimensions (
  dimension_id TEXT PRIMARY KEY, max_score NUMERIC NOT NULL CHECK(max_score > 0), sort_order INTEGER NOT NULL, UNIQUE(dimension_id,max_score)
);
CREATE TABLE IF NOT EXISTS hr_scoring_bands (
  dimension_id TEXT NOT NULL REFERENCES hr_scoring_dimensions(dimension_id), band INTEGER NOT NULL CHECK(band BETWEEN 0 AND 2),
  floor NUMERIC NOT NULL CHECK(floor >= 0), ceiling NUMERIC NOT NULL CHECK(ceiling >= floor), guide TEXT NOT NULL,
  PRIMARY KEY(dimension_id,band), UNIQUE(dimension_id,band,floor,ceiling)
);
CREATE TABLE IF NOT EXISTS hr_scoring_workspaces (
  workspace_id TEXT PRIMARY KEY, version INTEGER NOT NULL CHECK(version >= 1), legacy_fingerprint TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS hr_scoring_references (
  workspace_id TEXT NOT NULL REFERENCES hr_scoring_workspaces(workspace_id), reference_id TEXT NOT NULL,
  embedding_model TEXT NOT NULL, dimension_id TEXT NOT NULL, band INTEGER NOT NULL,
  floor NUMERIC NOT NULL, band_ceiling NUMERIC NOT NULL, cap NUMERIC NOT NULL CHECK(cap BETWEEN floor AND band_ceiling),
  context TEXT NOT NULL CHECK(length(context) > 0), embedding DOUBLE PRECISION[] NOT NULL CHECK(cardinality(embedding) > 0 AND array_ndims(embedding)=1),
  source TEXT NOT NULL CHECK(source IN ('human','user-rubric')), approved_at TIMESTAMPTZ, sort_order INTEGER NOT NULL,
  PRIMARY KEY(workspace_id,reference_id,embedding_model), UNIQUE(workspace_id,reference_id,embedding_model,dimension_id), UNIQUE(workspace_id,reference_id,embedding_model,dimension_id,band),
  FOREIGN KEY(dimension_id,band,floor,band_ceiling) REFERENCES hr_scoring_bands(dimension_id,band,floor,ceiling)
);
CREATE INDEX IF NOT EXISTS hr_scoring_references_lookup ON hr_scoring_references(workspace_id,dimension_id,embedding_model);
CREATE TABLE IF NOT EXISTS hr_scoring_sentence_decisions (
  workspace_id TEXT NOT NULL REFERENCES hr_scoring_workspaces(workspace_id), sentence_key TEXT NOT NULL,
  action TEXT NOT NULL CHECK(action IN ('approve','reject')), dimension_id TEXT, reference_id TEXT, reference_model TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(workspace_id,sentence_key),
  CHECK((action = 'reject' AND dimension_id IS NULL AND reference_id IS NULL AND reference_model IS NULL) OR
        (action = 'approve' AND dimension_id IS NOT NULL AND reference_id IS NOT NULL AND reference_model IS NOT NULL)),
  FOREIGN KEY(workspace_id,reference_id,reference_model,dimension_id) REFERENCES hr_scoring_references(workspace_id,reference_id,embedding_model,dimension_id)
);
CREATE TABLE IF NOT EXISTS hr_scoring_jobs (
  workspace_id TEXT NOT NULL REFERENCES hr_scoring_workspaces(workspace_id), job_id TEXT NOT NULL,
  created_at_ms BIGINT NOT NULL, embedding_model TEXT NOT NULL, reference_version INTEGER NOT NULL,
  scoring_unit TEXT, scoring_formula TEXT, result_version INTEGER, result_state TEXT NOT NULL CHECK(result_state IN ('review','complete')),
  total NUMERIC NOT NULL CHECK(total BETWEEN 0 AND 100), PRIMARY KEY(workspace_id,job_id), UNIQUE(workspace_id,job_id,embedding_model)
);
CREATE INDEX IF NOT EXISTS hr_scoring_jobs_retention ON hr_scoring_jobs(workspace_id,created_at_ms);
CREATE TABLE IF NOT EXISTS hr_scoring_evidence (
  workspace_id TEXT NOT NULL, job_id TEXT NOT NULL, evidence_id TEXT NOT NULL, sentence_id TEXT, sentence_key TEXT NOT NULL,
  quote TEXT NOT NULL, statement TEXT NOT NULL, reason TEXT NOT NULL, dimension_id TEXT NOT NULL, band INTEGER NOT NULL,
  embedding_model TEXT NOT NULL, embedding DOUBLE PRECISION[] NOT NULL CHECK(cardinality(embedding) > 0 AND array_ndims(embedding)=1), status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected')),
  reference_id TEXT, match_similarity DOUBLE PRECISION CHECK(match_similarity BETWEEN 0 AND 1),
  ceiling_fulfillment DOUBLE PRECISION CHECK(ceiling_fulfillment BETWEEN 0 AND 1), assessment_reason TEXT, assessment_model TEXT,
  score_floor NUMERIC, score_cap NUMERIC, score NUMERIC, sort_order INTEGER NOT NULL,
  PRIMARY KEY(workspace_id,job_id,evidence_id), UNIQUE(workspace_id,job_id,sentence_key),
  CHECK(score IS NULL OR (score >= 0 AND score BETWEEN score_floor AND score_cap)),
  CHECK(ceiling_fulfillment IS NULL OR reference_id IS NOT NULL),
  CHECK(ceiling_fulfillment IS NULL OR score IS NULL OR ABS(score::DOUBLE PRECISION - (score_floor::DOUBLE PRECISION + ceiling_fulfillment * (score_cap::DOUBLE PRECISION - score_floor::DOUBLE PRECISION))) < 0.0000001),
  FOREIGN KEY(dimension_id,band) REFERENCES hr_scoring_bands(dimension_id,band),
  FOREIGN KEY(workspace_id,job_id,embedding_model) REFERENCES hr_scoring_jobs(workspace_id,job_id,embedding_model) ON DELETE CASCADE,
  FOREIGN KEY(workspace_id,reference_id,embedding_model,dimension_id,band) REFERENCES hr_scoring_references(workspace_id,reference_id,embedding_model,dimension_id,band)
);
CREATE INDEX IF NOT EXISTS hr_scoring_evidence_reference ON hr_scoring_evidence(workspace_id,reference_id,embedding_model);
CREATE TABLE IF NOT EXISTS hr_scoring_dimension_scores (
  workspace_id TEXT NOT NULL, job_id TEXT NOT NULL, dimension_id TEXT NOT NULL REFERENCES hr_scoring_dimensions(dimension_id),
  max_score NUMERIC NOT NULL CHECK(max_score > 0), score NUMERIC NOT NULL CHECK(score BETWEEN 0 AND max_score),
  sort_order INTEGER NOT NULL, PRIMARY KEY(workspace_id,job_id,dimension_id),
  FOREIGN KEY(workspace_id,job_id) REFERENCES hr_scoring_jobs(workspace_id,job_id) ON DELETE CASCADE,
  FOREIGN KEY(dimension_id,max_score) REFERENCES hr_scoring_dimensions(dimension_id,max_score)
);

# PostgreSQL storage model

Railway uses the `relational-v1` schema. Local development without `DATABASE_URL` may still use JSON files. No scoring thresholds or formulas change in this migration.

| Table | Records |
| --- | --- |
| `hr_scoring_dimensions` | Nine dimensions and their maximum scores. |
| `hr_scoring_bands` | The 27 original floor/ceiling bands and guides. |
| `hr_scoring_workspaces` | Workspace version and compatibility fingerprint. |
| `hr_scoring_references` | One row per ceiling example, including context, floor, human cap, band, source and embedding model/vector. |
| `hr_scoring_sentence_decisions` | Latest human approve/reject decision per sentence hash and workspace. |
| `hr_scoring_jobs` | Job identity, creation time, model space, formula version, result state and total. |
| `hr_scoring_evidence` | One full source sentence per job, selected reference, retrieval match, separate ceiling fulfillment and evidence score. |
| `hr_scoring_dimension_scores` | Nine dimension score snapshots per job. |

A reference is identified by `(workspace_id, reference_id, embedding_model)`. There is deliberately no uniqueness constraint on cap or context: multiple 30-point examples with different contexts remain separate rows. The lookup index groups references by workspace, dimension and embedding model.

Embeddings use PostgreSQL `DOUBLE PRECISION[]` columns, not JSONB or pgvector. The scoring engine continues exact cosine comparison of the eligible examples in application code. This change provides structured storage and indexes; it does not introduce approximate vector search.

Evidence stores two independent values:

- `match_similarity`: cosine similarity used to select the reference and apply the 70% human-review threshold.
- `ceiling_fulfillment`: a separate model assessment used in `score_floor + ceiling_fulfillment * (score_cap - score_floor)`.

It also stores `reference_id`, original `quote`, `assessment_reason`, `assessment_model`, `score_floor`, `score_cap` and `score`. Existing jobs with an older formula retain their snapshots and remain subject to the application's rescore guard.

## Constraints

- Reference caps must be within their original band.
- A sentence hash is unique within a workspace/job, preventing two-house duplicates.
- Selected references must belong to the same workspace, embedding model, dimension and band as the evidence.
- Retrieval match and fulfillment are independently constrained to 0–1.
- Evidence points must lie within their stored floor/cap and, when fulfillment is available, agree with the independent score formula.
- Dimension scores must lie within the exact configured maximum; totals remain 0–100.
- Deleting an expired job cascades to its evidence and dimension scores, preserving reusable references and human decisions.

## Migration and rolling deployments

Startup initializes the schema before accepting traffic, inside the existing PostgreSQL migration transaction/advisory lock. The one-time prototype cleanup marker is preserved; this migration does not reset active data.

Before importing each legacy workspace, an immutable copy is stored in `hr_scoring_schema_backups` under `relational-v1`. Existing references, decisions, jobs and evidence are inserted into their tables without re-embedding, re-assessing or merging equal-cap examples. IDs, model spaces, order, scores and pending reviews remain intact. If a constraint or write fails, the transaction rolls back and the previous dataset remains available.

`hr_scoring_workspace_state` is retained as a compatibility mirror for old replicas and rollback. New application reads use normalized tables. During a rolling deployment, a fingerprint detects writes by an old replica and imports them under the same workspace advisory lock. New writes update both normalized records and the mirror atomically. This avoids losing updates while two application versions overlap. The mirror can be retired through a separate migration once rollback compatibility is no longer needed.

`hr_scoring_schema_migrations` records completion so subsequent deployments do not re-import the dataset. The historical `hr_scoring_test_data_archive` remains excluded from active scoring and this migration.

## Verification

The test suite runs the actual schema, import and service flow in embedded PostgreSQL (PGlite), with fake AI providers. It verifies equal-cap contexts, multiple embedding spaces, pending and approved evidence, independent percentages, human review, repeated scoring, tenant constraints, retention, rolling-deployment compatibility, restart safety and transactional rollback on malformed data. Production continues using the Railway PostgreSQL service through `pg`.

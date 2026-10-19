# PostgreSQL storage model

Railway uses the `candidate-cv-files-v5` schema. Local development without `DATABASE_URL` may still use JSON files. No scoring thresholds or formulas change in this migration.

| Table | Records |
| --- | --- |
| `hr_scoring_candidate_files` | Original PDF bytes, linked to durable candidate history and isolated by workspace. |
| `hr_scoring_candidates` | Durable CV metadata and original score summaries, independent of expiring jobs. |
| `hr_scoring_positions` | Immutable template definitions, owner workspace, position ID and version. |
| `hr_scoring_position_scopes` | Maps each owner/position/version to its isolated scoring workspace. |
| `hr_scoring_dimensions` | Default and user-configured criteria and their maximum scores. |
| `hr_scoring_bands` | Default and user-configured floor/ceiling bands and guides. |
| `hr_scoring_workspaces` | Workspace version and compatibility fingerprint. |
| `hr_scoring_references` | One row per ceiling example, including context, floor, human cap, band, source and embedding model/vector. |
| `hr_scoring_sentence_decisions` | Latest human approve/reject decision per sentence hash and workspace. |
| `hr_scoring_jobs` | Job identity, creation time, model space, formula version, result state and total. |
| `hr_scoring_evidence` | One full source sentence per job, selected reference, retrieval match, separate ceiling fulfillment and evidence score. |
| `hr_scoring_dimension_scores` | Configured criterion score snapshots per job. |

A reference is identified by `(workspace_id, reference_id, embedding_model)`. There is deliberately no uniqueness constraint on cap or context: multiple 30-point examples with different contexts remain separate rows. The lookup index groups references by workspace, dimension and embedding model.

Embeddings use PostgreSQL `DOUBLE PRECISION[]` columns, not JSONB or pgvector. The scoring engine continues exact cosine comparison of the eligible examples in application code. This change provides structured storage and indexes; it does not introduce approximate vector search.

Evidence stores two independent values:

- `match_similarity`: cosine similarity used to select the reference and apply the 70% human-review threshold.
- `ceiling_fulfillment`: a separate model assessment used in `score_floor + ceiling_fulfillment * (score_cap - score_floor)`.

It also stores `reference_id`, original `quote`, `assessment_reason`, `assessment_model`, `score_floor`, `score_cap` and `score`. Existing jobs with an older formula retain their snapshots and remain subject to the application's rescore guard.

## Custom positions and versions

`GET /api/positions` lists the current browser workspace’s latest templates. `POST /api/positions` creates a template; `POST /api/positions/:id` saves a new version with an optimistic version check. Scoring and review requests include `positionId` and `positionVersion`; job reads use those query parameters. Older clients default to HR Intern version 1.

Templates store their complete validated definition in JSONB, while each version’s criterion and band rows also populate the normalized scoring tables. Jobs retain position identity, version and a full immutable template snapshot. Custom criteria receive unique IDs, so separate roles cannot overwrite each other’s guides. The band constraint permits 1–12 bands per criterion, replacing the original three-band restriction.

Each position version derives an isolated scoring workspace from the owner capability, position ID and version. HR Intern version 1 retains its existing workspace to preserve previously approved references and jobs. Additional contexts are seeded separately and remain distinct even when their caps match. Editing creates a new version and scope rather than rewriting the rules behind earlier results. Templates and previous versions are preserved during compatibility imports from older replicas.

## Candidate history and live dashboard

`GET /api/candidates` returns lightweight candidate score snapshots for the current owner workspace and its registered position scopes. The query joins ownership through `hr_scoring_position_scopes`; it does not read embeddings, evidence quotes or complete CV text. New score requests also carry `fileName`, which is validated and stored on the job.

`hr_scoring_candidates` also has nullable `candidate_name`, `phone`, `email`, and `linkedin_url` columns. The source job stores the validated `candidate_profile` JSONB object. Luna returns `candidateProfile` alongside evidence in the same strict-schema extraction response, avoiding an additional model request. Missing, ambiguous or unverified values remain null; names/contacts are never passed as metadata to the matching or ceiling-assessment stages. The API includes this profile in score results and candidate snapshots. Older replicas omitting profile fields cannot erase existing contacts during compatibility imports.

`hr_scoring_candidates` has a `(workspace_id, job_id)` key and retains filename, position/version/name, creation and update timestamps, result state, total, pending count and a JSONB breakdown containing criterion IDs, original titles, maximums and scores. The workspace foreign key preserves ownership; there is intentionally no job foreign key, so review-job expiry or deletion cannot cascade into history. Review completion updates the same row instead of creating a second candidate. Different scoring runs remain separate rows.

Startup archives every retained legacy job during the backed-up migration. Reusable references, jobs, older template versions and the one-time cleanup marker are preserved. Compatibility imports cannot delete candidate snapshots when older replicas omit history. History remains available across template versions and review-job pruning. Previously deleted jobs or original filenames that were never stored cannot be reconstructed.

The frontend polls this endpoint every 3 seconds while visible, also refreshing after score/review mutations. Status labels are derived from completed totals; pending review remains provisional. This is automatic polling, not a WebSocket stream, and does not trigger model calls.

## Original CV access

After scoring, the browser uploads the corresponding original PDF through `POST /api/jobs/:id/cv?positionId=…&positionVersion=…`. The server accepts PDF data up to 20 MB, checks its signature and requires an existing candidate in that owned role/version scope. PostgreSQL stores bytes in `hr_scoring_candidate_files.pdf` (`BYTEA`); candidate snapshots expose only `cvAvailable`, never the bytes. Upload retries preserve the first saved original.

`GET` on the same endpoint requires the browser workspace capability and checks role/version ownership. Responses use `application/pdf`, `nosniff`, and `Cache-Control: no-store`. The UI fetches the authenticated PDF into a temporary browser object URL, shows it in a preview popup and revokes the URL when closed. No capability token appears in the PDF URL. Both history and original PDF survive review-job expiry. Local development stores private PDF files under the configured data directory.

The dashboard shows separate Phone, Email and CV columns. Candidate filename subtitles and visible template version labels are removed. Missing historical PDF originals display a dash; they cannot be reconstructed from stored scores.

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

# HR Intern experience scoring

Position: Talent Acquisition & Employer Branding Intern. Scope: experience only.

## Original dimensions and bands

| Dimension | Maximum | Bands |
| --- | ---: | --- |
| Learning drive / application | 30 | 0–9, 10–20, 21–30 |
| Learning agility | 20 | 0–6, 7–13, 14–20 |
| Long-term commitment / direction | 20 | 0–6, 7–13, 14–20 |
| Hiring coordination | 8 | 0–2, 3–5, 6–8 |
| Data organization / careful execution | 7 | 0–2, 3–5, 6–7 |
| Employer branding / content execution | 5 | 0–1, 2–3, 4–5 |
| Process discipline | 4 | 0–1, 2–3, 4 |
| Education / career direction / talent interest | 3 | 0, 1–2, 3 |
| Tools / English / AI support | 3 | 0, 1–2, 3 |

Potential / learning trajectory totals 70; functional readiness totals 30. Original descriptions and general rules are in `server/rubric.mjs`. Prior HR internships alone must not dominate. Learning needs evidence of application; courses alone are insufficient. Progression and responsibility may demonstrate learning agility. Short activities alone do not imply poor commitment. Academic achievements can support capacity; school names alone are insufficient.

## Pipeline

1. Shared PDF reader extracts text locally, then sends it to the backend when scoring.
2. The backend splits CV text into numbered full sentences using sentence boundaries, blank paragraphs and explicit bullet boundaries. PDF line wraps are joined within a sentence; commas, colons and semicolons do not split evidence. An unpunctuated bullet is one unit. Luna selects up to 36 IDs with a holistic reusable description, one best-fitting dimension and band. The backend supplies the complete source sentence; model-provided fragments cannot become separate evidence.
3. Complete normalized sentences are used once per CV and in one dimension, even if Luna proposes different dimensions or selects repeated copies. Normalization covers Unicode, case, whitespace, bullet markers and ending sentence punctuation. Different sentences remain separate; there is no automatic semantic deduplication of paraphrases.
4. Evidence descriptions become embeddings. The initial reference library contains the 27 band descriptions provided in the user's rubric; their caps are the corresponding band upper bounds.
5. Compare every sentence, including new sentences, against all eligible references in its dimension. Reuse a human-approved dimension mapping when available, but search all references again rather than pinning to an old cap. If the best cosine similarity is positive and at least the provisional threshold (default 0.70), approve automatically and pin the selected reference for this job. Below threshold, zero similarity, or no eligible reference requires human review. Explicitly rejected sentences stay rejected in that workspace.
6. The popup lets the human reject evidence or approve its dimension, original band, reference cap and reusable description. The backend enforces the band's cap range. Pending/rejected items contribute no points. Human approval creates a reusable reference and pins this evidence to it, preserving the human's selected cap.
7. Stage one selects the most similar reference in the assigned dimension and embedding model space, regardless of its cap or the model-suggested band. Stage two reuses that reference's cosine similarity to position the sentence inside its band. A human approval uses the newly approved reference for that review; subsequent CV runs search all references again.
8. Evidence score = `band floor + similarity × (reference cap − band floor)`, where similarity is clamped to 0–1 and the floor is the lower bound of the selected reference's original rubric band. A human-selected cap below the band upper bound remains the cap. Example: floor 21, cap 30, similarity 0.8 → 28.2. A single-point band gives that exact point value. Dimension score is the strongest approved evidence score, capped at the dimension maximum and rounded to one decimal. Total is the sum of all nine dimension scores.

## Explicit implementation choices requiring calibration

- **Aggregation:** use the maximum evidence score per dimension, rather than adding unlimited keyword hits. This prevents repeated/similar evidence from inflating scores. It is a conservative implementation choice; multi-evidence aggregation has not been agreed as a separate formula.
- **Percentage:** cosine similarity is the mathematical match percentage used here. It is not a calibrated probability or objective percentage of job capability. Default 0.70 needs evaluation on reviewed CVs.
- **Band boundaries:** the new interpolation formula keeps each approved score between the chosen band floor and reference cap. Weak automatic matches still require review before earning any score.
- **Reference scope:** approvals belong to the current browser's workspace token. Human-reviewed examples are reused through retrieval/matching; model weights are not fine-tuned automatically.
- **Result snapshots:** subsequent approvals do not silently alter already saved jobs. Rescore a CV to use newer references. Embedding models are kept separate.

## Output and persistence

Main results contain only the total and nine dimension scores. Human review appears in a focused popup. No sample results or model internals are presented on the scoring screen.

Use PostgreSQL (`DATABASE_URL`) or a mounted `SCORING_DATA_DIR` for durable references on Railway. Jobs are accessible for 24 hours, limited to 20 per workspace, and pruned lazily on scoring; references persist until storage is removed. Stored job evidence includes quotes and embeddings, not the original full CV. Browser session storage keeps recent result summaries and pending reviews for reload recovery.

## Sentence migration

Jobs created before `sentence-v1` cannot be reviewed or retrieved under the new scoring rules. Re-upload and rescore those CVs. Legacy phrase mappings stay stored but cannot automatically approve full sentences; existing reference examples are preserved. Sentence mappings use versioned SHA-256 keys. Human caps, maximum-per-dimension aggregation and the 70/30 rubric are unchanged.

## Formula and model migration

Jobs now use `band-interpolation-v1`; jobs made with the previous percentage-times-cap formula require re-uploading and rescoring. Stored references and human decisions are preserved. Extraction defaults to `gpt-5.6-luna`; the Railway start command explicitly sets this model so a stale environment setting cannot keep using GPT-6 Luna. Embeddings remain `text-embedding-3-small`.

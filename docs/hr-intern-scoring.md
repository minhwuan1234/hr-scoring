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
2. Luna proposes up to 36 evidence items, each with an exact CV quote, exact keyword/phrase, reusable capability description, suggested dimension and band. The backend verifies quotes against CV text.
3. Exact normalized phrases are used once per CV and in one dimension. Normalization covers Unicode, case and whitespace; synonyms stay distinct.
4. Evidence descriptions become embeddings. The initial reference library contains the 27 band descriptions provided in the user's rubric; their caps are the corresponding band upper bounds.
5. Unknown phrases always need human review, even when similarity is high. Previously approved phrases reuse the approved dimension/reference only when the new evidence meets the provisional similarity threshold (default 0.82). Otherwise they return for review. Rejected phrases stay rejected in that workspace.
6. The popup lets the human reject evidence or approve its dimension, original band, reference cap and reusable description. The backend enforces the band's cap range. Pending/rejected items contribute no points. Human approval creates a reusable reference and pins this evidence to it, preserving the human's selected cap.
7. Each approved evidence item is compared with eligible references in its dimension and embedding model space. Human-pinned references take precedence. For unpinned evidence, the closest reference by cosine similarity is selected.
8. Evidence score = `max(0, cosine similarity) × reference cap`, with similarity capped at 1. Dimension score is the strongest approved evidence score, capped at the dimension maximum and rounded to one decimal. Total is the sum of all nine dimension scores.

## Explicit implementation choices requiring calibration

- **Aggregation:** use the maximum evidence score per dimension, rather than adding unlimited keyword hits. This prevents repeated/similar evidence from inflating scores. It is a conservative implementation choice; multi-evidence aggregation has not been agreed as a separate formula.
- **Percentage:** cosine similarity is the mathematical match percentage used here. It is not a calibrated probability or objective percentage of job capability. Default 0.82 needs evaluation on reviewed CVs.
- **Band underflow:** percentage × cap may fall below the selected band's lower bound. Preserve the raw formula; do not silently raise a weak match to the band minimum.
- **Reference scope:** approvals belong to the current browser's workspace token. Human-reviewed examples are reused through retrieval/matching; model weights are not fine-tuned automatically.
- **Result snapshots:** subsequent approvals do not silently alter already saved jobs. Rescore a CV to use newer references. Embedding models are kept separate.

## Output and persistence

Main results contain only the total and nine dimension scores. Human review appears in a focused popup. No sample results or model internals are presented on the scoring screen.

Use PostgreSQL (`DATABASE_URL`) or a mounted `SCORING_DATA_DIR` for durable references on Railway. Jobs are accessible for 24 hours, limited to 20 per workspace, and pruned lazily on scoring; references persist until storage is removed. Stored job evidence includes quotes and embeddings, not the original full CV. Browser session storage keeps recent result summaries and pending reviews for reload recovery.

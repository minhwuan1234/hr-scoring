# HR Scoring

HR Intern experience scoring with human-approved reference examples. React + TypeScript + Vite frontend, Node.js API, OpenAI Responses and embeddings.

## Workflow

Select **Add CV** in the Candidates column, choose PDF CVs, then select **Score CVs**. PDF.js extracts text automatically on the device through the shared `src/cv-input.ts` pipeline, ready for reuse by future roles. There is no separate PDF-to-text screen. Scanned PDFs require OCR, which is not included.

The server segments the CV into full sentences; Luna selects sentence IDs and assigns one best-fitting dimension per sentence. Sentences first match existing reference examples. A positive match at or above the configured threshold (default 70%) scores automatically, including new sentences. Weak or missing matches open a review popup: approve or reject, choose a dimension and original rubric band, set the reference cap, and edit the reusable description. Approved references and mappings are reused for later CVs. Final results show the total /100 and nine dimension scores. After selecting a reference, a separate GPT-5.6 Luna request assesses ceiling fulfillment from the original sentence. It receives no retrieval similarity or vectors. Scores use `band floor + fulfillment × (reference cap − band floor)`; retrieval similarity only selects the reference and gates human review. There are no sample scores.

See `docs/hr-intern-scoring.md` for the scoring formula and current assumptions.

## Local development

Requires Node.js 22.13+ (Node.js 24 recommended).

```sh
npm ci
cp .env.example .env
# Set OPEN_AI_API_KEY in .env.
npm run dev:server
```

In another terminal:

```sh
npm run dev
```

Vite proxies `/api` to port 3001. PDF fonts, CMaps and WASM are copied locally before dev/build; no PDF CDN is required.

```sh
npm test
npm run build
npm start
```

`npm start` serves both the built frontend and API. `npm run preview` serves only static files and cannot score CVs.

## Railway

`railway.json` sets the build, Node start command and health check. Add:

- `OPEN_AI_API_KEY`: required, server only. This exact spelling is used.
- `OPENAI_MODEL`: optional for local runs, defaults to `gpt-5.6-luna`. The Railway start command explicitly sets this model to override an older deployment value. It also sets `MATCH_THRESHOLD=0.70` for automatic scoring.
- `OPENAI_EMBEDDING_MODEL`: optional, defaults to `text-embedding-3-small`.
- `DATABASE_URL`: required on Railway. Reference the existing Postgres service with `${{Postgres.DATABASE_URL}}`. The app initializes its PostgreSQL tables before accepting traffic.
- `SCORING_DATA_DIR`: optional file storage for local development only.

Railway startup fails if PostgreSQL is not configured; it cannot silently fall back to temporary files. Local runs without `DATABASE_URL` use `.data/`. `PORT` is supplied by Railway. `GET /api/status` reports whether the API key and persistent storage are configured, the backend storage type, dataset version, active extraction model and formula version; it never returns credentials.

## Data and limits

PDFs stay on the device; extracted CV text is sent through the API to OpenAI when scoring. Responses requests set `store: false`. The app stores evidence quotes, vectors, approved reusable references and job scores and separate ceiling assessments; it does not store complete PDF files or complete CV text. OpenAI's API data policies still apply.

A random browser-local workspace token isolates review data between browsers. This is a prototype workspace capability, not a shared team login. Keep the same browser storage to reuse approvals. Do not clear local storage unless you intend to lose access to that workspace. Browser session storage restores recent jobs after reload; jobs are limited to 20 per workspace and expire for access after 24 hours. Expired records are pruned on the next scoring run.

Upload up to 50 PDFs per batch, 20 MB each; readable CV text is limited to 100,000 characters. Processing pauses for human review before continuing the remaining CVs with **Score CVs**. Each full sentence belongs to one dimension and is counted once per CV. Repeated sentences are deduplicated even across PDF line wraps. The similarity threshold is provisional and needs human calibration. Jobs scored with older formulas (including reuse of retrieval similarity for interpolation) require re-uploading the CV. References and human decisions remain stored; phrase approvals are not automatically treated as sentence approvals.

Tests use fake providers and cover real PDF parsing plus scoring/review persistence. Live OpenAI access requires a configured API key and available models for that API project.

## Design references

Imported Toolhub references remain in `design/reference/toolhub-codex-initial-ui/`.

## Prototype data cleanup

The one-time `clean-start-2026-10-19` migration moves existing workspace payloads into `hr_scoring_test_data_archive` and clears `hr_scoring_workspace_state` in a single transaction. The archive is not read by scoring, retrieval or learning. `hr_scoring_data_migrations` records completion; later deployments preserve new data. If archival fails, the reset rolls back. Browser result cache v1 is removed on loading the new UI. The original PDFs are untouched. An operator can restore archived records through PostgreSQL if needed.

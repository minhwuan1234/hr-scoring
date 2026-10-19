# HR Scoring

HR Intern experience scoring with human-approved reference examples. React + TypeScript + Vite frontend, Node.js API, OpenAI Responses and embeddings.

## Workflow

Select **Add CV** in the Candidates column, choose PDF CVs, then select **Score CVs**. PDF.js extracts text automatically on the device through the shared `src/cv-input.ts` pipeline, ready for reuse by future roles. There is no separate PDF-to-text screen. Scanned PDFs require OCR, which is not included.

The server segments the CV into full sentences; Luna selects sentence IDs and assigns one best-fitting dimension per sentence. Unfamiliar full sentences open a review popup: approve or reject, choose a dimension and original rubric band, set the reference cap, and edit the reusable description. Approved references and mappings are reused for later CVs. Final results show the total /100 and nine dimension scores. There are no sample scores.

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
- `OPENAI_MODEL`: optional, defaults to `gpt-6-luna`.
- `OPENAI_EMBEDDING_MODEL`: optional, defaults to `text-embedding-3-small`.
- `DATABASE_URL`: recommended PostgreSQL connection string for durable human-approved references.
- Alternatively, mount a Railway volume and set `SCORING_DATA_DIR` to a directory on that volume.

Without PostgreSQL or a mounted directory, the local `.data/` store works for development but Railway redeploys may remove references. `PORT` is supplied by Railway. `GET /api/status` reports whether the API key and persistent storage are configured; it never returns credentials.

## Data and limits

PDFs stay on the device; extracted CV text is sent through the API to OpenAI when scoring. Responses requests set `store: false`. The app stores evidence quotes, vectors, approved reusable references and job scores; it does not store complete PDF files or complete CV text. OpenAI's API data policies still apply.

A random browser-local workspace token isolates review data between browsers. This is a prototype workspace capability, not a shared team login. Keep the same browser storage to reuse approvals. Do not clear local storage unless you intend to lose access to that workspace. Browser session storage restores recent jobs after reload; jobs are limited to 20 per workspace and expire for access after 24 hours. Expired records are pruned on the next scoring run.

Upload up to 50 PDFs per batch, 20 MB each; readable CV text is limited to 100,000 characters. Processing pauses for human review before continuing the remaining CVs with **Score CVs**. Each full sentence belongs to one dimension and is counted once per CV. Repeated sentences are deduplicated even across PDF line wraps. The similarity threshold is provisional and needs human calibration. Older keyword-based jobs require re-uploading the CV; their phrase approvals are not automatically treated as sentence approvals.

Tests use fake providers and cover real PDF parsing plus scoring/review persistence. Live OpenAI access requires a configured API key and available models for that API project.

## Design references

Imported Toolhub references remain in `design/reference/toolhub-codex-initial-ui/`.

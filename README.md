# HR Scoring

Configurable position templates and CV scoring with human-approved reference examples. React + TypeScript + Vite frontend, Node.js API, OpenAI Responses and embeddings.

## Workflow

Select **Add CV** in the Candidates column, choose PDF CVs, then select **Score CVs**. PDF.js extracts text automatically on the device through the shared `src/cv-input.ts` pipeline, ready for reuse by future roles. There is no separate PDF-to-text screen. Scanned PDFs require OCR, which is not included.

The server segments the CV into full sentences; Luna selects sentence IDs and assigns one best-fitting dimension per sentence. Sentences first match existing reference examples. A positive match at or above the configured threshold (default 70%) scores automatically, including new sentences. Weak or missing matches open a review popup: approve or reject, choose a dimension and original rubric band, set the reference cap, and edit the reusable description. Approved references and mappings are reused for later CVs. Final results show the total /100 and the configured criterion scores. After selecting a reference, a separate GPT-5.6 Luna request assesses ceiling fulfillment from the original sentence. It receives no retrieval similarity or vectors. Scores use `band floor + fulfillment × (reference cap − band floor)`; retrieval similarity only selects the reference and gates human review. There are no sample scores.

See `docs/hr-intern-scoring.md` for the scoring formula and current assumptions.

## Position templates

Select **Add position** in the sidebar to open the setup popup. Start blank or copy an existing template, name the position, and configure its criteria, score bands, floors, ceilings and additional ceiling contexts. Users choose the number of criteria (1–20); HR Intern’s nine criteria are only its default template. Criterion maximums must total 100 points. Each criterion supports up to 12 bands and 30 additional contexts, including multiple contexts with the same cap. Add role-specific general rules when needed.

All positions use the same PDF conversion and scoring algorithm. References, human decisions and candidate jobs are isolated by position and template version within the browser workspace. **Duplicate** creates an independent template. **Edit template** saves a new version; existing results and references keep their original rules, while new scoring uses the new version and its configured references. Templates persist in Railway PostgreSQL and survive reloads. Creating templates does not require an OpenAI request.

## Dashboard and candidate history

The sidebar **Dashboard** shows every saved CV scoring run across the workspace’s roles and template versions. Each role also has **Screening** and **History** tabs. Search by candidate name, email, phone or filename, filter by role or outcome, and open a CV to view its original score breakdown. Completed results use **Rejected** (0–50, red), **Consider** (>50 and <70, amber) and **Pass** (70–100, green). Pending human review stays neutral and its score is marked provisional.

Dashboard and role History show **10 results per page** with Previous/Next controls. Search, position and outcome filters run on the server across all saved candidates, rather than only the current page. Summary counts cover the selected role scope across all pages. Checkboxes/select-all apply to the visible page and reset when pages or filters change.

The dashboard refreshes the current page automatically every 3 seconds while the page is visible, and immediately after scoring/review actions. These requests only read saved records; they do not call the model or rescore candidates. Refresh failures keep the last view and display an update warning.

During the existing Luna CV-reading request, the model also extracts the applicant’s own name, phone, email and personal LinkedIn URL as separate nullable metadata. Name, phone and email appear in the dashboard, role history and candidate details; LinkedIn is retained as extracted metadata. The table’s CV column opens the original PDF; missing values display as a dash. Candidate names keep their original spelling and accents. The server verifies values against the supplied CV text and permits only personal LinkedIn URLs. Contacts are excluded from embedding and ceiling-assessment inputs and never affect points.

Candidate contact metadata, filename, role/version, timestamps, review status and score breakdown are saved independently of review jobs in PostgreSQL. Clearing the upload queue does not remove history, and job expiry/retention does not erase saved scores. Each scoring run is a separate record; filenames do not establish a unique candidate identity. Existing retained jobs are migrated into history; older jobs have a fallback filename when it was never stored. Historical entries without a contact profile require re-uploading/scoring their CV, because complete CV text/PDFs were never archived. Newly scored CVs also save the original PDF for **View CV** and download. Missing legacy originals show a dash until the CV is uploaded again. Complete extracted CV text is not archived.

## Delete selected CVs

Select rows with their checkboxes or use the header checkbox to select the current filtered list. **Delete selected** replaces the former live-update text; automatic refresh continues. A confirmation popup lists exactly which CVs will be permanently deleted. Cancelling leaves them unchanged.

Deletion removes candidate profiles/contact data, original PDFs, jobs, extracted evidence, score breakdowns and associated browser result caches. Candidate-specific learning decisions and unshared human references are removed; configured role templates and standards still used by other CVs remain intact. Application-managed migration backups and compatibility snapshots are scrubbed for the selected records. Non-personal deletion markers prevent older replicas or snapshots from restoring them. PostgreSQL deletion across selected roles is one transaction.

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

Railway startup fails if PostgreSQL is not configured; it cannot silently fall back to temporary files. Local runs without `DATABASE_URL` use `.data/`. `PORT` is supplied by Railway. `GET /api/status` reports whether the API key and persistent storage are configured, the backend storage type, dataset version, schema version, active extraction model and formula version; it never returns credentials.

## Data and limits

PDF text is extracted on the device; the original PDF is then saved to the private workspace for viewing from history, and extracted CV text is sent through the API to OpenAI when scoring. Responses requests set `store: false`. The app stores evidence quotes, vectors, approved reusable references and job scores and separate ceiling assessments; it stores original PDF files for CV viewing, but does not store the complete extracted CV text. OpenAI's API data policies still apply.

A random browser-local workspace token isolates review data between browsers. This is a prototype workspace capability, not a shared team login. Keep the same browser storage to reuse approvals. Do not clear local storage unless you intend to lose access to that workspace. Browser session storage restores recent jobs after reload; jobs are limited to 20 per workspace and expire for access after 24 hours. Expired records are pruned on the next scoring run.

Upload up to 50 PDFs per batch, 20 MB each; readable CV text is limited to 100,000 characters. Processing pauses for human review before continuing the remaining CVs with **Score CVs**. Each full sentence belongs to one dimension and is counted once per CV. Repeated sentences are deduplicated even across PDF line wraps. The similarity threshold is provisional and needs human calibration. Jobs scored with older formulas (including reuse of retrieval similarity for interpolation) require re-uploading the CV. References and human decisions remain stored; phrase approvals are not automatically treated as sentence approvals.

Tests use fake providers and cover real PDF parsing plus scoring/review persistence. Live OpenAI access requires a configured API key and available models for that API project.

## Design references

Imported Toolhub references remain in `design/reference/toolhub-codex-initial-ui/`.

## Prototype data cleanup

The one-time `clean-start-2026-10-19` migration moves existing workspace payloads into `hr_scoring_test_data_archive` and clears `hr_scoring_workspace_state` in a single transaction. The archive is not read by scoring, retrieval or learning. `hr_scoring_data_migrations` records completion; later deployments preserve new data. If archival fails, the reset rolls back. Browser result cache v1 is removed on loading the new UI. The original PDFs are untouched. An operator can restore archived records through PostgreSQL if needed.

## Structured PostgreSQL tables

Railway stores dimensions, bands, individual reference examples, sentence decisions, jobs, evidence and dimension scores in separate tables. Each evidence row stores retrieval match and independently assessed ceiling fulfillment in separate columns. Multiple examples with the same cap remain distinct by reference ID/context. See `docs/database.md` for the schema, constraints, model-space isolation, migration backups and rolling-deployment compatibility. The prior JSONB workspace table is retained only as a compatibility mirror; application reads use the normalized tables.


Role/template and saved-result reads are separate from scoring writes. Model requests run outside PostgreSQL transactions and advisory locks, so waiting for a model response does not block those reads. Short optimistic commits validate concurrent reviews and deletions before saving; see `docs/database.md` for details.


### Scoring error recovery

Evidence schemas restrict each criterion to its own valid band indices, including templates with different band counts. Invalid extracted sentences or ceiling assessments are regenerated once, then rejected with a specific 502 error if validation still fails. Invalid output never receives fallback scores or a saved scoring run.

Provider connection failures and early upstream 5xx responses get one bounded retry; long `Retry-After` delays, quota/authentication errors and timeouts are surfaced rather than retried immediately. Provider requests share their original 120-second timeout across transport attempts. Recovery follows the [OpenAI error guidance](https://developers.openai.com/api/docs/guides/error-codes); the schema uses supported nested `anyOf` branches from [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

If scoring fails, the UI displays an **Error ID** for 5xx responses. Match it to Railway's JSON `request_failed` log entry: `stage` distinguishes extraction, embedding, assessment and database read/commit, while `code` identifies model validation, upstream HTTP or database errors. Logs contain safe metadata only, excluding CV text, contacts, SQL values, API keys and raw provider error bodies. `/api/status` reports `errorHandlingVersion: scoring-recovery-v1` on this release. This instrumentation identifies future failures; it does not establish the cause of an earlier untraced production error.


### Lark sending

Set `LARK_APP_ID` and `LARK_APP_SECRET` on the Railway **application service** (`LARK_APP_` or `LARK_ID` for the App ID and `LARK_SECRET` for the secret are accepted aliases). Credentials stay server-side. `GET /api/lark/status` reports presence without values. `POST /api/lark/check` verifies the internal app and caches its tenant token until shortly before expiry. The Lark management API requires the existing workspace header; decision pages use narrowly signed links. POST routes use the existing rate limit.

Select up to 50 CVs in Dashboard or role History and choose **Send Lark**. The popup lists the selected candidates and shows the actual unique recipient count from the server. Default delivery remains restricted to Minh Quân (`ou_f77cf794a1319628941dd689ecc97e32`). Social Content Creator / Social Media CVs are an explicit exception: they go to Minh Quân, Trang Liu, Linh Giang and Annie. Routing is defined in `server/lark-config.mjs` from the saved candidate role name (case/whitespace normalized, exact match). Other roles keep the existing test recipient.

The application automatically creates a signed link to each candidate's saved original PDF. No Drive link, Google account or extra upload is required. The original card actions remain: **📄 Xem CV** (the actual saved PDF) and the unchanged **📅 Setup lịch Call** (`https://cal.com/f-creative-krcb9e/30min`). The CV label no longer claims Google Drive storage. Missing legacy PDFs must be uploaded/scored again before sending; the app does not create a broken CV link.

Links are valid for 30 days and authorize reading only their signed workspace/file pair, without exposing the browser workspace token. `GET`/`HEAD /api/shared-cvs/:token` verifies the HMAC and expiry before reading the PDF. Anyone holding the link can open that file until expiry; deleting the candidate removes the file and immediately invalidates access. Responses disable caching and referrers. Optional `CV_LINK_SECRET` provides a dedicated signing key; otherwise the existing Lark app secret is used. Changing the signing secret revokes earlier links. Optional `PUBLIC_APP_URL` sets the HTTPS public origin; the Railway public domain, or this project's production URL, is used by default. Incoming request hosts and client-supplied URLs are not used to generate links.

`POST /api/lark/send` reads contacts, role and score breakdowns from the workspace's saved records; client-provided scores, links or recipients cannot override them. Each candidate becomes an interactive card sent privately to its configured role recipients in `server/lark-config.mjs`. Criterion count is dynamic. Card colors/statuses follow the dashboard; pending reviews are explicitly provisional. The reference workflow's test-email callback remains disabled.

Delivery succeeds only when Lark returns API code zero and a message ID. Partial failure reports the delivered-card count; retrying the same popup batch reuses per-candidate/per-recipient message UUIDs for Lark deduplication. Closing the popup starts a new send action. No messages are sent automatically when scoring, deploying, or testing credentials. Logs exclude credentials, recipient IDs, signed CV links and CV content. The bot must have messaging permission and availability for the test recipient. API parameters follow the [official Lark SDK](https://github.com/larksuite/node-sdk/blob/main/code-gen/projects/im.ts) and [SDK setup guidance](https://github.com/larksuite/node-sdk#api-call).


The UI uses `GET /api/candidates/page?page=1&positionId=…&search=…&status=…`. PostgreSQL returns at most ten candidate snapshots plus consistent totals, outcome counts and role counts from one SQL statement. Stable ordering uses creation time, job ID and workspace; out-of-range pages clamp to the final page after deletion. Two additive covering indexes support recent and per-role ordering. Search treats punctuation literally and is debounced in the browser. Stale requests cannot replace a newer filter/page response. No scoring/reference/PDF data is loaded for paging. Legacy `GET /api/candidates` is retained for older clients during rollout; the new UI does not use it. Lark sending now fetches only the selected saved records, rather than reading the whole candidate history. `/api/status` reports `paginationVersion: candidate-pages-v1`. These additive indexes leave the existing schema version and data migration markers intact.

### Independent review decisions

Newly sent Lark cards also contain **Accept** and **Denied** URL buttons, using the [official Lark button types](https://github.com/larksuite/node-sdk/blob/main/typings/card.ts). Each opens an application page that automatically saves the decision with a POST request; there is no second confirmation click. No Lark callback-console setup is needed. Old cards must be sent again to gain these buttons. Previously delivered cards are static; Dashboard and position History poll for the latest saved decision. Future cards include it.

Dashboard and role History show separate **Accept** and **Reject** columns, with counts on the same candidate row and no individual names. Candidate details show **Accept N · Reject N** together, followed by **Accepted by** and **Rejected by** with the saved reviewer names. Each reviewer has one independent vote per CV; changing their choice moves their own vote between the counts. No votes shows two zero counts. This does not change Pass/Consider/Rejected, provisional review state, scoring totals, breakdowns or scoring filters/counts. Each reviewer’s latest choice wins only for that reviewer; repeating the same choice is idempotent. Other reviewers’ decisions stay unchanged. Later rubric review on the same CV retains the decision; a new scoring run gets an independent record.

`GET`/`HEAD /lark/decision/:token` never write data. A page opened in the browser automatically submits `POST` to apply the signed action to its single candidate. Fetch-only link previews and HEAD requests do not apply decisions. Safari/Lark opaque `Origin: null` is accepted only for the token-bound JSON action with its custom intent header; malformed and foreign origins return 403, never a URL parsing 500. Failed saves show a retry button and Error ID. Action links use a distinct HMAC purpose from PDF links and bind the candidate, scoring workspace, allowlisted recipient, decision and 30-day expiry. They use the existing CV/Lark signing secret and public-origin configuration. These are bearer links, not Lark identity authentication: forwarding a link forwards its narrow decision authority. Secret rotation revokes them. Responses disable caching/referrers, and signed tokens are excluded from diagnostics.

PostgreSQL stores a `reviewer_decisions` JSON object on `hr_scoring_candidates`, keyed by the full reviewer open_id, with server-assigned name, decision and timestamp. Legacy unattributed `manual_decision` and `decision_at_ms` values are retained for compatibility but are not guessed into reviewer counts. Opening the original signed link again records the named reviewer. This is additive, without changing schema/reset markers or erasing existing data. Compatibility writes merge each reviewer by timestamp, preserving newer votes and omitted reviewers. Candidate deletion removes the decision and revokes action links. `/api/status` exposes `decisionVersion: lark-reviewer-decisions-v3`.

Reviewer names in `server/reviewers.mjs`: `ou_f77cf794a1319628941dd689ecc97e32` → Minh Quân; `ou_9f7de713af63322b36ee7e41f5731313` → Trang Liu; `ou_4eb96bd84a22b6511fcb316d35ded621` → Quỳnh Chi. Signed links for known reviewers are supported, including earlier cards. Default roles still send only to Minh Quân; Social Content Creator / Social Media sends to the four configured Social reviewers. The reviewer comes from the verified link, never POST body names or IDs. Forwarding a card/link still attributes its action to the original recipient; this flow does not authenticate a different person who opens a forwarded link.

### Role-specific Lark delivery

Social routing adds Linh Giang (`ou_34667345f6e162ffccaa0b43f8c75986`) and Annie (`ou_70ce15a771b137289d618549406121ad`) to the reviewer registry. Its four recipients exclude Quỳnh Chi. `POST /api/lark/preview` resolves selected workspace-owned records and reports recipient/card counts without Lark authentication or message delivery. Send resolves the same saved records again; client names/recipient lists cannot change routing. In a mixed-role batch, only CVs assigned to a recipient’s group are sent to that person. Retry UUIDs remain per CV/recipient, and partial failures are scoped to that recipient’s own queue. Each card keeps its own recipient-bound Accept/Denied links. `/api/status` reports `larkRoutingVersion: role-recipients-v1`. No existing CVs are automatically resent on deployment.

### Full-sentence extraction limit

New scoring uses `sentence-period-v2`: only complete, period-terminated source sentences qualify for evidence. PDF wrapping is preserved within a sentence; unpunctuated bullets/unfinished tails are skipped, without inventing a period. Luna selects at most 10 relevant sentences across the entire eligible CV list. The model schema, server validation and review batch validation enforce the cap. Contact/profile extraction still reads the raw CV independently. Historical scores and reusable full-sentence decisions/reference examples remain; earlier pending review jobs require rescoring under the new policy. `/api/status` exposes `sentencePolicy` and `maxEvidenceSentences`.

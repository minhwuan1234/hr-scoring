# Lark Reject confirmation

Based on `codex/import-design-files` at `cab4126` (the default `main` branch currently contains only README).

## Behavior

Reject (including previously sent, unexpired Denied links) opens a confirmation page in the Lark browser. The user signs in with Lark, enters an optional reason (up to 2,000 characters), then selects Confirm. Opening or previewing the link, completing login, or cancelling without Confirm does not save a decision. Accept keeps its existing immediate-save behavior.

The actual actor is obtained server-side from Lark `user_info.open_id` and `name`; the signed link's recipient and any browser-provided identity fields are not used as the actor. Only the existing HR reviewer allowlist can reject. A forwarded link therefore records the signed-in, allowlisted actor. OAuth state is bound to a signed HttpOnly, Secure, SameSite=Lax browser cookie; the resulting 30-minute reviewer session is restricted to that decision link. User access tokens never reach the browser or database.

No Reject handler sends Lark messages or updates cards. The existing user-triggered Send Lark action stays available; newly sent cards label the existing Denied link as Reject. Existing cards are untouched.

## Configuration required before later rollout

- Set `PUBLIC_APP_URL` to the actual public HTTPS origin. All instances must share the same signing secret (`CV_LINK_SECRET`, or the existing Lark app secret fallback).
- Use the existing `LARK_APP_ID` and `LARK_APP_SECRET` for the app whose open IDs are in `server/reviewers.mjs`.
- Enable/configure the app's Lark web login capability and register the exact redirect URL `<PUBLIC_APP_URL>/lark/review/callback` in Lark's security/redirect settings. Make the app available to the HR reviewers. The flow requests basic login identity only, no messaging permission additions.
- Use PostgreSQL via the existing `DATABASE_URL`. Startup adds the `hr_scoring_candidate_rejections` table under the existing schema migration transaction/lock. This migration adds a table and does not reset existing data; no manual data rewrite is needed.

Reference: [Lark application login overview](https://open.larksuite.com/document/server-docs/getting-started/authen-v1/build-login-free-system-), [Lark official SDK](https://github.com/larksuite/node-sdk). This change does not configure a card-action webhook; the existing card URL flow is retained.

## Persistence and retries

`hr_scoring_candidate_rejections` stores `decision='reject'`, `reviewer_id`, `reviewer_name`, `reject_reason` (trimmed, NULL when empty), and `reviewed_at` (TIMESTAMPTZ), together with candidate scope and a unique request key. The request key is derived from the signed link plus the authenticated reviewer, so a repeated Confirm from the same link/reviewer is permanently a no-op, including after another decision. To make a fresh rejection after changing a decision, use a newly generated link. The first successful submission owns that link/reviewer receipt; retrying cannot edit its reason or timestamp.

The receipt and current reviewer decision JSON are written in one PostgreSQL transaction, with the same per-workspace advisory lock used by Accept, scoring and deletion, plus a candidate row lock. Failure rolls back both writes. Deleting a candidate cascades its rejection receipts and makes old links unavailable. File storage supports the same application behavior for local development, with its existing single-process limitation.

The Web UI polls existing candidate history every three seconds while visible. It shows Rejected by HR in the list and the reviewer, reason (or No reason provided), and review time in details. The scoring result, scoring filters/charts and points remain separate and unchanged. CSV reject counts recognize both legacy `denied` and new `reject` values.

## Validation

Run `npm ci`, `npm test`, and `npm run build`. Tests cover optional reasons, verified actors, forged identity fields, confirmation-only writes, login state/session binding, duplicates after Accept and restart, concurrent submissions, rollback, deletion, escaped text and the browser submission behavior. PostgreSQL tests use PGlite's PostgreSQL engine; HTTP tests stub Lark identity APIs and reject unexpected outbound calls. A live Lark tenant check is still needed after configuring the redirect URL; no live tenant or production database was accessed.

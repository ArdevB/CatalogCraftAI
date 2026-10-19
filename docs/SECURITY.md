# Security review

Status as of Phase 6 (pilot readiness). The table below maps every item of the specification's security requirements (§11) to how CatalogCraft meets it and which automated tests check it. Test paths are relative to the repository root.

## Requirement checklist

| Requirement | How it is met | Checked by |
| --- | --- | --- |
| Secure authentication | Argon2id password hashes (never returned by any query); generic "invalid email or password"; server-side sessions in MongoDB; a fresh session id at every sign-in (no session fixation); 72 h inactivity expiry; changing or resetting a password signs out every other session (`authVersion`). | `apps/api/tests/auth.test.ts`, `password.test.ts` |
| Authorization | One permissions table (`packages/shared/src/schemas/roles.ts`) enforced by the API on every route; the web app hides what a role can't do. Membership and role are re-read from the database on **every** request, so removals and role changes apply immediately. | `organizations.test.ts`, `team.test.ts`, `review-export.test.ts` |
| Organization-level tenant isolation | Every query is scoped with `tenantScope(auth)`; another organization's ids return `404`, exactly like missing ones. There is no organization id in any URL (`/organizations/current`). | Isolation tests in every API test file; browser test step 12 (`e2e/`) |
| Input validation on every endpoint | Zod schemas (shared with the web app) for every body, query and URL parameter; unknown fields are dropped. | `validate-request.test.ts` and per-feature tests |
| Rate limiting | 300 requests / 15 min per IP for the API; 10 failed attempts / 15 min for sign-in, registration, invitation sign-up/sign-in, password change and account deletion. | `auth.test.ts` (credential rate limiting) |
| CORS for the intended origin | Only `WEB_ORIGIN` may make credentialed browser requests. | `http.test.ts` |
| Security headers | Helmet. The API sends `default-src 'none'`; the served web app has its own strict policy (`script-src 'self'`, no inline scripts, `frame-ancestors 'none'`). | `http.test.ts`, `platform.test.ts`, browser security test |
| File type and size validation | Extension **and** content checks; `UPLOAD_MAX_MB`; row limit; zip-bomb guard for XLSX; macro workbooks and `.xls` refused; formulas never evaluated. | `import-parsing.test.ts`, `jobs.test.ts` |
| Private file storage | Server-generated keys; local folder or a **private** S3 bucket; nothing is ever served by URL. | `platform.test.ts`, `review-export.test.ts` |
| Authorized file streaming | Downloads go through `GET /exports/:id/download`, which checks the organization every time and logs the download. | `review-export.test.ts`, browser test step 12 |
| Path traversal | Storage keys must match a strict pattern and resolve inside the storage root; S3 keys are checked the same way. | `platform.test.ts` |
| CSV formula injection | Text cells starting with `= + - @`, tab or CR are prefixed with `'`; plain numbers are left alone. | `export-unit.test.ts`, browser test step 11 |
| HTML escaping | React escapes everything it renders; AI output containing HTML is flagged for review; exports are CSV, not HTML. | `ai-unit.test.ts` |
| Safe database queries | Only validated, typed values reach queries; text search escapes regular-expression characters; Mongoose casts ids. | `clients.test.ts` (literal search) |
| No secrets in frontend bundles | The web build never reads the root `.env`; only `VITE_*` variables reach the browser. | Browser security test scans the shipped JavaScript |
| No sensitive data in logs | Pino redacts cookies, auth headers, passwords, hashes, API keys and tokens; request bodies are never logged; **invitation tokens are stripped from logged URLs**; error alerts scrub emails and duplicate-key values. | `platform.test.ts` (request logs, alerts) |
| Secure session cookies | `httpOnly`, `SameSite=Lax`, and in production `Secure` with the `__Host-` prefix. | `auth.test.ts`, browser security test |
| CSRF protection | State-changing requests need the `X-CatalogCraft-Request` header (which cross-site forms can't send) and an allowed `Origin`, on top of `SameSite=Lax`. | `auth.test.ts` (CSRF) |
| Prompt-injection mitigation | Product data is sent as escaped JSON inside a marked data block; the system prompt treats it as data; structured output limited to the requested fields; guardrails check every answer. | `ai-unit.test.ts` |
| Explicit AI usage limits | Monthly product allowance per plan with reservations for running jobs; failures are free; concurrency and token caps. | `enrichment.test.ts` |
| Account and organization deletion | Owners delete an organization by typing its name (everything it owns, including files, is removed); users delete their account with their password (refused while they own an organization). Export files expire after 30 days; old invitations are removed by MongoDB. | `deletion.test.ts` |
| Automated cross-tenant tests | User A cannot read or change User B's clients, jobs, rows, exports, files, invitations or members, even with the ids. | Every API test file; `e2e/catalog-workflow.spec.ts` |

Uploaded spreadsheets and AI output are treated as untrusted throughout: neither is ever executed, evaluated or rendered as HTML.

## Fixed during this review

- **Invitation tokens in logs.** Request logs included the full URL, so an invitation link (a secret) could be read from the logs. URLs are now logged as `/invitations/[token]`.
- **No way to end other sessions.** Changing a password didn't sign out other devices, and there was no password change or reset at all. Added *Account → Change password* and `npm run reset-password`, both of which sign out every other session.
- **Unknown `/api` paths on the web origin** briefly received the web page's security policy instead of the API's. They now always get the strict API policy.
- **Data that could never be deleted.** Organizations and accounts can now be deleted; export files and old invitations expire.

## Accepted risks and limitations (for the pilot)

- **Account discovery.** Registration says when an email already has an account. This is common practice, and it's rate-limited. Hiding it needs email verification, which needs an email service.
- **No email.** There's no email verification, self-service password reset or emailed invitations. Resets are done by an operator (`npm run reset-password`). Invitation links are shared by hand.
- **No two-factor authentication.**
- **Rate limits are per server instance** (kept in memory). That's fine for one instance; use a shared store before scaling out.
- **The AI provider receives product data.** Only copy-relevant fields are sent: no prices, stock, identifiers or personal data. Mention the provider as a processor in the pilot's privacy terms.
- **Backups contain customer data.** Keep them private and encrypted, and never put them in git (`backups/` is git-ignored).
- **`style-src-attr 'unsafe-inline'`.** This lets React set a few inline style attributes (e.g. progress-bar widths). Scripts remain strictly same-origin.

## Reporting a problem

Error responses for unexpected failures include a **reference** (the request id). Search the server logs for it to find the exact failure.

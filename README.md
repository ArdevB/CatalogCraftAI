# CatalogCraft AI

Multi-tenant SaaS for ecommerce agencies: import messy supplier catalogues (CSV/XLSX), validate them, generate AI suggestions for selected fields, review every change, and export a clean CSV — with product facts and protected fields (SKU, price, stock, barcodes…) never altered by AI.

> **Status: Phase 2 (File import) complete.** Accounts, organizations and roles, client workspaces, plan limits, a live dashboard, and the full import workflow — CSV/XLSX upload, worksheet & header-row selection, column mapping, preview and deterministic validation with a row-level report — are working. AI enrichment, review and export are **not implemented yet** — see [Roadmap](#roadmap).

---

## Tech stack

| Layer    | Choice |
| -------- | ------ |
| Web      | React 19, Vite 8, TypeScript, Tailwind CSS 4, shadcn/ui-style components, React Router, TanStack Query |
| API      | Node.js, Express 5, TypeScript, Zod, Mongoose, pino (structured logs), helmet, CORS, rate limiting |
| Database | MongoDB (local or MongoDB Atlas) |
| Shared   | `@catalogcraft/shared` — Zod schemas and types used by both API and web |
| Tests    | Vitest, Supertest, React Testing Library (Playwright arrives with the end-to-end workflow) |

## Repository layout

```
apps/
  api/          Express REST API
    src/
      config/       env validation, logger, database connection
      middleware/   error handling, security (headers, CORS, rate limit)
      middleware/   error handling, security, CSRF, requireAuth / requirePermission
      modules/      one folder per feature: auth, organizations, memberships, health
      scripts/      seed script
      utils/        AppError, response helpers, request validation, tenantScope
      app.ts        builds the Express app (used by tests)
      server.ts     starts HTTP server + MongoDB connection + session store
    tests/          API tests (run against a throwaway in-memory MongoDB)
  web/          React single-page app
    src/
      components/     shadcn-style primitives (ui/) and shared form/page-state components
      features/       auth, organization, system status
      layouts/ pages/ routes/ lib/
    tests/
packages/
  shared/       Zod schemas shared by API and web (auth, roles & permissions, organizations, responses…)
```

## Prerequisites

- **Node.js 22.12+** (developed on Node 24) and npm 10+
- **MongoDB**, either:
  - **MongoDB Atlas free tier** (no install needed): create a free M0 cluster, add a database user, allow your IP, and copy the `mongodb+srv://…` connection string; or
  - **MongoDB Community Server** installed locally (listens on `mongodb://127.0.0.1:27017`).

## Getting started

```bash
npm install
cp .env.example .env      # Windows PowerShell: Copy-Item .env.example .env
# edit .env: set MONGODB_URI and generate SESSION_SECRET (command is in the file)
npm run seed              # optional: creates a synthetic demo account
npm run dev
```

Then open <http://localhost:5173> and **Create an account** (or sign in with the seeded demo account — `npm run seed` prints its details). Registering creates your agency organization with you as its owner.

`npm run dev` builds the shared package once and then runs three processes together:

| Process  | URL                               | Notes |
| -------- | --------------------------------- | ----- |
| `shared` | –                                 | recompiles shared schemas on change |
| `api`    | <http://localhost:4000/api/v1>    | restarts on code changes **and on `.env` changes** (tsx watch) |
| `web`    | <http://localhost:5173>           | Vite dev server; proxies `/api` to the API |

## Scripts (run from the repository root)

| Command             | What it does |
| ------------------- | ------------ |
| `npm run dev`       | Start shared watcher, API and web in development mode |
| `npm run build`     | Production build of shared, API (`apps/api/dist`) and web (`apps/web/dist`) |
| `npm start`         | Start the built API (`node apps/api/dist/server.js`) |
| `npm run lint`      | ESLint across the monorepo |
| `npm run typecheck` | TypeScript checks for every workspace |
| `npm test`          | All unit/API/component tests |
| `npm run check`     | lint + typecheck + test |
| `npm run seed`      | Create the synthetic demo account `demo@catalogcraft.test` (Agency plan) and a sample client (safe to re-run; refuses in production) |
| `npm run set-plan -- <owner-email> <plan>` | Manually change an organization's plan (`trial`, `solo`, `agency`, `studio`) — for pilot customers, since there is no payment integration |

API tests start a throwaway MongoDB automatically (`mongodb-memory-server`), so they never touch your real database. The **first** test run downloads a MongoDB binary (~800 MB, cached afterwards).

## Configuration

All settings come from environment variables, validated at startup by [`apps/api/src/config/env.ts`](apps/api/src/config/env.ts). If something is wrong, the API refuses to start and lists each bad variable. See [`.env.example`](.env.example) for every variable and its meaning.

| Variable | Required | Default | Purpose |
| -------- | -------- | ------- | ------- |
| `MONGODB_URI` | yes | – | MongoDB connection string |
| `SESSION_SECRET` | yes | – | Signs session cookies; ≥ 32 random characters, different per environment |
| `SESSION_TTL_HOURS` | no | `72` | Sessions end after this many hours of inactivity |
| `AUTH_RATE_LIMIT_MAX` | no | `10` | Failed login/registration attempts per IP per rate-limit window |
| `SEED_DEMO_PASSWORD` | no | generated | Password for the seeded demo account |
| `STORAGE_LOCAL_DIR` | no | `./storage` | Private folder for uploaded files (relative to the repo root, or absolute) |
| `UPLOAD_MAX_MB` | no | `10` | Maximum upload size |
| `IMPORT_MAX_ROWS` | no | `2000` | Maximum product rows per job |
| `NODE_ENV` | no | `development` | `development`, `test` or `production` |
| `PORT` | no | `4000` | API port (the Vite proxy uses it too) |
| `LOG_LEVEL` | no | `info` | pino log level |
| `WEB_ORIGIN` | no | `http://localhost:5173` | Allowed browser origin(s) for CORS, comma-separated |
| `TRUST_PROXY_HOPS` | no | `0` | Reverse proxies in front of the API (usually `1` in hosting) |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | no | `900000` / `300` | Per-IP API rate limit |
| `VITE_API_BASE_URL` | no | `/api/v1` | Web only — set in `apps/web/.env` or your host, **not** the root `.env`: absolute API URL when the API is on another domain |

## API conventions

Base path: `/api/v1`. Every response uses one envelope:

```jsonc
// success
{ "success": true, "data": { ... }, "message": "optional" }
// failure
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [{ "path": "body.name", "message": "Required" }] } }
```

Error codes live in [`packages/shared/src/schemas/api-response.ts`](packages/shared/src/schemas/api-response.ts). Unexpected errors return a generic `INTERNAL_ERROR` — stack traces and internals are logged server-side only (with an `X-Request-Id` for tracing), never sent to the browser.

State-changing requests (`POST`/`PUT`/`PATCH`/`DELETE`) must include the header `X-CatalogCraft-Request: 1` (CSRF protection — the web app sends it automatically). When MongoDB is unreachable, every endpoint except health returns `503 SERVICE_UNAVAILABLE`.

### Implemented endpoints

| Method | Path | Auth | Description |
| ------ | ---- | ---- | ----------- |
| GET | `/api/v1/health` | – | **Liveness.** Always `200` while the process responds; `data.checks.database` shows the MongoDB state. |
| GET | `/api/v1/health/ready` | – | **Readiness.** `200` when the database is connected, otherwise `503`. Use for load-balancer checks. |
| POST | `/api/v1/auth/register` | – | `{ name, email, password, organizationName }` → creates user + organization + owner membership, signs in. `409` if the email exists. |
| POST | `/api/v1/auth/login` | – | `{ email, password }` → signs in. Generic `401` for any wrong email/password. |
| POST | `/api/v1/auth/logout` | – | Deletes the session server-side and clears the cookie. |
| GET | `/api/v1/me` | signed in | Current user, active organization, role and permissions. |
| GET | `/api/v1/organizations/current` | `organization:read` | The active organization. |
| PATCH | `/api/v1/organizations/current` | `organization:update` | `{ name }` — rename (owner, admin). |
| GET | `/api/v1/organizations/current/members` | `members:read` | Members and their roles. |
| GET | `/api/v1/clients?page=&pageSize=&search=` | `clients:read` | Paginated client list (sorted by name; search matches name or reference literally) plus `allowance: { used, limit }`. |
| POST | `/api/v1/clients` | `clients:manage` | `{ name, internalReference?, brandProfile? }` — missing brand fields get defaults. `409` on a duplicate name (case-insensitive), `403 PLAN_LIMIT_REACHED` over the plan's workspace limit. |
| GET | `/api/v1/clients/:clientId` | `clients:read` | One client. Another organization's id returns `404`, exactly like a missing one. |
| PATCH | `/api/v1/clients/:clientId` | `clients:manage` | Partial update; only the brand fields sent change. `internalReference: null` clears it. |
| DELETE | `/api/v1/clients/:clientId` | `clients:manage` | Permanently deletes the client workspace. Refused (`409`) while the client still has catalogue jobs. |
| GET | `/api/v1/jobs?clientId=&status=&page=` | `jobs:read` | Jobs, newest first. |
| POST | `/api/v1/jobs` | `jobs:edit` | `{ clientId, name? }` → a `draft` job. `403 PLAN_LIMIT_REACHED` over the plan's active-job limit. |
| GET | `/api/v1/jobs/:jobId` | `jobs:read` | Job with file info, mapping, row counts and issue summary. |
| DELETE | `/api/v1/jobs/:jobId` | `jobs:edit` | Deletes the job, its rows and its stored file (not while validating). |
| POST | `/api/v1/jobs/:jobId/upload` | `jobs:edit` | Multipart field `file` (.csv/.xlsx, ≤ `UPLOAD_MAX_MB`). Replaces any previous file and rows. |
| POST | `/api/v1/jobs/:jobId/preview` | `jobs:read` | `{ sheetName?, headerRow? }` → headers, first rows, row count, suggested mapping, notices. Read-only. |
| PUT | `/api/v1/jobs/:jobId/mapping` | `jobs:edit` | `{ sheetName, headerRow, mapping: { sku: 0, title: 2, … } }` (field → column index). Needs a SKU or Product ID. |
| POST | `/api/v1/jobs/:jobId/validate` | `jobs:edit` | Imports and validates every row → status `ready` (or `failed` with `lastError`, e.g. too many rows). |
| GET | `/api/v1/jobs/:jobId/rows?status=&field=&search=&page=` | `jobs:read` | Paginated rows with original values and validation issues. |
| GET | `/api/v1/dashboard/summary` | signed in | Plan, client workspace count vs. limit, 5 most recently updated clients. |

### Plans

Plan prices and limits live only in [`apps/api/src/config/plans.ts`](apps/api/src/config/plans.ts). Today only **client workspaces** are enforced (Trial/Solo: 1, Agency/Studio: unlimited — "multiple client workspaces" is listed as an Agency feature). Product, user and job limits are defined there and will be enforced with usage tracking in a later phase. New organizations start on the free trial.

### Roles

Permissions are defined once in [`packages/shared/src/schemas/roles.ts`](packages/shared/src/schemas/roles.ts); the API enforces them and the web app uses the same table to hide actions a role can't take.

| Role | Can |
| ---- | --- |
| `owner` | everything, including deleting the organization |
| `admin` | manage organization details, members and clients; edit jobs; review suggestions |
| `editor` | create and edit catalogue jobs |
| `reviewer` | review and approve AI suggestions |

### Import workflow

`draft` → **upload** → `uploaded` → **map columns** → **validate** → `ready` (or `failed`). Allowed status changes are defined once in [`packages/shared/src/schemas/catalog.ts`](packages/shared/src/schemas/catalog.ts) (`JOB_TRANSITIONS`) and enforced with atomic database updates, so two simultaneous requests can't both act on a job.

- **Files:** checked by extension *and* content (a renamed file is rejected), stored privately under a server-generated name (`organizations/<org>/uploads/<uuid>.csv`) — the uploaded filename is display-only. CSV delimiter (`,` `;` tab `|`), UTF-8 BOM, UTF-16 and Windows-1252 are handled. XLSX formulas are **never evaluated** (Excel's saved result is used); `.xls`, `.xlsm` and macro workbooks are refused; workbooks that would unpack to an unreasonable size (zip bombs) are refused before parsing.
- **Rows:** each product row is its own MongoDB document. `sourceValues` (every cell, exactly as in the file) and `original` (mapped fields) are **immutable** — later phases store AI suggestions and approved values separately. Blank rows are counted and reported, never silently dropped; row numbers match the spreadsheet.
- **Validation** is plain, deterministic code ([`services/validation`](apps/api/src/services/validation)) — never the LLM. Errors: missing identifier, duplicate SKU / variant ID, unreadable or negative price. Warnings: empty/over-long title (client's limit), ambiguous decimal comma, price with currency symbol, invalid currency code, stock or barcode (GTIN check digit), non-http image URL, broken parent/variant links, exact duplicate rows, suspiciously long values. Info: empty description.
- **Retention:** an uploaded file is kept while its job exists and deleted with the job (or when replaced). Automatic expiry is planned for pilot readiness.

## Key design decisions (and why)

- **Monorepo with a shared schema package.** The API and the web app import the *same* Zod schemas, so the contract between them can't silently drift. The web client validates every response against them.
- **`createApp()` separate from `server.ts`.** Tests run the full Express middleware stack in memory with Supertest — no port, no real database needed for most tests.
- **The API starts even when MongoDB is down,** and keeps retrying every 5 s. The health endpoint reports the problem instead of the process crash-looping. Mongoose command buffering is disabled so queries fail fast instead of hanging.
- **Fail-fast configuration.** Invalid env vars stop startup with a clear message, instead of causing confusing failures later.
- **Vite dev proxy.** In development the browser only talks to `localhost:5173`; `/api` is forwarded to Express. Being same-origin keeps session cookies simple and secure (needed for Milestone 2 auth).
- **Errors are typed.** Throw `new AppError('CONFLICT', 'message')` anywhere in a request; the central error handler formats it. Express 5 forwards async errors automatically.
- **Server-side sessions, not JWTs in localStorage.** The browser only holds a random session id in an `httpOnly`, `SameSite=Lax` cookie (`Secure` and `__Host-` prefixed in production), so JavaScript — and therefore XSS — can't read it. Session data lives in MongoDB, so signing out truly ends the session. The session id is regenerated at sign-in (prevents session fixation) and expires after `SESSION_TTL_HOURS` of inactivity.
- **Passwords** are hashed with Argon2id (OWASP's recommendation). Login returns the same message for "no such email" and "wrong password", and takes the same time for both, so attackers can't discover which emails have accounts. Failed attempts are rate-limited per IP.
- **CSRF:** state-changing requests need a custom header that other websites can't add, and their `Origin` must be the web app.
- **Tenant isolation:** the active organization comes from the server-side session and is re-checked against the Membership collection on *every* request (removing someone takes effect immediately). Organization ids sent by the browser are ignored. Every tenant-owned query must include `tenantScope(auth)` ([`utils/tenant.ts`](apps/api/src/utils/tenant.ts)) — tests verify one agency can't see or change another's data.
- **Registration without transactions:** MongoDB multi-document transactions need a replica set, which a plain local MongoDB isn't. Registration therefore creates user → organization → membership in order and deletes the earlier records if a later step fails.
- **Indexes are built explicitly after connecting** (`ensureIndexes`). Mongoose's automatic index build doesn't work with command buffering disabled, so unique emails and one-membership-per-organization are guaranteed by a startup step that has its own regression test.
- **The web build never reads the root `.env`.** It contains the API's `NODE_ENV=development`, which made Vite produce a *development* React build even for production (fixed in Phase 2 — the bundle shrank by ~30%). The dev proxy reads only `PORT` from it.
- **exceljs with a patched `uuid`:** the `xlsx` package on npm has unfixed security advisories, so XLSX parsing uses `exceljs`, with an npm `overrides` entry forcing its `uuid` dependency to a patched version (`npm audit`: 0 vulnerabilities). Its streaming reader only works when the ZIP stores the workbook index first, which real files don't guarantee, so the regular reader is used behind the zip-bomb guard.
- **Database note:** the specification mentions Supabase once, but every data-model and setup section specifies MongoDB + Mongoose, so MongoDB is used.

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `Invalid environment configuration: MONGODB_URI…` on start | Copy `.env.example` to `.env` in the **repository root** and set `MONGODB_URI`. The error shows how your value begins — look for quotes or a duplicated `MONGODB_URI=`. |
| `SESSION_SECRET is required` / `still contains the placeholder` | Generate one with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` and paste it into `.env`. |
| Signed out unexpectedly after changing `SESSION_SECRET` | Expected: existing session cookies are signed with the old secret. Sign in again. |
| `Request blocked: missing anti-forgery header` when calling the API from curl/Postman | Add the header `X-CatalogCraft-Request: 1` to POST/PATCH/PUT/DELETE requests. |
| Upload rejected: "not a valid Excel workbook" / "Older .xls files" | Open the file in Excel and **Save As** `.xlsx` or CSV (UTF-8). |
| Accented characters look wrong after import | Save the CSV as **CSV UTF-8** in Excel. Files that aren't UTF-8 are read as Windows-1252, and the mapping step shows a notice. |
| Job failed: "more than 2,000 product rows" | Split the file, or raise `IMPORT_MAX_ROWS` for local testing. |
| Barcode warnings on valid-looking numbers | Excel drops leading zeros from numeric cells; format the barcode column as Text before exporting. |
| "Plan limit reached" when creating a job | Trial allows one active job at a time. Delete the old job, or `npm run set-plan -- <email> agency`. |
| "Plan limit reached" when adding a second client | Trial and Solo include one client workspace. For local testing or a pilot customer run `npm run set-plan -- <owner-email> agency`. |
| `Too many attempts` on login | The failed-login limit was hit; wait 15 minutes, or raise `AUTH_RATE_LIMIT_MAX` locally. |
| First `npm test` is slow or times out | It is downloading the MongoDB test binary (~800 MB, once). Re-run after it finishes. |
| System status shows **Database: Disconnected** | MongoDB isn't reachable. Start your local MongoDB, or for Atlas check the connection string, database user password, and *Network Access* IP allow-list. The API reconnects automatically — no restart needed. |
| System status shows **API unavailable** | The API isn't running or crashed — check the `[api]` lines in the `npm run dev` output. |
| `Port 5173 is already in use` / `EADDRINUSE` | Another dev server is still running (e.g. in another terminal). Stop it with Ctrl+C there. On Windows, find it with `Get-NetTCPConnection -LocalPort 5173,4000 -State Listen` and stop that process ID. |
| Data appears in a database called `test` | Your `MONGODB_URI` has no database name. Add it after the host: `…mongodb.net/catalogcraft?retryWrites=true&w=majority`. |
| `npm warn install-scripts … esbuild` during install | npm 11+ blocks install scripts by default. esbuild's script only verifies its binary; the project works without it. |
| Atlas password contains `@`, `:` or `/` | URL-encode it in `MONGODB_URI` (e.g. `@` → `%40`). |

## Deployment (outline)

Full deployment docs come with pilot readiness (Phase 6). The shape will be:

- **Web:** `npm run build`, deploy `apps/web/dist` to Vercel (or similar) with an SPA rewrite to `index.html`. Set `VITE_API_BASE_URL` if the API is on a different domain.
- **API:** any Node host (Render, Railway, Fly.io…). Build with `npm run build`, start with `npm start`. Set `NODE_ENV=production`, `MONGODB_URI`, `SESSION_SECRET` (a new one, not your local value), `WEB_ORIGIN`, `TRUST_PROXY_HOPS=1`. Use `/api/v1/health` as the liveness check. Secure cookies require HTTPS. Simplest setup: serve the web app and API from the same site (e.g. a Vercel rewrite of `/api/*` to the API) so cookies stay first-party.
- **Rate limits** are kept in memory per API instance — fine for one instance; use a shared store (e.g. Redis) before running several.
- **Database:** MongoDB Atlas.

## Roadmap

- [x] **Milestone 1 — Foundation:** monorepo, env config, logging, error handling, MongoDB connection, health checks, shared schemas, web shell, tests
- [x] **Milestone 2 — Auth & tenancy:** register/login/logout, secure sessions, organizations, memberships & roles, organization settings, tenant-isolation tests, seed script
- [x] **Milestone 3 — Client workspaces & dashboard:** client CRUD with brand profiles, plan limits, real dashboard statistics, seed sample client, manual plan script
- [ ] Later: team invitations by email, account & organization deletion policy, audit log
- [x] **Phase 2 — File import:** catalogue jobs with a state machine, CSV/XLSX upload with private storage, worksheet & header-row selection, column mapping with suggestions, preview, deterministic validation, row-level report, job history
- [ ] **Phase 3 — AI enrichment:** provider abstraction, versioned prompts, schema-validated suggestions, usage limits
- [ ] **Phase 4 — Review & export:** review table, approve/edit/reject, audit log, safe CSV export
- [ ] **Phase 5–6 — Agency workflow & pilot readiness**

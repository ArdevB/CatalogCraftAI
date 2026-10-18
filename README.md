# CatalogCraft AI

Multi-tenant SaaS for ecommerce agencies: import messy supplier catalogues (CSV/XLSX), validate them, generate AI suggestions for selected fields, review every change, and export a clean CSV — with product facts and protected fields (SKU, price, stock, barcodes…) never altered by AI.

> **Status: Milestone 1 (Foundation) complete.** The monorepo, API skeleton, web app shell, MongoDB connection, health checks, shared validation and tooling are working. Authentication, client workspaces, import, AI enrichment, review and export are **not implemented yet** — see [Roadmap](#roadmap).

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
      modules/      one folder per feature (health now; auth, clients… later)
      utils/        AppError, response helpers, request validation
      app.ts        builds the Express app (used by tests)
      server.ts     starts HTTP server + MongoDB connection
    tests/
  web/          React single-page app
    src/
      components/ui/  shadcn-style primitives (Button, Card, Badge)
      features/       feature folders (system status now)
      layouts/ pages/ routes/ lib/
    tests/
packages/
  shared/       Zod schemas shared by API and web (response envelope, health, pagination, ids)
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
# edit .env and set MONGODB_URI
npm run dev
```

Then open <http://localhost:5173>. The home page shows live **System status** for the API and database.

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

A database **seed** script will be added once the data models exist (Milestone 2), so it can create real synthetic records rather than placeholders.

## Configuration

All settings come from environment variables, validated at startup by [`apps/api/src/config/env.ts`](apps/api/src/config/env.ts). If something is wrong, the API refuses to start and lists each bad variable. See [`.env.example`](.env.example) for every variable and its meaning.

| Variable | Required | Default | Purpose |
| -------- | -------- | ------- | ------- |
| `MONGODB_URI` | yes | – | MongoDB connection string |
| `NODE_ENV` | no | `development` | `development`, `test` or `production` |
| `PORT` | no | `4000` | API port (the Vite proxy uses it too) |
| `LOG_LEVEL` | no | `info` | pino log level |
| `WEB_ORIGIN` | no | `http://localhost:5173` | Allowed browser origin(s) for CORS, comma-separated |
| `TRUST_PROXY_HOPS` | no | `0` | Reverse proxies in front of the API (usually `1` in hosting) |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | no | `900000` / `300` | Per-IP API rate limit |
| `VITE_API_BASE_URL` | no | `/api/v1` | Web only: absolute API URL when the API is on another domain |

## API conventions

Base path: `/api/v1`. Every response uses one envelope:

```jsonc
// success
{ "success": true, "data": { ... }, "message": "optional" }
// failure
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [{ "path": "body.name", "message": "Required" }] } }
```

Error codes live in [`packages/shared/src/schemas/api-response.ts`](packages/shared/src/schemas/api-response.ts). Unexpected errors return a generic `INTERNAL_ERROR` — stack traces and internals are logged server-side only (with an `X-Request-Id` for tracing), never sent to the browser.

### Implemented endpoints

| Method | Path | Description |
| ------ | ---- | ----------- |
| GET | `/api/v1/health` | **Liveness.** Always `200` while the process responds; `data.status` is `ok` or `degraded` and `data.checks.database` shows the MongoDB state. |
| GET | `/api/v1/health/ready` | **Readiness.** `200` when the database is connected, otherwise `503 SERVICE_UNAVAILABLE`. Use this for load-balancer checks. |

## Key design decisions (and why)

- **Monorepo with a shared schema package.** The API and the web app import the *same* Zod schemas, so the contract between them can't silently drift. The web client validates every response against them.
- **`createApp()` separate from `server.ts`.** Tests run the full Express middleware stack in memory with Supertest — no port, no real database needed for most tests.
- **The API starts even when MongoDB is down,** and keeps retrying every 5 s. The health endpoint reports the problem instead of the process crash-looping. Mongoose command buffering is disabled so queries fail fast instead of hanging.
- **Fail-fast configuration.** Invalid env vars stop startup with a clear message, instead of causing confusing failures later.
- **Vite dev proxy.** In development the browser only talks to `localhost:5173`; `/api` is forwarded to Express. Being same-origin keeps session cookies simple and secure (needed for Milestone 2 auth).
- **Errors are typed.** Throw `new AppError('CONFLICT', 'message')` anywhere in a request; the central error handler formats it. Express 5 forwards async errors automatically.
- **Database note:** the specification mentions Supabase once, but every data-model and setup section specifies MongoDB + Mongoose, so MongoDB is used.

## Troubleshooting

| Symptom | Fix |
| ------- | --- |
| `Invalid environment configuration: MONGODB_URI…` on start | Copy `.env.example` to `.env` in the **repository root** and set `MONGODB_URI`. |
| System status shows **Database: Disconnected** | MongoDB isn't reachable. Start your local MongoDB, or for Atlas check the connection string, database user password, and *Network Access* IP allow-list. The API reconnects automatically — no restart needed. |
| System status shows **API unavailable** | The API isn't running or crashed — check the `[api]` lines in the `npm run dev` output. |
| `Port 5173 is already in use` / `EADDRINUSE` | Another dev server is still running (e.g. in another terminal). Stop it with Ctrl+C there. On Windows, find it with `Get-NetTCPConnection -LocalPort 5173,4000 -State Listen` and stop that process ID. |
| Data appears in a database called `test` | Your `MONGODB_URI` has no database name. Add it after the host: `…mongodb.net/catalogcraft?retryWrites=true&w=majority`. |
| `npm warn install-scripts … esbuild` during install | npm 11+ blocks install scripts by default. esbuild's script only verifies its binary; the project works without it. |
| Atlas password contains `@`, `:` or `/` | URL-encode it in `MONGODB_URI` (e.g. `@` → `%40`). |

## Deployment (outline)

Full deployment docs come with pilot readiness (Phase 6). The shape will be:

- **Web:** `npm run build`, deploy `apps/web/dist` to Vercel (or similar) with an SPA rewrite to `index.html`. Set `VITE_API_BASE_URL` if the API is on a different domain.
- **API:** any Node host (Render, Railway, Fly.io…). Build with `npm run build`, start with `npm start`. Set `NODE_ENV=production`, `MONGODB_URI`, `WEB_ORIGIN`, `TRUST_PROXY_HOPS=1`. Use `/api/v1/health` as the liveness check.
- **Database:** MongoDB Atlas.

## Roadmap

- [x] **Milestone 1 — Foundation:** monorepo, env config, logging, error handling, MongoDB connection, health checks, shared schemas, web shell, tests
- [ ] **Milestone 2 — Auth & tenancy:** register/login/logout, secure sessions, organizations, memberships & roles, tenant-isolation tests, seed script
- [ ] **Milestone 3 — Client workspaces & dashboard**
- [ ] **Phase 2 — File import:** CSV/XLSX upload, column mapping, preview, validation report
- [ ] **Phase 3 — AI enrichment:** provider abstraction, versioned prompts, schema-validated suggestions, usage limits
- [ ] **Phase 4 — Review & export:** review table, approve/edit/reject, audit log, safe CSV export
- [ ] **Phase 5–6 — Agency workflow & pilot readiness**

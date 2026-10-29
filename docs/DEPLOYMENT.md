# Deployment and operations

This guide puts CatalogCraft online for a pilot using services with free tiers, then covers day-to-day operations: backups, restores, password resets, monitoring and retention.

Free tiers change. Check each provider's current limits before relying on them. The notes below were checked in October 2026.

## The setup

One web service runs the API **and** serves the web app on the same address. Cookies stay first-party and there is no CORS to configure.

| Part | Service (free tier) | Why |
| --- | --- | --- |
| App (API + web) | [Render](https://render.com/docs/free) web service | Builds from GitHub, HTTPS included |
| Database | [MongoDB Atlas](https://www.mongodb.com/docs/atlas/reference/free-shared-limitations/) free cluster | Managed MongoDB |
| Files (uploads, exports) | [Cloudflare R2](https://developers.cloudflare.com/r2/pricing/) | S3-compatible, 10 GB free, no download fees |
| Error alerts (optional) | A Slack or Discord incoming webhook | Free |

**Know the free-tier limits:**

- **Render free services sleep after 15 minutes without traffic.** The first visit afterwards takes up to a minute. AI enrichment runs inside the app, so it pauses while the app sleeps and resumes when it wakes.
- **Render's disk is wiped on every restart.** That's why files must go to R2 (`STORAGE_DRIVER=s3`), never `local`.
- Render free instances are small (512 MB memory). Keep `IMPORT_MAX_ROWS` at 2,000 or less.
- **Atlas free clusters have no built-in backups.** Use `npm run backup` (see below).

For real customers, an always-on paid instance on Render (or similar) removes the sleep delay. Nothing else changes.

## 1. Database: MongoDB Atlas

1. Create a free cluster.
2. Under *Database Access*, create a user with a long generated password. Give it read/write access to one database, e.g. `catalogcraft`.
3. Under *Network Access*, allow `0.0.0.0/0`. Render's free tier has no fixed IP address, so the strong password is what protects the database.
4. Copy the connection string and add the database name: `mongodb+srv://<user>:<password>@<cluster>/catalogcraft?retryWrites=true&w=majority`.

## 2. File storage: Cloudflare R2

1. Create a bucket, e.g. `catalogcraft-files`. Leave **public access off**: the app only ever reads files itself.
2. Create an R2 API token with **Object Read & Write** permission for that bucket only.
3. Note the access key id, the secret, and the S3 endpoint (`https://<account-id>.r2.cloudflarestorage.com`).

Backblaze B2 and AWS S3 work the same way. Set `S3_REGION` and `S3_ENDPOINT` for your provider.

## 3. App: Render

Create a **Web Service** from your GitHub repository:

| Setting | Value |
| --- | --- |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `npm start` |
| Health check path | `/api/v1/health` |

`--include=dev` is needed because the build tools are dev dependencies, and `NODE_ENV=production` would otherwise skip them.

Environment variables. Generate fresh secrets; never reuse your local ones.

```
NODE_VERSION=24
NODE_ENV=production
TRUST_PROXY_HOPS=1
WEB_ORIGIN=https://<your-service>.onrender.com
WEB_DIST_DIR=./apps/web/dist
MONGODB_URI=<Atlas connection string>
SESSION_SECRET=<node -e "console.log(require('crypto').randomBytes(48).toString('hex'))">
STORAGE_DRIVER=s3
S3_BUCKET=catalogcraft-files
S3_REGION=auto
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=<R2 access key id>
S3_SECRET_ACCESS_KEY=<R2 secret>
MONGOMS_DISABLE_POSTINSTALL=1
AI_API_KEY=<optional — without it, AI features say they are not configured>
AI_MODEL=claude-opus-5-5
ERROR_ALERT_WEBHOOK_URL=<optional Slack/Discord webhook>
```

`MONGOMS_DISABLE_POSTINSTALL=1` stops the test-only in-memory MongoDB from downloading itself (about 800 MB) during the build.

After the first deploy:

1. Open the site, register your agency, and check that *Dashboard → System status* shows the database as connected.
2. Upload a small file and export it. This proves R2 works: the file survives a restart (*Manual Deploy → Restart*) and can still be downloaded.
3. Change a pilot customer's plan with `npm run set-plan -- <owner-email> agency`, run from your computer with `MONGODB_URI` pointing at Atlas.

### Alternative: web app on Vercel

To host the web app separately:

- Build `apps/web` on Vercel with `VITE_API_BASE_URL=https://<api-host>/api/v1`.
- Set the API's `WEB_ORIGIN` to the Vercel address, and leave `WEB_DIST_DIR` empty.
- Prefer a rewrite of `/api/*` to the API. That keeps cookies first-party, since browsers increasingly block third-party cookies.

## Operations

### Backups (do this weekly, and before every upgrade)

```
npm run backup                      # → backups/<date-time>/
npm run backup -- D:\safe\place     # or a folder of your choice
```

Run it from your computer with `MONGODB_URI` and the storage settings of the environment you're backing up. It writes:

- every collection (except login sessions), as Extended JSON,
- every uploaded and exported file,
- a `manifest.json` with document counts and checksums.

**A backup contains customer data.** Keep it on an encrypted drive or a private bucket, and delete old ones you no longer need.

### Restore, and test that restores work

```
MONGODB_URI=<a NEW, EMPTY database> npm run restore -- backups/<folder>
```

The restore refuses a database that already has data, so it can't overwrite anything. When it finishes, it re-checks every collection against the backup's checksums and rebuilds the indexes.

**Restore drill:** once a month, restore the latest backup into a new empty database (e.g. `catalogcraft-restore-test` on the same cluster). Then point a local copy of the app at it and sign in. A backup you've never restored is only a hope. The automated test `apps/api/tests/backup.test.ts` checks the mechanics on every run.

### Email (optional, free)

With email set up, people confirm their address, reset forgotten passwords themselves, and receive invitations by email. Without it, everything still works: invitation links are copied by hand, and you reset passwords (below).

[Brevo](https://www.brevo.com/)'s free plan allows about 300 emails a day over SMTP, which is plenty for a pilot. Other SMTP providers work the same way.

1. Create a Brevo account and verify a sender address, or better, your own domain (add the DNS records Brevo shows you, so emails aren't marked as spam).
2. Under *SMTP & API*, create an SMTP key.
3. Set these on Render:
   ```
   EMAIL_DRIVER=smtp
   SMTP_HOST=smtp-relay.brevo.com
   SMTP_PORT=587
   SMTP_USER=<your Brevo SMTP login>
   SMTP_PASSWORD=<the SMTP key>
   EMAIL_FROM=CatalogCraft <no-reply@yourdomain.com>
   APP_URL=https://<your-service>.onrender.com
   ```
4. Test it: on the sign-in page, choose *Forgot password?* and use your own address.

If the API log says **`525 5.7.1 Unauthorized IP address`**, Brevo is blocking logins from unknown IP addresses. In Brevo, open your account menu → **Security → Authorised IPs**. Either add the IP shown there, or turn IP blocking off. Hosts like Render have no fixed outgoing IP address, so in production turning it off is the practical choice; your SMTP key still protects the account.

The API refuses to start if `EMAIL_DRIVER=smtp` is missing its host or sender, and it never allows the development `log` driver in production.

### Password resets without email

If email isn't set up (or someone can't receive it), reset the password yourself:

```
npm run reset-password -- user@example.com
```

This prints a random temporary password and signs that user out everywhere. Send the password over a channel you trust, and ask them to change it at *Account → Change password*.

### Monitoring

- **Logs:** Render shows the app's JSON logs. Every unexpected error returns a **reference** (shown in the app as "Reference: …"); search the logs for it to find the exact failure.
- **Alerts:** with `ERROR_ALERT_WEBHOOK_URL` set, unexpected errors post a short message to Slack or Discord. Alerts are throttled to one a minute and contain no request bodies or personal data.
- **Uptime:** a free uptime checker (e.g. UptimeRobot) pinging `/api/v1/health/ready` tells you when the database is unreachable. On Render's free tier, it also keeps the app awake.

### Data retention

| Data | Kept |
| --- | --- |
| Export files | 30 days (`EXPORT_RETENTION_DAYS`), then deleted automatically. The reviewed data stays, so exports can be recreated. |
| Invitations | Removed by MongoDB 30 days after they expire. |
| Email links (confirmation, password reset) | Removed by MongoDB when they expire (48 hours / 60 minutes). |
| Login sessions | End after 72 hours of inactivity (`SESSION_TTL_HOURS`). |
| Clients, jobs, products, suggestions, usage, activity log | Until the job, client or organization is deleted. |
| Organizations | Until the owner deletes them (*Organization settings → Delete organization*). Everything they own is deleted, including files. |
| Accounts | Until the user deletes theirs (*Account → Delete account*). |
| Backups | Your responsibility: delete old ones you don't need. |

### Upgrading

1. Run `npm run backup`.
2. Push to `main`. GitHub Actions runs every check, and Render redeploys automatically.
3. If something is wrong, use *Rollback* in Render to return to the previous deploy. Data changes are additive, so a rollback is safe.

Changing `SESSION_SECRET` signs everyone out. Rotate it if you think it leaked.

### Performance

`npm run perf` runs the whole workflow on a throwaway database with a scripted AI (`--rows 7500` for bigger files). On a laptop, 2,000 products took:

| Step | Time |
| --- | --- |
| Validate | ~0.7 s |
| Review page | ~20 ms |
| Bulk approve (4,000 suggestions) | ~0.13 s |
| Export | ~0.12 s |
| CatalogCraft's own overhead during enrichment | ~4 ms per product |

Real enrichment time is dominated by the AI: roughly products ÷ `AI_CONCURRENCY` × seconds per AI request.

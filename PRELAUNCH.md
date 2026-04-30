# Orca Pre-Launch Checklist

**Priority key:** 🔒 Hard blocker · ⚠️ Should do · 💡 Nice to have

Delete this file from the repo after launch.

---

## ✅ Recently completed

- [x] **Using Orca page redesign** — hero image pair, Tunneling + Superconcepts cells, GitHub URL fixed.
- [x] **README.md added** at repo root.
- [x] **`pg_trgm` migration fix** — `CREATE EXTENSION` and concept-name indexes now in `migrate.js`. Manual deploy step removed; ORCA_STATUS.md Known Issue #5 updated.
- [x] **Verified test data cleanup is a non-issue** — no seed scripts run on deploy.
- [x] **Verified phone storage architecture** — raw phones never stored; `phone_hash` (bcrypt, legacy) + `phone_lookup` (HMAC-SHA256, current).
- [x] **Rate limiting audit complete** — see `RATE_LIMIT_AUDIT.md`. Findings broken into Phases 49a/49b/49c below.
- [x] **Twilio account-level protection** — usage triggers configured ($10 warning, $20 hard-cap warning).
- [x] **Twilio prepaid mode configured** — upgraded from trial to paid, billing type is Pay as you go, auto-recharge disabled, initial balance ~$20.
- [x] **Cloudflare R2 production bucket created** — bucket `orca-documents-prod`, S3 API endpoint noted, Account API token (`orca-backend-prod`) generated with Object Read & Write scoped to this bucket only, Public Development URL enabled. All 5 credentials saved for Railway env vars.
- [x] **Phase 54 — Production deployment readiness** complete. 54a: R2 file storage abstraction (`backend/src/config/storage.js`) with production/dev switch and hard startup error if R2 env vars are missing in production. 54b: Backend serves frontend static files in production; root `package.json` orchestrates build + migrations-on-startup; single Railway service architecture. 54c: License consistency (AGPL-3.0-only in both package.json files), localhost reference audit, cookie/session config audit, trust proxy confirmed.
- [x] **Phase 55a — Database config uses `DATABASE_URL` connection string** with SSL for managed Postgres providers. Falls back to individual `DB_*` vars for local dev. Fixed Railway deploy `ECONNREFUSED 127.0.0.1:5432` bug.
- [x] **Railway project created** — connected to GitHub repo `orca-concepts/orca`, auto-deploys on push to main.
- [x] **Railway Postgres provisioned** — `DATABASE_URL` reference variable wired into orca service. Postgres credentials rotated once after an accidental chat-side leak (rotation completed cleanly because DB was empty at the time).
- [x] **Railway env vars set** — `JWT_SECRET`, `PHONE_LOOKUP_KEY` (both freshly generated for prod, not reused from dev), Twilio creds (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`), ORCID prod creds (`ORCID_CLIENT_ID`, `ORCID_CLIENT_SECRET`, `ORCID_REDIRECT_URI=https://orcaconcepts.org/orcid/callback`), R2 creds (`R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_PUBLIC_URL_PREFIX`), `NODE_ENV=production`, `ENABLED_ATTRIBUTES`, `ENABLED_DOCUMENT_TAGS`, `CORS_ORIGINS=https://<railway-url>,https://orcaconcepts.org`, `ADMIN_USER_ID=1`.
- [x] **First successful production deploy on Railway** — all migrations ran cleanly (Phase 10a through Phase 52a), `pg_trgm` extension created successfully on Railway Postgres, server running on port 8080, database health check passing.
- [x] **Production admin account registered** — username `orca-admin`, user ID `1`. Phone OTP / Twilio verification, password login, and admin-only routes all confirmed working in production.
- [x] **Phase 49 — Rate limiting (foundation + write-endpoint limiters + global safety net)** complete. Trust proxy configured, per-phone SMS limiter + global daily SMS cap on Postgres-backed store, all write-endpoint limiters in place, global 500 req/15min/IP safety net active. Old broken IP-based limiters in `auth.js` ripped out.
- [x] **CONTRIBUTING.md** added.
- [x] **CODE_OF_CONDUCT.md** added (Contributor Covenant v2.1).
- [x] **GitHub issue templates** added (`bug_report.md`, `feature_request.md`).
- [x] **LICENSE file verified** — full AGPL v3 text present at repo root.
- [x] **Gitleaks secrets audit** — 76 commits scanned, no leaks found.
- [x] **Deleted duplicate `backend/seed-test-data.js`** at repo root.
- [x] **Favicon + SEO meta tags** — favicon.svg + PNG fallbacks (16/32/180/192/512), 1200×630 og-image.png, site.webmanifest, all in `frontend/public/`. `<title>`, `<meta description>`, Open Graph, and Twitter Card tags wired into `frontend/index.html`. EB Garamond used for OG image and PNG icons. Verify OG preview post-launch via cards-dev.twitter.com/validator.

---

## 🔒 Deployment & Launch

### Cloudflare R2 (file storage) ✅

- [x] R2 bucket created and credentials saved
- [x] Public Development URL enabled
- [x] Credentials wired into Railway env vars

### Backend production code (Phase 54 + 55a) ✅

- [x] R2 storage abstraction (Phase 54a)
- [x] Backend serves frontend static files in production (Phase 54b)
- [x] Migrations run on startup (Phase 54b)
- [x] License consistency, localhost audit, cookie/session audit, trust proxy verified (Phase 54c)
- [x] Database config uses `DATABASE_URL` with SSL fallback for managed providers (Phase 55a)

### Railway setup ✅

- [x] Railway project created, GitHub repo connected
- [x] Railway Postgres provisioned, `DATABASE_URL` wired in
- [x] Service configured: build via root `package.json`, start runs migrations then server
- [x] On Hobby plan
- [x] All env vars set (see Recently Completed entry above for full list)
- [x] First deploy succeeded; migrations ran cleanly
- [x] `pg_trgm` confirmed working on Railway Postgres
- [ ] **Delete orphan `Postgres-DBUN` tile** — leftover from the credential rotation; safe to remove now that everything is confirmed working

### Production smoke test (on the Railway URL, before DNS)

- [x] Page loads at the Railway-generated URL
- [x] Register account (Twilio SMS + password) — works
- [x] Login (password) — works
- [x] Admin-only routes accessible to ADMIN_USER_ID — works
- [ ] Upload a document, confirm it lands in R2 bucket (check R2 dashboard)
- [ ] Create a concept, add an annotation, vote
- [ ] Test "Log out everywhere"
- [ ] Open the app on a phone — basic mobile sanity check
- [ ] Test legal/compliance flows: `/report-infringement`, `/counter-notice`, `/admin/legal`, data export from profile page
- [ ] **ORCID OAuth NOT testable on Railway URL** — registered redirect URI is `https://orcaconcepts.org/orcid/callback`, so ORCID will only work after DNS

### DNS and SSL

- [ ] Point `orcaconcepts.org` from Cloudflare DNS to Railway
- [ ] Decide on `www` subdomain handling (redirect to apex, or vice versa)
- [ ] Confirm Railway-issued SSL cert provisions on `orcaconcepts.org`
- [ ] Test `https://orcaconcepts.org` loads the live app
- [ ] Add `https://orcaconcepts.org/orcid/callback` to ORCID developer dashboard registered redirect URIs
- [ ] Test ORCID OAuth flow end-to-end on `orcaconcepts.org`
- [ ] Once DNS is fully confirmed working, narrow `CORS_ORIGINS` to just `https://orcaconcepts.org` (drop the Railway URL)

### Repo + announcement

- [ ] Flip GitHub repo from private to public
- [ ] Bluesky launch post (per pre-launch outreach plan)

---

## 🔒 Operational & Infrastructure

- [ ] Database backups configured on Railway
- [ ] Error monitoring set up (Sentry free tier)
- [ ] Uptime monitoring set up (UptimeRobot free tier)

---

## 🔒 Rate Limiting

**Phase 49a + 49b + 49d complete.** Phase 49c (polish) remains and is acceptable post-launch.

### Twilio account-level protection

- [x] **Twilio Usage Trigger: warning at $10/month**
- [x] **Twilio Usage Trigger: hard-cap warning at $20/month**
- [x] **Twilio prepaid mode configured** — upgraded to paid, Pay as you go billing, auto-recharge OFF, balance ~$20. The only true hard stop — triggers are notifications only.
- [ ] Low-balance email alert configured (notify when balance < $5)

### ✅ Phase 49d — Global safety net fixed

**Discovered April 11, 2026** during the favicon work session; fixed same day. The old global 500 req/15min/IP safety net was in-memory and locked legitimate users out of read endpoints during normal browsing. Confirmed by `taskkill /f /im node.exe` clearing the lockout instantly.

**Root causes:**
- React StrictMode in dev double-invokes effects, doubling every API call
- A normal session of opening Orca, navigating a few graphs, and using search easily makes 50–100 API calls
- A university lab behind a NAT'd IP would trip it almost instantly with multiple users

**Fixes applied (see ORCA_STATUS.md Phase 49d for details):**
- [x] Global per-IP limit raised to 2000 req / 15 min
- [x] GET requests exempted entirely from the global limiter — the bucket only meters writes (POST/PUT/PATCH/DELETE)
- [x] Global safety net moved to the Postgres-backed `pgRateLimitStore` with key namespace `global:ip:<ip>`; counters survive restarts and are shared across multi-instance deploys
- [x] Verified end-to-end: 20 GET bursts return 200 with no RateLimit headers; POSTs produce correct `RateLimit-Limit: 2000` / `Remaining` / `Reset` headers; counter row writes to Postgres and increments correctly; injecting `count = 2001` produces 429 with `Retry-After`; per-user write-endpoint limiters (Phase 49b) untouched
- [ ] Frontend: when a 429 is received on a read endpoint, show a clearer message than "no concepts" — now a non-issue for GETs (they can no longer 429 from the global limiter); still relevant for write 429s, tracked under Phase 49c frontend handling

### Phase 49c — Polish (post-launch acceptable)

- [ ] Frontend 429 handling: parse `RateLimit-Reset`, disable button, show countdown (start with `LoginModal.jsx`)
- [ ] Per-account login lockout: 5 failed attempts on same identifier → 15 min lock (mitigates credential stuffing)
- [ ] Move all remaining limiters to persistent Postgres store
- [ ] CAPTCHA decision (hCaptcha free tier in front of `sendCode`)

---

## ⚠️ Security & Abuse Prevention

- [ ] Admin unhide queue tested in production; workflow documented for self
- [ ] Decide on CAPTCHA for registration (now tracked in Phase 49c above)

---

## ⚠️ User-Facing Polish

- [ ] Forgot password flow walked through end-to-end
- [ ] Orphan document cleanup dry run
- [ ] Age verification flow tested with fresh user
- [ ] Copyright confirmation flow tested (checkbox + `copyright_confirmed_at` timestamp)
- [ ] All four attributes render correctly: `[value]`, `[action]`, `[tool]`, `[question]`
- [ ] Email deliverability resolved (SMTP wired up, or document manual-only decision)
- [ ] Browser compatibility spot check (Chrome, Firefox, Safari, mobile Safari, mobile Chrome)
- [x] Favicon + SEO meta tags (`<title>`, `<meta description>`, OG tags for Bluesky link previews)
- [ ] 404 page exists and looks reasonable
- [x] Decide on admin profile presentation — generic admin (`orca-admin`)

---

## ⚠️ Repository & Open Source Housekeeping

- [x] `LICENSE` file with full AGPL v3 text — verified
- [x] `CONTRIBUTING.md`
- [x] `CODE_OF_CONDUCT.md` (Contributor Covenant)
- [x] GitHub issue templates (bug report, feature request)
- [x] Secrets audit on public repo (`gitleaks` once) — clean
- [x] Delete duplicate `backend/seed-test-data.js`

---

## 💡 Financial & Sustainability

- [ ] Open Collective setup (Donate page should point somewhere real)
- [ ] 6-month budget written down

---

## 💡 Post-Launch Monitoring

- [ ] Daily metrics list defined (registrations, concepts, annotations, flags, Twilio spend, Railway CPU)
- [ ] 2am moderation emergency plan written
- [ ] Rollback plan written

---

## Outside review

- [ ] One trusted outside reviewer has spent ~1 hour on the live app

---

**Last updated:** April 29, 2026 (Railway deploy live, all env vars set, admin account `orca-admin` registered with ID 1, Phase 55a database config fix shipped; ready for remaining smoke tests then DNS)

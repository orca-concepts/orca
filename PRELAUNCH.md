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
- [x] **Cloudflare R2 production bucket created** — bucket `orca-documents-prod`, S3 API endpoint noted, Account API token (`orca-backend-prod`) generated with Object Read & Write scoped to this bucket only, Public Development URL enabled. All 5 credentials saved for Railway env vars (bucket name, endpoint URL, access key ID, secret access key, public URL prefix).
- [x] **Phase 54 — Production deployment readiness** complete. 54a: R2 file storage abstraction (`backend/src/config/storage.js`) with production/dev switch and hard startup error if R2 env vars are missing in production. 54b: Backend serves frontend static files in production; root `package.json` orchestrates build + migrations-on-startup; single Railway service architecture. 54c: License consistency (AGPL-3.0-only in both package.json files), localhost reference audit, cookie/session config audit, trust proxy confirmed.
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

This section is the actual sequence to get Orca live on the internet. Items are roughly ordered — earlier ones unblock later ones.

### Cloudflare R2 (file storage)

- [x] Create R2 bucket for production document uploads (`orca-documents-prod`)
- [x] Generate R2 access key + secret (Account API token `orca-backend-prod`, scoped to the bucket only, Object Read & Write)
- [x] Decide on bucket name and region (Automatic location)
- [x] Public Development URL enabled (`pub-<hash>.r2.dev`)
- [x] All 5 R2 credentials saved for Railway env vars

### Backend production code (Phase 54 ✅ complete)

- [x] R2 storage abstraction in production (Phase 54a)
- [x] Backend serves frontend static files in production (Phase 54b)
- [x] Migrations run on startup (Phase 54b)
- [x] License consistency, localhost audit, cookie/session audit, trust proxy verified (Phase 54c)

### Railway setup

- [ ] Create Railway project, connect GitHub repo (`orca-concepts/orca`)
- [ ] Provision Railway Postgres add-on; confirm `DATABASE_URL` is auto-injected
- [ ] Configure service: build command (`npm run build`), start command (`npm start`), root directory (repo root)
- [ ] Confirm Railway is on Hobby plan (~$5/month)

### Environment variables on Railway

- [ ] `DATABASE_URL` (auto-injected by Railway Postgres) — confirm present
- [ ] `JWT_SECRET` — generate fresh secret for production (do NOT reuse local dev value)
- [ ] `PHONE_LOOKUP_KEY` — generate fresh production value (currently placeholder)
- [ ] `ADMIN_USER_ID` — set after creating production admin account
- [ ] `ENABLED_ATTRIBUTES` — confirm matches intended production set
- [ ] `ENABLED_DOCUMENT_TAGS` — confirm matches intended production set
- [ ] Twilio creds: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_VERIFY_SERVICE_SID`
- [ ] ORCID production OAuth creds: `ORCID_CLIENT_ID`, `ORCID_CLIENT_SECRET`, `ORCID_REDIRECT_URI` (production URL — set after DNS is wired up)
- [ ] R2 creds: `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`, `R2_PUBLIC_URL_PREFIX`
- [ ] `NODE_ENV=production`
- [ ] `PRODUCTION_ORIGIN=https://orcaconcepts.org` (CORS allowlist for production)

### First deploy

- [ ] Push to `main` (or whichever branch Railway is watching) and trigger first deploy
- [ ] Watch deploy logs — confirm backend builds, migrations run cleanly
- [ ] **Verify `pg_trgm` extension creates successfully on Railway Postgres** — if it fails, migration halts and the app won't start
- [ ] Confirm frontend build succeeds and serves
- [ ] Hit the Railway-provided URL directly (before DNS) and confirm app loads

### DNS and SSL

- [ ] Point `orcaconcepts.org` from Cloudflare DNS to Railway
- [ ] Decide on `www` subdomain handling (redirect to apex, or vice versa)
- [ ] Confirm Railway-issued SSL cert provisions on `orcaconcepts.org`
- [ ] Test `https://orcaconcepts.org` loads the live app
- [ ] Update `ORCID_REDIRECT_URI` in Railway env vars and ORCID developer dashboard with production callback URL

### Production smoke test

- [ ] Register a real account on the live site (use real phone, real email)
- [ ] Verify Twilio SMS arrives to a real phone
- [ ] Upload a document, confirm it lands in R2 (check R2 dashboard)
- [ ] Create a concept, add an annotation, vote
- [ ] Try ORCID OAuth flow with production credentials end-to-end
- [ ] Log out, log back in (test password login)
- [ ] Test "Log out everywhere"
- [ ] Open the app on a phone — basic mobile sanity check
- [ ] Test legal/compliance flows: `/report-infringement`, `/counter-notice`, `/admin/legal`, data export from profile page

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
- [ ] Decide on admin profile presentation (personal account vs generic "Orca Admin")

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

**Last updated:** April 28, 2026 (Phase 54 production deployment readiness complete; R2 storage abstraction, single-service architecture, migrations-on-startup all shipped; ready for Railway setup)

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
- [x] **DMCA agent registered** with US Copyright Office. Renewal in 3 years.
- [x] **Cloudflare R2 production bucket created** (kept in place even though current architecture doesn't store original files — text-only documents store extracted text in `documents.body`. Bucket and credentials are dormant infrastructure for if/when image or original-file support is added later. No env vars are read for it currently.)
- [x] **Phase 54 — Production deployment readiness** complete. 54a was correctly SKIPPED (no file storage to migrate). 54b: Backend serves frontend static files in production; root `package.json` orchestrates build + migrations-on-startup; single Railway service architecture. 54c: License consistency (AGPL-3.0-only), localhost reference audit, cookie/session config audit, trust proxy confirmed.
- [x] **Phase 55a — Database config uses `DATABASE_URL` connection string** with SSL for managed Postgres providers. Falls back to individual `DB_*` vars for local dev. Fixed Railway deploy `ECONNREFUSED 127.0.0.1:5432` bug.
- [x] **Phase 55b — Seed `question` attribute** in `migrate.js` so fresh production databases include all four attributes (`action`, `tool`, `value`, `question`). Idempotent on existing databases via `ON CONFLICT DO NOTHING`.
- [x] **Phase 55d — ORCID callback back-button fix** — `OrcidCallback.jsx` now uses replace navigation so the consumed-code URL doesn't remain in browser history. Hitting Back after ORCID connect returns the user to wherever they were before, not into a callback loop.
- [x] **Railway project created** — connected to GitHub repo `orca-concepts/orca`, auto-deploys on push to main. Hobby plan ($5/month + usage). Spending limit set.
- [x] **Railway Postgres provisioned** — `DATABASE_URL` reference variable wired into orca service. Postgres credentials rotated once after an accidental chat-side leak (rotation completed cleanly because DB was empty at the time).
- [x] **Railway env vars set** — `JWT_SECRET`, `PHONE_LOOKUP_KEY` (both freshly generated for prod), Twilio creds, ORCID prod creds (`ORCID_REDIRECT_URI=https://orcaconcepts.org/orcid/callback`), R2 creds (dormant), `NODE_ENV=production`, `ENABLED_ATTRIBUTES`, `ENABLED_DOCUMENT_TAGS`, `CORS_ORIGINS=https://orcaconcepts.org`, `ADMIN_USER_ID=1`.
- [x] **First successful production deploy on Railway** — all migrations ran cleanly, `pg_trgm` extension created on Railway Postgres, server running on port 8080, database health check passing.
- [x] **Production admin account registered** — username `orca-admin`, user ID `1`. Phone OTP / Twilio verification, password login, and admin-only routes all confirmed working in production.
- [x] **DNS cutover complete** — `orcaconcepts.org` points to Railway via Cloudflare CNAME (DNS-only, not proxied, so Railway SSL works correctly). `https://orcaconcepts.org` loads the live app. SSL cert provisioned by Railway.
- [x] **www → apex redirect** — Cloudflare Redirect Rule + proxied CNAME record for `www.orcaconcepts.org` → `https://orcaconcepts.org`.
- [x] **CORS narrowed to production domain only** post-DNS.
- [x] **Auto-generated Railway domain removed** from the orca service.
- [x] **ORCID production redirect URI registered** with the ORCID developer dashboard. End-to-end OAuth flow tested working on `orcaconcepts.org`.
- [x] **GitHub repo flipped to public** — sanity checks passed (logged-out repo loads, README renders, AGPL v3 LICENSE detected).
- [x] **Phase 49 — Rate limiting (foundation + write-endpoint limiters + global safety net)** complete.
- [x] **CONTRIBUTING.md** added.
- [x] **CODE_OF_CONDUCT.md** added (Contributor Covenant v2.1).
- [x] **GitHub issue templates** added.
- [x] **LICENSE file verified** — full AGPL v3 text present at repo root.
- [x] **Gitleaks secrets audit** — clean.
- [x] **Deleted duplicate `backend/seed-test-data.js`**.
- [x] **Favicon + SEO meta tags** — complete.

---

## 🔒 Deployment & Launch — almost complete ✅

- [x] R2 (kept dormant)
- [x] Phase 54 production code shipped
- [x] Phase 55a/b/d follow-up fixes shipped
- [x] Railway project, Postgres, env vars, first deploy, admin account
- [x] DNS cutover to `orcaconcepts.org`
- [x] www redirect, CORS narrowed, Railway-only domain removed
- [x] ORCID production OAuth registered + tested
- [x] DMCA agent registered
- [x] Repo public on GitHub
- [ ] **Delete orphan `Postgres-DBUN` tile** in Railway — leftover from credential rotation
- [ ] Smoke test: legal/compliance flows on production (`/report-infringement`, `/counter-notice`, `/admin/legal`, data export from profile page)
- [ ] Smoke test: mobile sanity check on a phone
- [ ] Test "Log out everywhere"
- [ ] Bluesky launch post

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
- [x] **Twilio prepaid mode configured** — auto-recharge OFF, balance ~$20.
- [ ] Low-balance email alert configured (notify when balance < $5)

### Phase 49c — Polish (post-launch acceptable)

- [ ] Frontend 429 handling: parse `RateLimit-Reset`, disable button, show countdown
- [ ] Per-account login lockout: 5 failed attempts on same identifier → 15 min lock
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
- [x] All four attributes render correctly: `[value]`, `[action]`, `[tool]`, `[question]` — confirmed working post-Phase 55b
- [ ] Email deliverability resolved (SMTP wired up, or document manual-only decision)
- [ ] Browser compatibility spot check (Chrome, Firefox, Safari, mobile Safari, mobile Chrome)
- [x] Favicon + SEO meta tags
- [ ] 404 page exists and looks reasonable
- [x] Decide on admin profile presentation — `orca-admin` (username = display name in Orca; no separate display name field)

---

## ⚠️ Repository & Open Source Housekeeping

- [x] `LICENSE`
- [x] `CONTRIBUTING.md`
- [x] `CODE_OF_CONDUCT.md`
- [x] GitHub issue templates
- [x] Secrets audit
- [x] Delete duplicate `backend/seed-test-data.js`

---

## 💡 Financial & Sustainability

- [ ] Open Collective setup (Donate page should point somewhere real)
- [ ] 6-month budget written down (recurring costs: Railway ~$5-10/month, Twilio ~$5-20/month, total ~$10-30/month at small scale)

---

## 💡 Post-Launch Monitoring

- [ ] Daily metrics list defined (registrations, concepts, annotations, flags, Twilio spend, Railway CPU)
- [ ] 2am moderation emergency plan written
- [ ] Rollback plan written

---

## 💡 Future architecture consideration

- [ ] **Rich text + image support in document viewer** — current architecture stores text-only in `documents.body`. Adding images and rich formatting is a meaningful architectural change (storage model, upload pipeline, viewer, annotation anchoring, search). Discussed during launch session; deferred to post-launch. Estimated 8-15 sub-phases for full support, 4-5 for "preserve formatting + tables, no images yet" intermediate scope.

---

## Outside review

- [ ] One trusted outside reviewer has spent ~1 hour on the live app

---

**Last updated:** April 29, 2026 (DMCA registered; repo flipped public; deployment + launch infrastructure essentially complete; remaining items are post-launch hardening and the Bluesky announcement)

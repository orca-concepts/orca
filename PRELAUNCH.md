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
- [x] **Twilio account-level protection** — usage triggers configured ($10 warning, $20 hard-cap warning). Prepaid mode setup deferred.
- [x] **Phase 49 — Rate limiting (foundation + write-endpoint limiters + global safety net)** complete. Trust proxy configured, per-phone SMS limiter + global daily SMS cap on Postgres-backed store, all write-endpoint limiters in place, global 500 req/15min/IP safety net active. Old broken IP-based limiters in `auth.js` ripped out.
- [x] **CONTRIBUTING.md** added.
- [x] **CODE_OF_CONDUCT.md** added (Contributor Covenant v2.1; contact email needs update once domain email is live).
- [x] **GitHub issue templates** added (`bug_report.md`, `feature_request.md`).
- [x] **LICENSE file verified** — full AGPL v3 text present at repo root.
- [x] **Gitleaks secrets audit** — 76 commits scanned, no leaks found.
- [x] **Deleted duplicate `backend/seed-test-data.js`** at repo root.
- [x] **Favicon + SEO meta tags** — favicon.svg + PNG fallbacks (16/32/180/192/512), 1200×630 og-image.png, site.webmanifest, all in `frontend/public/`. `<title>`, `<meta description>`, Open Graph, and Twitter Card tags wired into `frontend/index.html`. EB Garamond used for OG image and PNG icons. Verify OG preview post-launch via cards-dev.twitter.com/validator.

---

## 🔒 Legal & Entity (blocked on Murphy Desmond)

- [ ] LLC formation complete
- [ ] Terms of Service finalized and published
- [ ] Privacy Policy finalized and published (must cover email, phone hashing, ORCID, Twilio, document text, annotation permanence, cookies)
- [ ] DMCA agent registered with US Copyright Office (~$6)
- [ ] Update Constitution page to match Privacy Policy language (wait for Lane's draft)
- [ ] Verify copyright confirmation checkbox at upload still in place
- [ ] Verify age verification (18+) checkbox at registration still in place
- [ ] Repeat infringer policy documented in ToS
- [ ] Takedown / counter-notice process documented user-facing

---

## 🔒 Operational & Infrastructure

- [ ] **Audit Railway env vars** — `PHONE_LOOKUP_KEY` (currently placeholder), `ADMIN_USER_ID`, `ENABLED_ATTRIBUTES`, `ENABLED_DOCUMENT_TAGS`, Twilio creds, ORCID prod creds, `DATABASE_URL`, R2 creds, JWT secret
- [ ] **Verify `pg_trgm` works on Railway Postgres** on first deploy — if extension creation fails, migration halts and app won't start
- [ ] Database backups configured on Railway
- [ ] Error monitoring set up (Sentry free tier)
- [ ] Uptime monitoring set up (UptimeRobot free tier)
- [ ] SSL cert verified on orcaconcepts.org
- [ ] Domain email working (for DMCA / ToS contact) — also update CODE_OF_CONDUCT.md contact email once live
- [ ] **Investigate EB Garamond rendering** — coding convention says EB Garamond on all interactive elements, but live app is currently rendering in default sans-serif. Discovered April 11 during favicon work. Likely a missing `<link>` to Google Fonts in `index.html` or a broken local font import. Not a launch blocker but inconsistent with stated brand.

---

## 🔒 Rate Limiting

**Phase 49a + 49b complete.** Phase 49d added April 11 as a hard blocker; Phase 49c (polish) remains and is acceptable post-launch.

### Twilio account-level protection

- [x] **Twilio Usage Trigger: warning at $10/month**
- [x] **Twilio Usage Trigger: hard-cap warning at $20/month**
- [ ] **Twilio auto-recharge OFF** + balance kept low (~$25). The only true hard stop — triggers are notifications only.
- [ ] Document in ORCA_STATUS.md that Twilio is in prepaid mode with auto-recharge off

### 🔒 Phase 49d — Global safety net is too aggressive (LAUNCH BLOCKER)

**Discovered April 11, 2026** during the favicon work session. The global 500 req/15min/IP safety net locks legitimate users out of read endpoints during normal browsing. Confirmed the limiter is currently **in-memory**, not on the Postgres store, because `taskkill /f /im node.exe` cleared the lockout instantly.

**Why it triggers on normal usage:**
- React StrictMode in dev double-invokes effects, doubling every API call
- A normal session of opening Orca, navigating a few graphs, and using search easily makes 50–100 API calls
- A university lab behind a NAT'd IP would trip it almost instantly with multiple users
- Self-inflicted lockout during dev/debug is trivially easy

**Required fixes:**
- [ ] Raise the global per-IP limit substantially (proposed: 2000/15min, or 10,000/hour with a wider window)
- [ ] Exempt GET requests to read-only concept/annotation endpoints from the global limiter, OR give them their own much higher bucket separate from write endpoints
- [ ] Move the global safety net to the Postgres-backed store so a backend restart doesn't silently reset abuse counters in production
- [ ] Test by hard-refreshing the dev app repeatedly with StrictMode on and confirming you don't lock yourself out
- [ ] Frontend: when a 429 is received on a read endpoint, show a clearer message than "no concepts" (this overlaps with Phase 49c frontend handling)

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
- [ ] **Flip repo from private back to public** (do once Murphy Desmond gives legal greenlight; repo currently private pending ToS/Privacy Policy)

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

## Recommended next-session order (no spending required)

1. **Phase 49d — global rate limiter fix** (now a hard blocker; small code change but critical)
2. **Manual testing batch** — forgot password, orphan cleanup, age verification, copyright, attributes (after lawyers; structured test script)
3. **404 page**
4. **EB Garamond investigation** — find why the brand font isn't rendering live
5. **Twilio prepaid mode** (auto-recharge off + low balance) — outside code, ~5 min in Twilio console
6. **Planning docs** (metrics, 2am plan, rollback) — anytime you have 15 minutes
7. **Phase 49c — rate limiting polish** (post-launch OK)

---

**Last updated:** April 11, 2026 (favicon + SEO complete; Phase 49d added as launch blocker after self-inflicted rate limit lockout exposed it; EB Garamond rendering issue noted)

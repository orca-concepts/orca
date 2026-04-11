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
- [x] **Rate limiting audit complete** — see `RATE_LIMIT_AUDIT.md`. Findings broken into Phases 44a/44b/44c below.

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
- [ ] Domain email working (for DMCA / ToS contact)

---

## 🔒 Rate Limiting (from RATE_LIMIT_AUDIT.md)

**Critical context:** The existing IP-based limiters in `auth.js` are effectively broken because `trust proxy` is not configured — behind Railway's edge, all requests appear to come from the same handful of IPs. Every other endpoint in the app has zero rate limiting. Full findings in `RATE_LIMIT_AUDIT.md`.

### Twilio account-level protection (do FIRST, outside code)

- [ ] **Twilio Usage Trigger: warning at $10/month** (`Orca SMS warning - $10`, recurring monthly)
- [ ] **Twilio Usage Trigger: hard-cap warning at $20/month** (`Orca SMS hard cap - $20`, recurring monthly)
- [ ] **Twilio auto-recharge OFF** + balance kept low (~$25). This is the only true hard stop — triggers are notifications only, not enforcement.
- [ ] Document in ORCA_STATUS.md that Twilio is in prepaid mode with auto-recharge off

### Phase 44a — Foundation (must-fix before launch)

- [ ] Configure `app.set('trust proxy', 1)` in `server.js` (validate against Railway docs; may need `2` if Cloudflare is in front)
- [ ] Add per-phone-number limiter to `sendCode` keyed on `phone_lookup` HMAC: 2 SMS/hour, 5 SMS/24hr per phone
- [ ] Add global daily SMS cap: 200 SMS/24hr total across both send-code endpoints; return 503 + loud log on breach
- [ ] Move `sendCode` limiter to Postgres-backed store (counters survive deploys)

### Phase 44b — Write-endpoint limiters (should-fix before launch)

- [ ] Per-user limiter on `/api/moderation/flag` (20/hr per user)
- [ ] Per-user limiter on `/api/corpuses/annotations/create` (60/hr per user)
- [ ] Per-user limiter on `/api/corpuses/:id/documents/upload` (10/hr per user)
- [ ] Per-user limiter on `/api/corpuses/versions/create` (10/hr per user)
- [ ] Per-user limiter on `/api/pages/:slug/comments` (10/hr per user)
- [ ] Per-user limiter on `/api/messages/threads` (20/hr per user starts, 120/hr per user replies)
- [ ] Per-user limiter on `/api/votes/web-links/add` (30/hr per user)
- [ ] Per-user limiter on `/api/concepts/root` (10/hr per user) and `/api/concepts/child` (100/hr per user)
- [ ] Global app-wide safety net: 500 req / 15 min / IP in `server.js`

### Phase 44c — Polish (post-launch acceptable)

- [ ] Frontend 429 handling: parse `RateLimit-Reset`, disable button, show countdown (start with `LoginModal.jsx`)
- [ ] Per-account login lockout: 5 failed attempts on same identifier → 15 min lock (mitigates credential stuffing)
- [ ] Move all remaining limiters to persistent Postgres store
- [ ] CAPTCHA decision (hCaptcha free tier in front of `sendCode`)

---

## ⚠️ Security & Abuse Prevention

- [ ] Admin unhide queue tested in production; workflow documented for self
- [ ] Decide on CAPTCHA for registration (now tracked in Phase 44c above)

---

## ⚠️ User-Facing Polish

- [ ] Forgot password flow walked through end-to-end
- [ ] Orphan document cleanup dry run
- [ ] Age verification flow tested with fresh user
- [ ] Copyright confirmation flow tested (checkbox + `copyright_confirmed_at` timestamp)
- [ ] All four attributes render correctly: `[value]`, `[action]`, `[tool]`, `[question]`
- [ ] Email deliverability resolved (SMTP wired up, or document manual-only decision)
- [ ] Browser compatibility spot check (Chrome, Firefox, Safari, mobile Safari, mobile Chrome)
- [ ] Favicon + SEO meta tags (`<title>`, `<meta description>`, OG tags for Bluesky link previews)
- [ ] 404 page exists and looks reasonable
- [ ] Decide on admin profile presentation (personal account vs generic "Orca Admin")

---

## ⚠️ Repository & Open Source Housekeeping

- [ ] `LICENSE` file with full AGPL v3 text — verify GitHub auto-generated it
- [ ] `CONTRIBUTING.md` (one paragraph: open issue before PR). README already links it as forward reference.
- [ ] `CODE_OF_CONDUCT.md` (Contributor Covenant via GitHub one-click template)
- [ ] GitHub issue templates (bug report, feature request)
- [ ] Secrets audit on public repo (`gitleaks` once)
- [ ] Delete duplicate `backend/seed-test-data.js` (root copy of `backend/src/config/` version)

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

1. **Twilio account-level protection** (triggers + prepaid mode) — do this TODAY, outside code
2. **Phase 44a — rate limiting foundation** (trust proxy, per-phone limiter, daily cap, persistent store) — fresh Claude Code session
3. **Phase 44b — write-endpoint limiters + global safety net**
4. **CONTRIBUTING.md + CODE_OF_CONDUCT.md + issue templates** — batch in one session
5. **Manual testing batch** — forgot password, orphan cleanup, age verification, copyright, attributes
6. **Favicon + SEO meta tags**
7. **404 page**
8. **Delete duplicate `seed-test-data.js`** (30 seconds)
9. **Planning docs** (metrics, 2am plan, rollback) — anytime you have 15 minutes
10. **Verify `LICENSE` file** on GitHub (30 seconds)
11. **Phase 44c — rate limiting polish** (post-launch OK)

---

**Last updated:** April 11, 2026 (rate limit audit findings added)

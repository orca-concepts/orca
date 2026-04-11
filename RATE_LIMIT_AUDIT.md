# Orca Rate Limiting Audit

**Date:** 2026-04-11
**Scope:** Pre-launch investigation of rate limiting coverage across the Orca backend. Read-only — no code changes.
**Primary concern:** Twilio SMS cost abuse via the `sendCode` endpoint.

---

## Summary

The entire rate limiting surface of the Orca backend lives in one file: `backend/src/routes/auth.js`. Three limiters are defined there, applied only to the five auth endpoints (login, send-code registration, verify-register, forgot-password send-code, forgot-password reset). **Every other endpoint in the application has no rate limiting of any kind** — no global limiter, no per-route limiter, no custom throttle middleware, no database-level quota.

The limiters that do exist are keyed by IP only (no phone-number keying, no user ID keying, no daily cap), and they use the default in-memory store, which means:

1. Counters reset on every Railway deploy and restart.
2. If Railway ever scales to more than one instance, the counters do not coordinate — the effective limit becomes `max × instance_count`.
3. The application does not call `app.set('trust proxy', ...)` in `server.js`. Behind Railway's edge proxy this means `req.ip` resolves to the proxy's address, not the client's. In production every request will appear to come from the same handful of IPs, which breaks IP-keyed limiting in both directions (legitimate users collide; an attacker blends in). `express-rate-limit` v8 also validates trust-proxy configuration at startup and will log a warning or error when it detects `X-Forwarded-For` headers without a configured trust-proxy.

The single biggest risk is the `sendCode` endpoint, which triggers a Twilio Verify API call on every successful request. A determined attacker with a rotating pool of residential IPs can bypass the IP-only 5-per-15-minute limit trivially and cause unbounded Twilio spend.

---

## Library in use

| Field | Value |
|---|---|
| Library | `express-rate-limit` |
| Version | `^8.3.1` (from `backend/package.json`) |
| Store | Default — in-memory (`MemoryStore`), per-process |
| Key | Default — IP address, via `req.ip` |
| Trust proxy | **Not configured** in `server.js` |
| Custom middleware / throttles | **None** — only file: `backend/src/middleware/auth.js`, which handles JWT auth, not rate limiting |

Files importing `express-rate-limit`: exactly one — `backend/src/routes/auth.js`.

---

## Endpoint coverage table

| Endpoint | File:Line | Current Limit | Key | Risk | Notes |
|---|---|---|---|---|---|
| `POST /api/auth/send-code` (registration OTP) | `routes/auth.js:7-13, 35` | 5 req / 15 min | IP | **High** | Triggers Twilio SMS. Same limiter instance also shared with forgot-password send-code (see next row). No per-phone limit, no daily cap. |
| `POST /api/auth/forgot-password/send-code` | `routes/auth.js:7-13, 39` | 5 req / 15 min | IP | **High** | Uses the same `sendCodeLimiter` instance as the register send-code route. Since both routes share the same limiter variable, the counter is shared per IP — 5 SMS per IP per 15 min across both endpoints combined. Still IP-only. |
| `POST /api/auth/login` (password login) | `routes/auth.js:15-21, 32` | 10 req / 15 min | IP | Medium | No account-lockout or per-identifier limit. An attacker can attempt 10 passwords per IP per 15 min against every account in the database. |
| `POST /api/auth/verify-register` (OTP check during registration) | `routes/auth.js:23-29, 36` | 10 req / 15 min | IP | Low | Twilio Verify's own server-side bucket rate-limits verification checks to a small number per-code, so this is double-covered. |
| `POST /api/auth/forgot-password/reset` | `routes/auth.js:23-29, 40` | 10 req / 15 min | IP | Low | Same `verifyCodeLimiter` instance as verify-register. Twilio Verify's own limits apply. |
| `POST /api/concepts/root` (create root concept) | `routes/concepts.js:44` | **None** | n/a | Medium | Writes to DB. Authenticated. No limit means a logged-in attacker can spam concepts faster than the community can flag them. |
| `POST /api/concepts/child` (create child concept) | `routes/concepts.js:47` | **None** | n/a | Medium | Same as above. |
| `POST /api/corpuses/create` | `routes/corpuses.js` | **None** | n/a | Medium | Writes a corpus row. No cap. |
| `POST /api/corpuses/:id/documents/upload` (file upload) | `routes/corpuses.js` | **None** (10 MB multer size cap only) | n/a | Medium | Large file upload, R2 storage cost, PDF/DOCX text extraction CPU. No request-count limit. |
| `POST /api/corpuses/versions/create` (document version upload) | `routes/corpuses.js` | **None** (10 MB multer size cap only) | n/a | Medium | Same as upload. |
| `POST /api/corpuses/annotations/create` | `routes/corpuses.js` | **None** | n/a | Medium | Annotations are permanent and can't be deleted (410 Gone on the delete endpoint). Spam annotations are permanent graffiti. |
| `POST /api/votes/add`, `/remove`, `/swap/add`, `/link/add`, etc. | `routes/votes.js` | **None** | n/a | Low–Medium | Fast DB writes, no external cost. Distortion of vote counts is the main risk. |
| `POST /api/moderation/flag` | `routes/moderation.js` | **None** | n/a | Medium | Abuse vector for mass-flagging (10 flags hides an edge — a coordinated group can weaponize this). |
| `POST /api/moderation/comment` | `routes/moderation.js` | **None** | n/a | Low | Max 2000 chars but otherwise uncapped. |
| `POST /api/moderation/vote` (hide/show) | `routes/moderation.js` | **None** | n/a | Low | |
| `POST /api/corpuses/annotations/vote`, `/unvote` | `routes/corpuses.js` | **None** | n/a | Low | |
| `POST /api/combos/create` | `routes/combos.js` | **None** | n/a | Low | Combos are permanent (append-only). |
| `POST /api/combos/:id/edges/add` | `routes/combos.js` | **None** | n/a | Low | |
| `POST /api/tunnels/create` | `routes/tunnels.js` | **None** | n/a | Low | Tunnel links are permanent. |
| `POST /api/pages/:slug/comments` (info-page comments) | `routes/pages.js` | **None** | n/a | Medium | Public-facing comment stream on Using Orca / Constitution / Donate pages. Prime spam target. |
| `POST /api/messages/threads`, `/messages/threads/:id/reply` | `routes/messages.js` | **None** | n/a | Medium | Direct messages to document authors. Unsolicited-message abuse vector. |
| `POST /api/votes/web-links/add` | `routes/votes.js` | **None** | n/a | Medium | Adds arbitrary URLs to edges. Attractive to link spammers. |
| `GET /api/users/search` | `routes/users.js` | **None** | n/a | Low | Authenticated-only, but an attacker with an account can enumerate usernames and ORCID prefixes. |
| `GET /*` (read endpoints) | — | **None** | n/a | Low | Guest-accessible read endpoints have no limit. Scraping risk only. |
| **App-wide limiter** | `server.js` | **None** | — | — | No global limiter. |

---

## Deep dive: `sendCode`

The `sendCodeLimiter` is the single most important limiter in the app because every successful call translates directly into a Twilio SMS charge.

**Current configuration (`backend/src/routes/auth.js:7-13`):**

```js
const sendCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many code requests. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});
```

**Applied to both:**
- `POST /api/auth/send-code` (registration)
- `POST /api/auth/forgot-password/send-code`

**What's present:**
- Per-IP limit: 5 SMS per 15 minutes per IP, shared across both endpoints (because both routes use the same `sendCodeLimiter` instance, and express-rate-limit keys counters per-limiter-instance).
- Standard `RateLimit-*` response headers.
- JSON error body that the frontend surfaces.

**What's missing:**
1. **No per-phone-number limit.** An attacker with a rotating IP pool (trivial — residential proxies cost pennies) can request unlimited SMS to a single victim phone number. This is the canonical SMS-pumping attack. *Note:* Twilio Verify's own service-side rate limit buckets (configurable in the Twilio console, not in the Orca code) may apply — but they are the *last* line of defense, not the first, and they're configured outside this codebase. Orca should not rely on them alone.
2. **No daily cap, total or per-phone.** Even if the 15-minute bucket holds, an attacker who paces requests can send 5 × 96 = 480 SMS/day per IP per victim number.
3. **No per-account-creation limit.** Nothing caps how many different phone numbers a single IP can register against, which creates a second SMS-pumping path.
4. **IP key is broken behind Railway's proxy** until `trust proxy` is configured — see separate section below.
5. **In-memory store resets on deploy.** A Railway redeploy flushes the counter; an attacker who burned through 5 requests just waits for the next deploy (or triggers one, e.g., by poking something on the frontend that causes the dev team to push a fix) and gets 5 more.

Twilio Verify spend cap: the Twilio console allows configuring a hard spending cap per project, which is the correct last-resort protection. `PRELAUNCH.md` lists this as a pre-launch item but I did not verify whether it's actually set.

---

## Frontend 429 handling

Checked `frontend/src/components/LoginModal.jsx` and found:

```js
} catch (err) {
  setError(err.response?.data?.error || 'Failed to send code');
}
```

The frontend does **not** explicitly check for status 429. It surfaces `err.response.data.error` as a generic error message. Because `express-rate-limit` returns the configured `message` object (`{ error: 'Too many code requests...' }`) with status 429, the user does see the "Too many code requests" text on screen — but:

- No countdown or "try again in X minutes" timer.
- No parsing of the `Retry-After` or `RateLimit-Reset` headers.
- No disabling of the button for the duration of the cooldown — the user can keep clicking and keep getting the same error.
- No distinction between 429 and any other error — a 500 shows the same kind of inline message.

A grep for `429`, `TOO_MANY_REQUESTS`, and `Retry-After` across `frontend/src/` returned zero matches, confirming there is no deliberate 429 handling anywhere in the frontend.

**Status:** the rate-limit error message is displayed, but the UX is minimal. Acceptable for launch; worth improving post-launch.

---

## Persistent store — in-memory vs Redis/Postgres

All three limiters use `express-rate-limit`'s default store (no `store:` option specified). The default store is `MemoryStore`, which is:

- **Per-process** — resets on restart or deploy
- **Not shared** across multiple instances — if Railway ever runs more than one container, each container has its own counter
- **Not inspectable** — you can't see current counters from outside the Node process

`backend/package.json` does **not** include `redis`, `ioredis`, `rate-limit-redis`, `rate-limit-postgres`, or any other store adapter. There is no Redis connection anywhere in the codebase.

**Railway impact:** Railway's Hobby plan runs one instance of the app, so multi-instance coordination is not a launch-day problem. Counter reset on deploy is still a real issue — it's trivially abuseable, and `PRELAUNCH.md` mentions error monitoring setup, which may cause frequent post-launch deploys while bugs are ironed out. Every deploy hands attackers a fresh bucket.

Postgres is already present and could back a shared-store rate limiter via `rate-limit-postgres` with minimal operational cost.

---

## Trust proxy configuration — CRITICAL

**Finding:** `backend/src/server.js` does **not** call `app.set('trust proxy', ...)`. Grep for `trust.*proxy` and `trustProxy` across `server.js` and `routes/auth.js` returned zero matches.

**Why this matters:** When Orca is deployed behind Railway's edge (or Cloudflare), every incoming request has an `X-Forwarded-For` header with the real client IP, and the TCP-level source is Railway's proxy. Without `trust proxy` set, Express's `req.ip` resolves to the proxy's IP, not the client's. That means:

1. **All users share a rate-limit bucket** — every legitimate user behind the proxy looks like the same IP to the limiter, and 5 sign-ups from 5 different users in 15 minutes will hit the limit and lock out everyone else.
2. **Attackers are effectively un-keyed** — there's no distinguishing characteristic separating attacker traffic from legitimate traffic, so the limiter acts globally instead of per-client.
3. **`express-rate-limit` v8 startup validation** — v8 added a validation check that logs a loud warning (or in some configurations throws) when it detects forwarded headers without an explicit trust-proxy configuration. This will surface in Railway's logs immediately on first deploy.

**This is the highest-severity finding in this audit.** Fixing rate limits is meaningless until trust proxy is configured — the current limiters do not work correctly in production even for the endpoints they cover.

---

## Critical gaps

Ordered by severity.

1. **Trust proxy is not configured.** Every rate limiter in the app is effectively broken in production. Must be fixed before launch regardless of everything else below. `app.set('trust proxy', 1)` (or more specific) in `server.js`.

2. **`sendCode` has no per-phone-number limit.** This is the SMS-pumping attack vector. An attacker with a rotating IP pool can cause unbounded Twilio spend against one or many victim phone numbers. Needs an application-level per-phone-hash limiter using the existing `phone_lookup` HMAC value, plus a daily cap per phone.

3. **`sendCode` has no total daily cap.** Even with per-IP and per-phone limits, there should be a global ceiling on total SMS per 24 hours so a worst-case breach is still bounded in dollar terms.

4. **Twilio spending cap not verified.** Out of scope for code audit but critical — confirm in the Twilio console that a hard monthly cap is set on SMS spend. `PRELAUNCH.md` flags this but I did not check the console.

5. **No rate limiting on any write endpoint outside of auth.** Concept creation, annotation creation, corpus creation, flag, moderation vote, web link add, message send, page comment, document upload — all uncapped. The highest-concern subset:
   - `POST /api/moderation/flag` — weaponizable for coordinated hiding (10 flags hides an edge).
   - `POST /api/corpuses/annotations/create` — permanent, un-deletable, public.
   - `POST /api/corpuses/:id/documents/upload` — R2 storage cost + PDF/DOCX extraction CPU.
   - `POST /api/pages/:slug/comments` — public-facing comment stream.
   - `POST /api/messages/threads` — unsolicited DM vector.
   - `POST /api/concepts/root` and `/child` — graph-level vandalism.

6. **In-memory store resets on every deploy.** Sensitive limiters (especially `sendCode`) should use a persistent store. Postgres is already present; `rate-limit-postgres` is a low-operational-cost option.

7. **No app-wide limiter.** There is no global fallback limiter in `server.js`. Every unprotected endpoint is limited only by Railway's infrastructure limits and whatever Cloudflare is in front.

8. **Login has no per-account lockout.** 10 req / 15 min per IP is fine for brute force from one IP, but not for credential stuffing across many IPs. Low priority for launch (strong passwords enforced via zxcvbn mitigate this somewhat).

9. **Frontend 429 UX is minimal.** The error message is shown but there's no countdown, no button disable, no `Retry-After` parsing. Low severity for launch; cosmetic polish afterward.

---

## Recommendations

**Do not implement any of these yet — this is an audit.** Suggested targets for the fix phase:

### Priority 1 — Must fix before launch

1. **Configure trust proxy.**
   `app.set('trust proxy', 1)` in `server.js` before any route or limiter mounts. If Cloudflare sits in front of Railway, may need `'trust proxy', 2` or an explicit list of trusted proxy IPs. Validate against Railway's documentation.

2. **Add per-phone-number limiter to `sendCode`.**
   Target: **2 SMS per phone_lookup per hour**, **5 SMS per phone_lookup per 24 hours**. Key by the HMAC `phone_lookup` value already computed in `phoneAuth.js`. Enforce even if the per-IP limit has capacity. Rejection message: "Too many verification attempts to this phone number. Please wait before requesting another code."

3. **Add a global daily SMS cap.**
   Target: **200 SMS per 24 hours total** across both send-code endpoints. If exceeded, return 503 "verification temporarily unavailable" and log loudly so you can investigate. This is the blast-radius bound — worst case, a bypass of the other limits still costs you <$5/day.

4. **Move `sendCode` limiter to a persistent store.**
   Use `rate-limit-postgres` backed by the existing Postgres instance, or add a small `sms_rate_limit` table keyed on IP and phone_lookup with sliding windows. The key property: counters survive deploys.

5. **Verify Twilio account-level spending cap** in the Twilio console (out of code scope, but flag in PRELAUNCH.md).

### Priority 2 — Should fix before or shortly after launch

6. **Write-endpoint limiters.** Apply a modest per-user limit to the highest-risk POST endpoints. Suggested starting points, all keyed by authenticated user ID (not IP), with `express-rate-limit`'s `keyGenerator` option:

   | Endpoint | Suggested limit |
   |---|---|
   | `/api/moderation/flag` | 20 per hour per user |
   | `/api/corpuses/annotations/create` | 60 per hour per user |
   | `/api/corpuses/:id/documents/upload` | 10 per hour per user |
   | `/api/corpuses/versions/create` | 10 per hour per user |
   | `/api/pages/:slug/comments` | 10 per hour per user |
   | `/api/messages/threads` | 20 per hour per user (thread starts), 120 per hour per user (replies) |
   | `/api/votes/web-links/add` | 30 per hour per user |
   | `/api/concepts/root` | 10 per hour per user |
   | `/api/concepts/child` | 100 per hour per user |

   These are intentionally generous — legitimate power-users shouldn't hit them. The goal is to bound an attacker's damage, not gate normal usage.

7. **Global app-wide limiter as a safety net.**
   `500 requests / 15 min / IP`, applied in `server.js` before route mounts. Catches anything the per-route limiters miss. Low enough to stop trivial flood attacks, high enough to never affect a real user.

8. **Frontend 429 handling improvement.**
   In `LoginModal.jsx` and anywhere else that can hit `sendCode`, check for `err.response?.status === 429`, disable the submit button for the duration indicated by the `RateLimit-Reset` header, and show a countdown. Low priority but nice UX.

### Priority 3 — Post-launch hardening

9. **Per-account login lockout.** After 5 failed password attempts against the same identifier (regardless of IP), lock that account for 15 minutes. Mitigates credential stuffing.

10. **Move all limiters to a persistent store**, not just `sendCode`. Uniform behavior across the app; easier to reason about.

11. **Consider CAPTCHA (hCaptcha free tier) in front of `sendCode`.** `PRELAUNCH.md` already flags this as a possibility. Given the trivially-defeatable IP-only limits, a CAPTCHA is cheap insurance and eliminates most automated SMS-pumping attacks at the source.

---

## Files reviewed

- `backend/package.json` — rate-limit library version
- `backend/src/server.js` — no app-wide limiter, no trust proxy
- `backend/src/routes/auth.js` — only file with limiters
- `backend/src/routes/concepts.js` — no limiters
- `backend/src/routes/votes.js` — no limiters
- `backend/src/routes/corpuses.js` — no limiters
- `backend/src/routes/moderation.js` — no limiters
- `backend/src/routes/documents.js` — no limiters
- `backend/src/routes/pages.js` — no limiters
- `backend/src/routes/messages.js` — no limiters
- `backend/src/routes/combos.js` — no limiters
- `backend/src/routes/tunnels.js` — no limiters
- `backend/src/routes/users.js` — no limiters
- `backend/src/routes/citations.js` — no limiters
- `backend/src/middleware/auth.js` — JWT only, no rate limiting
- `frontend/src/components/LoginModal.jsx` — error surfacing, no explicit 429 handling
- Frontend-wide grep for `429`, `TOO_MANY_REQUESTS`, `Retry-After` — zero matches

---

**End of audit.**

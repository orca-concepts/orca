# Orca Pre-Launch Checklist

This is a working checklist of everything that should be verified, configured, or completed before Orca's public launch. Items are organized by category and grouped by priority.

**Priority key:**
- 🔒 **Hard blocker** — cannot launch without this
- ⚠️ **Should do** — launching without this creates real risk or pain
- 💡 **Nice to have** — launching without this is survivable but worth considering

Delete this file from the repo after launch. It is not part of the long-term project documentation.

---

## 🔒 Legal & Entity

- [ ] **LLC formation complete** (Murphy Desmond engagement in progress). Blocks several items below.
- [ ] **Terms of Service finalized and published.** Being drafted by Lane Rideout at Murphy Desmond. Must be linked from the app footer and shown at sign-up.
- [ ] **Privacy Policy finalized and published.** Same source. Must cover: email collection, phone hashing (both `phone_hash` and `phone_lookup`), ORCID linkage, what Twilio touches, document text extraction, annotation permanence, and cookies/sessions.
- [ ] **DMCA agent registered with the US Copyright Office** under the LLC name (~$6 filing fee). Required for safe harbor.
- [ ] **Update Constitution page** to match Murphy Desmond's Privacy Policy language. Current bullet about phone storage is incomplete (says "hashed phone numbers" but doesn't mention email collection, ORCID, or the HMAC `phone_lookup` mechanism added in Phase 33e).
- [ ] **Verify copyright confirmation checkbox at upload** is still in place (implemented Phase 36).
- [ ] **Verify age verification (18+) checkbox at registration** is still in place (implemented Phase 36).
- [ ] **Repeat infringer policy** documented (typically inside the ToS — confirm Lane includes it).
- [ ] **Takedown and counter-notice process** documented in a user-facing location, pointing at the DMCA agent's contact info.

---

## 🔒 Operational & Infrastructure

- [ ] **Audit all production environment variables on Railway.** Open the Railway Variables tab and confirm none are still at placeholder values. Critical ones to check:
  - [ ] `PHONE_LOOKUP_KEY` — must be a real random hex string (`.env.example` line 1888 still says `change_me_to_a_random_hex_string`)
  - [ ] `ADMIN_USER_ID` — set to your production user ID
  - [ ] `ENABLED_ATTRIBUTES` — `value,action,tool,question`
  - [ ] `ENABLED_DOCUMENT_TAGS` — production tag list
  - [ ] Twilio credentials (Account SID, Auth Token, Verify Service SID)
  - [ ] ORCID production credentials (client ID, client secret, redirect URI)
  - [ ] `DATABASE_URL`
  - [ ] Cloudflare R2 credentials
  - [ ] JWT secret
- [ ] **Database backups configured on Railway.** Verify whether the Hobby plan includes automated backups; if not, set up a weekly `pg_dump` to R2 or another destination.
- [ ] **Pre-launch test data cleanup migration written and ready to run.** Targets: test users (alice–frank), `ZDiff_` and `ZFlip_` seeded concepts, personal test annotations. Per ORCA_STATUS.md line 3629, hard deletion is fine pre-launch — not soft-hide. Order matters; write carefully so cascades don't surprise you.
- [ ] **Error monitoring set up** (Sentry free tier or equivalent). Without this, you'll only learn about bugs when users report them.
- [ ] **Uptime monitoring set up** (UptimeRobot free tier or equivalent — pings every 5 minutes, emails on outage).
- [ ] **SSL cert verified** on orcaconcepts.org. Visit in incognito and confirm the padlock icon.
- [ ] **Domain email working** (e.g. `hello@orcaconcepts.org` or `legal@orcaconcepts.org`). Needed for DMCA agent registration and Contact info in ToS/Privacy.

---

## ⚠️ Security & Abuse Prevention

- [ ] **Rate limiting audit on all public endpoints.** Especially:
  - [ ] `sendCode` (registration phone OTP — biggest Twilio cost risk)
  - [ ] Concept creation
  - [ ] Annotation creation
  - [ ] Flag/moderation endpoints
  - [ ] Forgot-password (already has 5 req/IP/15min per ORCA_STATUS line 1351 — confirm still active)
- [ ] **Twilio spending cap configured** in the Twilio console. Hard cap on SMS spending so abuse can't bankrupt you.
- [ ] **Admin unhide queue workflow tested in production.** Confirm `HiddenConceptsView.jsx` works and you know how to reach it. Document the workflow for yourself.
- [ ] **Decide on CAPTCHA for registration.** Phone verification does most anti-bot work, but a lightweight challenge (hCaptcha free tier) in front of `sendCode` is cheap insurance against Twilio cost attacks.

---

## ⚠️ User-Facing Polish

- [ ] **Using Orca page redesign complete** (in progress today).
- [ ] **Forgot password flow walked through end-to-end.** Click "Forgot password?" → enter phone → get OTP → set new password → log in with new password.
- [ ] **Orphan document cleanup dry run.** Upload, add to corpus, remove from corpus, verify orphan rescue path works.
- [ ] **Age verification flow tested.** Sign up as a brand-new user and confirm the 18+ checkbox blocks progression if unchecked.
- [ ] **Copyright confirmation flow tested.** Upload a document and confirm the checkbox is required and gets a `copyright_confirmed_at` timestamp.
- [ ] **All four attributes render correctly** in production: `[value]`, `[action]`, `[tool]`, `[question]`. Bracketed display, picker, filter, etc.
- [ ] **Email deliverability resolved.** Phase 36 added email collection "for legal notifications." Decide: is there an SMTP configured to actually send them, or are these notifications manual-only? If manual-only, document that as an explicit decision.
- [ ] **Browser compatibility spot check.** Chrome, Firefox, Safari (desktop), mobile Safari, mobile Chrome. At minimum: load homepage, log in, create an annotation, view a graph.
- [ ] **Favicon and basic SEO meta tags** on the landing page: `<title>`, `<meta name="description">`, Open Graph tags (so links render nicely when pasted into Bluesky, Slack, etc.). Bluesky outreach plan depends on this.
- [ ] **404 page exists and looks reasonable.**
- [ ] **Decide on admin profile presentation.** When you, Miles, appear as the first user / 10-flag moderator, what does your profile look like? Personal account or generic "Orca Admin"?

---

## ⚠️ Repository & Open Source Housekeeping

The repo is public at `github.com/orca-concepts/orca` under AGPL v3.

- [ ] **`README.md`** at repo root: what Orca is, screenshot, link to live site, how to run locally, how to contribute, license notice.
- [ ] **`LICENSE` file** with full AGPL v3 text. Verify GitHub auto-generated this when license was set.
- [ ] **`CONTRIBUTING.md`** (can be one paragraph: "open an issue first before a PR").
- [ ] **`CODE_OF_CONDUCT.md`** — Contributor Covenant is the standard. GitHub has a one-click template for this.
- [ ] **GitHub issue templates** (bug report, feature request).
- [ ] **Secrets audit on the public repo.** Run `gitleaks` or equivalent once to scan history for accidentally committed `.env` files, API keys, or passwords.

---

## 💡 Financial & Sustainability

- [ ] **Open Collective setup** complete (planned funding path). Doesn't block launch, but the "Donate" info page should point somewhere real before users find it broken.
- [ ] **6-month budget written down.** Railway (~$5/mo), Cloudflare domain (~$10/yr), Twilio (variable), R2 (variable). What's the cap if things go sideways?

---

## 💡 Post-Launch Monitoring Plan

Not strictly pre-launch, but should exist on Day 1.

- [ ] **Daily metrics list defined** for the first week: registrations, concept creations, annotation creations, flag count, Twilio spend, Railway CPU.
- [ ] **2am moderation emergency plan written.** What do you do if someone uploads something genuinely illegal at 2am?
- [ ] **Rollback plan written.** If a recent feature breaks something critical with real users on the system, what's the recovery path?

---

## Outside review

- [ ] **One trusted outside reviewer has spent ~1 hour on the live app** specifically looking for things that would embarrass you. Ideally someone with some security or web ops background. An outside pair of eyes catches what you've stopped seeing.

---

**Last updated:** [date when you make your first edit]

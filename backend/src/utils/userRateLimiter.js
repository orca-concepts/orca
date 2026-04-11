// Phase 49b — Per-user rate limiters for authenticated write endpoints.
//
// These limiters are keyed by the authenticated user ID (req.user.userId),
// NOT the IP address. This is the right key for write endpoints because:
//   1. An authenticated attacker has already proven they can create accounts,
//      so IP-based limits just push them to use multiple accounts.
//   2. Legitimate users behind NAT/proxy share an IP but should have
//      independent budgets.
//   3. JWT is required for all these endpoints anyway, so req.user.userId
//      is always present by the time the limiter runs.
//
// In-memory store is fine here (not Postgres-backed like the SMS limiter).
// These limits are bounds on damage, not dollar-cost guards — a reset on
// deploy just means the attacker's counter clears, which is a minor
// inconvenience at most. The SMS limiter is the one that must persist.
//
// Mount order: these must be added AFTER authenticateToken on the route,
// so that req.user.userId is populated by the time keyGenerator runs.

const rateLimit = require('express-rate-limit');

const ONE_HOUR_MS = 60 * 60 * 1000;

// Factory for per-user hourly limiters. Each call creates a new limiter
// with its own counter store, so different routes do not share counters.
//
// Every route using these limiters is mounted AFTER `authenticateToken`,
// which guarantees `req.user.userId` exists by the time the keyGenerator
// runs. If an unauthenticated request ever reaches here it is a bug, and
// we want a 500 rather than silently falling back to IP keying (which
// would also trip express-rate-limit v8's IPv6-safety validation).
function perUserHourly(max, label) {
  return rateLimit({
    windowMs: ONE_HOUR_MS,
    max,
    keyGenerator: (req) => `u:${req.user.userId}`,
    message: { error: `You are doing that too often. Please wait before trying again.${label ? ` (${label})` : ''}` },
    standardHeaders: true,
    legacyHeaders: false,
  });
}

// Pre-configured limiters for each write endpoint, matching the targets
// from RATE_LIMIT_AUDIT.md Priority 2.
module.exports = {
  perUserHourly,

  // Moderation — weaponizable for coordinated hiding (10 flags hides an edge)
  flagLimiter: perUserHourly(20, 'flag'),

  // Annotations — permanent, un-deletable, public
  annotationCreateLimiter: perUserHourly(60, 'annotation create'),

  // Document uploads — R2 storage + PDF/DOCX extraction CPU
  documentUploadLimiter: perUserHourly(10, 'document upload'),

  // Document version uploads — same cost profile as uploads
  versionCreateLimiter: perUserHourly(10, 'version upload'),

  // Info page comments — public-facing spam target
  pageCommentLimiter: perUserHourly(10, 'page comment'),

  // Direct messages — unsolicited-message vector (thread starts)
  messageThreadCreateLimiter: perUserHourly(20, 'new message thread'),

  // Replies in existing threads — higher budget since conversation is mutual
  messageReplyLimiter: perUserHourly(120, 'message reply'),

  // Web link additions — attractive to link spammers
  webLinkAddLimiter: perUserHourly(30, 'web link add'),

  // Root concept creation — graph-level vandalism
  rootConceptCreateLimiter: perUserHourly(10, 'root concept create'),

  // Child concept creation — more generous budget (normal usage)
  childConceptCreateLimiter: perUserHourly(100, 'child concept create'),
};

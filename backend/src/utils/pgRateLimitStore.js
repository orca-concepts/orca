// Phase 49a — Postgres-backed sliding-window rate limit store.
//
// Used for limiters where counter persistence across restarts/deploys is
// important (currently: per-phone SMS and global daily SMS cap). Most write
// endpoints use express-rate-limit's in-memory store — that is intentional.
//
// The key idea: bucket requests into discrete windows of length `windowMs`
// starting at the Unix epoch. For a given `now`, the current window starts
// at `floor(now / windowMs) * windowMs`. `increment` writes to that bucket;
// `getCount` reads from it. This is a fixed-window counter, not a true
// sliding window, but it's cheap, safe to race, and more than adequate for
// SMS abuse prevention.
//
// Old rows are cleaned up opportunistically on each increment — any row
// with a window_start older than 7 days is deleted. This keeps the table
// small without requiring a separate cron job.

const pool = require('../config/database');

function currentWindowStart(windowMs, now = Date.now()) {
  const ms = Math.floor(now / windowMs) * windowMs;
  return new Date(ms);
}

// Increment the counter for `key` in the current window, returning the new
// count. Atomic via INSERT ... ON CONFLICT. Opportunistically cleans up rows
// older than 7 days (cheap — indexed on window_start).
async function increment(key, windowMs) {
  const windowStart = currentWindowStart(windowMs);
  const result = await pool.query(
    `INSERT INTO rate_limit_counters (key, window_start, count)
     VALUES ($1, $2, 1)
     ON CONFLICT (key, window_start)
     DO UPDATE SET count = rate_limit_counters.count + 1
     RETURNING count`,
    [key, windowStart]
  );
  // Fire-and-forget cleanup — do not await, do not block the request path.
  pool
    .query(
      `DELETE FROM rate_limit_counters WHERE window_start < NOW() - INTERVAL '7 days'`
    )
    .catch((err) => {
      console.error('[pgRateLimitStore] cleanup error:', err.message);
    });
  return result.rows[0].count;
}

// Read the count for `key` in the current window without incrementing.
async function getCount(key, windowMs) {
  const windowStart = currentWindowStart(windowMs);
  const result = await pool.query(
    `SELECT count FROM rate_limit_counters WHERE key = $1 AND window_start = $2`,
    [key, windowStart]
  );
  return result.rows[0] ? result.rows[0].count : 0;
}

// Sum counts across all windows whose window_start is within the last
// `windowMs` milliseconds. Used for "total over the last N hours" checks
// where we want a rolling window rather than a single fixed bucket. With
// fixed-window bucketing, this can be called with a single `windowMs`
// (e.g. 24h) to get a single bucket, or with a shorter window to sum
// buckets across a rolling horizon.
async function getCountSince(key, sinceMs) {
  const since = new Date(Date.now() - sinceMs);
  const result = await pool.query(
    `SELECT COALESCE(SUM(count), 0)::int AS total
       FROM rate_limit_counters
      WHERE key = $1 AND window_start >= $2`,
    [key, since]
  );
  return result.rows[0].total;
}

module.exports = { increment, getCount, getCountSince, currentWindowStart };

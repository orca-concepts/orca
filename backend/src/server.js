const express = require('express');
const cors = require('cors');
const rateLimitStore = require('./utils/pgRateLimitStore');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const conceptsRoutes = require('./routes/concepts');
const votesRoutes = require('./routes/votes');
const corpusesRoutes = require('./routes/corpuses');
const moderationRoutes = require('./routes/moderation');
const documentRoutes = require('./routes/documents');
const pageRoutes = require('./routes/pages');
const messageRoutes = require('./routes/messages');
const citationRoutes = require('./routes/citations');
const comboRoutes = require('./routes/combos');
const tunnelRoutes = require('./routes/tunnels');
const userRoutes = require('./routes/users');
const annotationRoutes = require('./routes/annotations');
const legalRoutes = require('./routes/legal');
const adminLegalRoutes = require('./routes/adminLegal');

const pool = require('./config/database');

const app = express();
const PORT = process.env.PORT || 5000;

// Trust proxy (Phase 49a) — Cloudflare → Railway = 2 hops.
// Required so req.ip resolves to the real client IP (not the proxy),
// which makes IP-keyed rate limiters work correctly in production.
// Must be set before any rate limiter or route mounts.
app.set('trust proxy', 2);

// CORS configuration
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (curl, server-to-server, mobile apps)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Phase 49d — Global app-wide safety-net limiter.
//
// Keyed by IP (trust proxy is configured above, so req.ip is the real
// client). 2000 writes per 15 minutes per IP — deliberately generous;
// this is NOT the primary defense for any particular endpoint, it's a
// blanket floor that catches trivial flood attacks on endpoints the
// per-route limiters may have missed. Legitimate power-users should
// never see it.
//
// GET requests are exempt entirely. A safety net for abuse should care
// about writes (creating concepts, voting, flagging, uploading) and auth
// attempts, not innocent page loads. React StrictMode in dev doubles every
// effect, and a normal session can easily rack up 100+ GETs in a few
// minutes — penalizing that would lock out legitimate users.
//
// Counters are stored in Postgres via pgRateLimitStore, so they survive
// backend restarts and are shared across multi-instance deploys on Railway.
// The key namespace `global:ip:` is distinct from the `sms:*` keys used by
// the SMS limiter to prevent collisions.
//
// Fail-open on store errors: a transient database hiccup should not lock
// legitimate users out of the app. The per-route write-endpoint limiters
// (Phase 49b) and the per-phone SMS limiter (Phase 49a) provide the real
// defense; this one is just a backstop.
const GLOBAL_SAFETY_NET_WINDOW_MS = 15 * 60 * 1000;
const GLOBAL_SAFETY_NET_MAX = 2000;

async function globalSafetyNetLimiter(req, res, next) {
  // Exempt GETs — reads should never hit this bucket.
  if (req.method === 'GET') {
    return next();
  }
  try {
    const key = `global:ip:${req.ip}`;
    const count = await rateLimitStore.increment(key, GLOBAL_SAFETY_NET_WINDOW_MS);
    const remaining = Math.max(0, GLOBAL_SAFETY_NET_MAX - count);
    const windowStart = rateLimitStore.currentWindowStart(GLOBAL_SAFETY_NET_WINDOW_MS);
    const resetTime = new Date(windowStart.getTime() + GLOBAL_SAFETY_NET_WINDOW_MS);
    const resetSeconds = Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000));

    // Standard headers (draft-7 / express-rate-limit `standardHeaders: true`
    // equivalent). Legacy X-RateLimit-* headers intentionally omitted.
    res.setHeader('RateLimit-Limit', GLOBAL_SAFETY_NET_MAX);
    res.setHeader('RateLimit-Remaining', remaining);
    res.setHeader('RateLimit-Reset', resetSeconds);

    if (count > GLOBAL_SAFETY_NET_MAX) {
      res.setHeader('Retry-After', resetSeconds);
      return res.status(429).json({
        error: 'Too many requests. Please slow down and try again in a few minutes.',
      });
    }
    return next();
  } catch (err) {
    console.error('[global safety net] store error:', err.message);
    // Fail open — do not block legit users on a transient DB error.
    return next();
  }
}

app.use('/api', globalSafetyNetLimiter);

// Request logging middleware
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/concepts', conceptsRoutes);
app.use('/api/votes', votesRoutes);
app.use('/api/corpuses', corpusesRoutes);
app.use('/api/moderation', moderationRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/pages', pageRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/citations', citationRoutes);
app.use('/api/combos', comboRoutes);
app.use('/api/tunnels', tunnelRoutes);
app.use('/api/users', userRoutes);
app.use('/api/annotations', annotationRoutes);
app.use('/api/legal', legalRoutes);
app.use('/api/admin', adminLegalRoutes);

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// Phase 54b: In production, serve frontend static files and SPA fallback.
// Placed AFTER all /api routes so API requests are handled first.
if (process.env.NODE_ENV === 'production') {
  const path = require('path');
  const frontendDist = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDist));
  // SPA fallback — any non-/api route serves index.html so React Router works
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
}

// 404 handler (only catches unmatched /api routes in production; catches all in dev)
app.use((req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Database health check, then start server
let server;
(async () => {
  try {
    await pool.query('SELECT 1');
    console.log('Database health check passed');
  } catch (err) {
    console.error('ERROR: Cannot connect to PostgreSQL. Is the database running?');
    console.error(err.message);
    process.exit(1);
  }

  server = app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });

  // Handle EADDRINUSE: kill the stale process occupying the port, then retry once
  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${PORT} in use, attempting to free it...`);
      const { exec } = require('child_process');
      // Windows: find and kill the process using the port
      exec(`netstat -ano | findstr :${PORT} | findstr LISTENING`, (e, stdout) => {
        if (e || !stdout.trim()) {
          console.error(`Could not find process on port ${PORT}. Please free it manually.`);
          process.exit(1);
        }
        // Extract PID from the last column of the first LISTENING line
        const line = stdout.trim().split('\n')[0];
        const pid = line.trim().split(/\s+/).pop();
        if (!pid || pid === '0') {
          console.error('Could not determine PID. Please free the port manually.');
          process.exit(1);
        }
        console.log(`Killing PID ${pid} on port ${PORT}...`);
        exec(`taskkill /F /PID ${pid}`, (killErr) => {
          if (killErr) {
            console.error(`Failed to kill PID ${pid}:`, killErr.message);
            process.exit(1);
          }
          console.log(`Killed PID ${pid}. Retrying listen on port ${PORT}...`);
          setTimeout(() => {
            server.listen(PORT, () => {
              console.log(`Server is running on port ${PORT}`);
              console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
            });
          }, 1000);
        });
      });
    } else {
      console.error('Server error:', err);
      process.exit(1);
    }
  });
})();

// Graceful shutdown — release the port so nodemon restarts cleanly
function shutdown(signal) {
  console.log(`\n${signal} received, shutting down gracefully...`);
  if (server) {
    server.close(() => {
      console.log('Server closed.');
      pool.end().then(() => {
        console.log('Database pool closed.');
        process.exit(0);
      });
    });
  }
  // Force exit if close takes too long
  setTimeout(() => process.exit(1), 3000);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
// Windows: nodemon sends 'message' with 'shutdown' before killing the child
process.once('message', (msg) => {
  if (msg === 'shutdown') shutdown('shutdown message');
});

module.exports = app;

const express = require('express');
const cors = require('cors');
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

const pool = require('./config/database');

const app = express();
const PORT = process.env.PORT || 5000;

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

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Server is running' });
});

// 404 handler
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

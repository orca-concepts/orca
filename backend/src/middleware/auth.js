const jwt = require('jsonwebtoken');
const pool = require('../config/database');
require('dotenv').config();

const checkTokenIssuedAfter = async (userId, tokenIat) => {
  const result = await pool.query(
    'SELECT token_issued_after FROM users WHERE id = $1',
    [userId]
  );
  if (result.rows.length === 0) {
    return { valid: false };
  }
  const row = result.rows[0];
  if (row.token_issued_after) {
    const issuedAfterUnix = Math.floor(new Date(row.token_issued_after).getTime() / 1000);
    if (tokenIat <= issuedAfterUnix) {
      return { valid: false };
    }
  }
  return { valid: true };
};

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }

    try {
      const check = await checkTokenIssuedAfter(user.userId, user.iat);
      if (!check.valid) {
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
      }
    } catch (dbErr) {
      console.error('Token validation DB error:', dbErr);
      return res.status(500).json({ error: 'Internal server error' });
    }

    req.user = user; // Add user info to request
    next();
  });
};

// Optional authentication: if a token is present and valid, attach user.
// If no token or invalid token, proceed with req.user = null (guest mode).
const optionalAuth = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = null;
    return next();
  }

  jwt.verify(token, process.env.JWT_SECRET, async (err, user) => {
    if (err) {
      req.user = null; // Invalid/expired token — treat as guest
      return next();
    }

    try {
      const check = await checkTokenIssuedAfter(user.userId, user.iat);
      if (!check.valid) {
        req.user = null; // Token invalidated by logout-everywhere — treat as guest
        return next();
      }
    } catch (dbErr) {
      req.user = null;
      return next();
    }

    req.user = user;
    next();
  });
};

module.exports = authenticateToken;
module.exports.optionalAuth = optionalAuth;

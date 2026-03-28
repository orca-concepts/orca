const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const { normalizePhone, sendVerificationCode, checkVerificationCode, computePhoneLookup } = require('../utils/phoneAuth');
require('dotenv').config();

const authController = {
  // Get current user info
  getCurrentUser: async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, username, email, created_at FROM users WHERE id = $1',
        [req.user.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.json({ user: result.rows[0] });
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Send OTP code via Twilio
  sendCode: async (req, res) => {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    try {
      const result = await sendVerificationCode(phoneNumber);
      if (result.success) {
        return res.json({ message: 'Verification code sent' });
      }
      return res.status(500).json({ error: result.error });
    } catch (error) {
      console.error('Twilio sendCode error:', error);
      return res.status(500).json({ error: 'Failed to send verification code' });
    }
  },

  // Verify OTP and register new user
  verifyRegister: async (req, res) => {
    const { phoneNumber, code, username, email, ageVerified } = req.body;

    if (!phoneNumber || !code || !username) {
      return res.status(400).json({ error: 'Phone number, code, and username are required' });
    }

    // Email validation (before Twilio call)
    if (!email || typeof email !== 'string' || !email.trim()) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }
    const atIndex = email.indexOf('@');
    if (atIndex < 1 || email.indexOf('.', atIndex) === -1) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    // Age verification validation (before Twilio call)
    if (ageVerified !== true) {
      return res.status(400).json({ error: 'Age verification is required (must be 18 or older)' });
    }

    // Username format validation (before Twilio call)
    if (!/^[a-zA-Z0-9_]{1,30}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 1-30 characters, alphanumeric and underscores only' });
    }

    // Username uniqueness check (before Twilio call)
    try {
      const existing = await pool.query(
        'SELECT id FROM users WHERE LOWER(username) = LOWER($1)',
        [username]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'Username already taken' });
      }
    } catch (error) {
      console.error('Username check error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }

    // Verify OTP with Twilio
    let verifyResult;
    try {
      verifyResult = await checkVerificationCode(phoneNumber, code);
    } catch (error) {
      console.error('Twilio verifyRegister error:', error);
      return res.status(500).json({ error: 'Failed to send verification code' });
    }
    if (!verifyResult.success) {
      return res.status(400).json({ error: verifyResult.error });
    }

    try {
      const normalized = normalizePhone(phoneNumber);
      const phoneLookup = computePhoneLookup(normalized);

      // Phone uniqueness check — O(1) via HMAC lookup
      const existingPhone = await pool.query(
        'SELECT id FROM users WHERE phone_lookup = $1',
        [phoneLookup]
      );
      if (existingPhone.rows.length > 0) {
        return res.status(409).json({ error: 'An account with this phone number already exists' });
      }

      // Hash phone, create user + default tab in a transaction
      const phoneHash = await bcrypt.hash(normalized, 10);
      const client = await pool.connect();
      let user;
      try {
        await client.query('BEGIN');

        const result = await client.query(
          'INSERT INTO users (username, phone_hash, phone_lookup, email, age_verified_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id, username',
          [username, phoneHash, phoneLookup, email.trim()]
        );
        user = result.rows[0];

        // Auto-create the default "Saved" tab
        await client.query(
          'INSERT INTO saved_tabs (user_id, name, display_order) VALUES ($1, $2, 0)',
          [user.id, 'Saved']
        );

        await client.query('COMMIT');
      } catch (txError) {
        await client.query('ROLLBACK');
        throw txError;
      } finally {
        client.release();
      }

      // Sign JWT (outside transaction — no DB needed)
      const token = jwt.sign(
        { userId: user.id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '90d' }
      );

      res.status(201).json({
        token,
        user: { id: user.id, username: user.username }
      });
    } catch (error) {
      console.error('Phone registration error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Verify OTP and login existing user
  verifyLogin: async (req, res) => {
    const { phoneNumber, code } = req.body;

    if (!phoneNumber || !code) {
      return res.status(400).json({ error: 'Phone number and code are required' });
    }

    // Verify OTP with Twilio
    let verifyResult;
    try {
      verifyResult = await checkVerificationCode(phoneNumber, code);
    } catch (error) {
      console.error('Twilio verifyLogin error:', error);
      return res.status(500).json({ error: 'Failed to send verification code' });
    }
    if (!verifyResult.success) {
      return res.status(400).json({ error: verifyResult.error });
    }

    try {
      const normalized = normalizePhone(phoneNumber);
      const phoneLookup = computePhoneLookup(normalized);

      // Find user by phone lookup — O(1) via HMAC index
      const result = await pool.query(
        'SELECT id, username FROM users WHERE phone_lookup = $1',
        [phoneLookup]
      );
      const matchedUser = result.rows[0] || null;

      if (!matchedUser) {
        return res.status(404).json({ error: 'No account found with this phone number. Please register first.' });
      }

      // Sign JWT
      const token = jwt.sign(
        { userId: matchedUser.id, username: matchedUser.username },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '90d' }
      );

      res.json({
        token,
        user: { id: matchedUser.id, username: matchedUser.username }
      });
    } catch (error) {
      console.error('Phone login error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Invalidate all existing sessions
  logoutEverywhere: async (req, res) => {
    try {
      await pool.query(
        'UPDATE users SET token_issued_after = NOW() WHERE id = $1',
        [req.user.userId]
      );
      res.json({ message: 'All sessions invalidated. Please log in again.' });
    } catch (error) {
      console.error('Logout everywhere error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Delete user account (Phase 35c)
  deleteAccount: async (req, res) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Pre-check: user must not own any corpuses
      const ownedCorpuses = await client.query(
        'SELECT id, name FROM corpuses WHERE created_by = $1',
        [req.user.userId]
      );
      if (ownedCorpuses.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `You still own ${ownedCorpuses.rows.length} corpus(es). Transfer ownership or delete them before deleting your account.`,
          corpuses: ownedCorpuses.rows
        });
      }

      // Delete the user row — CASCADE and SET NULL handle all child tables
      await client.query('DELETE FROM users WHERE id = $1', [req.user.userId]);

      await client.query('COMMIT');
      res.json({ message: 'Account deleted successfully' });
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Delete account error:', error);
      res.status(500).json({ error: 'Internal server error' });
    } finally {
      client.release();
    }
  }
};

module.exports = authController;

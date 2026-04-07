const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const zxcvbn = require('zxcvbn');
const pool = require('../config/database');
const { normalizePhone, sendVerificationCode, checkVerificationCode, computePhoneLookup } = require('../utils/phoneAuth');
require('dotenv').config();

// Password validation helper (NIST SP 800-63B)
function validatePassword(password, userInputs = []) {
  if (!password || typeof password !== 'string') {
    return { valid: false, error: 'Password is required' };
  }
  if (password.length < 8) {
    return { valid: false, error: 'Password must be at least 8 characters' };
  }
  if (password.length > 128) {
    return { valid: false, error: 'Password must be 128 characters or fewer' };
  }
  const result = zxcvbn(password, userInputs);
  if (result.score < 2) {
    const suggestion = result.feedback.suggestions.join(' ') || result.feedback.warning || 'Please choose a stronger password';
    return { valid: false, error: suggestion };
  }
  return { valid: true };
}

const authController = {
  // Get current user info
  getCurrentUser: async (req, res) => {
    try {
      const result = await pool.query(
        'SELECT id, username, email, orcid_id, hide_annotation_warning, created_at FROM users WHERE id = $1',
        [req.user.userId]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const row = result.rows[0];
      res.json({ user: { id: row.id, username: row.username, email: row.email, orcidId: row.orcid_id, hideAnnotationWarning: row.hide_annotation_warning, created_at: row.created_at } });
    } catch (error) {
      console.error('Get user error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Password login (Phase 40b)
  login: async (req, res) => {
    const { identifier, password } = req.body;

    if (!identifier || !password) {
      return res.status(400).json({ error: 'Username/email and password are required' });
    }

    try {
      const isEmail = identifier.includes('@');

      let user;
      if (isEmail) {
        const result = await pool.query(
          'SELECT id, username, password_hash FROM users WHERE LOWER(email) = LOWER($1)',
          [identifier.trim()]
        );
        user = result.rows[0];
      } else {
        const result = await pool.query(
          'SELECT id, username, password_hash FROM users WHERE LOWER(username) = LOWER($1)',
          [identifier.trim()]
        );
        user = result.rows[0];
      }

      if (!user || !user.password_hash) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const passwordValid = await bcrypt.compare(password, user.password_hash);
      if (!passwordValid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = jwt.sign(
        { userId: user.id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '90d' }
      );

      res.json({ token, user: { id: user.id, username: user.username } });
    } catch (error) {
      console.error('Login error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Send OTP code via Twilio (used for registration and forgot-password)
  sendCode: async (req, res) => {
    const { phoneNumber, intent } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    // Pre-check phone uniqueness/existence before calling Twilio
    try {
      const normalized = normalizePhone(phoneNumber);
      const phoneLookup = computePhoneLookup(normalized);

      if (intent === 'register') {
        // Registration: reject if phone already exists
        const existing = await pool.query(
          'SELECT id FROM users WHERE phone_lookup = $1',
          [phoneLookup]
        );
        if (existing.rows.length > 0) {
          return res.status(400).json({ error: 'An account with this phone number already exists' });
        }
      }
      // intent=login no longer used (OTP login removed in Phase 40b)
    } catch (error) {
      console.error('Phone pre-check error:', error);
      return res.status(500).json({ error: 'Internal server error' });
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

  // Verify OTP and register new user (Phase 40b: now requires password)
  verifyRegister: async (req, res) => {
    const { phoneNumber, code, username, email, password, ageVerified } = req.body;

    if (!phoneNumber || !code || !username) {
      return res.status(400).json({ error: 'Phone number, code, and username are required' });
    }

    // Password validation (before Twilio call)
    const passwordValidation = validatePassword(password, [username, email].filter(Boolean));
    if (!passwordValidation.valid) {
      return res.status(400).json({ error: passwordValidation.error });
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

      // Hash phone and password
      const phoneHash = await bcrypt.hash(normalized, 10);
      const passwordHash = await bcrypt.hash(password, 10);

      const client = await pool.connect();
      let user;
      try {
        await client.query('BEGIN');

        const result = await client.query(
          'INSERT INTO users (username, phone_hash, phone_lookup, password_hash, email, age_verified_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING id, username',
          [username, phoneHash, phoneLookup, passwordHash, email.trim()]
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

  // Forgot password: send OTP to phone number (Phase 40b)
  forgotPasswordSendCode: async (req, res) => {
    const { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({ error: 'Phone number is required' });
    }

    try {
      const normalized = normalizePhone(phoneNumber);
      const lookupHash = computePhoneLookup(normalized);

      // Check user exists
      const result = await pool.query(
        'SELECT id FROM users WHERE phone_lookup = $1',
        [lookupHash]
      );

      if (!result.rows[0]) {
        // Generic response — don't reveal whether account exists
        return res.json({ message: 'If an account exists with this phone number, a verification code has been sent' });
      }

      // Send OTP via Twilio
      const sendResult = await sendVerificationCode(phoneNumber);
      if (!sendResult.success) {
        return res.status(500).json({ error: 'Failed to send verification code' });
      }

      res.json({ message: 'If an account exists with this phone number, a verification code has been sent' });
    } catch (error) {
      console.error('Forgot password send code error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Forgot password: verify OTP and reset password (Phase 40b)
  forgotPasswordReset: async (req, res) => {
    const { phoneNumber, code, newPassword } = req.body;

    if (!phoneNumber || !code || !newPassword) {
      return res.status(400).json({ error: 'Phone number, verification code, and new password are required' });
    }

    // Verify OTP via Twilio
    let verifyResult;
    try {
      const normalizedPhone = normalizePhone(phoneNumber);
      verifyResult = await checkVerificationCode(normalizedPhone, code);
    } catch (error) {
      console.error('Twilio forgot password verify error:', error);
      return res.status(500).json({ error: 'Failed to verify code' });
    }
    if (!verifyResult.success) {
      return res.status(400).json({ error: verifyResult.error });
    }

    try {
      const normalized = normalizePhone(phoneNumber);
      const lookupHash = computePhoneLookup(normalized);

      const userResult = await pool.query(
        'SELECT id, username, email FROM users WHERE phone_lookup = $1',
        [lookupHash]
      );
      const user = userResult.rows[0];

      if (!user) {
        return res.status(400).json({ error: 'No account found with this phone number' });
      }

      // Validate new password
      const validation = validatePassword(newPassword, [user.username, user.email].filter(Boolean));
      if (!validation.valid) {
        return res.status(400).json({ error: validation.error });
      }

      // Hash and store
      const passwordHash = await bcrypt.hash(newPassword, 10);
      await pool.query(
        'UPDATE users SET password_hash = $1 WHERE id = $2',
        [passwordHash, user.id]
      );

      // Auto-login: generate JWT
      const token = jwt.sign(
        { userId: user.id, username: user.username },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '90d' }
      );

      res.json({ token, user: { id: user.id, username: user.username } });
    } catch (error) {
      console.error('Forgot password reset error:', error);
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

      // Pre-check: user must not own any combos/superconcepts (Phase 42c)
      const ownedCombos = await client.query(
        'SELECT id, name FROM combos WHERE created_by = $1',
        [req.user.userId]
      );
      if (ownedCombos.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `You still own ${ownedCombos.rows.length} superconcept(s). Transfer ownership before deleting your account.`,
          ownedCombos: ownedCombos.rows
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
  },

  // Phase 41a: ORCID OAuth — get authorize URL
  getOrcidAuthorizeUrl: async (req, res) => {
    try {
      const clientId = process.env.ORCID_CLIENT_ID;
      const redirectUri = process.env.ORCID_REDIRECT_URI;
      const baseUrl = process.env.ORCID_BASE_URL || 'https://orcid.org';

      if (!clientId || !redirectUri) {
        return res.status(500).json({ error: 'ORCID OAuth is not configured' });
      }

      const url = `${baseUrl}/oauth/authorize?client_id=${encodeURIComponent(clientId)}&response_type=code&scope=/authenticate&redirect_uri=${encodeURIComponent(redirectUri)}`;
      res.json({ url });
    } catch (error) {
      console.error('ORCID authorize URL error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 41a: ORCID OAuth — exchange code for verified ORCID iD
  orcidCallback: async (req, res) => {
    const { code } = req.body;
    if (!code) {
      return res.status(400).json({ error: 'Authorization code is required' });
    }

    try {
      const clientId = process.env.ORCID_CLIENT_ID;
      const clientSecret = process.env.ORCID_CLIENT_SECRET;
      const redirectUri = process.env.ORCID_REDIRECT_URI;
      const baseUrl = process.env.ORCID_BASE_URL || 'https://orcid.org';

      if (!clientId || !clientSecret || !redirectUri) {
        return res.status(500).json({ error: 'ORCID OAuth is not configured' });
      }

      // Server-to-server token exchange with ORCID
      const tokenUrl = `${baseUrl}/oauth/token`;
      const body = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      });

      const tokenResponse = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body: body.toString(),
      });

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text();
        console.error('ORCID token exchange failed:', tokenResponse.status, errorText);
        return res.status(400).json({ error: 'Failed to verify ORCID authorization code' });
      }

      const tokenData = await tokenResponse.json();
      const orcidId = tokenData.orcid;

      if (!orcidId) {
        return res.status(400).json({ error: 'No ORCID iD returned from ORCID' });
      }

      // Check uniqueness — another user may already have this ORCID
      const existing = await pool.query(
        'SELECT id FROM users WHERE orcid_id = $1 AND id != $2',
        [orcidId, req.user.userId]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'This ORCID iD is already linked to another account' });
      }

      // Store the verified ORCID iD
      await pool.query(
        'UPDATE users SET orcid_id = $1 WHERE id = $2',
        [orcidId, req.user.userId]
      );

      res.json({ success: true, orcidId });
    } catch (error) {
      console.error('ORCID callback error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 41a: ORCID disconnect
  disconnectOrcid: async (req, res) => {
    try {
      await pool.query(
        'UPDATE users SET orcid_id = NULL WHERE id = $1',
        [req.user.userId]
      );
      res.json({ success: true });
    } catch (error) {
      console.error('ORCID disconnect error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 41a: Dev-mode ORCID bypass (non-production only)
  devConnectOrcid: async (req, res) => {
    if (process.env.NODE_ENV === 'production') {
      return res.status(404).json({ error: 'Route not found' });
    }

    const { orcidId } = req.body;
    if (!orcidId) {
      return res.status(400).json({ error: 'orcidId is required' });
    }

    // Validate ORCID format: 0000-0000-0000-0000 (last char can be X)
    if (!/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(orcidId)) {
      return res.status(400).json({ error: 'Invalid ORCID format. Expected: 0000-0000-0000-0000' });
    }

    try {
      // Check uniqueness
      const existing = await pool.query(
        'SELECT id FROM users WHERE orcid_id = $1 AND id != $2',
        [orcidId, req.user.userId]
      );
      if (existing.rows.length > 0) {
        return res.status(409).json({ error: 'This ORCID iD is already linked to another account' });
      }

      await pool.query(
        'UPDATE users SET orcid_id = $1 WHERE id = $2',
        [orcidId, req.user.userId]
      );

      res.json({ success: true, orcidId });
    } catch (error) {
      console.error('Dev ORCID connect error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  },

  // Phase 45: Hide annotation warning
  hideAnnotationWarning: async (req, res) => {
    try {
      await pool.query(
        'UPDATE users SET hide_annotation_warning = true WHERE id = $1',
        [req.user.userId]
      );
      res.json({ success: true });
    } catch (error) {
      console.error('Hide annotation warning error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  }
};

module.exports = authController;

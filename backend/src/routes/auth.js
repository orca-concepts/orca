const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authenticateToken = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

// Phase 49a — The old IP-keyed sendCodeLimiter was removed. SMS abuse
// protection now lives inside the controller (per-phone_lookup buckets
// backed by Postgres, plus a global daily cap). See checkSmsRateLimits()
// in authController.js. Login and verify-code limiters remain — they are
// IP-keyed and now correct because trust proxy is configured in server.js.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

const verifyCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many verification attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Password login (Phase 40b)
router.post('/login', loginLimiter, authController.login);

// Phone OTP routes (registration only, Phase 40b)
router.post('/send-code', authController.sendCode);
router.post('/verify-register', verifyCodeLimiter, authController.verifyRegister);

// Forgot password (Phase 40b)
router.post('/forgot-password/send-code', authController.forgotPasswordSendCode);
router.post('/forgot-password/reset', verifyCodeLimiter, authController.forgotPasswordReset);

// Protected routes
router.get('/me', authenticateToken, authController.getCurrentUser);
router.post('/logout-everywhere', authenticateToken, authController.logoutEverywhere);
router.post('/delete-account', authenticateToken, authController.deleteAccount);

// Phase 45: Annotation warning dismissal
router.post('/hide-annotation-warning', authenticateToken, authController.hideAnnotationWarning);

// Phase 41a: ORCID OAuth
router.get('/orcid/authorize-url', authenticateToken, authController.getOrcidAuthorizeUrl);
router.post('/orcid/callback', authenticateToken, authController.orcidCallback);
router.post('/orcid/disconnect', authenticateToken, authController.disconnectOrcid);
router.post('/orcid/dev-connect', authenticateToken, authController.devConnectOrcid);

module.exports = router;

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authenticateToken = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

const sendCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many code requests. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

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
router.post('/send-code', sendCodeLimiter, authController.sendCode);
router.post('/verify-register', verifyCodeLimiter, authController.verifyRegister);

// Forgot password (Phase 40b)
router.post('/forgot-password/send-code', sendCodeLimiter, authController.forgotPasswordSendCode);
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

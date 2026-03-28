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

const verifyCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many verification attempts. Please try again in 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false
});

// Phone OTP routes (Phase 32b)
router.post('/send-code', sendCodeLimiter, authController.sendCode);
router.post('/verify-register', verifyCodeLimiter, authController.verifyRegister);
router.post('/verify-login', verifyCodeLimiter, authController.verifyLogin);

// Protected routes
router.get('/me', authenticateToken, authController.getCurrentUser);
router.post('/logout-everywhere', authenticateToken, authController.logoutEverywhere);
router.post('/delete-account', authenticateToken, authController.deleteAccount);

module.exports = router;

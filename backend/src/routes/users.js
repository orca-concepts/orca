const express = require('express');
const router = express.Router();
const usersController = require('../controllers/usersController');
const authenticateToken = require('../middleware/auth');
const optionalAuth = authenticateToken.optionalAuth;

// Public profile (guest-accessible)
router.get('/:id/profile', optionalAuth, usersController.getUserProfile);

module.exports = router;

const express = require('express');
const router = express.Router();
const usersController = require('../controllers/usersController');
const authenticateToken = require('../middleware/auth');
const optionalAuth = authenticateToken.optionalAuth;

// Search users by username or ORCID (auth required)
router.get('/search', authenticateToken, usersController.searchUsers);

// Public profile (guest-accessible)
router.get('/:id/profile', optionalAuth, usersController.getUserProfile);

module.exports = router;

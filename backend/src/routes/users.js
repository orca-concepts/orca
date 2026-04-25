const express = require('express');
const router = express.Router();
const usersController = require('../controllers/usersController');
const authenticateToken = require('../middleware/auth');
const optionalAuth = authenticateToken.optionalAuth;

// Search users by username or ORCID (auth required)
router.get('/search', authenticateToken, usersController.searchUsers);

// Self-service data export (Phase 52a — Colorado Privacy Act)
router.get('/me/export', authenticateToken, usersController.exportMyData);

// Export usage counter (Phase 52b)
router.get('/me/export-status', authenticateToken, usersController.getExportStatus);

// Update correctable profile fields (Phase 52b — Colorado right to correct)
router.patch('/me', authenticateToken, usersController.updateMyProfile);

// Public profile (guest-accessible)
router.get('/:id/profile', optionalAuth, usersController.getUserProfile);

module.exports = router;

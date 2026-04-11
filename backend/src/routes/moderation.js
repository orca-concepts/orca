const express = require('express');
const router = express.Router();
const moderationController = require('../controllers/moderationController');
const authenticateToken = require('../middleware/auth');
const { flagLimiter } = require('../utils/userRateLimiter');

// All moderation routes require authentication
// Phase 49b: flag endpoint is per-user rate limited (20/hr) — it's weaponizable
// for coordinated hiding (10 flags hides an edge).
router.post('/flag', authenticateToken, flagLimiter, moderationController.flagEdge);
router.post('/unflag', authenticateToken, moderationController.unflagEdge);
router.get('/hidden/:parentId', authenticateToken, moderationController.getHiddenChildren);
router.post('/vote', authenticateToken, moderationController.voteOnHidden);
router.post('/vote/remove', authenticateToken, moderationController.removeVoteOnHidden);
router.post('/comment', authenticateToken, moderationController.addComment);
router.get('/comments/:edgeId', authenticateToken, moderationController.getComments);
router.post('/unhide', authenticateToken, moderationController.unhideEdge);

module.exports = router;

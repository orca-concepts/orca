const express = require('express');
const router = express.Router();
const moderationController = require('../controllers/moderationController');
const authenticateToken = require('../middleware/auth');

// All moderation routes require authentication
router.post('/flag', authenticateToken, moderationController.flagEdge);
router.post('/unflag', authenticateToken, moderationController.unflagEdge);
router.get('/hidden/:parentId', authenticateToken, moderationController.getHiddenChildren);
router.post('/vote', authenticateToken, moderationController.voteOnHidden);
router.post('/vote/remove', authenticateToken, moderationController.removeVoteOnHidden);
router.post('/comment', authenticateToken, moderationController.addComment);
router.get('/comments/:edgeId', authenticateToken, moderationController.getComments);
router.post('/unhide', authenticateToken, moderationController.unhideEdge);

module.exports = router;

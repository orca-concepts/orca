const express = require('express');
const router = express.Router();
const pagesController = require('../controllers/pagesController');
const authenticateToken = require('../middleware/auth');
const { optionalAuth } = require('../middleware/auth');
const { pageCommentLimiter } = require('../utils/userRateLimiter');

// Get comments for an informational page (guests can view)
router.get('/:slug/comments', optionalAuth, pagesController.getPageComments);

// Add a comment to an informational page (auth required)
// Phase 49b: per-user rate limited — public-facing comment stream is a spam target.
router.post('/:slug/comments', authenticateToken, pageCommentLimiter, pagesController.addPageComment);

// Toggle vote on a page comment (auth required)
router.post('/comments/:commentId/vote', authenticateToken, pagesController.togglePageCommentVote);

module.exports = router;

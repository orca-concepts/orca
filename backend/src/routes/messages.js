const express = require('express');
const router = express.Router();
const messagesController = require('../controllers/messagesController');
const authenticateToken = require('../middleware/auth');

// All messaging endpoints require authentication

// Create a new thread with first message
router.post('/threads/create', authenticateToken, messagesController.createThread);

// Get all threads for the current user (grouped by document → annotation)
router.get('/threads', authenticateToken, messagesController.getThreads);

// Get unread count (before :threadId to avoid route conflict)
router.get('/unread-count', authenticateToken, messagesController.getUnreadCount);

// Get annotation thread status (before :threadId to avoid route conflict)
router.get('/annotations/:annotationId/status', authenticateToken, messagesController.getAnnotationStatus);

// Get a single thread with all messages
router.get('/threads/:threadId', authenticateToken, messagesController.getThread);

// Reply to an existing thread
router.post('/threads/:threadId/reply', authenticateToken, messagesController.replyToThread);

// Get paginated messages for a thread
router.get('/threads/:threadId/messages', authenticateToken, messagesController.getMessages);

module.exports = router;

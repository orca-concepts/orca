const express = require('express');
const router = express.Router();
const corpusController = require('../controllers/corpusController');
const authenticateToken = require('../middleware/auth');

// Phase 38j: Resolve a citation URL to corpus/document for navigation
router.get('/resolve/:annotationId', authenticateToken, corpusController.resolveCitation);

module.exports = router;

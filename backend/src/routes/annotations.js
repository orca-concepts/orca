const express = require('express');
const router = express.Router();
const corpusController = require('../controllers/corpusController');
const authenticateToken = require('../middleware/auth');
const optionalAuth = authenticateToken.optionalAuth;

// Phase 50a: Reverse citation lookup — which documents cite this annotation (guest OK)
router.get('/:id/cited-by', optionalAuth, corpusController.getAnnotationCitedBy);

module.exports = router;

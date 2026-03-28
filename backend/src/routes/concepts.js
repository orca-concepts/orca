const express = require('express');
const router = express.Router();
const conceptsController = require('../controllers/conceptsController');
const authenticateToken = require('../middleware/auth');
const { optionalAuth } = require('../middleware/auth');

// GET routes use optionalAuth — guests can browse read-only
// POST routes use authenticateToken — must be logged in to create

// Get root concepts
router.get('/root', optionalAuth, conceptsController.getRootConcepts);

// Get available attributes
router.get('/attributes', optionalAuth, conceptsController.getAttributes);

// Search concepts - must come before /:id route
router.get('/search', optionalAuth, conceptsController.searchConcepts);

// Get concept names by IDs
router.get('/names/batch', optionalAuth, conceptsController.getConceptNames);

// Get concept parents (flip view) - must come before /:id route
router.get('/:id/parents', optionalAuth, conceptsController.getConceptParents);

// Phase 27b: Get all annotations for a concept across all contexts
router.get('/:id/annotations', optionalAuth, conceptsController.getAnnotationsForConcept);

// Get vote sets for a concept's children - must come before /:id route
router.get('/:id/votesets', optionalAuth, conceptsController.getVoteSets);

// Get concept with children
router.get('/:id', optionalAuth, conceptsController.getConceptWithChildren);

// Find concept names in text (Phase 7i — live concept linking)
router.post('/find-in-text', optionalAuth, conceptsController.findConceptsInText);

// Phase 14a: Batch children for diff modal (guest-accessible)
router.post('/batch-children-for-diff', optionalAuth, conceptsController.getBatchChildrenForDiff);

// Get cached concept links for a finalized document (Phase 7i-5)
router.get('/document-links/:documentId', optionalAuth, conceptsController.getDocumentConceptLinks);

// Create root concept (requires login)
router.post('/root', authenticateToken, conceptsController.createRootConcept);

// Create child concept (requires login)
router.post('/child', authenticateToken, conceptsController.createChildConcept);

module.exports = router;

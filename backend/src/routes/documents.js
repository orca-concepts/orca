const express = require('express');
const router = express.Router();
const corpusController = require('../controllers/corpusController');
const authenticateToken = require('../middleware/auth');
const optionalAuth = authenticateToken.optionalAuth;

// ---- Phase 17a: Document Tag endpoints ----
// These must come BEFORE /:id to avoid 'tags' being treated as :id

// List all tags with usage counts (guest OK)
router.get('/tags', optionalAuth, corpusController.listDocumentTags);

// Create a new tag (auth required)
router.post('/tags/create', authenticateToken, corpusController.createDocumentTag);

// Assign a tag to a document (auth required)
router.post('/tags/assign', authenticateToken, corpusController.assignDocumentTag);

// Remove a tag from a document (auth required)
router.post('/tags/remove', authenticateToken, corpusController.removeDocumentTag);

// ---- Parameterized paths ----

// Get tags for a specific document (guest OK)
router.get('/:id/tags', optionalAuth, corpusController.getDocumentTags);

// Phase 21c: Get version chain for a document — lightweight, no body text (guest OK)
router.get('/:id/version-chain', optionalAuth, corpusController.getVersionChain);

// Phase 31d: Get annotation fingerprints across all versions in a document's lineage (guest OK)
router.get('/:id/version-annotation-map', optionalAuth, corpusController.getVersionAnnotationMap);

// Phase 35a: Delete a single document version (auth required, uploader only)
router.post('/:id/delete', authenticateToken, corpusController.deleteDocument);

// Phase 38j: Get citations for a document (guest OK)
router.get('/:id/citations', optionalAuth, corpusController.getDocumentCitations);

// Get a single document with full body text + corpus list (guest OK)
// NOTE: This was previously a standalone route in server.js — moved here for organization
router.get('/:id', optionalAuth, corpusController.getDocument);

module.exports = router;

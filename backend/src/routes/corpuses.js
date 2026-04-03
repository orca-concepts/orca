const express = require('express');
const router = express.Router();
const multer = require('multer');
const corpusController = require('../controllers/corpusController');
const authenticateToken = require('../middleware/auth');
const optionalAuth = authenticateToken.optionalAuth;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
});

// ---- Specific paths FIRST (before /:id) ----

// List current user's own corpuses (auth required)
router.get('/mine', authenticateToken, corpusController.listMyCorpuses);

// Create a new corpus (auth required)
router.post('/create', authenticateToken, corpusController.createCorpus);

// Check for duplicate documents before uploading (Phase 7b — auth required)
// Accepts either JSON { body } or multipart file upload (for PDF/DOCX server-side text extraction)
router.post('/check-duplicates', authenticateToken, upload.single('file'), corpusController.checkDuplicates);

// Search documents by title (Phase 7e — for "Add existing document" UI, auth required)
router.get('/documents/search', authenticateToken, corpusController.searchDocuments);

// Get current user's subscriptions (Phase 7c — auth required)
router.get('/subscriptions', authenticateToken, corpusController.getMySubscriptions);

// Subscribe to a corpus (Phase 7c — auth required)
router.post('/subscribe', authenticateToken, corpusController.subscribe);

// Unsubscribe from a corpus (Phase 7c — auth required)
router.post('/unsubscribe', authenticateToken, corpusController.unsubscribe);

// ---- Annotation endpoints with specific paths (Phase 7d) ----
// These must come BEFORE /:id to avoid 'annotations' being treated as :id

// Create an annotation (auth required — permission checked server-side based on corpus mode)
router.post('/annotations/create', authenticateToken, corpusController.createAnnotation);

// Delete an annotation (auth required — permission checked server-side)
router.post('/annotations/delete', authenticateToken, corpusController.deleteAnnotation);

// Vote on an annotation (Phase 7f — auth required)
router.post('/annotations/vote', authenticateToken, corpusController.voteOnAnnotation);

// Remove vote from an annotation (Phase 7f — auth required)
router.post('/annotations/unvote', authenticateToken, corpusController.unvoteAnnotation);

// Phase 26c-2: Color set voting retired — endpoints return 410 Gone
router.post('/annotations/color-set/vote', authenticateToken, (req, res) => res.status(410).json({ error: 'Color set voting has been removed' }));
router.post('/annotations/color-set/unvote', authenticateToken, (req, res) => res.status(410).json({ error: 'Color set voting has been removed' }));
router.get('/annotations/:annotationId/color-sets', optionalAuth, (req, res) => res.status(410).json({ error: 'Color set voting has been removed' }));

// Get all annotations for an edge across all corpuses (guest OK — for External Links page)
router.get('/annotations/edge/:edgeId', optionalAuth, corpusController.getAnnotationsForEdge);

// Get ALL annotations for a document across ALL corpuses (guest OK — Phase 7e decontextualized view)
router.get('/annotations/document/:documentId', optionalAuth, corpusController.getAllDocumentAnnotations);

// ---- Phase 7g: Allowed Users & Invite Token endpoints ----

// Generate an invite token for a corpus (corpus owner only)
router.post('/invite/generate', authenticateToken, corpusController.generateInviteToken);

// Accept an invite token (any logged-in user)
router.post('/invite/accept', authenticateToken, corpusController.acceptInvite);

// Delete an invite token (corpus owner only)
router.post('/invite/delete', authenticateToken, corpusController.deleteInviteToken);

// Remove an allowed user from a corpus (corpus owner only)
router.post('/allowed-users/remove', authenticateToken, corpusController.removeAllowedUser);

// Set display name for allowed user — RETIRED (Phase 26b, returns 410)
router.post('/allowed-users/display-name', authenticateToken, corpusController.setAllowedUserDisplayName);

// Leave a corpus (self-remove from allowed users + subscription) — Phase 26b
router.post('/allowed-users/leave', authenticateToken, corpusController.leaveCorpus);

// ---- Phase 26a: Document Co-Author endpoints ----

// Accept a document invite token (any logged-in user)
router.post('/documents/invite/accept', authenticateToken, corpusController.acceptDocumentInvite);

// Generate an invite token for a document (author only)
router.post('/documents/:documentId/invite/generate', authenticateToken, corpusController.generateDocumentInviteToken);

// Get authors for a document (guest OK for count)
router.get('/documents/:documentId/authors', optionalAuth, corpusController.getDocumentAuthors);

// Remove a co-author from a document (author only)
router.post('/documents/:documentId/authors/remove', authenticateToken, corpusController.removeDocumentAuthor);

// Leave as a co-author (self-remove)
router.post('/documents/:documentId/authors/leave', authenticateToken, corpusController.leaveDocumentAuthorship);

// Phase 42b: Direct invite coauthor by userId (author only)
router.post('/documents/:documentId/invite-author', authenticateToken, corpusController.inviteAuthorToDocument);

// ---- Phase 7h: Document Versioning endpoints ----

// Document Favorites — toggle (Phase 7c Overhaul, auth required)
router.post('/documents/favorite/toggle', authenticateToken, corpusController.toggleDocumentFavorite);

// Create a new version of a document within a corpus (allowed users only) — multipart
router.post('/versions/create', authenticateToken, upload.single('file'), corpusController.createVersion);

// Get version history for a document (guest OK)
router.get('/versions/:documentId/history', optionalAuth, corpusController.getVersionHistory);

// ---- Phase 9b: Orphan Rescue endpoints ----

// Get current user's orphaned documents (auth required)
router.get('/orphaned-documents', authenticateToken, corpusController.getOrphanedDocuments);

// Rescue an orphaned document into a corpus (auth required)
router.post('/rescue-document', authenticateToken, corpusController.rescueOrphanedDocument);

// Dismiss (permanently delete) an orphaned document (auth required)
router.post('/dismiss-orphan', authenticateToken, corpusController.dismissOrphanedDocument);

// List all corpuses (guest OK)
router.get('/', optionalAuth, corpusController.listCorpuses);

// ---- Parameterized paths ----

// Get single corpus with document list (guest OK)
router.get('/:id', optionalAuth, corpusController.getCorpus);

// Update corpus (owner only)
router.post('/:id/update', authenticateToken, corpusController.updateCorpus);

// Delete corpus (owner only)
router.post('/:id/delete', authenticateToken, corpusController.deleteCorpus);

// Transfer corpus ownership (owner only) — Phase 35b
router.post('/:id/transfer-ownership', authenticateToken, corpusController.transferOwnership);

// Upload a new document into a corpus (auth required) — multipart
router.post('/:id/documents/upload', authenticateToken, upload.single('file'), corpusController.uploadDocument);

// Add an existing document to a corpus (owner only)
router.post('/:id/documents/add', authenticateToken, corpusController.addDocumentToCorpus);

// Remove a document from a corpus (owner only)
router.post('/:id/documents/remove', authenticateToken, corpusController.removeDocumentFromCorpus);

// Get annotations for a document within a corpus (guest OK)
// This /:corpusId/documents/:documentId/annotations pattern is safe here
// because it has 3 segments — won't conflict with /:id
router.get('/:corpusId/documents/:documentId/annotations', optionalAuth, corpusController.getDocumentAnnotations);

// Phase 38h: Get annotations for a specific concept on a specific document within a corpus (guest OK)
router.get('/:corpusId/documents/:documentId/annotations-for-concept/:conceptId', optionalAuth, corpusController.getAnnotationsForConceptOnDocument);

// ---- Phase 7g: Parameterized allowed user routes ----

// Phase 41d: Direct invite user to corpus by userId (corpus owner only)
router.post('/:id/invite-user', authenticateToken, corpusController.inviteUserToCorpus);

// List allowed users for a corpus (owner or allowed users only)
router.get('/:corpusId/allowed-users', authenticateToken, corpusController.listAllowedUsers);

// Get active invite tokens for a corpus (corpus owner only)
router.get('/:corpusId/invite-tokens', authenticateToken, corpusController.getInviteTokens);

// Get annotation removal log for a corpus (owner or allowed users only)
router.get('/:corpusId/removal-log', authenticateToken, corpusController.getRemovalLog);

// Check if current user is an allowed user of a corpus
router.get('/:corpusId/allowed-status', authenticateToken, corpusController.checkAllowedStatus);

// Get document favorites for a corpus (Phase 7c Overhaul, auth required)
router.get('/:corpusId/document-favorites', authenticateToken, corpusController.getDocumentFavorites);

// Multer file-size error handler — must be a 4-argument Express error middleware
// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File is too large. Maximum upload size is 10 MB.' });
  }
  next(err);
});

module.exports = router;

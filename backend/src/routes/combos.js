const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const optionalAuth = authenticateToken.optionalAuth;
const comboController = require('../controllers/comboController');

// ---- Specific paths FIRST (before /:id) ----

// List current user's owned combos (auth required)
router.get('/mine', authenticateToken, comboController.getMyCombos);

// Get current user's combo subscriptions (auth required)
router.get('/subscriptions', authenticateToken, comboController.getComboSubscriptions);

// Create a new combo (auth required)
router.post('/create', authenticateToken, comboController.createCombo);

// Subscribe to a combo (auth required)
router.post('/subscribe', authenticateToken, comboController.subscribeToCombo);

// Unsubscribe from a combo (auth required)
router.post('/unsubscribe', authenticateToken, comboController.unsubscribeFromCombo);

// List all combos (guest-accessible)
router.get('/', optionalAuth, comboController.listCombos);

// ---- Parameterized routes ----

// Get combo details (guest-accessible)
router.get('/:id', optionalAuth, comboController.getCombo);

// Get annotations for a combo (auth required)
router.get('/:id/annotations', authenticateToken, comboController.getComboAnnotations);

// Add an edge to a combo (owner only)
router.post('/:id/edges/add', authenticateToken, comboController.addEdgeToCombo);

// Remove an edge from a combo (owner only)
router.post('/:id/edges/remove', authenticateToken, comboController.removeEdgeFromCombo);

// Vote on an annotation within a combo (auth required)
router.post('/:id/annotations/vote', authenticateToken, comboController.voteComboAnnotation);

// Remove vote on an annotation within a combo (auth required)
router.post('/:id/annotations/unvote', authenticateToken, comboController.unvoteComboAnnotation);

module.exports = router;

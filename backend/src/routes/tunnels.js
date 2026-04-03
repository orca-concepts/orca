const express = require('express');
const router = express.Router();
const authenticateToken = require('../middleware/auth');
const optionalAuth = authenticateToken.optionalAuth;
const tunnelController = require('../controllers/tunnelController');

// Get tunnel links for an edge (guest-accessible)
router.get('/:edgeId', optionalAuth, tunnelController.getTunnelLinks);

// Create a tunnel link (auth required)
router.post('/create', authenticateToken, tunnelController.createTunnelLink);

// Toggle vote on a tunnel link (auth required)
router.post('/vote', authenticateToken, tunnelController.toggleTunnelVote);

module.exports = router;

const express = require('express');
const router = express.Router();
const legalController = require('../controllers/legalController');

// Public — no auth required
router.post('/infringement', legalController.submitInfringement);
router.post('/counter-notice', legalController.submitCounterNotice);

module.exports = router;

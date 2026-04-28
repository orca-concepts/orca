const express = require('express');
const router = express.Router();
const adminLegalController = require('../controllers/adminLegalController');
const authenticateToken = require('../middleware/auth');

router.post('/legal-removal', authenticateToken, adminLegalController.legalRemove);

module.exports = router;

const express = require('express');
const router = express.Router();
const adminLegalController = require('../controllers/adminLegalController');
const authenticateToken = require('../middleware/auth');

router.post('/legal-removal', authenticateToken, adminLegalController.legalRemove);
router.get('/legal/notices', authenticateToken, adminLegalController.getNotices);
router.get('/legal/counter-notices', authenticateToken, adminLegalController.getCounterNotices);
router.get('/legal/removals', authenticateToken, adminLegalController.getRemovals);
router.post('/legal/removals/:id/mark-notified', authenticateToken, adminLegalController.markNotified);
router.get('/legal/repeat-infringers', authenticateToken, adminLegalController.getRepeatInfringers);
router.post('/legal/strikes/:id/clear', authenticateToken, adminLegalController.clearStrike);

module.exports = router;

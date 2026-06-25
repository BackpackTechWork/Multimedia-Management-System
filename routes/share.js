const express = require('express');
const router = express.Router();
const shareController = require('../controllers/ShareController');
const { authGuard } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/security');

router.post('/api/create', authGuard, csrfProtection, shareController.createShare);
router.post('/api/revoke', authGuard, csrfProtection, shareController.deleteShare);

router.get('/:token', shareController.renderShare);
router.get('/:token/folders/:folderId(\\d+)', shareController.renderShare);
router.post('/:token/password', shareController.handleSharePassword);
router.get('/:token/download', shareController.downloadSharedFile);

module.exports = router;

const express = require('express');
const router = express.Router();
const multer = require('multer');
const shareController = require('../controllers/ShareController');
const { authGuard } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/security');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }
});

router.post('/api/create', authGuard, csrfProtection, shareController.createShare);
router.post('/api/revoke', authGuard, csrfProtection, shareController.deleteShare);
router.get('/api/settings', authGuard, shareController.getShareSettings);

router.get('/:token', shareController.renderShare);
router.get('/:token/folders/:folderId(\\d+)', shareController.renderShare);
router.post('/:token/password', shareController.handleSharePassword);
router.post('/:token/upload/refresh-stats', shareController.refreshSharedUploadStats);
router.post('/:token/upload', upload.single('file'), shareController.uploadSharedFile);
router.post('/:token/folders', shareController.createSharedFolder);
router.get('/:token/download', shareController.downloadSharedFile);

module.exports = router;

const express = require('express');
const router = express.Router();
const multer = require('multer');
const driveController = require('../controllers/DriveController');
const { authGuard } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/security');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

router.use(authGuard);

router.use(csrfProtection);

router.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

router.get('/', driveController.renderDashboard);
router.get('/my-drive', driveController.renderDashboard);
router.get('/recent', driveController.renderDashboard);
router.get('/starred', driveController.renderDashboard);
router.get('/trash', driveController.renderDashboard);
router.get('/folders/:folderId(\\d+)', driveController.renderDashboard);

router.post('/api/folders', driveController.createFolder);
router.post('/api/folders/rename', driveController.renameFolder);
router.post('/api/folders/move', driveController.moveFolder);
router.post('/api/folders/copy', driveController.copyFolder);

router.post('/api/files/rename', driveController.renameFile);
router.post('/api/files/move', driveController.moveFile);
router.post('/api/files/copy', driveController.copyFile);
router.get('/api/files/download/:id', driveController.downloadFile);
router.get('/api/folders/download/:id', driveController.downloadFolder);

router.get('/api/upload/status', driveController.checkChunkStatus);
router.post('/api/upload/chunk', upload.single('chunk'), driveController.uploadChunk);
router.post('/api/upload/complete', driveController.completeUpload);

router.get('/api/versions', driveController.listVersions);
router.post('/api/upload/version/complete', driveController.uploadNewVersionComplete);
router.post('/api/versions/restore', driveController.restoreVersion);
router.post('/api/versions/delete', driveController.deleteVersion);

router.post('/api/trash/move', driveController.trashItem);
router.post('/api/trash/restore', driveController.restoreItem);
router.post('/api/trash/purge', driveController.purgeItem);

router.post('/api/favorites/toggle', driveController.toggleStar);

module.exports = router;

const express = require('express');
const router = express.Router();
const previewController = require('../controllers/PreviewController');
const { authGuard } = require('../middleware/auth');

router.use(authGuard);

router.get('/image/:id', (req, res) => previewController.previewImage(req, res));
router.get('/pdf/:id', (req, res) => previewController.previewPdf(req, res));
router.get('/excel/:id', (req, res) => previewController.previewExcel(req, res));
router.get('/presentation/:id', (req, res) => previewController.previewPresentation(req, res));
router.get('/markdown/:id', (req, res) => previewController.previewMarkdown(req, res));
router.get('/code/:id', (req, res) => previewController.previewCode(req, res));
router.get('/video/:id', (req, res) => previewController.previewVideo(req, res));
router.get('/audio/:id', (req, res) => previewController.previewAudio(req, res));
router.get('/zip/:id', (req, res) => previewController.previewZip(req, res));
router.get('/zip-entry/:id', (req, res) => previewController.serveZipEntry(req, res));

router.get('/stream/:id', (req, res) => previewController.serveRawStream(req, res));

module.exports = router;

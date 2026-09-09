const express = require('express');
const router = express.Router();
const previewController = require('../controllers/PreviewController');
const { authGuard } = require('../middleware/auth');

router.use((req, res, next) => {
  // Guests with a link are authorized by checkAccess on every preview request,
  // including streams and archive entries. Keep normal previews signed in.
  if (!req.session?.userId && typeof req.query.shareToken === 'string' && req.query.shareToken) {
    return next();
  }
  return authGuard(req, res, next);
});

router.get('/image/:id', (req, res) => previewController.previewImage(req, res));
router.get('/pdf/:id', (req, res) => previewController.previewPdf(req, res));
router.get('/excel/:id', (req, res) => previewController.previewExcel(req, res));
router.get('/word/:id', (req, res) => previewController.previewWord(req, res));
router.get('/presentation/:id', (req, res) => previewController.previewPresentation(req, res));
router.get('/markdown/:id', (req, res) => previewController.previewMarkdown(req, res));
router.get('/code/:id', (req, res) => previewController.previewCode(req, res));
router.get('/design/:id', (req, res) => previewController.previewDesign(req, res));
router.get('/unsupported/:id', (req, res) => previewController.previewUnsupported(req, res));
router.get('/video/:id', (req, res) => previewController.previewVideo(req, res));
router.get('/audio/:id', (req, res) => previewController.previewAudio(req, res));
router.get('/zip/:id', (req, res) => previewController.previewZip(req, res));
router.get('/zip-entry/:id', (req, res) => previewController.serveZipEntry(req, res));

router.get('/stream/:id', (req, res) => previewController.serveRawStream(req, res));

module.exports = router;

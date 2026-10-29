const express = require('express');
const router = express.Router();
const authController = require('../controllers/AuthController');
const umsController = require('../controllers/UmsAuthController');
const ums = require('../services/UmsAuthService');
const { authGuard, guestGuard } = require('../middleware/auth');
const { authLimiter, csrfProtection } = require('../middleware/security');
const multer = require('multer');
const avatarService = require('../services/AvatarService');
const avatarUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 } }).single('avatar');

router.use(csrfProtection);

router.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  res.locals.umsEnabled = ums.isEnabled();
  next();
});

router.get('/login', guestGuard, authController.renderLogin);
router.post('/login', guestGuard, authLimiter, authController.handleLogin);
router.get('/ums/redirect', guestGuard, authLimiter, umsController.redirect);
router.get('/ums/callback', guestGuard, authLimiter, umsController.callback);

router.get('/logout', authController.handleLogout);

router.get('/devices', authGuard, authController.renderDevices);
router.post('/devices/revoke', authGuard, authController.handleRevokeDevice);
router.post('/devices/revoke-others', authGuard, authController.handleRevokeOtherDevices);

router.get('/profile', authGuard, authController.renderProfile);
router.get('/avatars/:userId(\\d+)', authGuard, (req, res) => {
  res.setHeader('Cache-Control', 'private, no-cache');
  res.sendFile(avatarService.avatarPath(req.params.userId), async err => {
    if (!err || res.headersSent) return;
    if (err.statusCode === 404 || err.code === 'ENOENT') {
      try {
        return res.type('image/svg+xml').send(await avatarService.defaultAvatar(req.params.userId));
      } catch (error) {
        console.error('Unable to generate default avatar:', error.message);
      }
    }
    res.sendStatus(500);
  });
});
// CSRF is validated from the query before accepting multipart data.
router.post('/profile/avatar', authGuard, (req, res) => {
  avatarUpload(req, res, async error => {
    try {
      if (error) throw new Error(error.code === 'LIMIT_FILE_SIZE' ? 'Profile pictures must be 5 MB or smaller.' : 'Unable to upload this picture.');
      if (!req.file) throw new Error('Choose a JPEG, PNG, or WebP image.');
      await avatarService.save(req.session.userId, req.file.buffer);
      req.session.profileSuccess = 'Profile picture updated.';
    } catch (err) {
      req.session.profileError = err.message;
    }
    res.redirect('/auth/profile');
  });
});
router.post('/profile/avatar/remove', authGuard, async (req, res) => {
  try {
    await require('fs/promises').rm(avatarService.avatarPath(req.session.userId), { force: true });
    req.session.profileSuccess = 'Profile picture removed.';
  } catch {
    req.session.profileError = 'Unable to remove your picture. Please try again.';
  }
  res.redirect('/auth/profile');
});
router.post('/profile/update', authGuard, authController.handleUpdateProfile);
router.post('/profile/change-password', authGuard, authController.handleChangePassword);

module.exports = router;

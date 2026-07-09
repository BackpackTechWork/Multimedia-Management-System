const express = require('express');
const router = express.Router();
const authController = require('../controllers/AuthController');
const { authGuard, guestGuard } = require('../middleware/auth');
const { authLimiter, csrfProtection } = require('../middleware/security');

router.use(csrfProtection);

router.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

router.get('/login', guestGuard, authController.renderLogin);
router.post('/login', guestGuard, authLimiter, authController.handleLogin);

router.get('/logout', authController.handleLogout);

router.get('/devices', authGuard, authController.renderDevices);
router.post('/devices/revoke', authGuard, authController.handleRevokeDevice);
router.post('/devices/revoke-others', authGuard, authController.handleRevokeOtherDevices);

router.get('/profile', authGuard, authController.renderProfile);
router.post('/profile/update', authGuard, authController.handleUpdateProfile);
router.post('/profile/change-password', authGuard, authController.handleChangePassword);

module.exports = router;

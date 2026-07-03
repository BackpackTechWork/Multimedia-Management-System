const express = require('express');
const router = express.Router();
const adminController = require('../controllers/AdminController');
const { authGuard, superAdminGuard } = require('../middleware/auth');
const { csrfProtection } = require('../middleware/security');

router.use(authGuard);
router.use(superAdminGuard);
router.use(csrfProtection);

router.use((req, res, next) => {
  res.locals.csrfToken = req.csrfToken();
  next();
});

router.get('/users', adminController.renderUsers);
router.get('/users/new', adminController.renderNewUser);
router.post('/users', adminController.createUser);
router.get('/users/:id(\\d+)/edit', adminController.renderEditUser);
router.post('/users/:id(\\d+)/edit', adminController.updateUser);
router.post('/users/delete', adminController.deleteUser);

module.exports = router;

const sessionRepository = require('../repositories/SessionRepository');
const userRepository = require('../repositories/UserRepository');

async function authGuard(req, res, next) {
  if (!req.session || !req.session.userId) {
    if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
      return res.status(401).json({ error: 'Unauthorized. Please login.' });
    }
    return res.redirect('/auth/login');
  }

  const now = new Date();
  const maxAge = 7 * 24 * 60 * 60 * 1000;
  const expiresAt = new Date(now.getTime() + maxAge);

  try {
    const user = await userRepository.findById(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
        return res.status(401).json({ error: 'Unauthorized. Please login.' });
      }
      return res.redirect('/auth/login');
    }

    req.session.userName = user.name;
    req.session.userEmail = user.email;
    req.session.userRole = user.role || 'user';

    const sessionData = JSON.stringify(req.session);
    await sessionRepository.createOrUpdateSession(
      req.sessionID,
      req.session.userId,
      req.ip,
      req.headers['user-agent'],
      sessionData,
      now,
      expiresAt
    );
  } catch (err) {
    console.error('Failed to extend database session:', err.message);
  }

  res.locals.userId = req.session.userId;
  res.locals.userName = req.session.userName;
  res.locals.userEmail = req.session.userEmail;
  res.locals.userRole = req.session.userRole || 'user';
  res.locals.isSuperAdmin = req.session.userRole === 'super_admin';

  next();
}

function superAdminGuard(req, res, next) {
  if (req.session?.userRole === 'super_admin') return next();

  if (req.xhr || (req.headers.accept && req.headers.accept.indexOf('json') > -1)) {
    return res.status(403).json({ error: 'Super admin access required.' });
  }
  return res.status(403).send('Super admin access required.');
}

function guestGuard(req, res, next) {
  if (req.session && req.session.userId) {
    return res.redirect('/');
  }
  next();
}

module.exports = {
  authGuard,
  guestGuard,
  superAdminGuard
};

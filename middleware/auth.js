const sessionRepository = require('../repositories/SessionRepository');

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

  next();
}

function guestGuard(req, res, next) {
  if (req.session && req.session.userId) {
    return res.redirect('/');
  }
  next();
}

module.exports = {
  authGuard,
  guestGuard
};

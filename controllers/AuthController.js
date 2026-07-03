const authService = require('../services/AuthService');
const sessionRepository = require('../repositories/SessionRepository');

function getSafeReturnTo(value) {
  if (!value || typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

class AuthController {
  renderLogin(req, res) {
    res.render('auth/login', {
      error: null,
      success: null,
      returnTo: getSafeReturnTo(req.query.returnTo)
    });
  }

  async handleLogin(req, res) {
    const { email, password, rememberMe } = req.body;
    const returnTo = getSafeReturnTo(req.body.returnTo);

    if (!email || !password) {
      return res.render('auth/login', { error: 'Email and password are required', success: null, returnTo });
    }

    try {
      const user = await authService.login(email, password);
      
      req.session.regenerate(async (err) => {
        if (err) {
          return res.render('auth/login', { error: 'Session regeneration failed', success: null, returnTo });
        }

        req.session.userId = user.id;
        req.session.userName = user.name;
        req.session.userEmail = user.email;
        req.session.userRole = user.role || 'user';

        if (rememberMe) {
          req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
        } else {
          req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + req.session.cookie.maxAge);
        const sessionData = JSON.stringify(req.session);
        await sessionRepository.createOrUpdateSession(
          req.sessionID,
          user.id,
          req.ip,
          req.headers['user-agent'],
          sessionData,
          now,
          expiresAt
        );

        res.redirect(returnTo || '/');
      });
    } catch (err) {
      res.render('auth/login', { error: err.message, success: null, returnTo });
    }
  }

  async handleLogout(req, res) {
    const sessionId = req.sessionID;
    
    try {
      await sessionRepository.destroySession(sessionId);
    } catch (err) {
      console.error('Failed to destroy session from DB during logout:', err.message);
    }

    req.session.destroy((err) => {
      if (err) {
        console.error('Failed to destroy express session:', err);
      }
      res.redirect('/auth/login');
    });
  }

  async renderDevices(req, res) {
    try {
      const activeSessions = await sessionRepository.findUserSessions(req.session.userId);
      res.render('dashboard/devices', {
        sessions: activeSessions,
        currentSessionId: req.sessionID,
        error: null,
        success: null
      });
    } catch (err) {
      res.redirect('/');
    }
  }

  async handleRevokeDevice(req, res) {
    const { id } = req.body;
    try {
      await sessionRepository.destroySessionById(parseInt(id), req.session.userId);
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async handleRevokeOtherDevices(req, res) {
    try {
      await sessionRepository.destroyOtherUserSessions(req.session.userId, req.sessionID);
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new AuthController();

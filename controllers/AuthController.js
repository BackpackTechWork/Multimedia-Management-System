const authService = require('../services/AuthService');
const sessionRepository = require('../repositories/SessionRepository');
const userRepository = require('../repositories/UserRepository');
const bcrypt = require('bcrypt');

function getSafeReturnTo(value) {
  if (!value || typeof value !== 'string') return null;
  if (!value.startsWith('/') || value.startsWith('//')) return null;
  return value;
}

function isMobileUserAgent(userAgent) {
  if (!userAgent) return false;
  return userAgent.includes('Mobi') || userAgent.includes('Android') || userAgent.includes('iPhone');
}

function matchesDeviceType(session, type, currentSessionId) {
  if (!type || type === 'all') return true;
  if (type === 'current') return session.sessionId === currentSessionId;
  if (type === 'mobile') return isMobileUserAgent(session.userAgent);
  if (type === 'desktop') return !isMobileUserAgent(session.userAgent);
  return true;
}

function matchesDeviceActivity(session, activity) {
  if (!activity || activity === 'all') return true;

  const lastActive = session.lastActivityAt ? new Date(session.lastActivityAt) : null;
  if (!lastActive || Number.isNaN(lastActive.getTime())) return false;

  const now = new Date();
  const ageMs = now.getTime() - lastActive.getTime();
  const dayMs = 24 * 60 * 60 * 1000;

  if (activity === 'today') return lastActive.toDateString() === now.toDateString();
  if (activity === 'week') return ageMs <= 7 * dayMs;
  if (activity === 'month') return ageMs <= 30 * dayMs;
  return true;
}

function matchesDeviceSearch(session, searchQuery) {
  if (!searchQuery) return true;
  const query = String(searchQuery).trim().toLowerCase();
  if (!query) return true;

  const haystack = [
    session.userAgent || '',
    session.ipAddress || ''
  ].join(' ').toLowerCase();

  return haystack.includes(query);
}

class AuthController {
  renderLogin(req, res) {
    res.render('auth/login', {
      error: null,
      success: null,
      email: '',
      returnTo: getSafeReturnTo(req.query.returnTo)
    });
  }

  async handleLogin(req, res) {
    const { email, password, rememberMe } = req.body;
    const returnTo = getSafeReturnTo(req.body.returnTo);
    const submittedEmail = typeof email === 'string' ? email.trim() : '';

    if (!submittedEmail || !password) {
      return res.render('auth/login', {
        error: 'Email and password are required',
        success: null,
        email: submittedEmail,
        returnTo
      });
    }

    try {
      const user = await authService.login(submittedEmail, password);
      
      req.session.regenerate(async (err) => {
        if (err) {
          return res.render('auth/login', {
            error: 'Session regeneration failed',
            success: null,
            email: submittedEmail,
            returnTo
          });
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
      res.render('auth/login', {
        error: err.message,
        success: null,
        email: submittedEmail,
        returnTo
      });
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
      const searchQuery = typeof req.query.search === 'string' ? req.query.search.trim() : '';
      const typeFilter = req.query.type || 'all';
      const activityFilter = req.query.activity || 'all';
      const currentSessionId = req.sessionID;
      const activeSessions = await sessionRepository.findUserSessions(req.session.userId);

      const filteredSessions = activeSessions
        .filter(session => matchesDeviceType(session, typeFilter, currentSessionId))
        .filter(session => matchesDeviceActivity(session, activityFilter))
        .filter(session => matchesDeviceSearch(session, searchQuery));

      res.render('dashboard/devices', {
        tab: 'devices',
        sessions: filteredSessions,
        totalSessionCount: activeSessions.length,
        currentSessionId,
        searchQuery,
        typeFilter,
        activityFilter,
        error: null,
        success: null
      });
    } catch (err) {
      console.error('Failed to render devices:', err);
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

  async renderProfile(req, res) {
    try {
      const user = await userRepository.findById(req.session.userId);
      if (!user) {
        return res.redirect('/auth/login');
      }

      const success = req.session.profileSuccess || null;
      const error = req.session.profileError || null;
      delete req.session.profileSuccess;
      delete req.session.profileError;

      res.render('dashboard/profile', {
        tab: 'profile',
        user,
        success,
        error
      });
    } catch (err) {
      res.redirect('/');
    }
  }

  async handleUpdateProfile(req, res) {
    const { name } = req.body;
    try {
      if (!name || name.trim() === '') {
        throw new Error('Name cannot be empty.');
      }

      const user = await userRepository.findById(req.session.userId);
      if (!user) {
        throw new Error('User not found.');
      }

      await userRepository.updateUser(req.session.userId, {
        name: name.trim(),
        email: user.email,
        role: user.role
      });

      req.session.userName = name.trim();
      req.session.profileSuccess = 'Profile information updated successfully.';
      res.redirect('/auth/profile');
    } catch (err) {
      req.session.profileError = err.message;
      res.redirect('/auth/profile');
    }
  }

  async handleChangePassword(req, res) {
    const { currentPassword, newPassword, confirmNewPassword } = req.body;
    try {
      if (!currentPassword || !newPassword || !confirmNewPassword) {
        throw new Error('All fields are required.');
      }

      if (newPassword.length < 8) {
        throw new Error('New password must be at least 8 characters long.');
      }

      if (newPassword !== confirmNewPassword) {
        throw new Error('New passwords do not match.');
      }

      const user = await userRepository.findById(req.session.userId);
      if (!user) {
        throw new Error('User not found.');
      }

      const isMatch = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!isMatch) {
        throw new Error('Incorrect current password.');
      }

      const saltRounds = 10;
      const newPasswordHash = await bcrypt.hash(newPassword, saltRounds);

      await userRepository.updateUser(req.session.userId, {
        name: user.name,
        email: user.email,
        role: user.role,
        passwordHash: newPasswordHash
      });

      req.session.profileSuccess = 'Password changed successfully.';
      res.redirect('/auth/profile');
    } catch (err) {
      req.session.profileError = err.message;
      res.redirect('/auth/profile');
    }
  }
}

module.exports = new AuthController();

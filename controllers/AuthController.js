const authService = require('../services/AuthService');
const sessionRepository = require('../repositories/SessionRepository');
const userRepository = require('../repositories/UserRepository');
const bcrypt = require('bcrypt');

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

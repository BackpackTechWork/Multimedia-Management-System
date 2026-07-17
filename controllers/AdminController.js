const authService = require('../services/AuthService');
const userRepository = require('../repositories/UserRepository');
const folderRepository = require('../repositories/FolderRepository');
const { db } = require('../config/db');
const { folders, files, userStorageStats } = require('../models/schema');
const { eq, sql } = require('drizzle-orm');
const bcrypt = require('bcrypt');

class AdminController {
  constructor() {
    [
      'renderUsers',
      'renderNewUser',
      'createUser',
      'renderEditUser',
      'updateUser',
      'deleteUser'
    ].forEach(method => {
      this[method] = this[method].bind(this);
    });
  }

  async viewData(req, overrides = {}) {
    const userId = req.session.userId;
    const includeAll = req.session.userRole === 'super_admin';
    const statsPromise = includeAll
      ? Promise.all([
          db.select({
            totalFiles: sql`COUNT(${files.id})`,
            totalSize: sql`COALESCE(SUM(${files.size}), 0)`
          }).from(files),
          db.select({
            totalFolders: sql`COUNT(${folders.id})`
          }).from(folders)
        ]).then(([fileStats, folderStats]) => ({
          totalFiles: Number(fileStats[0]?.totalFiles) || 0,
          totalSize: Number(fileStats[0]?.totalSize) || 0,
          totalFolders: Number(folderStats[0]?.totalFolders) || 0
        }))
      : db.select().from(userStorageStats).where(eq(userStorageStats.userId, userId)).limit(1)
          .then(rows => rows[0] || { totalSize: 0, totalFolders: 0, totalFiles: 0 });

    const [storageStats, userRootFolders] = await Promise.all([
      statsPromise,
      folderRepository.findUserRootFolders(userId, includeAll)
    ]);

    return {
      tab: 'admin',
      users: [],
      error: null,
      success: null,
      form: {},
      user: null,
      storageStats,
      userRootFolders: userRootFolders.map(row => row.folders),
      ...overrides
    };
  }

  async renderUsers(req, res) {
    try {
      const users = await userRepository.listUsers();
      const success = req.session.adminFlash || null;
      delete req.session.adminFlash;
      res.render('admin/users', await this.viewData(req, { users, success }));
    } catch (err) {
      res.status(500).send('Failed to load users');
    }
  }

  async renderNewUser(req, res) {
    res.render('admin/new', await this.viewData(req, {
      form: {
        name: '',
        email: '',
        role: 'user'
      }
    }));
  }

  async createUser(req, res) {
    const { name, email, password, role } = req.body;
    const normalizedRole = role === 'super_admin' ? 'super_admin' : 'user';

    try {
      if (!name || !email || !password) {
        throw new Error('Name, email, and password are required');
      }

      await authService.register(name, email, password, normalizedRole);
      req.session.adminFlash = 'Account created.';
      res.redirect('/admin/users');
    } catch (err) {
      res.status(400).render('admin/new', await this.viewData(req, {
        error: err.message,
        form: { name, email, role: normalizedRole }
      }));
    }
  }

  async renderEditUser(req, res) {
    try {
      const user = await userRepository.findById(parseInt(req.params.id, 10));
      if (!user) {
        return res.status(404).send('User not found');
      }

      res.render('admin/edit', await this.viewData(req, { user }));
    } catch (err) {
      res.status(500).send('Failed to load user');
    }
  }

  async updateUser(req, res) {
    const userId = parseInt(req.params.id, 10);
    const { name, email, password, role } = req.body;
    const normalizedRole = role === 'super_admin' ? 'super_admin' : 'user';

    try {
      if (!Number.isInteger(userId)) {
        throw new Error('Invalid user id');
      }

      if (!name || !email) {
        throw new Error('Name and email are required');
      }

      const user = await userRepository.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      const existingEmailUser = await userRepository.findByEmail(email);
      if (existingEmailUser && existingEmailUser.id !== userId) {
        throw new Error('Email is already registered');
      }

      const passwordHash = password && password.trim() !== ''
        ? await bcrypt.hash(password, 10)
        : null;

      await userRepository.updateUser(userId, {
        name,
        email,
        role: normalizedRole,
        passwordHash
      });

      if (userId === req.session.userId) {
        req.session.userName = name;
        req.session.userEmail = email;
        req.session.userRole = normalizedRole;
      }

      req.session.adminFlash = 'Account updated.';
      res.redirect('/admin/users');
    } catch (err) {
      res.status(400).render('admin/edit', await this.viewData(req, {
        error: err.message,
        user: {
          id: userId,
          name,
          email,
          role: normalizedRole,
          createdAt: new Date()
        }
      }));
    }
  }

  async deleteUser(req, res) {
    const userId = parseInt(req.body.userId, 10);

    try {
      if (!Number.isInteger(userId)) {
        throw new Error('Invalid user id');
      }

      if (userId === req.session.userId) {
        throw new Error('You cannot delete your own account while signed in');
      }

      const user = await userRepository.findById(userId);
      if (!user) {
        throw new Error('User not found');
      }

      await userRepository.deleteUser(userId);
      req.session.adminFlash = 'Account deleted.';
      res.redirect('/admin/users');
    } catch (err) {
      const users = await userRepository.listUsers();
      res.status(400).render('admin/users', await this.viewData(req, { users, error: err.message }));
    }
  }
}

module.exports = new AdminController();

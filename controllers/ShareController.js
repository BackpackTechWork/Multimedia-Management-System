const crypto = require('crypto');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');
const { db } = require('../config/db');
const { shares, files, folders } = require('../models/schema');
const { eq, inArray } = require('drizzle-orm');
const shareRepository = require('../repositories/ShareRepository');
const fileRepository = require('../repositories/FileRepository');
const folderRepository = require('../repositories/FolderRepository');
const storageService = require('../services/StorageService');
const driveService = require('../services/DriveService');
const jobRepository = require('../repositories/JobRepository');
const fileChecksumService = require('../services/FileChecksumService');

function handleFileStreamError(res, err) {
  if (res.headersSent) {
    res.destroy(err);
    return;
  }

  if (['UNKNOWN', 'ENOENT', 'EBUSY', 'EPERM', 'EACCES'].includes(err?.code)) {
    return res.status(503).send('File is not available locally yet. Please try again after Synology Drive finishes syncing it.');
  }

  console.error(err);
  return res.status(500).send('Download failed');
}

async function fileExists(fullPath) {
  try {
    await fs.promises.access(fullPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

class ShareController {
  constructor() {
    [
      'createShare',
      'getShareSettings',
      'deleteShare',
      'renderShare',
      'handleSharePassword',
      'uploadSharedFile',
      'refreshSharedUploadStats',
      'downloadSharedFile',
      'createSharedFolder'
    ].forEach(method => {
      this[method] = this[method].bind(this);
    });
  }

  canManage(req, item) {
    return item && (req.session.userRole === 'super_admin' || item.userId === req.session.userId);
  }

  async getManagedItem(req, fileId, folderId) {
    if (fileId) {
      const file = await fileRepository.findById(parseInt(fileId));
      if (!this.canManage(req, file)) return null;
      return { type: 'file', item: file };
    }

    if (folderId) {
      const folder = await folderRepository.findById(parseInt(folderId));
      if (!this.canManage(req, folder)) return null;
      return { type: 'folder', item: folder };
    }

    return null;
  }

  async findShareForItem(fileId, folderId) {
    if (fileId) return await shareRepository.findShareByFileId(parseInt(fileId));
    if (folderId) return await shareRepository.findShareByFolderId(parseInt(folderId));
    return null;
  }

  async createShare(req, res) {
    const { fileId, folderId, password, removePassword, expiresAt, allowDownload, recipientEmails, recipientUserIds, linkAccess, linkRole } = req.body;
    const userId = req.session.userId;

    try {
      const managedItem = await this.getManagedItem(req, fileId, folderId);
      if (!managedItem) {
        return res.status(400).json({ error: 'Missing fileId or folderId parameter' });
      }

      const userIds = this.parseRecipientUserIds(recipientUserIds).filter(id => id !== Number(userId));
      const emails = this.parseRecipientEmails(recipientEmails);
      const [recipientsById, recipientsByEmail] = await Promise.all([
        shareRepository.findUsersByIds(userIds),
        shareRepository.findUsersByEmails(emails)
      ]);
      const recipientMap = new Map();
      [...recipientsById, ...recipientsByEmail].forEach(user => {
        if (user.id !== Number(userId)) recipientMap.set(user.id, user);
      });
      const recipients = Array.from(recipientMap.values());
      const foundIds = new Set(recipientsById.map(user => Number(user.id)));
      const missingIds = userIds.filter(id => !foundIds.has(id));
      const foundEmails = new Set(recipients.map(user => user.email.toLowerCase()));
      const missingEmails = emails.filter(email => !foundEmails.has(email.toLowerCase()));

      if (missingIds.length > 0) {
        return res.status(400).json({ error: 'One or more selected accounts no longer exist.' });
      }

      if (missingEmails.length > 0) {
        return res.status(400).json({ error: `No account found for: ${missingEmails.join(', ')}` });
      }

      const existingShare = await this.findShareForItem(fileId, folderId);
      let passwordHash = null;
      if (removePassword === 'true' || removePassword === true) {
        passwordHash = null;
      } else if (password && password.trim() !== '') {
        passwordHash = await bcrypt.hash(password, 10);
      } else if (existingShare) {
        passwordHash = undefined;
      }

      const parsedExpiry = expiresAt ? new Date(expiresAt) : null;
      const downloadAllowed = allowDownload === 'true' || allowDownload === true;
      const normalizedLinkAccess = linkAccess === 'anyone' ? 'anyone' : 'restricted';
      const normalizedLinkRole = linkRole === 'editor' ? 'editor' : 'viewer';

      let token;
      let shareId;
      if (existingShare) {
        token = existingShare.token;
        shareId = existingShare.id;
        await shareRepository.updateShare(shareId, {
          passwordHash,
          expiresAt: parsedExpiry,
          allowDownload: downloadAllowed,
          linkAccess: normalizedLinkAccess,
          linkRole: normalizedLinkRole
        });
      } else {
        token = crypto.randomBytes(12).toString('hex');
        shareId = await shareRepository.createShare(
          token,
          userId,
          fileId ? parseInt(fileId) : null,
          folderId ? parseInt(folderId) : null,
          passwordHash,
          parsedExpiry,
          downloadAllowed,
          normalizedLinkAccess,
          normalizedLinkRole
        );
      }

      await shareRepository.deleteOtherSharesForItem(
        fileId ? parseInt(fileId) : null,
        folderId ? parseInt(folderId) : null,
        shareId
      );
      await shareRepository.replaceRecipients(shareId, recipients.map(user => user.id));

      res.status(200).json({ success: true, token, recipients });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  parseRecipientEmails(value) {
    if (!value) return [];
    const rawItems = Array.isArray(value) ? value : String(value).split(/[\s,;]+/);
    return [...new Set(rawItems.map(item => item.trim().toLowerCase()).filter(Boolean))];
  }

  parseRecipientUserIds(value) {
    if (!value) return [];
    const rawItems = Array.isArray(value) ? value : String(value).split(/[\s,;]+/);
    return [...new Set(rawItems.map(item => Number(item)).filter(Number.isInteger))];
  }

  async getShareSettings(req, res) {
    const { fileId, folderId } = req.query;

    try {
      const managedItem = await this.getManagedItem(req, fileId, folderId);
      if (!managedItem) {
        return res.status(400).json({ error: 'Missing fileId or folderId parameter' });
      }

      const share = await this.findShareForItem(fileId, folderId);
      if (!share) {
        return res.status(200).json({ exists: false });
      }

      const recipients = await shareRepository.findShareRecipients(share.id);
      res.status(200).json({
        exists: true,
        token: share.token,
        allowDownload: share.allowDownload,
        expiresAt: share.expiresAt,
        hasPassword: Boolean(share.passwordHash),
        linkAccess: share.linkAccess || 'anyone',
        linkRole: share.linkRole || 'viewer',
        recipients
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async canOpenShare(req, share) {
    if (!share) return false;
    if ((share.linkAccess || 'anyone') === 'anyone') return true;

    const userId = req.session?.userId;
    if (!userId) return false;
    if (req.session.userRole === 'super_admin') return true;
    if (Number(share.createdById) === Number(userId)) return true;

    return await shareRepository.userCanAccessShare(userId, share.id);
  }

  renderRestrictedShare(req, res, token, message) {
    return res.status(403).render('share/restricted', {
      token,
      isSignedIn: Boolean(req.session?.userId),
      message
    });
  }

  async deleteShare(req, res) {
    const { token } = req.body;
    const userId = req.session.userId;
    try {
      const share = await shareRepository.findByToken(token);
      if (!share) {
        return res.status(404).json({ error: 'Share link not found' });
      }

      if (share.fileId) {
        const file = await fileRepository.findById(share.fileId);
        if (!this.canManage(req, file)) return res.status(403).json({ error: 'Unauthorized' });
      } else if (share.folderId) {
        const folder = await folderRepository.findById(share.folderId);
        if (!this.canManage(req, folder)) return res.status(403).json({ error: 'Unauthorized' });
      }

      await shareRepository.deleteShare(share.id);
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async renderShare(req, res) {
    const { token } = req.params;
    if (req.query.folderId) {
      return res.redirect(`/share/${token}/folders/${encodeURIComponent(req.query.folderId)}`);
    }

    const subFolderId = req.params.folderId ? parseInt(req.params.folderId, 10) : null;

    try {
      const share = await shareRepository.findByToken(token);
      if (!share) {
        return res.status(404).send('Share link not found or has been disabled.');
      }

      if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
        return res.status(410).send('This sharing link has expired.');
      }

      if (!(await this.canOpenShare(req, share))) {
        return this.renderRestrictedShare(
          req,
          res,
          token,
          'Sign in with an account this item was shared with to open this restricted link.'
        );
      }

      const isAuthorized = req.session.sharedAccess && req.session.sharedAccess[token];
      if (share.passwordHash && !isAuthorized) {
        return res.render('share/password', { token, error: null });
      }

      if (share.fileId) {
        const file = await fileRepository.findById(share.fileId);
        if (!file) return res.status(404).send('Shared file no longer exists.');

        return res.render('share/public', {
          token,
          share,
          isFolder: false,
          file,
          folder: null,
          contents: null,
          breadcrumbs: []
        });
      } else if (share.folderId) {
        const rootFolder = await folderRepository.findById(share.folderId);
        if (!rootFolder) return res.status(404).send('Shared folder no longer exists.');

        let currentFolder = rootFolder;
        if (subFolderId) {
          const queriedFolder = await folderRepository.findById(subFolderId);
          if (queriedFolder && queriedFolder.path.startsWith(rootFolder.path)) {
            currentFolder = queriedFolder;
          } else {
            return res.redirect(`/share/${token}`);
          }
        }

        const subfoldersJoin = await folderRepository.findSubfolders(rootFolder.userId, currentFolder.id);
        const subfolders = subfoldersJoin.map(r => r.folders);

        const filesJoin = await fileRepository.findFilesInFolder(rootFolder.userId, currentFolder.id);
        const filesList = filesJoin.map(r => r.files);

        let breadcrumbs = [];
        const pathIds = currentFolder.path.split('/').filter(id => id !== '');
        const rootIndex = pathIds.indexOf(String(rootFolder.id));
        const sharedSubtreeIds = pathIds.slice(rootIndex); // slice out ancestors above the shared root

        if (sharedSubtreeIds.length > 0) {
          const matchedFolders = await db.select()
            .from(folders)
            .where(inArray(folders.id, sharedSubtreeIds.map(Number)));
          breadcrumbs = sharedSubtreeIds.map(id => matchedFolders.find(f => f.id === Number(id))).filter(Boolean);
        }

        return res.render('share/public', {
          token,
          share,
          isFolder: true,
          file: null,
          folder: currentFolder,
          contents: { folders: subfolders, files: filesList },
          breadcrumbs
        });
      }
    } catch (err) {
      console.error(err);
      res.status(500).send('Internal Server Error');
    }
  }

  async handleSharePassword(req, res) {
    const { token } = req.params;
    const { password } = req.body;

    try {
      const share = await shareRepository.findByToken(token);
      if (!share) return res.status(404).send('Share link not found.');

      const isMatch = await bcrypt.compare(password || '', share.passwordHash);
      if (!isMatch) {
        return res.render('share/password', { token, error: 'Incorrect password' });
      }

      if (!req.session.sharedAccess) req.session.sharedAccess = {};
      req.session.sharedAccess[token] = true;

      res.redirect(`/share/${token}`);
    } catch (err) {
      res.status(500).send('Authentication failed');
    }
  }

  async uploadSharedFile(req, res) {
    const { token } = req.params;
    const targetFolderId = req.body.folderId ? parseInt(req.body.folderId, 10) : null;
    const deferStats = req.body.deferStats === 'true' || req.body.deferStats === true;

    try {
      const share = await shareRepository.findByToken(token);
      if (!share || !share.folderId) return res.status(404).send('Share link not found.');
      if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
        return res.status(410).send('This sharing link has expired.');
      }
      if ((share.linkRole || 'viewer') !== 'editor') {
        return res.status(403).send('This shared folder is view only.');
      }
      if (!(await this.canOpenShare(req, share))) {
        return this.renderRestrictedShare(
          req,
          res,
          token,
          'Sign in with an account this item was shared with to upload to this restricted link.'
        );
      }
      if (share.passwordHash && (!req.session.sharedAccess || !req.session.sharedAccess[token])) {
        return res.status(403).send('Enter the share password before uploading.');
      }
      if (!req.file) {
        return res.status(400).send('Choose a file to upload.');
      }

      const rootFolder = await folderRepository.findById(share.folderId);
      const targetFolder = targetFolderId ? await folderRepository.findById(targetFolderId) : rootFolder;
      if (!rootFolder || !targetFolder || !targetFolder.path.startsWith(rootFolder.path)) {
        return res.status(400).send('Invalid shared folder destination.');
      }

      const saved = await storageService.saveUploadedBuffer(rootFolder.userId, req.file.originalname, req.file.buffer);
      const mimeType = req.file.mimetype || require('mime-types').lookup(req.file.originalname) || 'application/octet-stream';
      const ext = path.extname(req.file.originalname).substring(1).toLowerCase();
      const fileId = await fileRepository.createFile(
        rootFolder.userId,
        targetFolder.id,
        saved.filename,
        req.file.originalname,
        ext,
        mimeType,
        saved.size,
        saved.path,
        saved.checksum
      );

      if (!deferStats) {
        await driveService.updateStorageStats(rootFolder.userId).catch(err => {
          console.error(`Failed to refresh storage stats after shared upload ${fileId}:`, err.message);
        });
      }
      if (mimeType.startsWith('image/')) {
        await jobRepository.createJob('thumbnail', { fileId }).catch(err => {
          console.error(`Failed to queue thumbnail for shared upload ${fileId}:`, err.message);
        });
      }

      if (req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'))) {
        return res.status(200).json({ success: true });
      }
      const destination = targetFolder.id === rootFolder.id
        ? `/share/${encodeURIComponent(token)}`
        : `/share/${encodeURIComponent(token)}/folders/${targetFolder.id}`;
      res.redirect(destination);
    } catch (err) {
      console.error(err);
      res.status(500).send('Upload failed.');
    }
  }

  async refreshSharedUploadStats(req, res) {
    const { token } = req.params;

    try {
      const share = await shareRepository.findByToken(token);
      if (!share || !share.folderId) return res.status(404).json({ error: 'Share link not found.' });
      if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
        return res.status(410).json({ error: 'This sharing link has expired.' });
      }
      if ((share.linkRole || 'viewer') !== 'editor') {
        return res.status(403).json({ error: 'This shared folder is view only.' });
      }
      if (!(await this.canOpenShare(req, share))) {
        return res.status(403).json({ error: 'Access denied.' });
      }
      if (share.passwordHash && (!req.session.sharedAccess || !req.session.sharedAccess[token])) {
        return res.status(403).json({ error: 'Enter the share password first.' });
      }

      const rootFolder = await folderRepository.findById(share.folderId);
      if (!rootFolder) return res.status(404).json({ error: 'Shared folder no longer exists.' });

      await driveService.updateStorageStats(rootFolder.userId);
      res.status(200).json({ success: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to refresh upload totals.' });
    }
  }

  async createSharedFolder(req, res) {
    const { token } = req.params;
    const { name, parentId, deferStats } = req.body;

    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    try {
      const share = await shareRepository.findByToken(token);
      if (!share || !share.folderId) return res.status(404).json({ error: 'Share link not found.' });
      if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
        return res.status(410).json({ error: 'This sharing link has expired.' });
      }
      if ((share.linkRole || 'viewer') !== 'editor') {
        return res.status(403).json({ error: 'This shared folder is view only.' });
      }
      if (!(await this.canOpenShare(req, share))) {
        return res.status(403).json({ error: 'Access denied.' });
      }
      if (share.passwordHash && (!req.session.sharedAccess || !req.session.sharedAccess[token])) {
        return res.status(403).json({ error: 'Enter the share password first.' });
      }

      const rootFolder = await folderRepository.findById(share.folderId);
      const parsedParentId = parentId ? parseInt(parentId, 10) : rootFolder.id;
      const parentFolder = await folderRepository.findById(parsedParentId);
      
      if (!rootFolder || !parentFolder || !parentFolder.path.startsWith(rootFolder.path)) {
        return res.status(400).json({ error: 'Invalid shared folder destination.' });
      }

      const folder = await folderRepository.createFolder(rootFolder.userId, parentFolder.id, name, parentFolder.path);
      if (!deferStats) {
        await driveService.updateStorageStats(rootFolder.userId).catch(() => {});
      }

      res.status(200).json({ success: true, folder });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: 'Failed to create folder.' });
    }
  }


  async downloadSharedFile(req, res) {
    const { token } = req.params;
    const { fileId } = req.query;

    try {
      const share = await shareRepository.findByToken(token);
      if (!share) return res.status(404).send('Access denied.');

      if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
        return res.status(410).send('Link expired.');
      }

      if (!(await this.canOpenShare(req, share))) {
        return this.renderRestrictedShare(
          req,
          res,
          token,
          'Sign in with an account this item was shared with to download from this restricted link.'
        );
      }

      if (share.passwordHash && (!req.session.sharedAccess || !req.session.sharedAccess[token])) {
        return res.status(403).send('Forbidden.');
      }

      if (!share.allowDownload) {
        return res.status(403).send('Download is disabled for this link.');
      }

      let targetFileId = share.fileId;
      if (share.folderId && fileId) {
        const requestedFile = await fileRepository.findById(parseInt(fileId));
        if (requestedFile && requestedFile.folderId) {
          const folder = await folderRepository.findById(requestedFile.folderId);
          const sharedRoot = await folderRepository.findById(share.folderId);
          if (folder && folder.path.startsWith(sharedRoot.path)) {
            targetFileId = requestedFile.id;
          }
        }
      }

      if (!targetFileId) {
        return res.status(400).send('Invalid file requested.');
      }

      const file = await fileRepository.findById(targetFileId);
      if (!file) return res.status(404).send('File not found.');

      const fullPath = path.join(storageService.storageRoot, file.path);
      if (!(await fileExists(fullPath))) {
        return res.status(404).send('File not found on disk.');
      }

      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalName)}"`);

      const readStream = fileChecksumService.createHashingReadStream(file, fullPath, fs);
      readStream.on('error', err => handleFileStreamError(res, err));
      readStream.pipe(res);
    } catch (err) {
      res.status(500).send('Download failed');
    }
  }
}

module.exports = new ShareController();

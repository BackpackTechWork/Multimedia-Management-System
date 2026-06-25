const crypto = require('crypto');
const bcrypt = require('bcrypt');
const { db } = require('../config/db');
const { shares, files, folders } = require('../models/schema');
const { eq, and, sql, inArray } = require('drizzle-orm');
const shareRepository = require('../repositories/ShareRepository');
const fileRepository = require('../repositories/FileRepository');
const folderRepository = require('../repositories/FolderRepository');
const storageService = require('../services/StorageService');

class ShareController {
  async createShare(req, res) {
    const { fileId, folderId, password, expiresAt, allowDownload } = req.body;
    const userId = req.session.userId;

    try {
      if (fileId) {
        const file = await fileRepository.findById(parseInt(fileId));
        if (!file || file.userId !== userId) {
          return res.status(403).json({ error: 'Unauthorized to share this file' });
        }
      } else if (folderId) {
        const folder = await folderRepository.findById(parseInt(folderId));
        if (!folder || folder.userId !== userId) {
          return res.status(403).json({ error: 'Unauthorized to share this folder' });
        }
      } else {
        return res.status(400).json({ error: 'Missing fileId or folderId parameter' });
      }

      let existingShare = null;
      if (fileId) {
        existingShare = await shareRepository.findShareByFileId(parseInt(fileId));
      } else {
        existingShare = await shareRepository.findShareByFolderId(parseInt(folderId));
      }

      if (existingShare) {
        await shareRepository.deleteShare(existingShare.id);
      }

      const token = crypto.randomBytes(12).toString('hex');
      let passwordHash = null;
      if (password && password.trim() !== '') {
        passwordHash = await bcrypt.hash(password, 10);
      }

      const parsedExpiry = expiresAt ? new Date(expiresAt) : null;
      const downloadAllowed = allowDownload === 'true' || allowDownload === true;

      await shareRepository.createShare(
        token,
        fileId ? parseInt(fileId) : null,
        folderId ? parseInt(folderId) : null,
        passwordHash,
        parsedExpiry,
        downloadAllowed
      );

      res.status(200).json({ success: true, token });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
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
        if (!file || file.userId !== userId) return res.status(403).json({ error: 'Unauthorized' });
      } else if (share.folderId) {
        const folder = await folderRepository.findById(share.folderId);
        if (!folder || folder.userId !== userId) return res.status(403).json({ error: 'Unauthorized' });
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

  async downloadSharedFile(req, res) {
    const { token } = req.params;
    const { fileId } = req.query;

    try {
      const share = await shareRepository.findByToken(token);
      if (!share) return res.status(404).send('Access denied.');

      if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
        return res.status(410).send('Link expired.');
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
      if (!fs.existsSync(fullPath)) {
        return res.status(404).send('File not found on disk.');
      }

      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(file.originalName)}"`);

      const readStream = fs.createReadStream(fullPath);
      readStream.pipe(res);
    } catch (err) {
      res.status(500).send('Download failed');
    }
  }
}

module.exports = new ShareController();

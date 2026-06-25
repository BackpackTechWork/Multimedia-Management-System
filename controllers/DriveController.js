const fs = require('fs');
const path = require('path');
const { db } = require('../config/db');
const { folders, files, fileVersions, trashItems, favorites, recentActivity, userStorageStats, shares } = require('../models/schema');
const { eq, and, sql, like, inArray, desc } = require('drizzle-orm');
const fileRepository = require('../repositories/FileRepository');
const folderRepository = require('../repositories/FolderRepository');
const sessionRepository = require('../repositories/SessionRepository');
const jobRepository = require('../repositories/JobRepository');
const storageService = require('../services/StorageService');
const driveService = require('../services/DriveService');

class DriveController {
  constructor() {
    this.renderDashboard = this.renderDashboard.bind(this);
  }

  getDashboardRouteState(req) {
    if (req.path === '/recent') return { tab: 'recent', currentFolderId: null };
    if (req.path === '/starred') return { tab: 'starred', currentFolderId: null };
    if (req.path === '/trash') return { tab: 'trash', currentFolderId: null };
    if (req.params.folderId) {
      return {
        tab: 'my-drive',
        currentFolderId: req.params.folderId ? parseInt(req.params.folderId, 10) : null
      };
    }

    return { tab: 'my-drive', currentFolderId: null };
  }

  redirectLegacyDashboardQuery(req, res) {
    if (!req.query.tab && !req.query.folderId) return false;

    const tab = req.query.tab || 'my-drive';
    let target = '/';

    if (tab === 'recent') target = '/recent';
    else if (tab === 'starred') target = '/starred';
    else if (tab === 'trash') target = '/trash';
    else if (req.query.folderId) target = `/folders/${encodeURIComponent(req.query.folderId)}`;

    const query = new URLSearchParams();
    Object.entries(req.query).forEach(([key, value]) => {
      if (key === 'tab' || key === 'folderId') return;
      if (Array.isArray(value)) {
        value.forEach(item => query.append(key, item));
      } else if (value !== undefined) {
        query.append(key, value);
      }
    });

    const queryString = query.toString();
    res.redirect(queryString ? `${target}?${queryString}` : target);
    return true;
  }

  async renderDashboard(req, res) {
    const userId = req.session.userId;
    if (this.redirectLegacyDashboardQuery(req, res)) return;

    const { tab, currentFolderId } = this.getDashboardRouteState(req);
    const searchQuery = req.query.search || '';
    const fileType = req.query.type || 'all';
    const sortBy = req.query.sortBy || 'date';
    const sortOrder = req.query.sortOrder || 'desc';

    try {
      let currentFolder = null;
      let breadcrumbs = [];
      if (currentFolderId && tab === 'my-drive') {
        currentFolder = await folderRepository.findById(currentFolderId);
        if (!currentFolder || currentFolder.userId !== userId) {
          return res.redirect('/');
        }

        const pathIds = currentFolder.path.split('/').filter(id => id !== '');
        if (pathIds.length > 0) {
          const matchedFolders = await db.select()
            .from(folders)
            .where(inArray(folders.id, pathIds.map(Number)));
          
          breadcrumbs = pathIds.map(id => matchedFolders.find(f => f.id === Number(id))).filter(Boolean);
        }
      }

      let stats = await db.select().from(userStorageStats).where(eq(userStorageStats.userId, userId)).limit(1);
      let storageStats = stats[0] || { totalSize: 0, totalFolders: 0, totalFiles: 0 };

      let itemsList = { folders: [], files: [] };

      if (searchQuery.trim() !== '') {
        const searchResults = await fileRepository.searchFiles(userId, {
          query: searchQuery,
          type: fileType,
          sortBy,
          sortOrder,
          limit: 100,
          offset: 0
        });
        
        itemsList.files = searchResults;

        itemsList.folders = await db.select()
          .from(folders)
          .leftJoin(trashItems, and(eq(trashItems.entityId, folders.id), eq(trashItems.entityType, 'folder')))
          .where(and(
            eq(folders.userId, userId),
            like(folders.name, `%${searchQuery}%`),
            sql`${trashItems.id} IS NULL`
          ))
          .limit(30);
        itemsList.folders = itemsList.folders.map(r => r.folders);
      } else if (tab === 'starred') {
        const favFolders = await db.select({ folder: folders })
          .from(favorites)
          .innerJoin(folders, eq(favorites.folderId, folders.id))
          .leftJoin(trashItems, and(eq(trashItems.entityId, folders.id), eq(trashItems.entityType, 'folder')))
          .where(and(eq(favorites.userId, userId), sql`${trashItems.id} IS NULL`));
        
        const favFiles = await db.select({ file: files })
          .from(favorites)
          .innerJoin(files, eq(favorites.fileId, files.id))
          .leftJoin(trashItems, and(eq(trashItems.entityId, files.id), eq(trashItems.entityType, 'file')))
          .where(and(eq(favorites.userId, userId), sql`${trashItems.id} IS NULL`));

        itemsList.folders = favFolders.map(r => r.folder);
        itemsList.files = favFiles.map(r => r.file);
      } else if (tab === 'recent') {
        const recents = await db.select({ file: files })
          .from(recentActivity)
          .innerJoin(files, eq(recentActivity.fileId, files.id))
          .leftJoin(trashItems, and(eq(trashItems.entityId, files.id), eq(trashItems.entityType, 'file')))
          .where(and(eq(recentActivity.userId, userId), sql`${trashItems.id} IS NULL`))
          .orderBy(desc(recentActivity.lastOpenedAt))
          .limit(30);

        itemsList.files = recents.map(r => r.file);
      } else if (tab === 'trash') {
        const trashedFolders = await db.select({ folder: folders, trash: trashItems })
          .from(trashItems)
          .innerJoin(folders, and(eq(trashItems.entityId, folders.id), eq(trashItems.entityType, 'folder')))
          .where(eq(trashItems.userId, userId));
        
        const trashedFiles = await db.select({ file: files, trash: trashItems })
          .from(trashItems)
          .innerJoin(files, and(eq(trashItems.entityId, files.id), eq(trashItems.entityType, 'file')))
          .where(eq(trashItems.userId, userId));

        itemsList.folders = trashedFolders.map(r => ({ ...r.folder, trashedAt: r.trash.deletedAt }));
        itemsList.files = trashedFiles.map(r => ({ ...r.file, trashedAt: r.trash.deletedAt }));
      } else {
        const subfoldersJoin = await folderRepository.findSubfolders(userId, currentFolderId);
        itemsList.folders = subfoldersJoin.map(r => r.folders);

        const filesJoin = await fileRepository.findFilesInFolder(userId, currentFolderId);
        itemsList.files = filesJoin.map(r => r.files);
      }

      const userStarred = await db.select().from(favorites).where(eq(favorites.userId, userId));
      const starredFolderIds = new Set(userStarred.filter(f => f.folderId).map(f => f.folderId));
      const starredFileIds = new Set(userStarred.filter(f => f.fileId).map(f => f.fileId));

      const userRootFolders = await folderRepository.findUserRootFolders(userId);
      const allUserFolders = await db.select().from(folders).where(eq(folders.userId, userId));

      res.render('dashboard/index', {
        tab,
        currentFolderId,
        currentFolder,
        breadcrumbs,
        folders: itemsList.folders,
        files: itemsList.files,
        storageStats,
        starredFolderIds,
        starredFileIds,
        searchQuery,
        fileType,
        sortBy,
        sortOrder,
        allUserFolders,
        userRootFolders: userRootFolders.map(r => r.folders)
      });
    } catch (err) {
      console.error(err);
      res.status(500).send('Internal Server Error');
    }
  }

  async createFolder(req, res) {
    const { name, parentId } = req.body;
    const userId = req.session.userId;
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    try {
      let pathPrefix = '/';
      const parsedParentId = parentId ? parseInt(parentId) : null;
      
      if (parsedParentId) {
        const parent = await folderRepository.findById(parsedParentId);
        if (!parent || parent.userId !== userId) {
          return res.status(404).json({ error: 'Parent folder not found' });
        }
        pathPrefix = parent.path;
      }

      const folder = await folderRepository.createFolder(userId, parsedParentId, name, pathPrefix);
      await driveService.updateStorageStats(userId);
      res.status(200).json({ success: true, folder });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async renameFolder(req, res) {
    const { id, name } = req.body;
    const userId = req.session.userId;
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    try {
      const folder = await folderRepository.findById(parseInt(id));
      if (!folder || folder.userId !== userId) {
        return res.status(404).json({ error: 'Folder not found' });
      }

      await folderRepository.renameFolder(folder.id, name);
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async moveFolder(req, res) {
    const { folderId, destinationFolderId } = req.body;
    const userId = req.session.userId;
    try {
      const targetId = parseInt(folderId);
      const destId = destinationFolderId ? parseInt(destinationFolderId) : null;
      
      if (targetId === destId) {
        return res.status(400).json({ error: 'Cannot move folder into itself' });
      }

      await driveService.moveFolder(targetId, destId, userId);
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async copyFolder(req, res) {
    const { folderId, destinationFolderId } = req.body;
    const userId = req.session.userId;
    try {
      await jobRepository.createJob('folder_copy', {
        folderId: parseInt(folderId),
        newParentId: destinationFolderId ? parseInt(destinationFolderId) : null,
        userId
      });
      res.status(200).json({ success: true, message: 'Folder copy has been scheduled in the background' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async renameFile(req, res) {
    const { id, name } = req.body;
    const userId = req.session.userId;
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'File name is required' });
    }

    try {
      const file = await fileRepository.findById(parseInt(id));
      if (!file || file.userId !== userId) {
        return res.status(404).json({ error: 'File not found' });
      }

      const ext = path.extname(name).substring(1);
      const base = path.basename(name, path.extname(name));
      await fileRepository.renameFile(file.id, base, ext || file.extension);
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async moveFile(req, res) {
    const { fileId, destinationFolderId } = req.body;
    const userId = req.session.userId;
    try {
      await driveService.moveFile(parseInt(fileId), destinationFolderId ? parseInt(destinationFolderId) : null, userId);
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async copyFile(req, res) {
    const { fileId, destinationFolderId } = req.body;
    const userId = req.session.userId;
    try {
      await driveService.copyFile(parseInt(fileId), destinationFolderId ? parseInt(destinationFolderId) : null, userId);
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async checkChunkStatus(req, res) {
    const { uploadId } = req.query;
    if (!uploadId) {
      return res.status(400).json({ error: 'uploadId parameter is required' });
    }
    try {
      const uploadedIndices = await storageService.getUploadedChunks(uploadId);
      res.status(200).json({ success: true, uploadedChunks: uploadedIndices });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async uploadChunk(req, res) {
    const { uploadId, chunkIndex } = req.body;
    if (!uploadId || chunkIndex === undefined || !req.file) {
      return res.status(400).json({ error: 'Missing chunk upload arguments' });
    }

    try {
      await storageService.saveChunk(uploadId, parseInt(chunkIndex), req.file.buffer);
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async completeUpload(req, res) {
    const { uploadId, totalChunks, filename, folderId } = req.body;
    const userId = req.session.userId;

    if (!uploadId || !totalChunks || !filename) {
      return res.status(400).json({ error: 'Missing merge details' });
    }

    try {
      const destFolderId = folderId ? parseInt(folderId) : null;
      
      const result = await storageService.assembleChunks(uploadId, parseInt(totalChunks), userId, filename);

      const mimeType = require('mime-types').lookup(filename) || 'application/octet-stream';
      const ext = path.extname(filename).substring(1).toLowerCase();

      const fileId = await fileRepository.createFile(
        userId,
        destFolderId,
        result.filename,
        filename,
        ext,
        mimeType,
        result.size,
        result.path,
        result.checksum
      );

      await driveService.updateStorageStats(userId);

      if (mimeType.startsWith('image/')) {
        await jobRepository.createJob('thumbnail', { fileId });
      }

      res.status(200).json({ success: true, fileId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async listVersions(req, res) {
    const { fileId } = req.query;
    const userId = req.session.userId;
    try {
      const file = await fileRepository.findById(parseInt(fileId));
      if (!file || file.userId !== userId) {
        return res.status(404).json({ error: 'File not found' });
      }

      const versions = await fileRepository.getVersions(file.id);
      res.status(200).json({ success: true, versions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async uploadNewVersionComplete(req, res) {
    const { uploadId, totalChunks, filename, fileId } = req.body;
    const userId = req.session.userId;

    try {
      const file = await fileRepository.findById(parseInt(fileId));
      if (!file || file.userId !== userId) {
        return res.status(404).json({ error: 'File not found' });
      }

      const merge = await storageService.assembleChunks(uploadId, parseInt(totalChunks), userId, filename);

      const existingVersions = await fileRepository.getVersions(file.id);
      const nextVerNum = existingVersions.length > 0 ? existingVersions[0].versionNumber + 1 : 1;

      await fileRepository.createVersion(
        file.id,
        file.path,
        nextVerNum,
        file.size,
        userId
      );

      const ext = path.extname(filename).substring(1).toLowerCase();
      const mimeType = require('mime-types').lookup(filename) || 'application/octet-stream';

      await db.update(files)
        .set({
          filename: merge.filename,
          originalName: filename,
          extension: ext,
          mimeType,
          size: merge.size,
          path: merge.path,
          checksum: merge.checksum,
          createdAt: new Date()
        })
        .where(eq(files.id, file.id));

      await driveService.updateStorageStats(userId);

      if (mimeType.startsWith('image/')) {
        await jobRepository.createJob('thumbnail', { fileId: file.id });
      }

      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async restoreVersion(req, res) {
    const { versionId } = req.body;
    const userId = req.session.userId;
    try {
      const ver = await fileRepository.findVersionById(parseInt(versionId));
      if (!ver) {
        return res.status(404).json({ error: 'Version record not found' });
      }

      const file = await fileRepository.findById(ver.fileId);
      if (!file || file.userId !== userId) {
        return res.status(404).json({ error: 'File not found' });
      }

      const versionsList = await fileRepository.getVersions(file.id);
      const nextVerNum = versionsList[0].versionNumber + 1;

      await fileRepository.createVersion(
        file.id,
        file.path,
        nextVerNum,
        file.size,
        userId
      );

      await db.update(files)
        .set({
          path: ver.storagePath,
          size: ver.size,
          createdAt: ver.uploadedAt
        })
        .where(eq(files.id, file.id));

      await fileRepository.deleteVersion(ver.id);

      await driveService.updateStorageStats(userId);
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async deleteVersion(req, res) {
    const { versionId } = req.body;
    const userId = req.session.userId;
    try {
      const ver = await fileRepository.findVersionById(parseInt(versionId));
      if (!ver) {
        return res.status(404).json({ error: 'Version not found' });
      }

      const file = await fileRepository.findById(ver.fileId);
      if (!file || file.userId !== userId) {
        return res.status(404).json({ error: 'Unauthorized' });
      }

      await storageService.deleteDiskFile(ver.storagePath);

      await fileRepository.deleteVersion(ver.id);
      
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async downloadFile(req, res) {
    const { id } = req.params;
    const userId = req.session.userId;
    const versionId = req.query.versionId ? parseInt(req.query.versionId) : null;

    try {
      const file = await fileRepository.findById(parseInt(id));
      if (!file || file.userId !== userId) {
        return res.status(404).send('File not found');
      }

      let filePath = file.path;
      let downloadName = file.originalName;

      if (versionId) {
        const ver = await fileRepository.findVersionById(versionId);
        if (ver && ver.fileId === file.id) {
          filePath = ver.storagePath;
          downloadName = `V${ver.versionNumber}_${file.originalName}`;
        }
      }

      const fullPath = path.join(storageService.storageRoot, filePath);
      if (!fs.existsSync(fullPath)) {
        return res.status(404).send('Physical file not found on disk');
      }

      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`);
      
      const readStream = fs.createReadStream(fullPath);
      readStream.pipe(res);
    } catch (err) {
      res.status(500).send('Download failed');
    }
  }

  async downloadFolder(req, res) {
    const { id } = req.params;
    const userId = req.session.userId;
    try {
      await driveService.packageFolderToZip(parseInt(id), userId, res);
    } catch (err) {
      res.status(500).send('Folder packaging failed');
    }
  }

  async toggleStar(req, res) {
    const { entityType, entityId } = req.body;
    const userId = req.session.userId;
    try {
      const parsedId = parseInt(entityId);
      const isFolder = entityType === 'folder';

      const existing = await db.select().from(favorites).where(
        and(
          eq(favorites.userId, userId),
          isFolder ? eq(favorites.folderId, parsedId) : eq(favorites.fileId, parsedId)
        )
      ).limit(1);

      if (existing.length > 0) {
        await db.delete(favorites).where(eq(favorites.id, existing[0].id));
        res.status(200).json({ success: true, starred: false });
      } else {
        await db.insert(favorites).values({
          userId,
          fileId: isFolder ? null : parsedId,
          folderId: isFolder ? parsedId : null
        });
        res.status(200).json({ success: true, starred: true });
      }
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async trashItem(req, res) {
    const { entityType, entityId } = req.body;
    const userId = req.session.userId;
    try {
      await driveService.moveToTrash(userId, entityType, parseInt(entityId));
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async restoreItem(req, res) {
    const { entityType, entityId } = req.body;
    const userId = req.session.userId;
    try {
      await driveService.restoreFromTrash(userId, entityType, parseInt(entityId));
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async purgeItem(req, res) {
    const { entityType, entityId } = req.body;
    const userId = req.session.userId;
    try {
      await driveService.purgeItemPermanently(userId, entityType, parseInt(entityId));
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new DriveController();

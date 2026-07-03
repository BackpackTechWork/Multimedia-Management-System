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
const shareRepository = require('../repositories/ShareRepository');
const userRepository = require('../repositories/UserRepository');

async function fileExists(fullPath) {
  try {
    await fs.promises.access(fullPath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

class DriveController {
  constructor() {
    [
      'renderDashboard',
      'renderStorage',
      'createFolder',
      'renameFolder',
      'moveFolder',
      'copyFolder',
      'renameFile',
      'moveFile',
      'copyFile',
      'checkChunkStatus',
      'uploadChunk',
      'completeUpload',
      'refreshStorageStats',
      'cancelUpload',
      'listVersions',
      'uploadNewVersionComplete',
      'restoreVersion',
      'deleteVersion',
      'downloadFile',
      'downloadFolder',
      'toggleStar',
      'trashItem',
      'restoreItem',
      'purgeItem'
    ].forEach(method => {
      this[method] = this[method].bind(this);
    });
  }

  isSuperAdmin(req) {
    return req.session.userRole === 'super_admin';
  }

  canAccessItem(req, item) {
    return item && (this.isSuperAdmin(req) || item.userId === req.session.userId);
  }

  async canAccessFolder(req, folder) {
    if (this.canAccessItem(req, folder)) return true;
    return await shareRepository.userCanAccessFolder(req.session.userId, folder);
  }

  async canAccessFile(req, file) {
    if (this.canAccessItem(req, file)) return true;
    return await shareRepository.userCanAccessFile(req.session.userId, file);
  }

  async canEditFolder(req, folder) {
    if (this.canAccessItem(req, folder)) return true;
    return await shareRepository.userCanEditFolder(req.session.userId, folder);
  }

  async canEditFile(req, file) {
    if (this.canAccessItem(req, file)) return true;
    return await shareRepository.userCanEditFile(req.session.userId, file);
  }

  getStorageCategory(file) {
    const mimeType = file.mimeType || '';
    const extension = (file.extension || '').toLowerCase();

    if (mimeType.startsWith('image/')) return 'Images';
    if (mimeType.startsWith('video/')) return 'Videos';
    if (mimeType.startsWith('audio/')) return 'Audio';
    if (['doc', 'docx', 'txt', 'rtf', 'odt', 'pdf', 'ppt', 'pptx'].includes(extension)) return 'Documents';
    if (['xls', 'xlsx', 'csv', 'ods'].includes(extension)) return 'Spreadsheets';
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(extension)) return 'Archives';
    if (['js', 'ts', 'html', 'css', 'json', 'xml', 'sql', 'php', 'py', 'go', 'rs', 'cpp', 'c', 'cs', 'md'].includes(extension)) return 'Code';
    return 'Other';
  }

  getPreviewRoute(file) {
    const mimeType = file.mimeType || '';
    const extension = (file.extension || '').toLowerCase();

    if (mimeType.startsWith('image/')) return 'image';
    if (mimeType === 'application/pdf') return 'pdf';
    if (mimeType.startsWith('video/')) return 'video';
    if (mimeType.startsWith('audio/')) return 'audio';
    if (extension === 'md') return 'markdown';
    if (['xls', 'xlsx', 'csv', 'ods'].includes(extension)) return 'excel';
    if (extension === 'zip' || mimeType === 'application/zip' || mimeType === 'application/x-zip-compressed') return 'zip';
    return 'code';
  }

  matchesStorageType(file, type) {
    if (!type || type === 'all') return true;
    const category = this.getStorageCategory(file).toLowerCase();

    if (type === 'documents') return category === 'documents';
    if (type === 'spreadsheets') return category === 'spreadsheets';
    if (type === 'archives') return category === 'archives';
    return category === type;
  }

  matchesStorageModified(file, modified) {
    if (!modified || modified === 'all') return true;

    const createdAt = file.createdAt ? new Date(file.createdAt) : null;
    if (!createdAt || Number.isNaN(createdAt.getTime())) return false;

    const now = new Date();
    const ageMs = now.getTime() - createdAt.getTime();
    const dayMs = 24 * 60 * 60 * 1000;

    if (modified === 'today') return createdAt.toDateString() === now.toDateString();
    if (modified === 'week') return ageMs <= 7 * dayMs;
    if (modified === 'month') return ageMs <= 30 * dayMs;
    if (modified === 'year') return ageMs <= 365 * dayMs;
    return true;
  }

  getDashboardRouteState(req) {
    if (req.path === '/recent') return { tab: 'recent', currentFolderId: null };
    if (req.path === '/starred') return { tab: 'starred', currentFolderId: null };
    if (req.path === '/shared') return { tab: 'shared', currentFolderId: null };
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
    else if (tab === 'shared') target = '/shared';
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
    const includeAll = this.isSuperAdmin(req);
    if (this.redirectLegacyDashboardQuery(req, res)) return;

    const { tab, currentFolderId } = this.getDashboardRouteState(req);
    const searchQuery = req.query.search || '';
    const fileType = req.query.type || 'all';
    const sortBy = req.query.sortBy || 'date';
    const sortOrder = req.query.sortOrder || 'desc';

    try {
      let currentFolder = null;
      let currentFolderCanEdit = ['my-drive', 'recent', 'starred'].includes(tab) && !currentFolderId;
      let breadcrumbs = [];
      let folderScopeUserId = userId;
      if (currentFolderId && tab === 'my-drive') {
        currentFolder = await folderRepository.findById(currentFolderId);
        if (!(await this.canAccessFolder(req, currentFolder))) {
          return res.redirect('/');
        }
        currentFolderCanEdit = await this.canEditFolder(req, currentFolder);
        folderScopeUserId = currentFolder.userId;

        const pathIds = currentFolder.path.split('/').filter(id => id !== '');
        if (pathIds.length > 0) {
          const matchedFolders = await db.select()
            .from(folders)
            .where(inArray(folders.id, pathIds.map(Number)));
          
          breadcrumbs = pathIds.map(id => matchedFolders.find(f => f.id === Number(id))).filter(Boolean);
        }
      }

      const statsPromise = includeAll
        ? Promise.all([
            db.select({
              totalFiles: sql`COUNT(${files.id})`,
              totalSize: sql`COALESCE(SUM(${files.size}), 0)`
            }).from(files),
            db.select({
              totalFolders: sql`COUNT(${folders.id})`
            }).from(folders)
          ]).then(([fileStats, folderStats]) => [{
            totalFiles: Number(fileStats[0]?.totalFiles) || 0,
            totalSize: Number(fileStats[0]?.totalSize) || 0,
            totalFolders: Number(folderStats[0]?.totalFolders) || 0
          }])
        : db.select().from(userStorageStats).where(eq(userStorageStats.userId, userId)).limit(1);
      let storageStats = { totalSize: 0, totalFolders: 0, totalFiles: 0 };

      let itemsList = { folders: [], files: [] };

      if (searchQuery.trim() !== '') {
        const searchResultsPromise = fileRepository.searchFiles(userId, {
          query: searchQuery,
          type: fileType,
          sortBy,
          sortOrder,
          limit: 100,
          offset: 0,
          includeAll
        });

        const foldersPromise = db.select()
          .from(folders)
          .leftJoin(trashItems, and(eq(trashItems.entityId, folders.id), eq(trashItems.entityType, 'folder')))
          .where(and(
            includeAll ? sql`1 = 1` : eq(folders.userId, userId),
            like(folders.name, `%${searchQuery}%`),
            sql`${trashItems.id} IS NULL`
          ))
          .limit(30);

        const [searchResults, folderResults] = await Promise.all([searchResultsPromise, foldersPromise]);
        itemsList.files = searchResults;
        itemsList.folders = folderResults.map(r => r.folders);
      } else if (tab === 'starred') {
        const favFoldersPromise = db.select({ folder: folders })
          .from(favorites)
          .innerJoin(folders, eq(favorites.folderId, folders.id))
          .leftJoin(trashItems, and(eq(trashItems.entityId, folders.id), eq(trashItems.entityType, 'folder')))
          .where(and(eq(favorites.userId, userId), sql`${trashItems.id} IS NULL`));
        
        const favFilesPromise = db.select({ file: files })
          .from(favorites)
          .innerJoin(files, eq(favorites.fileId, files.id))
          .leftJoin(trashItems, and(eq(trashItems.entityId, files.id), eq(trashItems.entityType, 'file')))
          .where(and(eq(favorites.userId, userId), sql`${trashItems.id} IS NULL`));

        const [favFolders, favFiles] = await Promise.all([favFoldersPromise, favFilesPromise]);
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
      } else if (tab === 'shared') {
        const [sharedByMe, sharedWithMe] = await Promise.all([
          shareRepository.findSharedByUser(userId),
          shareRepository.findSharedWithUser(userId)
        ]);
        itemsList.sharedSections = { sharedByMe, sharedWithMe };
      } else if (tab === 'trash') {
        const trashedFoldersPromise = db.select({ folder: folders, trash: trashItems })
          .from(trashItems)
          .innerJoin(folders, and(eq(trashItems.entityId, folders.id), eq(trashItems.entityType, 'folder')))
          .where(includeAll ? sql`1 = 1` : eq(trashItems.userId, userId));
        
        const trashedFilesPromise = db.select({ file: files, trash: trashItems })
          .from(trashItems)
          .innerJoin(files, and(eq(trashItems.entityId, files.id), eq(trashItems.entityType, 'file')))
          .where(includeAll ? sql`1 = 1` : eq(trashItems.userId, userId));

        const [trashedFolders, trashedFiles] = await Promise.all([trashedFoldersPromise, trashedFilesPromise]);
        itemsList.folders = trashedFolders.map(r => ({ ...r.folder, trashedAt: r.trash.deletedAt }));
        itemsList.files = trashedFiles.map(r => ({ ...r.file, trashedAt: r.trash.deletedAt }));
      } else {
        const [subfoldersJoin, filesJoin] = await Promise.all([
          folderRepository.findSubfolders(folderScopeUserId, currentFolderId, includeAll),
          fileRepository.findFilesInFolder(folderScopeUserId, currentFolderId, includeAll)
        ]);
        itemsList.folders = subfoldersJoin.map(r => r.folders);
        itemsList.files = filesJoin.map(r => r.files);
      }

      const [stats, userStarred, userRootFolders, allUserFolders, shareUsers] = await Promise.all([
        statsPromise,
        db.select().from(favorites).where(eq(favorites.userId, userId)),
        folderRepository.findUserRootFolders(userId, includeAll),
        includeAll ? db.select().from(folders) : db.select().from(folders).where(eq(folders.userId, userId)),
        userRepository.listShareCandidates(userId)
      ]);
      storageStats = stats[0] || storageStats;
      const starredFolderIds = new Set(userStarred.filter(f => f.folderId).map(f => f.folderId));
      const starredFileIds = new Set(userStarred.filter(f => f.fileId).map(f => f.fileId));

      res.render('dashboard/index', {
        tab,
        currentFolderId,
        currentFolder,
        currentFolderCanEdit,
        breadcrumbs,
        folders: itemsList.folders,
        files: itemsList.files,
        sharedSections: itemsList.sharedSections || null,
        storageStats,
        starredFolderIds,
        starredFileIds,
        searchQuery,
        fileType,
        sortBy,
        sortOrder,
        allUserFolders,
        userRootFolders: userRootFolders.map(r => r.folders),
        shareUsers
      });
    } catch (err) {
      console.error(err);
      res.status(500).send('Internal Server Error');
    }
  }

  async renderStorage(req, res) {
    const userId = req.session.userId;
    const includeAll = this.isSuperAdmin(req);
    const typeFilter = req.query.type || 'all';
    const modifiedFilter = req.query.modified || 'all';
    const sourceFilter = req.query.source || 'all';

    try {
      const activeFilesPromise = db.select({ file: files, folder: folders })
        .from(files)
        .leftJoin(folders, eq(files.folderId, folders.id))
        .leftJoin(trashItems, and(eq(trashItems.entityId, files.id), eq(trashItems.entityType, 'file')))
        .where(and(includeAll ? sql`1 = 1` : eq(files.userId, userId), sql`${trashItems.id} IS NULL`))
        .orderBy(desc(files.size));

      const statsPromise = includeAll
        ? Promise.all([
            db.select({
              totalFiles: sql`COUNT(${files.id})`,
              totalSize: sql`COALESCE(SUM(${files.size}), 0)`
            }).from(files),
            db.select({
              totalFolders: sql`COUNT(${folders.id})`
            }).from(folders)
          ]).then(([fileStats, folderStats]) => [{
            totalFiles: Number(fileStats[0]?.totalFiles) || 0,
            totalSize: Number(fileStats[0]?.totalSize) || 0,
            totalFolders: Number(folderStats[0]?.totalFolders) || 0
          }])
        : db.select().from(userStorageStats).where(eq(userStorageStats.userId, userId)).limit(1);

      const [activeFileRows, stats, userRootFolders, allUserFolders] = await Promise.all([
        activeFilesPromise,
        statsPromise,
        folderRepository.findUserRootFolders(userId, includeAll),
        includeAll ? db.select().from(folders) : db.select().from(folders).where(eq(folders.userId, userId))
      ]);

      const activeFiles = activeFileRows.map(row => ({
        ...row.file,
        folderName: row.folder ? row.folder.name : 'My Drive'
      }));

      const storageStats = stats[0] || { totalSize: 0, totalFolders: 0, totalFiles: 0 };
      const activeTotalSize = activeFiles.reduce((sum, file) => sum + (Number(file.size) || 0), 0);
      const categoryTotalsMap = activeFiles.reduce((acc, file) => {
        const category = this.getStorageCategory(file);
        acc.set(category, (acc.get(category) || 0) + (Number(file.size) || 0));
        return acc;
      }, new Map());

      const categoryPalette = {
        Videos: { color: '#EF4444', icon: 'bi-camera-reels-fill' },
        Images: { color: '#3B82F6', icon: 'bi-image-fill' },
        Documents: { color: '#F59E0B', icon: 'bi-file-earmark-text-fill' },
        Spreadsheets: { color: '#16A34A', icon: 'bi-file-earmark-spreadsheet-fill' },
        Audio: { color: '#EC4899', icon: 'bi-file-music-fill' },
        Archives: { color: '#8B5CF6', icon: 'bi-file-zip-fill' },
        Code: { color: '#4B5563', icon: 'bi-file-code-fill' },
        Other: { color: '#9CA3AF', icon: 'bi-file-earmark-fill' }
      };

      const categoryTotals = Array.from(categoryTotalsMap.entries())
        .map(([name, size]) => ({
          name,
          size,
          percent: activeTotalSize > 0 ? (size / activeTotalSize) * 100 : 0,
          color: categoryPalette[name]?.color || categoryPalette.Other.color,
          icon: categoryPalette[name]?.icon || categoryPalette.Other.icon
        }))
        .sort((a, b) => b.size - a.size);

      const filteredFiles = activeFiles
        .filter(file => this.matchesStorageType(file, typeFilter))
        .filter(file => this.matchesStorageModified(file, modifiedFilter))
        .filter(file => sourceFilter === 'all' || file.visibility === sourceFilter)
        .map(file => {
          const category = this.getStorageCategory(file);
          return {
            ...file,
            category,
            categoryIcon: categoryPalette[category]?.icon || categoryPalette.Other.icon,
            categoryColor: categoryPalette[category]?.color || categoryPalette.Other.color,
            previewRoute: this.getPreviewRoute(file)
          };
        });

      res.render('dashboard/storage', {
        tab: 'storage',
        storageStats: {
          ...storageStats,
          totalSize: activeTotalSize,
          totalFiles: activeFiles.length
        },
        files: filteredFiles,
        categoryTotals,
        typeFilter,
        modifiedFilter,
        sourceFilter,
        allUserFolders,
        userRootFolders: userRootFolders.map(r => r.folders)
      });
    } catch (err) {
      console.error(err);
      res.status(500).send('Internal Server Error');
    }
  }

  async createFolder(req, res) {
    const { name, parentId, deferStats } = req.body;
    const userId = req.session.userId;
    if (!name || name.trim() === '') {
      return res.status(400).json({ error: 'Folder name is required' });
    }

    try {
      let pathPrefix = '/';
      const parsedParentId = parentId ? parseInt(parentId) : null;
      
      if (parsedParentId) {
        const parent = await folderRepository.findById(parsedParentId);
        if (!(await this.canEditFolder(req, parent))) {
          return res.status(404).json({ error: 'Parent folder not found' });
        }
        req.body.ownerId = parent.userId;
        pathPrefix = parent.path;
      }

      const ownerId = req.body.ownerId || userId;
      const folder = await folderRepository.createFolder(ownerId, parsedParentId, name, pathPrefix);
      if (!deferStats) {
        await driveService.updateStorageStats(ownerId);
      }
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
      if (!this.canAccessItem(req, folder)) {
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

      await driveService.moveFolder(targetId, destId, userId, { isSuperAdmin: this.isSuperAdmin(req) });
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
      if (!this.canAccessItem(req, file)) {
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
      await driveService.moveFile(parseInt(fileId), destinationFolderId ? parseInt(destinationFolderId) : null, userId, { isSuperAdmin: this.isSuperAdmin(req) });
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async copyFile(req, res) {
    const { fileId, destinationFolderId } = req.body;
    const userId = req.session.userId;
    try {
      await driveService.copyFile(parseInt(fileId), destinationFolderId ? parseInt(destinationFolderId) : null, userId, { isSuperAdmin: this.isSuperAdmin(req) });
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
      const receipt = await storageService.getUploadReceipt(uploadId);
      if (receipt?.userId === req.session.userId) {
        return res.status(200).json({
          success: true,
          completed: true,
          fileId: receipt.fileId,
          uploadedChunks: []
        });
      }

      const uploadedIndices = await storageService.getUploadedChunks(uploadId);
      res.status(200).json({ success: true, completed: false, uploadedChunks: uploadedIndices });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async uploadChunk(req, res) {
    const { uploadId, chunkIndex, chunkOffset, fileSize } = req.body;
    if (!uploadId || chunkIndex === undefined || !req.file) {
      return res.status(400).json({ error: 'Missing chunk upload arguments' });
    }

    try {
      const parsedChunkIndex = Number.parseInt(chunkIndex, 10);
      const parsedChunkOffset = chunkOffset === undefined ? null : Number(chunkOffset);
      const parsedFileSize = fileSize === undefined ? null : Number(fileSize);
      if (!Number.isSafeInteger(parsedChunkIndex) || parsedChunkIndex < 0) {
        return res.status(400).json({ error: 'Invalid chunk index' });
      }
      if (parsedChunkOffset !== null && (!Number.isSafeInteger(parsedChunkOffset) || parsedChunkOffset < 0)) {
        return res.status(400).json({ error: 'Invalid chunk offset' });
      }
      if (parsedChunkOffset !== null) {
        if (!Number.isSafeInteger(parsedFileSize) || parsedFileSize < 0) {
          return res.status(400).json({ error: 'Invalid file size' });
        }
        if (parsedChunkOffset + req.file.size > parsedFileSize) {
          return res.status(400).json({ error: 'Chunk exceeds declared file size' });
        }
      }

      await storageService.saveChunk(uploadId, parsedChunkIndex, req.file.buffer, parsedChunkOffset);
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async completeUpload(req, res) {
    const { uploadId, totalChunks, filename, fileSize, folderId, deferStats } = req.body;
    const userId = req.session.userId;
    let result = null;
    let fileCreated = false;

    if (!uploadId || !totalChunks || !filename) {
      return res.status(400).json({ error: 'Missing merge details' });
    }

    try {
      const existingReceipt = await storageService.getUploadReceipt(uploadId);
      if (existingReceipt?.userId === userId) {
        return res.status(200).json({ success: true, fileId: existingReceipt.fileId, resumed: true });
      }

      const destFolderId = folderId ? parseInt(folderId) : null;
      let ownerId = userId;
      if (destFolderId) {
        const destFolder = await folderRepository.findById(destFolderId);
        if (!(await this.canEditFolder(req, destFolder))) {
          return res.status(404).json({ error: 'Destination folder not found' });
        }
        ownerId = destFolder.userId;
      }
      
      const parsedFileSize = fileSize === undefined ? null : Number(fileSize);
      result = await storageService.assembleChunks(
        uploadId,
        parseInt(totalChunks),
        ownerId,
        filename,
        parsedFileSize
      );

      const mimeType = require('mime-types').lookup(filename) || 'application/octet-stream';
      const ext = path.extname(filename).substring(1).toLowerCase();

      const fileId = await fileRepository.createFile(
        ownerId,
        destFolderId,
        result.filename,
        filename,
        ext,
        mimeType,
        result.size,
        result.path,
        result.checksum
      );
      fileCreated = true;

      await storageService.saveUploadReceipt(uploadId, { userId, ownerId, fileId }).catch(err => {
        console.error(`Failed to save upload receipt for ${uploadId}:`, err.message);
      });

      if (!deferStats) {
        await driveService.updateStorageStats(ownerId).catch(err => {
          console.error(`Failed to refresh storage stats after upload ${uploadId}:`, err.message);
        });
      }

      if (mimeType.startsWith('image/')) {
        await jobRepository.createJob('thumbnail', { fileId }).catch(err => {
          console.error(`Failed to queue thumbnail for file ${fileId}:`, err.message);
        });
      }

      res.status(200).json({ success: true, fileId });
    } catch (err) {
      if (result?.path && !fileCreated) {
        await storageService.deleteDiskFile(result.path).catch(() => {});
      }
      res.status(500).json({ error: err.message });
    }
  }

  async refreshStorageStats(req, res) {
    try {
      await driveService.updateStorageStats(req.session.userId);
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async cancelUpload(req, res) {
    const uploadIds = Array.isArray(req.body.uploadIds)
      ? req.body.uploadIds
      : req.body.uploadId
        ? [req.body.uploadId]
        : [];

    if (uploadIds.length === 0) {
      return res.status(400).json({ error: 'No upload ids provided' });
    }

    try {
      await Promise.all(uploadIds.map(uploadId => storageService.discardChunks(uploadId)));
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async listVersions(req, res) {
    const { fileId } = req.query;
    const userId = req.session.userId;
    try {
      const file = await fileRepository.findById(parseInt(fileId));
      if (!(await this.canAccessFile(req, file))) {
        return res.status(404).json({ error: 'File not found' });
      }

      const versions = await fileRepository.getVersions(file.id);
      res.status(200).json({ success: true, versions });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async uploadNewVersionComplete(req, res) {
    const { uploadId, totalChunks, filename, fileSize, fileId } = req.body;
    const userId = req.session.userId;
    let merge = null;

    try {
      const file = await fileRepository.findById(parseInt(fileId));
      if (!(await this.canEditFile(req, file))) {
        return res.status(404).json({ error: 'File not found' });
      }

      merge = await storageService.assembleChunks(
        uploadId,
        parseInt(totalChunks),
        file.userId,
        filename,
        fileSize === undefined ? null : Number(fileSize)
      );

      const existingVersions = await fileRepository.getVersions(file.id);
      const nextVerNum = existingVersions.length > 0 ? existingVersions[0].versionNumber + 1 : 1;

      await fileRepository.createVersion(
        file.id,
        file.path,
        nextVerNum,
        file.size,
        file.userId
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

      await driveService.updateStorageStats(file.userId);

      if (mimeType.startsWith('image/')) {
        await jobRepository.createJob('thumbnail', { fileId: file.id });
      }

      res.status(200).json({ success: true });
    } catch (err) {
      if (merge?.path) {
        await storageService.deleteDiskFile(merge.path).catch(() => {});
      }
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
      if (!this.canAccessItem(req, file)) {
        return res.status(404).json({ error: 'File not found' });
      }

      const versionsList = await fileRepository.getVersions(file.id);
      const nextVerNum = versionsList[0].versionNumber + 1;

      await fileRepository.createVersion(
        file.id,
        file.path,
        nextVerNum,
        file.size,
        file.userId
      );

      await db.update(files)
        .set({
          path: ver.storagePath,
          size: ver.size,
          createdAt: ver.uploadedAt
        })
        .where(eq(files.id, file.id));

      await fileRepository.deleteVersion(ver.id);

      await driveService.updateStorageStats(file.userId);
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
      if (!this.canAccessItem(req, file)) {
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
      if (!(await this.canAccessFile(req, file))) {
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
      if (!(await fileExists(fullPath))) {
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
      await driveService.packageFolderToZip(parseInt(id), userId, res, { isSuperAdmin: this.isSuperAdmin(req) });
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
      const item = isFolder
        ? await folderRepository.findById(parsedId)
        : await fileRepository.findById(parsedId);

      if (!this.canAccessItem(req, item)) {
        return res.status(404).json({ error: 'Item not found' });
      }

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
      await driveService.moveToTrash(userId, entityType, parseInt(entityId), { isSuperAdmin: this.isSuperAdmin(req) });
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async restoreItem(req, res) {
    const { entityType, entityId } = req.body;
    const userId = req.session.userId;
    try {
      await driveService.restoreFromTrash(userId, entityType, parseInt(entityId), { isSuperAdmin: this.isSuperAdmin(req) });
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }

  async purgeItem(req, res) {
    const { entityType, entityId } = req.body;
    const userId = req.session.userId;
    try {
      await driveService.purgeItemPermanently(userId, entityType, parseInt(entityId), { isSuperAdmin: this.isSuperAdmin(req) });
      res.status(200).json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  }
}

module.exports = new DriveController();

const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { db } = require('../config/db');
const { folders, files, fileVersions, trashItems, favorites, recentActivity, userStorageStats } = require('../models/schema');
const { eq, and, sql, like, inArray } = require('drizzle-orm');
const fileRepository = require('../repositories/FileRepository');
const folderRepository = require('../repositories/FolderRepository');
const storageService = require('./StorageService');
const jobRepository = require('../repositories/JobRepository');

class DriveService {
  async updateStorageStats(userId) {
    const [fileStats] = await db.select({
      count: sql`COUNT(${files.id})`,
      size: sql`SUM(${files.size})`
    }).from(files).where(eq(files.userId, userId));

    const [folderStats] = await db.select({
      count: sql`COUNT(${folders.id})`
    }).from(folders).where(eq(folders.userId, userId));

    const totalFiles = Number(fileStats.count) || 0;
    const totalFolders = Number(folderStats.count) || 0;
    const totalSize = Number(fileStats.size) || 0;

    await db.insert(userStorageStats)
      .values({
        userId,
        totalFiles,
        totalFolders,
        totalSize,
        updatedAt: new Date()
      })
      .onDuplicateKeyUpdate({
        set: {
          totalFiles,
          totalFolders,
          totalSize,
          updatedAt: new Date()
        }
      });
  }

  async moveToTrash(userId, entityType, entityId) {
    const purgeAt = new Date();
    purgeAt.setDate(purgeAt.getDate() + 30);

    await db.insert(trashItems).values({
      userId,
      entityType,
      entityId,
      purgeAt
    });

  }

  async restoreFromTrash(userId, entityType, entityId) {
    await db.delete(trashItems).where(
      and(
        eq(trashItems.userId, userId),
        eq(trashItems.entityType, entityType),
        eq(trashItems.entityId, entityId)
      )
    );
  }

  async purgeItemPermanently(userId, entityType, entityId) {
    if (entityType === 'file') {
      const file = await fileRepository.findById(entityId);
      if (file && file.userId === userId) {
        await storageService.deleteDiskFile(file.path);

        const versions = await fileRepository.getVersions(entityId);
        for (let ver of versions) {
          await storageService.deleteDiskFile(ver.storagePath);
          await fileRepository.deleteVersion(ver.id);
        }

        await db.delete(favorites).where(eq(favorites.fileId, entityId));
        await db.delete(recentActivity).where(eq(recentActivity.fileId, entityId));

        await db.delete(files).where(eq(files.id, entityId));
      }
    } else if (entityType === 'folder') {
      const folder = await folderRepository.findById(entityId);
      if (folder && folder.userId === userId) {
        const descendants = await folderRepository.findDescendants(folder.path);
        const foldersToPurge = [folder, ...descendants];
        const folderIds = foldersToPurge.map(f => f.id);

        const filesToPurge = await db.select().from(files).where(
          and(eq(files.userId, userId), inArray(files.folderId, folderIds))
        );

        for (let file of filesToPurge) {
          await storageService.deleteDiskFile(file.path);
          const versions = await fileRepository.getVersions(file.id);
          for (let ver of versions) {
            await storageService.deleteDiskFile(ver.storagePath);
            await fileRepository.deleteVersion(ver.id);
          }
          await db.delete(favorites).where(eq(favorites.fileId, file.id));
          await db.delete(recentActivity).where(eq(recentActivity.fileId, file.id));
          await db.delete(files).where(eq(files.id, file.id));
        }

        await db.delete(folders).where(inArray(folders.id, folderIds));
      }
    }

    await db.delete(trashItems).where(
      and(
        eq(trashItems.userId, userId),
        eq(trashItems.entityType, entityType),
        eq(trashItems.entityId, entityId)
      )
    );

    await this.updateStorageStats(userId);
  }

  async moveFolder(folderId, newParentId, userId) {
    const folder = await folderRepository.findById(folderId);
    if (!folder || folder.userId !== userId) {
      throw new Error('Folder not found');
    }

    let newPathPrefix = '/';
    if (newParentId) {
      const newParent = await folderRepository.findById(newParentId);
      if (!newParent || newParent.userId !== userId) {
        throw new Error('New parent folder not found');
      }
      if (newParent.path.startsWith(folder.path)) {
        throw new Error('Cannot move a folder into one of its subfolders');
      }
      newPathPrefix = newParent.path;
    }

    const oldPath = folder.path;
    const newPath = `${newPathPrefix}${folderId}/`;

    await folderRepository.moveFolderSubtree(folderId, newParentId, oldPath, newPath);
  }

  async moveFile(fileId, newFolderId, userId) {
    if (newFolderId) {
      const folder = await folderRepository.findById(newFolderId);
      if (!folder || folder.userId !== userId) {
        throw new Error('Destination folder not found');
      }
    }
    await db.update(files)
      .set({ folderId: newFolderId })
      .where(and(eq(files.id, fileId), eq(files.userId, userId)));
  }

  async copyFile(fileId, destinationFolderId, userId) {
    const file = await fileRepository.findById(fileId);
    if (!file || file.userId !== userId) {
      throw new Error('File not found');
    }

    const diskCopy = await storageService.copyDiskFile(file.path, userId);

    const newFileId = await fileRepository.createFile(
      userId,
      destinationFolderId,
      diskCopy.filename,
      `Copy of ${file.originalName}`,
      file.extension,
      file.mimeType,
      diskCopy.size,
      diskCopy.path,
      file.checksum,
      file.visibility
    );

    await this.updateStorageStats(userId);
    
    if (file.mimeType.startsWith('image/')) {
      await jobRepository.createJob('thumbnail', { fileId: newFileId });
    }

    return newFileId;
  }

  async packageFolderToZip(folderId, userId, res) {
    const folder = await folderRepository.findById(folderId);
    if (!folder || folder.userId !== userId) {
      res.status(404).send('Folder not found');
      return;
    }

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${folder.name}.zip"`);

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.pipe(res);

    const descendants = await folderRepository.findDescendants(folder.path);
    const allFolders = [folder, ...descendants];
    const folderMap = new Map(allFolders.map(f => [f.id, f]));

    const folderIds = allFolders.map(f => f.id);
    const folderFiles = await db.select().from(files).where(
      and(
        eq(files.userId, userId),
        inArray(files.folderId, folderIds),
        sql`NOT EXISTS (
          SELECT 1 FROM trash_items 
          WHERE trash_items.entity_id = files.id 
            AND trash_items.entity_type = 'file'
        )`
      )
    );

    for (let file of folderFiles) {
      let zipFilePath = file.originalName;
      let currFolderId = file.folderId;
      const paths = [];

      while (currFolderId && currFolderId !== folder.parentId) {
        const f = folderMap.get(currFolderId);
        if (!f) break;
        paths.unshift(f.name);
        currFolderId = f.parentId;
      }

      paths.push(file.originalName);
      zipFilePath = paths.join('/');

      const diskPath = path.join(storageService.storageRoot, file.path);
      if (fs.existsSync(diskPath)) {
        archive.file(diskPath, { name: zipFilePath });
      }
    }

    await archive.finalize();
  }
}

module.exports = new DriveService();

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const { db } = require('../config/db');
const { folders, files, trashItems } = require('../models/schema');
const { eq, and, sql, lt, inArray } = require('drizzle-orm');
const fileRepository = require('../repositories/FileRepository');
const folderRepository = require('../repositories/FolderRepository');
const jobRepository = require('../repositories/JobRepository');
const storageService = require('./StorageService');

class QueueService {
  constructor() {
    this.isRunning = false;
    this.intervalId = null;
    this.verboseJobs = process.env.VERBOSE_JOBS === 'true';
  }

  logJob(message) {
    if (this.verboseJobs) {
      console.log(message);
    }
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log('Background job queue processing started...');
    
    this.intervalId = setInterval(() => this.processNextJob(), 3000);
    
    this.trashCleanupIntervalId = setInterval(() => this.processTrashPurge(), 3600 * 1000);
  }

  stop() {
    this.isRunning = false;
    if (this.intervalId) clearInterval(this.intervalId);
    if (this.trashCleanupIntervalId) clearInterval(this.trashCleanupIntervalId);
    console.log('Background job queue processing stopped.');
  }

  async processNextJob() {
    try {
      const job = await jobRepository.getNextPendingJob();
      if (!job) return; // No pending jobs

      this.logJob(`Processing job ${job.id} (type: ${job.type})...`);
      
      try {
        switch (job.type) {
          case 'thumbnail':
            await this.handleThumbnailJob(job.payload);
            break;
          case 'folder_copy':
            await this.handleFolderCopyJob(job.payload);
            break;
          default:
            console.warn(`Unknown job type: ${job.type}`);
        }
        await jobRepository.updateJobStatus(job.id, 'completed');
        this.logJob(`Job ${job.id} completed successfully.`);
      } catch (err) {
        console.error(`Job ${job.id} failed:`, err.message);
        await jobRepository.updateJobStatus(job.id, 'failed');
      }
    } catch (err) {
      console.error('Error in job queue polling loop:', err);
    }
  }

  async handleThumbnailJob({ fileId }) {
    const file = await fileRepository.findById(fileId);
    if (!file) return;

    const sourcePath = path.join(storageService.storageRoot, file.path);
    if (!fs.existsSync(sourcePath)) {
      throw new Error(`Source file does not exist on disk: ${file.path}`);
    }

    const isImage = file.mimeType.startsWith('image/');
    if (!isImage) {
      return;
    }

    const sizes = [200, 400];
    for (let size of sizes) {
      const destPath = storageService.getThumbnailPath(file.filename, size);
      await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
      
      await sharp(sourcePath)
        .resize(size, size, { fit: 'cover' })
        .toFormat('jpeg')
        .toFile(destPath);
        
      this.logJob(`Generated thumbnail ${size} for fileId ${fileId}`);
    }
  }

  async handleFolderCopyJob({ folderId, newParentId, userId }) {
    const rootFolder = await folderRepository.findById(folderId);
    if (!rootFolder) return;

    let newPathPrefix = '/';
    if (newParentId) {
      const newParent = await folderRepository.findById(newParentId);
      if (newParent) {
        newPathPrefix = newParent.path;
      }
    }

    const descendants = await folderRepository.findDescendants(rootFolder.path);
    const allFolders = [rootFolder, ...descendants];

    allFolders.sort((a, b) => a.path.length - b.path.length);

    const folderMap = new Map(); // Old ID -> New ID mapping

    for (let f of allFolders) {
      let pId = null;
      let pathPrefix = newPathPrefix;

      if (f.id !== rootFolder.id) {
        pId = folderMap.get(f.parentId);
        const pFolder = await folderRepository.findById(pId);
        if (pFolder) {
          pathPrefix = pFolder.path;
        }
      } else {
        pId = newParentId;
      }

      const copyName = f.id === rootFolder.id ? `Copy of ${f.name}` : f.name;
      const copyFolder = await folderRepository.createFolder(
        userId,
        pId,
        copyName,
        pathPrefix,
        f.visibility
      );

      folderMap.set(f.id, copyFolder.id);

      const oldFiles = await db.select().from(files).where(
        and(
          eq(files.folderId, f.id),
          sql`NOT EXISTS (
            SELECT 1 FROM trash_items 
            WHERE trash_items.entity_id = files.id 
              AND trash_items.entity_type = 'file'
          )`
        )
      );

      for (let oldFile of oldFiles) {
        const diskCopy = await storageService.copyDiskFile(oldFile.path, userId);
        const newFileId = await fileRepository.createFile(
          userId,
          copyFolder.id,
          diskCopy.filename,
          oldFile.originalName,
          oldFile.extension,
          oldFile.mimeType,
          diskCopy.size,
          diskCopy.path,
          oldFile.checksum,
          oldFile.visibility
        );
        
        if (oldFile.mimeType.startsWith('image/')) {
          await jobRepository.createJob('thumbnail', { fileId: newFileId });
        }
      }
    }

    const driveService = require('./DriveService');
    await driveService.updateStorageStats(userId);
  }

  async processTrashPurge() {
    try {
      console.log('Running scheduled trash cleanup job...');
      const now = new Date();
      const driveService = require('./DriveService');

      const expiredItems = await db.select()
        .from(trashItems)
        .where(lt(trashItems.purgeAt, now));

      for (let item of expiredItems) {
        console.log(`Auto-purging expired trash item (type: ${item.entityType}, id: ${item.entityId})`);
        await driveService.purgeItemPermanently(item.userId, item.entityType, item.entityId);
      }
    } catch (err) {
      console.error('Error during automatic trash purging:', err);
    }
  }
}

module.exports = new QueueService();

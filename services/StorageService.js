const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

class StorageService {
  constructor() {
    this.storageRoot = path.resolve(process.env.STORAGE_ROOT || './storage');
    this.chunksDir = path.join(this.storageRoot, '.chunks');
    this.thumbnailsDir = path.join(this.storageRoot, '.thumbnails');
    
    fs.mkdirSync(this.storageRoot, { recursive: true });
    fs.mkdirSync(this.chunksDir, { recursive: true });
    fs.mkdirSync(this.thumbnailsDir, { recursive: true });
  }

  getUserStorageDir(userId) {
    const dir = path.join(this.storageRoot, `user_${userId}`);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  getChunkUploadDir(uploadId) {
    return path.join(this.chunksDir, uploadId);
  }

  async saveChunk(uploadId, chunkIndex, chunkBuffer) {
    const dir = this.getChunkUploadDir(uploadId);
    await fs.promises.mkdir(dir, { recursive: true });
    
    const chunkPath = path.join(dir, `chunk_${chunkIndex}`);
    await fs.promises.writeFile(chunkPath, chunkBuffer);
  }

  async getUploadedChunks(uploadId) {
    const dir = this.getChunkUploadDir(uploadId);
    if (!fs.existsSync(dir)) {
      return [];
    }
    const files = await fs.promises.readdir(dir);
    return files
      .filter(f => f.startsWith('chunk_'))
      .map(f => parseInt(f.split('_')[1], 10))
      .sort((a, b) => a - b);
  }

  getAvailableDiskSpace() {
    return new Promise((resolve) => {
      const absolutePath = path.resolve(this.storageRoot);
      const { exec } = require('child_process');
      
      if (process.platform === 'win32') {
        const drive = absolutePath.substring(0, 2);
        exec(`powershell -Command "[System.IO.DriveInfo]::new('${drive}').AvailableFreeSpace"`, (err, stdout) => {
          if (err) return resolve(null);
          const bytes = parseInt(stdout.trim(), 10);
          resolve(isNaN(bytes) ? null : bytes);
        });
      } else {
        exec(`df -k "${absolutePath}"`, (err, stdout) => {
          if (err) return resolve(null);
          const lines = stdout.trim().split('\n');
          if (lines.length >= 2) {
            const parts = lines[1].replace(/\s+/g, ' ').split(' ');
            if (parts.length >= 4) {
              const kb = parseInt(parts[3], 10);
              if (!isNaN(kb)) return resolve(kb * 1024);
            }
          }
          resolve(null);
        });
      }
    });
  }

  async getChunkUploadSize(uploadId) {
    const chunkDir = this.getChunkUploadDir(uploadId);
    if (!fs.existsSync(chunkDir)) {
      return 0;
    }
    const filesList = await fs.promises.readdir(chunkDir);
    let totalSize = 0;
    for (let f of filesList) {
      if (f.startsWith('chunk_')) {
        const stats = await fs.promises.stat(path.join(chunkDir, f));
        totalSize += stats.size;
      }
    }
    return totalSize;
  }

  async checkStorageLimits(uploadId) {
    const fileSize = await this.getChunkUploadSize(uploadId);

    // 1. Check physical disk space
    const freeSpace = await this.getAvailableDiskSpace();
    if (freeSpace !== null && freeSpace < fileSize) {
      throw new Error(`Insufficient physical disk space. Required: ${fileSize} bytes, Available: ${freeSpace} bytes.`);
    }

    // 2. Check maximum system storage (configured in .env)
    const maxSystemStorageGb = process.env.MAX_SYSTEM_STORAGE_GB ? parseFloat(process.env.MAX_SYSTEM_STORAGE_GB) : null;
    if (maxSystemStorageGb !== null && !isNaN(maxSystemStorageGb)) {
      const maxSystemStorageBytes = maxSystemStorageGb * 1024 * 1024 * 1024;
      
      const { db } = require('../config/db');
      const { files, fileVersions } = require('../models/schema');
      const { sql } = require('drizzle-orm');

      const [fileStats] = await db.select({
        totalSize: sql`SUM(${files.size})`
      }).from(files);
      
      const [versionStats] = await db.select({
        totalSize: sql`SUM(${fileVersions.size})`
      }).from(fileVersions);
      
      const totalSystemUsed = (Number(fileStats.totalSize) || 0) + (Number(versionStats.totalSize) || 0);
      
      if (totalSystemUsed + fileSize > maxSystemStorageBytes) {
        throw new Error(`System storage limit reached (${maxSystemStorageGb} GB). Cannot upload file.`);
      }
    }
  }

  async assembleChunks(uploadId, totalChunks, userId, originalFilename) {
    // Verify storage space and limits in the background
    await this.checkStorageLimits(uploadId);

    const chunkDir = this.getChunkUploadDir(uploadId);
    
    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(chunkDir, `chunk_${i}`);
      if (!fs.existsSync(chunkPath)) {
        throw new Error(`Missing chunk index ${i} for upload ${uploadId}`);
      }
    }

    const ext = path.extname(originalFilename);
    const uniqueFilename = `${crypto.randomUUID()}${ext}`;
    const userDir = this.getUserStorageDir(userId);
    const destinationPath = path.join(userDir, uniqueFilename);

    const writeStream = fs.createWriteStream(destinationPath);
    const sha256Hasher = crypto.createHash('sha256');

    for (let i = 0; i < totalChunks; i++) {
      const chunkPath = path.join(chunkDir, `chunk_${i}`);
      const chunkBuffer = await fs.promises.readFile(chunkPath);
      
      sha256Hasher.update(chunkBuffer);
      
      const isWritable = writeStream.write(chunkBuffer);
      if (!isWritable) {
        await new Promise((resolve) => writeStream.once('drain', resolve));
      }
    }
    
    writeStream.end();
    
    await new Promise((resolve, reject) => {
      writeStream.on('finish', resolve);
      writeStream.on('error', reject);
    });

    const checksum = sha256Hasher.digest('hex');
    const stats = await fs.promises.stat(destinationPath);

    await fs.promises.rm(chunkDir, { recursive: true, force: true });

    return {
      filename: uniqueFilename,
      path: path.relative(this.storageRoot, destinationPath).replace(/\\/g, '/'),
      size: stats.size,
      checksum
    };
  }

  async deleteDiskFile(relativeStoragePath) {
    const fullPath = path.join(this.storageRoot, relativeStoragePath);
    if (fs.existsSync(fullPath)) {
      await fs.promises.unlink(fullPath);
    }
  }

  async copyDiskFile(relativeSrcPath, userId) {
    const fullSrcPath = path.join(this.storageRoot, relativeSrcPath);
    if (!fs.existsSync(fullSrcPath)) {
      throw new Error(`Source file does not exist: ${relativeSrcPath}`);
    }

    const ext = path.extname(relativeSrcPath);
    const uniqueFilename = `${crypto.randomUUID()}${ext}`;
    const userDir = this.getUserStorageDir(userId);
    const destinationPath = path.join(userDir, uniqueFilename);

    await fs.promises.copyFile(fullSrcPath, destinationPath);
    
    const stats = await fs.promises.stat(destinationPath);
    
    return {
      filename: uniqueFilename,
      path: path.relative(this.storageRoot, destinationPath).replace(/\\/g, '/'),
      size: stats.size
    };
  }

  getThumbnailPath(filename, size = 200) {
    return path.join(this.thumbnailsDir, `thumb_${size}_${filename}.jpg`);
  }
}

module.exports = new StorageService();

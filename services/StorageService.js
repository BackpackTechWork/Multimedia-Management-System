const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

class StorageService {
  constructor() {
    this.storageRoot = path.resolve(process.env.STORAGE_ROOT || './storage');
    // Keep uploads outside `public`: files in public/temp would be directly
    // downloadable before authorization and malware checks. This may point at
    // a fast local disk while STORAGE_ROOT is a slower/network-backed store.
    const storageIsNetworkShare = this.storageRoot.startsWith('\\\\');
    const defaultChunksDir = storageIsNetworkShare
      ? path.resolve('./.upload-temp')
      : path.join(this.storageRoot, '.chunks');
    this.chunksDir = path.resolve(process.env.UPLOAD_TEMP_ROOT || defaultChunksDir);
    this.thumbnailsDir = path.join(this.storageRoot, '.thumbnails');
    // Queue/status metadata is hot operational data. Keep it beside the local
    // upload staging area so polling does not perform small-file I/O over SMB.
    this.uploadReceiptsDir = path.join(this.chunksDir, '.upload-receipts');
    this.legacyUploadReceiptsDir = path.join(this.storageRoot, '.upload-receipts');
    this.legacyUploadReceiptNames = new Set();
    this.cancelledUploadIds = new Map();
    
    fs.mkdirSync(this.storageRoot, { recursive: true });
    fs.mkdirSync(this.chunksDir, { recursive: true });
    fs.mkdirSync(this.thumbnailsDir, { recursive: true });
    fs.mkdirSync(this.uploadReceiptsDir, { recursive: true });
    try {
      fs.readdirSync(this.legacyUploadReceiptsDir, { withFileTypes: true })
        .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
        .forEach(entry => this.legacyUploadReceiptNames.add(entry.name));
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.warn(`Could not index legacy upload receipts: ${err.message}`);
      }
    }
    console.log(`Upload staging directory: ${this.chunksDir}`);
    if (storageIsNetworkShare && !process.env.UPLOAD_TEMP_ROOT) {
      console.warn('UPLOAD_TEMP_ROOT is not set; using local .upload-temp staging for SMB storage.');
    }
  }

  getUserStorageDir(userId) {
    const dir = path.join(this.storageRoot, `user_${userId}`);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  getChunkUploadDir(uploadId) {
    const safeUploadId = String(uploadId || '').replace(/[^a-zA-Z0-9._-]/g, '');
    if (!safeUploadId) {
      throw new Error('Invalid upload id');
    }
    return path.join(this.chunksDir, safeUploadId);
  }

  getUploadOwnerPath(uploadId) {
    return path.join(this.getChunkUploadDir(uploadId), 'owner.json');
  }

  async assertUploadOwner(uploadId, userId, { create = false } = {}) {
    const dir = this.getChunkUploadDir(uploadId);
    if (create) await fs.promises.mkdir(dir, { recursive: true });

    const ownerPath = this.getUploadOwnerPath(uploadId);
    try {
      const owner = JSON.parse(await fs.promises.readFile(ownerPath, 'utf8'));
      if (Number(owner.userId) !== Number(userId)) {
        const err = new Error('Upload session does not belong to this user');
        err.code = 'UPLOAD_FORBIDDEN';
        throw err;
      }
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
      if (!create) return false;
      try {
        await fs.promises.writeFile(ownerPath, JSON.stringify({ userId: Number(userId) }), { flag: 'wx' });
      } catch (writeErr) {
        if (writeErr.code !== 'EEXIST') throw writeErr;
        return this.assertUploadOwner(uploadId, userId);
      }
    }
    return true;
  }

  async discardChunks(uploadId, userId = null) {
    if (userId !== null) await this.assertUploadOwner(uploadId, userId);
    const dir = this.getChunkUploadDir(uploadId);
    await fs.promises.rm(dir, { recursive: true, force: true });
  }

  async cancelUpload(uploadId, userId) {
    const safeUploadId = path.basename(this.getChunkUploadDir(uploadId));
    if (userId !== null) await this.assertUploadOwner(uploadId, userId);
    this.cancelledUploadIds.set(safeUploadId, Date.now());
    if (this.cancelledUploadIds.size > 2000) {
      const cutoff = Date.now() - (24 * 60 * 60 * 1000);
      for (const [id, cancelledAt] of this.cancelledUploadIds) {
        if (cancelledAt < cutoff) this.cancelledUploadIds.delete(id);
      }
    }
    const chunkDir = this.getChunkUploadDir(uploadId);
    for (let attempt = 0; attempt < 20; attempt += 1) {
      try {
        await fs.promises.rm(chunkDir, { recursive: true, force: true });
        break;
      } catch (err) {
        if (!['EBUSY', 'EPERM'].includes(err.code) || attempt === 19) throw err;
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
  }

  isUploadCancelled(uploadId) {
    const safeUploadId = path.basename(this.getChunkUploadDir(uploadId));
    return this.cancelledUploadIds.has(safeUploadId);
  }

  getStagedUploadPath(uploadId) {
    return path.join(this.getChunkUploadDir(uploadId), 'upload.part');
  }

  getUploadReceiptPath(uploadId) {
    const safeUploadId = path.basename(this.getChunkUploadDir(uploadId));
    return path.join(this.uploadReceiptsDir, `${safeUploadId}.json`);
  }

  getLegacyUploadReceiptPath(uploadId) {
    const safeUploadId = path.basename(this.getChunkUploadDir(uploadId));
    return path.join(this.legacyUploadReceiptsDir, `${safeUploadId}.json`);
  }

  async getUploadReceipt(uploadId) {
    try {
      return JSON.parse(await fs.promises.readFile(this.getUploadReceiptPath(uploadId), 'utf8'));
    } catch (err) {
      if (err instanceof SyntaxError) return null;
      if (err.code === 'ENOENT') {
        const legacyName = path.basename(this.getLegacyUploadReceiptPath(uploadId));
        if (!this.legacyUploadReceiptNames.has(legacyName)) return null;
        try {
          return JSON.parse(await fs.promises.readFile(this.getLegacyUploadReceiptPath(uploadId), 'utf8'));
        } catch (legacyErr) {
          if (legacyErr.code === 'ENOENT' || legacyErr instanceof SyntaxError) return null;
          throw legacyErr;
        }
      }
      throw err;
    }
  }

  async saveUploadReceipt(uploadId, receipt) {
    await fs.promises.mkdir(this.uploadReceiptsDir, { recursive: true });
    await fs.promises.writeFile(
      this.getUploadReceiptPath(uploadId),
      JSON.stringify({ ...receipt, completedAt: new Date().toISOString() }),
      'utf8'
    );
  }

  async claimUploadReceipt(uploadId, receipt) {
    await fs.promises.mkdir(this.uploadReceiptsDir, { recursive: true });
    try {
      await fs.promises.writeFile(
        this.getUploadReceiptPath(uploadId),
        JSON.stringify({ ...receipt, completedAt: new Date().toISOString() }),
        { encoding: 'utf8', flag: 'wx' }
      );
      return true;
    } catch (err) {
      if (err.code === 'EEXIST') return false;
      throw err;
    }
  }

  async deleteUploadReceipt(uploadId) {
    this.legacyUploadReceiptNames.delete(path.basename(this.getLegacyUploadReceiptPath(uploadId)));
    await Promise.all([
      fs.promises.rm(this.getUploadReceiptPath(uploadId), { force: true }),
      fs.promises.rm(this.getLegacyUploadReceiptPath(uploadId), { force: true })
    ]);
  }

  async ensureStagedUploadFile(stagedPath) {
    try {
      const handle = await fs.promises.open(stagedPath, 'wx');
      await handle.close();
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }

  async saveChunk(uploadId, chunkIndex, chunkBuffer, chunkOffset = null, userId = null) {
    if (this.isUploadCancelled(uploadId)) {
      const err = new Error('Upload was cancelled');
      err.code = 'UPLOAD_CANCELLED';
      throw err;
    }
    const dir = this.getChunkUploadDir(uploadId);
    await fs.promises.mkdir(dir, { recursive: true });
    if (userId !== null) await this.assertUploadOwner(uploadId, userId, { create: true });

    const chunkPath = path.join(dir, `chunk_${chunkIndex}`);
    if (Number.isSafeInteger(chunkOffset) && chunkOffset >= 0) {
      const stagedPath = this.getStagedUploadPath(uploadId);
      await this.ensureStagedUploadFile(stagedPath);

      const handle = await fs.promises.open(stagedPath, 'r+');
      try {
        let written = 0;
        while (written < chunkBuffer.length) {
          const result = await handle.write(
            chunkBuffer,
            written,
            chunkBuffer.length - written,
            chunkOffset + written
          );
          written += result.bytesWritten;
        }
      } finally {
        await handle.close();
      }

      if (this.isUploadCancelled(uploadId)) {
        await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
        const err = new Error('Upload was cancelled');
        err.code = 'UPLOAD_CANCELLED';
        throw err;
      }

      const chunkDigest = crypto.createHash('sha256').update(chunkBuffer).digest('hex');
      await fs.promises.writeFile(chunkPath, JSON.stringify({
        offset: chunkOffset,
        length: chunkBuffer.length,
        digest: chunkDigest
      }));
      return;
    }

    // Legacy chunks are retained for uploads started by an older browser tab.
    await fs.promises.writeFile(chunkPath, chunkBuffer);
    if (this.isUploadCancelled(uploadId)) {
      await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
      const err = new Error('Upload was cancelled');
      err.code = 'UPLOAD_CANCELLED';
      throw err;
    }
  }

  async getUploadedChunks(uploadId, userId = null) {
    const dir = this.getChunkUploadDir(uploadId);
    if (!fs.existsSync(dir)) {
      return [];
    }
    if (userId !== null) await this.assertUploadOwner(uploadId, userId);
    const files = await fs.promises.readdir(dir);
    return files
      .filter(f => f.startsWith('chunk_'))
      .map(f => parseInt(f.split('_')[1], 10))
      .sort((a, b) => a - b);
  }

  getAvailableDiskSpace() {
    return fs.promises.statfs(this.storageRoot)
      .then(stats => Number(stats.bavail) * Number(stats.bsize))
      .catch(() => null);
  }

  async getChunkUploadSize(uploadId) {
    const chunkDir = this.getChunkUploadDir(uploadId);
    if (!fs.existsSync(chunkDir)) {
      return 0;
    }
    const stagedPath = this.getStagedUploadPath(uploadId);
    try {
      const stagedStats = await fs.promises.stat(stagedPath);
      return stagedStats.size;
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
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

  async checkStorageLimits(uploadId, { requiresCopy = true } = {}) {
    const fileSize = await this.getChunkUploadSize(uploadId);

    // Legacy uploads need a second full-size file while chunks are assembled.
    if (requiresCopy) {
      const freeSpace = await this.getAvailableDiskSpace();
      if (freeSpace !== null && freeSpace < fileSize) {
        throw new Error(`Insufficient physical disk space. Required: ${fileSize} bytes, Available: ${freeSpace} bytes.`);
      }
    }

    // Check maximum system storage (configured in .env).
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

  async hashFile(filePath) {
    const hasher = crypto.createHash('sha256');
    const readStream = fs.createReadStream(filePath);
    for await (const chunk of readStream) {
      hasher.update(chunk);
    }
    return hasher.digest('hex');
  }

  async getManifestChecksum(uploadId, totalChunks, expectedFileSize) {
    const chunkDir = this.getChunkUploadDir(uploadId);
    const manifestHasher = crypto.createHash('sha256');
    manifestHasher.update(`harbor-drive-chunks-v1:${totalChunks}:${expectedFileSize ?? ''}:`);

    for (let i = 0; i < totalChunks; i++) {
      const markerPath = path.join(chunkDir, `chunk_${i}`);
      let marker;
      try {
        marker = JSON.parse(await fs.promises.readFile(markerPath, 'utf8'));
      } catch {
        return null;
      }

      if (
        !Number.isSafeInteger(marker.offset) ||
        !Number.isSafeInteger(marker.length) ||
        typeof marker.digest !== 'string' ||
        !/^[a-f0-9]{64}$/.test(marker.digest)
      ) {
        return null;
      }

      manifestHasher.update(`${i}:${marker.offset}:${marker.length}:${marker.digest};`);
    }

    return manifestHasher.digest('hex');
  }

  async assembleChunks(uploadId, totalChunks, userId, originalFilename, expectedFileSize = null, uploadUserId = null) {
    const chunkDir = this.getChunkUploadDir(uploadId);
    const uploadedChunks = new Set(await this.getUploadedChunks(uploadId, uploadUserId));
    for (let i = 0; i < totalChunks; i++) {
      if (!uploadedChunks.has(i)) {
        throw new Error(`Missing chunk index ${i} for upload ${uploadId}`);
      }
    }

    const stagedPath = this.getStagedUploadPath(uploadId);
    const hasStagedUpload = await fs.promises.access(stagedPath)
      .then(() => true)
      .catch(() => false);

    const defaultChunksDir = path.join(this.storageRoot, '.chunks');
    const stagedOnSeparateRoot = path.resolve(this.chunksDir) !== path.resolve(defaultChunksDir);
    await this.checkStorageLimits(uploadId, { requiresCopy: !hasStagedUpload || stagedOnSeparateRoot });

    const ext = path.extname(originalFilename);
    const uniqueFilename = `${crypto.randomUUID()}${ext}`;
    const userDir = this.getUserStorageDir(userId);
    const destinationPath = path.join(userDir, uniqueFilename);

    if (hasStagedUpload) {
      const stagedStats = await fs.promises.stat(stagedPath);
      if (Number.isSafeInteger(expectedFileSize) && stagedStats.size !== expectedFileSize) {
        throw new Error(`Uploaded file size mismatch. Expected ${expectedFileSize} bytes, received ${stagedStats.size} bytes.`);
      }

      // New uploads hash each chunk while it is already in memory. The manifest
      // checksum avoids rereading very large files solely during finalization.
      const checksum = await this.getManifestChecksum(uploadId, totalChunks, expectedFileSize)
        || await this.hashFile(stagedPath);
      try {
        await fs.promises.rename(stagedPath, destinationPath);
      } catch (err) {
        if (err.code !== 'EXDEV') throw err;
        // A separate fast temp disk needs a copy. This runs in the background
        // finalize worker, so the browser is no longer held open by the sync.
        try {
          await fs.promises.copyFile(stagedPath, destinationPath);
        } catch (copyErr) {
          await fs.promises.rm(destinationPath, { force: true }).catch(() => {});
          throw copyErr;
        }
        await fs.promises.unlink(stagedPath);
      }
      await fs.promises.rm(chunkDir, { recursive: true, force: true });

      return {
        filename: uniqueFilename,
        path: path.relative(this.storageRoot, destinationPath).replace(/\\/g, '/'),
        size: stagedStats.size,
        checksum
      };
    }

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

  async saveUploadedBuffer(userId, originalFilename, buffer) {
    const ext = path.extname(originalFilename);
    const uniqueFilename = `${crypto.randomUUID()}${ext}`;
    const userDir = this.getUserStorageDir(userId);
    const destinationPath = path.join(userDir, uniqueFilename);
    await fs.promises.writeFile(destinationPath, buffer);

    return {
      filename: uniqueFilename,
      path: path.relative(this.storageRoot, destinationPath).replace(/\\/g, '/'),
      size: buffer.length,
      checksum: crypto.createHash('sha256').update(buffer).digest('hex')
    };
  }

  async deleteDiskFile(relativeStoragePath) {
    const fullPath = path.join(this.storageRoot, relativeStoragePath);
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        await fs.promises.unlink(fullPath);
        return;
      } catch (err) {
        if (err.code === 'ENOENT') return;
        if (!['EBUSY', 'EPERM'].includes(err.code) || attempt === 59) throw err;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
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

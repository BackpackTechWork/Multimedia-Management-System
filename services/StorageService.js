const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable, Transform } = require('stream');
const { pipeline } = require('stream/promises');
require('dotenv').config();

function batchUploadWrites() {
  let blocks = [];
  let bufferedBytes = 0;
  return new Transform({
    transform(block, encoding, callback) {
      if (bufferedBytes === 0 && block.length >= 512 * 1024) return callback(null, block);
      blocks.push(block);
      bufferedBytes += block.length;
      // Batch small socket buffers into bounded 512 KiB disk writes. Without
      // this, a fast disk pays for a filesystem operation per network packet.
      if (bufferedBytes < 512 * 1024) return callback();
      const batch = Buffer.concat(blocks, bufferedBytes);
      blocks = [];
      bufferedBytes = 0;
      callback(null, batch);
    },
    flush(callback) {
      if (bufferedBytes) this.push(Buffer.concat(blocks, bufferedBytes));
      blocks = [];
      bufferedBytes = 0;
      callback();
    }
  });
}

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
    this.activeChunkWrites = new Map();
    this.activeOwnerChecks = new Map();
    this.activeCopies = 0;
    this.copyWaiters = [];
    this.copyConcurrency = Math.max(1, Math.min(8, Number.parseInt(process.env.STORAGE_COPY_CONCURRENCY || '2', 10) || 2));
    
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
    const safeUploadId = String(uploadId || '');
    if (!/^[a-zA-Z0-9_-][a-zA-Z0-9._-]{0,199}$/.test(safeUploadId)) {
      throw Object.assign(new Error('Invalid upload id'), { status: 400 });
    }
    return path.join(this.chunksDir, safeUploadId);
  }

  getUploadOwnerPath(uploadId) {
    return path.join(this.getChunkUploadDir(uploadId), 'owner.json');
  }

  async assertUploadOwner(uploadId, userId, { create = false } = {}) {
    const key = this.getUploadOwnerPath(uploadId);
    const previous = this.activeOwnerChecks.get(key) || Promise.resolve();
    const checking = previous.catch(() => {}).then(() => this.checkUploadOwner(uploadId, userId, create));
    this.activeOwnerChecks.set(key, checking);
    try {
      return await checking;
    } finally {
      if (this.activeOwnerChecks.get(key) === checking) this.activeOwnerChecks.delete(key);
    }
  }

  async checkUploadOwner(uploadId, userId, create) {
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
        return this.checkUploadOwner(uploadId, userId, false);
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
    return this.saveChunkStream(uploadId, chunkIndex, Readable.from([chunkBuffer]), chunkOffset, userId);
  }

  async removeChunk(uploadId, chunkIndex) {
    await fs.promises.rm(path.join(this.getChunkUploadDir(uploadId), `chunk_${chunkIndex}`), { force: true });
  }

  async saveChunkStream(uploadId, chunkIndex, stream, chunkOffset = null, userId = null, fileSize = null) {
    const key = `${path.basename(this.getChunkUploadDir(uploadId))}:${chunkIndex}`;
    // A timed-out request may still be writing when its retry arrives. Serialize
    // that chunk only; other offsets and users continue transferring in parallel.
    const previous = this.activeChunkWrites.get(key) || Promise.resolve();
    const writing = previous.catch(() => {}).then(() =>
      this.writeChunkStream(uploadId, chunkIndex, stream, chunkOffset, userId, fileSize));
    this.activeChunkWrites.set(key, writing);
    try {
      return await writing;
    } finally {
      if (this.activeChunkWrites.get(key) === writing) this.activeChunkWrites.delete(key);
    }
  }

  async writeChunkStream(uploadId, chunkIndex, stream, chunkOffset, userId, fileSize) {
    if (this.isUploadCancelled(uploadId)) {
      const err = new Error('Upload was cancelled');
      err.code = 'UPLOAD_CANCELLED';
      throw err;
    }
    const dir = this.getChunkUploadDir(uploadId);
    await fs.promises.mkdir(dir, { recursive: true });
    if (userId !== null) await this.assertUploadOwner(uploadId, userId, { create: true });
    const receipt = await this.getUploadReceipt(uploadId);
    if (receipt && receipt.state !== 'failed') {
      throw Object.assign(new Error('Upload is already being finalized'), { status: 400 });
    }
    const chunkPath = path.join(dir, `chunk_${chunkIndex}`);
    const positioned = Number.isSafeInteger(chunkOffset) && chunkOffset >= 0;
    let targetPath = chunkPath;
    if (positioned) {
      const stagedPath = this.getStagedUploadPath(uploadId);
      await this.ensureStagedUploadFile(stagedPath);
      targetPath = stagedPath;
    }
    await this.removeChunk(uploadId, chunkIndex);
    const hasher = crypto.createHash('sha256');
    let size = 0;
    const service = this;
    const hashingStream = new Transform({
      transform(chunk, encoding, callback) {
        size += chunk.length;
        if (service.isUploadCancelled(uploadId)) {
          return callback(Object.assign(new Error('Upload was cancelled'), { code: 'UPLOAD_CANCELLED' }));
        }
        if (positioned && fileSize !== null && chunkOffset + size > fileSize) {
          return callback(Object.assign(new Error('Chunk exceeds declared file size'), { status: 400 }));
        }
        hasher.update(chunk);
        callback(null, chunk);
      }
    });
    try {
      await pipeline(stream, batchUploadWrites(), hashingStream, fs.createWriteStream(targetPath, positioned
        ? { flags: 'r+', start: chunkOffset, highWaterMark: 1024 * 1024 }
        : { flags: 'w', highWaterMark: 1024 * 1024 }));
      if (stream.truncated) throw Object.assign(new Error('Chunk exceeds upload limit'), { code: 'LIMIT_FILE_SIZE' });
      if (this.isUploadCancelled(uploadId)) {
        throw Object.assign(new Error('Upload was cancelled'), { code: 'UPLOAD_CANCELLED' });
      }
      const digest = hasher.digest('hex');
      if (positioned) {
        await fs.promises.writeFile(chunkPath, JSON.stringify({ offset: chunkOffset, length: size, digest }));
      }
      return { size, digest, uploadId, chunkIndex };
    } catch (err) {
      await this.removeChunk(uploadId, chunkIndex).catch(() => {});
      throw err;
    }
  }

  async stageIncomingFile(stream) {
    const incomingDir = path.join(this.chunksDir, '.incoming');
    await fs.promises.mkdir(incomingDir, { recursive: true });
    const incomingPath = path.join(incomingDir, crypto.randomUUID());
    const hasher = crypto.createHash('sha256');
    let size = 0;
    const hashingStream = new Transform({
      transform(chunk, encoding, callback) {
        size += chunk.length;
        hasher.update(chunk);
        callback(null, chunk);
      }
    });
    try {
      await pipeline(stream, batchUploadWrites(), hashingStream,
        fs.createWriteStream(incomingPath, { flags: 'wx', highWaterMark: 1024 * 1024 }));
      if (stream.truncated) throw Object.assign(new Error('File exceeds upload limit'), { code: 'LIMIT_FILE_SIZE' });
      return { path: incomingPath, size, checksum: hasher.digest('hex') };
    } catch (err) {
      await fs.promises.rm(incomingPath, { force: true }).catch(() => {});
      throw err;
    }
  }

  async copyFileStreaming(sourcePath, destinationPath) {
    // A single fs.copyFile holds a libuv worker for the entire multi-GB copy.
    // Bounded streams yield between reads/writes so new chunks and status I/O
    // can use the same pool even while final storage is slow.
    if (this.activeCopies >= this.copyConcurrency) {
      await new Promise(resolve => this.copyWaiters.push(resolve));
    } else {
      this.activeCopies += 1;
    }
    try {
      await pipeline(
        fs.createReadStream(sourcePath, { highWaterMark: 1024 * 1024 }),
        fs.createWriteStream(destinationPath, { flags: 'wx', highWaterMark: 1024 * 1024 })
      );
    } catch (err) {
      if (err.code !== 'EEXIST') await fs.promises.rm(destinationPath, { force: true }).catch(() => {});
      throw err;
    } finally {
      const next = this.copyWaiters.shift();
      if (next) next();
      else this.activeCopies -= 1;
    }
  }

  async moveStagedFile(sourcePath, destinationPath) {
    try {
      await fs.promises.rename(sourcePath, destinationPath);
    } catch (err) {
      if (err.code !== 'EXDEV') throw err;
      await this.copyFileStreaming(sourcePath, destinationPath);
      try {
        await fs.promises.unlink(sourcePath);
      } catch (unlinkErr) {
        await fs.promises.rm(destinationPath, { force: true }).catch(() => {});
        throw unlinkErr;
      }
    }
  }

  async saveUploadedFile(userId, originalFilename, staged) {
    const uniqueFilename = `${crypto.randomUUID()}${path.extname(originalFilename)}`;
    const userDir = path.join(this.storageRoot, `user_${userId}`);
    await fs.promises.mkdir(userDir, { recursive: true });
    const destinationPath = path.join(userDir, uniqueFilename);
    await this.moveStagedFile(staged.path, destinationPath);
    return { filename: uniqueFilename,
      path: path.relative(this.storageRoot, destinationPath).replace(/\\/g, '/'),
      size: staged.size, checksum: staged.checksum };
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

    let nextOffset = 0;
    for (let start = 0; start < totalChunks; start += 16) {
      let markers;
      try {
        markers = await Promise.all(Array.from({ length: Math.min(16, totalChunks - start) },
          (_, offset) => fs.promises.readFile(path.join(chunkDir, `chunk_${start + offset}`), 'utf8')
            .then(contents => JSON.parse(contents))));
      } catch {
        return null;
      }
      for (let offset = 0; offset < markers.length; offset++) {
        const marker = markers[offset];
        if (!marker || marker.offset !== nextOffset || !Number.isSafeInteger(marker.length) ||
            marker.length < 0 || (marker.length === 0 && totalChunks !== 1) ||
            typeof marker.digest !== 'string' || !/^[a-f0-9]{64}$/.test(marker.digest)) {
          return null;
        }
        nextOffset += marker.length;
        if (!Number.isSafeInteger(nextOffset)) return null;
        manifestHasher.update(`${start + offset}:${marker.offset}:${marker.length}:${marker.digest};`);
      }
    }
    if (Number.isSafeInteger(expectedFileSize) && nextOffset !== expectedFileSize) return null;
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
    const userDir = path.join(this.storageRoot, `user_${userId}`);
    await fs.promises.mkdir(userDir, { recursive: true });
    const destinationPath = path.join(userDir, uniqueFilename);

    if (hasStagedUpload) {
      const stagedStats = await fs.promises.stat(stagedPath);
      if (Number.isSafeInteger(expectedFileSize) && stagedStats.size !== expectedFileSize) {
        throw new Error(`Uploaded file size mismatch. Expected ${expectedFileSize} bytes, received ${stagedStats.size} bytes.`);
      }

      // New uploads hash each chunk while streaming to disk. The manifest
      // checksum avoids rereading very large files solely during finalization.
      const checksum = await this.getManifestChecksum(uploadId, totalChunks, expectedFileSize);
      if (!checksum) throw new Error('Staged upload verification failed; retry the selected file');
      await this.moveStagedFile(stagedPath, destinationPath);
      await fs.promises.rm(chunkDir, { recursive: true, force: true });

      return {
        filename: uniqueFilename,
        path: path.relative(this.storageRoot, destinationPath).replace(/\\/g, '/'),
        size: stagedStats.size,
        checksum
      };
    }

    const sha256Hasher = crypto.createHash('sha256');
    const chunks = Readable.from((async function* () {
      for (let i = 0; i < totalChunks; i++) {
        const chunkPath = path.join(chunkDir, `chunk_${i}`);
        for await (const block of fs.createReadStream(chunkPath)) yield block;
      }
    })());
    const hashingStream = new Transform({
      transform(block, encoding, callback) {
        sha256Hasher.update(block);
        callback(null, block);
      }
    });
    // Handle disk/SMB failures from the first write, including while waiting
    // for backpressure. Preserve staging so the upload can be retried.
    try {
      await pipeline(chunks, hashingStream, fs.createWriteStream(destinationPath, { flags: 'wx' }));
      const stats = await fs.promises.stat(destinationPath);
      if (Number.isSafeInteger(expectedFileSize) && stats.size !== expectedFileSize) {
        throw new Error(`Uploaded file size mismatch. Expected ${expectedFileSize} bytes, received ${stats.size} bytes.`);
      }
    } catch (error) {
      await fs.promises.rm(destinationPath, { force: true }).catch(() => {});
      throw error;
    }

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

    await this.copyFileStreaming(fullSrcPath, destinationPath);
    
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

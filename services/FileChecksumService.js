const crypto = require('crypto');
const { spawn } = require('child_process');
const { Transform } = require('stream');
const { db } = require('../config/db');
const { files } = require('../models/schema');
const { eq } = require('drizzle-orm');
const jobRepository = require('../repositories/JobRepository');

const PENDING_PREFIX = 'pending_';
const PENDING_DIGEST_LENGTH = 64 - PENDING_PREFIX.length;

class FileChecksumService {
  createPendingChecksum(storagePath, stats) {
    return PENDING_PREFIX + crypto
      .createHash('sha256')
      .update(`lazy-checksum-v1:${storagePath}:${stats.size}:${stats.mtimeMs}`)
      .digest('hex')
      .slice(0, PENDING_DIGEST_LENGTH);
  }

  isPendingChecksum(checksum) {
    return typeof checksum === 'string' && checksum.startsWith(PENDING_PREFIX);
  }

  async updateChecksum(fileId, checksum) {
    await db.update(files)
      .set({ checksum })
      .where(eq(files.id, fileId));
  }

  async finalizeChecksum(file, checksum) {
    await this.updateChecksum(file.id, checksum);
    if ((file.mimeType || '').startsWith('image/')) {
      await jobRepository.createJob('thumbnail', { fileId: file.id }).catch(err => {
        console.error(`Failed to queue thumbnail for file ${file.id}: ${err.message}`);
      });
    }
  }

  async updateChecksumFromBuffer(file, buffer) {
    if (!this.isPendingChecksum(file.checksum)) return file.checksum;

    const checksum = crypto.createHash('sha256').update(buffer).digest('hex');
    await this.finalizeChecksum(file, checksum);
    return checksum;
  }

  hydrateWindowsFile(fullPath) {
    if (process.platform !== 'win32') {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      let stderr = '';
      const child = spawn('powershell.exe', [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        '$p = $args[0]; $s = [IO.File]::OpenRead($p); $s.Dispose()',
        fullPath
      ], {
        windowsHide: true,
        stdio: ['ignore', 'ignore', 'pipe']
      });

      child.stderr.on('data', chunk => {
        stderr += chunk.toString();
      });

      child.on('error', err => {
        console.error(`Failed to start hydration helper for ${fullPath}: ${err.message}`);
        resolve(false);
      });
      child.on('exit', code => {
        if (code !== 0) {
          console.error(`Hydration helper failed for ${fullPath} with exit code ${code}: ${stderr.trim()}`);
        }
        resolve(code === 0);
      });
    });
  }

  createReadStreamWithHydration(file, fullPath, fs, streamOptions = null) {
    const stream = this.createHashingReadStream(file, fullPath, fs, streamOptions);
    let retried = false;

    stream.retryAfterHydration = async () => {
      if (retried) return null;
      retried = true;
      const hydrated = await this.hydrateWindowsFile(fullPath);
      if (!hydrated) return null;
      return this.createHashingReadStream(file, fullPath, fs, streamOptions);
    };

    return stream;
  }

  createHashingReadStream(file, fullPath, fs, streamOptions = null) {
    const source = fs.createReadStream(fullPath, streamOptions || undefined);
    if (!this.isPendingChecksum(file.checksum) || streamOptions) {
      return source;
    }

    const hasher = crypto.createHash('sha256');
    const hashingStream = new Transform({
      transform(chunk, encoding, callback) {
        hasher.update(chunk);
        callback(null, chunk);
      }
    });

    source.on('error', err => {
      hashingStream.destroy(err);
    });

    hashingStream.on('finish', () => {
      const checksum = hasher.digest('hex');
      this.finalizeChecksum(file, checksum).catch(err => {
        console.error(`Failed to update checksum for file ${file.id}: ${err.message}`);
      });
    });

    return source.pipe(hashingStream);
  }
}

module.exports = new FileChecksumService();

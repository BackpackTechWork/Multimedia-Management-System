const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mime = require('mime-types');
const { eq, and, sql } = require('drizzle-orm');
const { db, pool } = require('../config/db');
const { users, folders, files } = require('../models/schema');
const driveService = require('../services/DriveService');
const folderRepository = require('../repositories/FolderRepository');
const jobRepository = require('../repositories/JobRepository');
const storageService = require('../services/StorageService');

const DEFAULT_STABLE_WAIT_MS = 100;
const DEFAULT_SCAN_DEBOUNCE_MS = 750;
const DEFAULT_FILE_READ_RETRIES = 0;
const DEFAULT_FILE_READ_RETRY_MS = 2000;
const DEFAULT_CONCURRENCY = 8;
const USAGE = 'Usage: node scripts/import-user-files.js [all|userId|user_3] [--watch] [--stable-ms 100] [--concurrency 8] [--verbose]';

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const options = {
    userId: null,
    allUsers: argv.length === 0,
    watch: false,
    stableWaitMs: DEFAULT_STABLE_WAIT_MS,
    debounceMs: DEFAULT_SCAN_DEBOUNCE_MS,
    fileReadRetries: DEFAULT_FILE_READ_RETRIES,
    fileReadRetryMs: DEFAULT_FILE_READ_RETRY_MS,
    concurrency: DEFAULT_CONCURRENCY,
    verbose: false,
    visibility: 'private'
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--watch') {
      options.watch = true;
    } else if (arg === '--once') {
      options.watch = false;
    } else if (arg === '--stable-ms') {
      options.stableWaitMs = Number(argv[++i]);
    } else if (arg === '--debounce-ms') {
      options.debounceMs = Number(argv[++i]);
    } else if (arg === '--file-read-retries') {
      options.fileReadRetries = Number(argv[++i]);
    } else if (arg === '--file-read-retry-ms') {
      options.fileReadRetryMs = Number(argv[++i]);
    } else if (arg === '--concurrency') {
      options.concurrency = Number(argv[++i]);
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--visibility') {
      options.visibility = argv[++i];
    } else if (arg.toLowerCase() === 'all') {
      options.allUsers = true;
    } else if (!options.userId) {
      const match = arg.match(/^user_(\d+)$/i);
      options.userId = Number(match ? match[1] : arg);
    }
  }

  if (options.allUsers && options.userId) {
    throw new Error(USAGE);
  }

  if (!options.allUsers && (!Number.isInteger(options.userId) || options.userId <= 0)) {
    throw new Error(USAGE);
  }

  if (!Number.isFinite(options.stableWaitMs) || options.stableWaitMs < 100) {
    throw new Error('--stable-ms must be at least 100');
  }

  if (!Number.isFinite(options.debounceMs) || options.debounceMs < 100) {
    throw new Error('--debounce-ms must be at least 100');
  }

  if (!Number.isInteger(options.fileReadRetries) || options.fileReadRetries < 0) {
    throw new Error('--file-read-retries must be 0 or greater');
  }

  if (!Number.isFinite(options.fileReadRetryMs) || options.fileReadRetryMs < 100) {
    throw new Error('--file-read-retry-ms must be at least 100');
  }

  if (!Number.isInteger(options.concurrency) || options.concurrency < 1) {
    throw new Error('--concurrency must be at least 1');
  }

  if (!['private', 'public'].includes(options.visibility)) {
    throw new Error('--visibility must be private or public');
  }

  return options;
}

async function assertUserExists(userId) {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!rows[0]) {
    throw new Error(`User ${userId} does not exist in the database.`);
  }
}

async function getAllUserIds() {
  const rows = await db.select({ id: users.id }).from(users);
  return rows.map(row => row.id);
}

async function getDirectoryEntries(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  return {
    directories: entries
      .filter(entry => entry.isDirectory())
      .map(entry => path.join(dir, entry.name)),
    files: entries
      .filter(entry => entry.isFile())
      .map(entry => path.join(dir, entry.name))
  };
}

async function runLimited(items, limit, worker) {
  const results = [];
  let nextIndex = 0;

  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await worker(items[index], index);
    }
  }

  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, runWorker));
  return results;
}

async function getStableStats(filePath, stableWaitMs) {
  const first = await fs.promises.stat(filePath);
  if (!first.isFile()) return null;

  await sleep(stableWaitMs);

  const second = await fs.promises.stat(filePath);
  if (!second.isFile()) return null;

  if (first.size !== second.size || first.mtimeMs !== second.mtimeMs) {
    return null;
  }

  return second;
}

function isRetryableFileReadError(err) {
  return ['UNKNOWN', 'EBUSY', 'EPERM', 'EACCES', 'ENOENT'].includes(err?.code);
}

async function retryFileRead(filePath, options, operation) {
  let lastError;
  for (let attempt = 0; attempt <= options.fileReadRetries; attempt++) {
    try {
      return await operation();
    } catch (err) {
      lastError = err;
      if (!isRetryableFileReadError(err) || attempt === options.fileReadRetries) {
        throw err;
      }

      if (options.verbose) {
        console.log(`File is not readable yet, retrying (${attempt + 1}/${options.fileReadRetries}): ${toStoragePath(filePath)}`);
      }
      await sleep(options.fileReadRetryMs);
    }
  }

  throw lastError;
}

async function hashFile(filePath) {
  const hasher = crypto.createHash('sha256');
  const stream = fs.createReadStream(filePath);
  for await (const chunk of stream) {
    hasher.update(chunk);
  }
  return hasher.digest('hex');
}

function toStoragePath(filePath) {
  return path.relative(storageService.storageRoot, filePath).replace(/\\/g, '/');
}

async function fileRecordExists(userId, storagePath) {
  const rows = await db.select({ id: files.id })
    .from(files)
    .where(and(eq(files.userId, userId), eq(files.path, storagePath)))
    .limit(1);
  return Boolean(rows[0]);
}

async function findFolderByName(userId, parentId, name) {
  const rows = await db.select()
    .from(folders)
    .where(and(
      eq(folders.userId, userId),
      parentId ? eq(folders.parentId, parentId) : sql`${folders.parentId} IS NULL`,
      eq(folders.name, name)
    ))
    .limit(1);
  return rows[0] || null;
}

async function ensureFolder(userId, parentId, folderPath, pathPrefix, options) {
  const name = path.basename(folderPath);
  const existing = await findFolderByName(userId, parentId, name);
  if (existing) {
    return { folder: existing, created: false };
  }

  const folder = await folderRepository.createFolder(
    userId,
    parentId,
    name,
    pathPrefix,
    options.visibility
  );
  if (options.verbose) {
    console.log(`Created folder #${folder.id}: ${toStoragePath(folderPath)}`);
  }
  return { folder, created: true };
}

async function importFile(userId, filePath, folderId, options) {
  const storagePath = toStoragePath(filePath);
  if (await fileRecordExists(userId, storagePath)) {
    return { status: 'skipped', reason: 'already_imported', path: storagePath };
  }

  let stats;
  try {
    stats = await retryFileRead(
      filePath,
      options,
      () => getStableStats(filePath, options.stableWaitMs)
    );
  } catch (err) {
    if (isRetryableFileReadError(err)) {
      return { status: 'skipped', reason: 'not_readable', path: storagePath, error: err.message };
    }
    throw err;
  }

  if (!stats) {
    return { status: 'skipped', reason: 'still_changing', path: storagePath };
  }

  if (await fileRecordExists(userId, storagePath)) {
    return { status: 'skipped', reason: 'already_imported', path: storagePath };
  }

  const originalName = path.basename(filePath);
  const extension = path.extname(originalName).substring(1).toLowerCase();
  const mimeType = mime.lookup(originalName) || 'application/octet-stream';
  let checksum;
  try {
    checksum = await retryFileRead(filePath, options, () => hashFile(filePath));
  } catch (err) {
    if (isRetryableFileReadError(err)) {
      return { status: 'skipped', reason: 'not_readable', path: storagePath, error: err.message };
    }
    throw err;
  }

  const [result] = await db.insert(files).values({
    userId,
    folderId,
    filename: originalName,
    originalName,
    extension,
    mimeType,
    size: stats.size,
    path: storagePath,
    visibility: options.visibility,
    checksum
  });

  const fileId = result.insertId;
  if (mimeType.startsWith('image/')) {
    await jobRepository.createJob('thumbnail', { fileId }).catch(err => {
      console.error(`Failed to queue thumbnail for ${storagePath}: ${err.message}`);
    });
  }

  return { status: 'imported', fileId, path: storagePath };
}

async function scanDirectory(userId, dir, folderId, pathPrefix, options) {
  const entries = await getDirectoryEntries(dir);
  let imported = 0;
  let skipped = 0;
  let changing = 0;
  let foldersCreated = 0;

  for (const directoryPath of entries.directories) {
    try {
      const result = await ensureFolder(userId, folderId, directoryPath, pathPrefix, options);
      if (result.created) {
        foldersCreated += 1;
      }

      const childResult = await scanDirectory(
        userId,
        directoryPath,
        result.folder.id,
        result.folder.path,
        options
      );
      imported += childResult.imported;
      skipped += childResult.skipped;
      changing += childResult.changing;
      foldersCreated += childResult.foldersCreated;
    } catch (err) {
      skipped += 1;
      console.error(`Failed to import folder ${directoryPath}: ${err.message}`);
    }
  }

  const fileResults = await runLimited(entries.files, options.concurrency, async (filePath) => {
    try {
      const result = await importFile(userId, filePath, folderId, options);
      if (result.status === 'imported') {
        if (options.verbose) {
          console.log(`Imported #${result.fileId}: ${result.path}`);
        }
      }
      return result;
    } catch (err) {
      return {
        status: 'failed',
        path: toStoragePath(filePath),
        error: err.message
      };
    }
  });

  for (const result of fileResults) {
    if (result.status === 'imported') {
      imported += 1;
    } else {
      skipped += 1;
      if (result.reason === 'still_changing') {
        changing += 1;
        if (options.verbose) {
          console.log(`Waiting for copy to finish: ${result.path}`);
        }
      } else if (result.status === 'failed') {
        console.error(`Failed to import ${result.path}: ${result.error}`);
      } else if (result.reason === 'not_readable' && options.verbose) {
        console.log(`Skipped unreadable file: ${result.path} (${result.error})`);
      }
    }
  }

  return { imported, skipped, changing, foldersCreated };
}

async function scanUserDir(userId, userDir, options) {
  console.log(`Scanning user ${userId}: ${userDir}`);
  const result = await scanDirectory(userId, userDir, null, '/', options);

  if (result.imported > 0 || result.foldersCreated > 0) {
    await driveService.updateStorageStats(userId);
  }

  console.log(`User ${userId} scan complete. Created ${result.foldersCreated} folders, imported ${result.imported} files, skipped ${result.skipped}.`);
  return result;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const userIds = options.allUsers ? await getAllUserIds() : [options.userId];
  if (userIds.length === 0) {
    throw new Error('No users exist in the database.');
  }

  if (!options.allUsers) {
    await assertUserExists(options.userId);
  }

  const userDirs = userIds.map(userId => ({
    userId,
    userDir: storageService.getUserStorageDir(userId)
  }));
  console.log(options.watch ? 'Watching user directories:' : 'Scanning user directories:');
  userDirs.forEach(({ userDir }) => console.log(`- ${userDir}`));

  let scanInProgress = false;
  let rescanRequested = false;
  let timer = null;

  const runScan = async () => {
    if (scanInProgress) {
      rescanRequested = true;
      return;
    }

    scanInProgress = true;
    let lastResult = { changing: 0 };
    try {
      do {
        rescanRequested = false;
        lastResult = { changing: 0 };
        for (const { userId, userDir } of userDirs) {
          const result = await scanUserDir(userId, userDir, options);
          lastResult.changing += result.changing;
        }
      } while (rescanRequested);
    } finally {
      scanInProgress = false;
    }

    if (options.watch && lastResult.changing > 0) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        runScan().catch(err => console.error(`Scan failed: ${err.message}`));
      }, options.stableWaitMs + options.debounceMs);
    }
  };

  await runScan();

  if (!options.watch) {
    await pool.end();
    return;
  }

  console.log('Auto-import is running. Press Ctrl+C to stop.');
  const scheduleScan = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      runScan().catch(err => console.error(`Scan failed: ${err.message}`));
    }, options.debounceMs);
  };

  const watchers = userDirs.map(({ userDir }) => fs.watch(userDir, {
    persistent: true,
    recursive: true
  }, scheduleScan));

  process.on('SIGINT', async () => {
    clearTimeout(timer);
    watchers.forEach(watcher => watcher.close());
    await pool.end();
    process.exit(0);
  });
}

main().catch(async (err) => {
  console.error(err.message);
  await pool.end().catch(() => {});
  process.exit(1);
});

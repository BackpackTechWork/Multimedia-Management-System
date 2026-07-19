const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mime = require('mime-types');
const { eq, and } = require('drizzle-orm');
const { db, pool } = require('../config/db');
const { users, files } = require('../models/schema');
const driveService = require('../services/DriveService');
const jobRepository = require('../repositories/JobRepository');
const storageService = require('../services/StorageService');

const DEFAULT_STABLE_WAIT_MS = 1000;
const DEFAULT_SCAN_DEBOUNCE_MS = 750;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseArgs(argv) {
  const options = {
    userId: null,
    allUsers: false,
    watch: false,
    stableWaitMs: DEFAULT_STABLE_WAIT_MS,
    debounceMs: DEFAULT_SCAN_DEBOUNCE_MS,
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
    throw new Error('Usage: node scripts/import-user-files.js <all|userId|user_3> [--watch] [--stable-ms 1000]');
  }

  if (!options.allUsers && (!Number.isInteger(options.userId) || options.userId <= 0)) {
    throw new Error('Usage: node scripts/import-user-files.js <all|userId|user_3> [--watch] [--stable-ms 1000]');
  }

  if (!Number.isFinite(options.stableWaitMs) || options.stableWaitMs < 100) {
    throw new Error('--stable-ms must be at least 100');
  }

  if (!Number.isFinite(options.debounceMs) || options.debounceMs < 100) {
    throw new Error('--debounce-ms must be at least 100');
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

async function getDirectFiles(userDir) {
  const entries = await fs.promises.readdir(userDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile())
    .map(entry => path.join(userDir, entry.name));
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

async function importFile(userId, filePath, options) {
  const storagePath = toStoragePath(filePath);
  if (await fileRecordExists(userId, storagePath)) {
    return { status: 'skipped', reason: 'already_imported', path: storagePath };
  }

  const stats = await getStableStats(filePath, options.stableWaitMs);
  if (!stats) {
    return { status: 'skipped', reason: 'still_changing', path: storagePath };
  }

  if (await fileRecordExists(userId, storagePath)) {
    return { status: 'skipped', reason: 'already_imported', path: storagePath };
  }

  const originalName = path.basename(filePath);
  const extension = path.extname(originalName).substring(1).toLowerCase();
  const mimeType = mime.lookup(originalName) || 'application/octet-stream';
  const checksum = await hashFile(filePath);

  const [result] = await db.insert(files).values({
    userId,
    folderId: null,
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

async function scanUserDir(userId, userDir, options) {
  console.log(`Scanning user ${userId}: ${userDir}`);
  const diskFiles = await getDirectFiles(userDir);
  let imported = 0;
  let skipped = 0;
  let changing = 0;

  for (const filePath of diskFiles) {
    try {
      const result = await importFile(userId, filePath, options);
      if (result.status === 'imported') {
        imported += 1;
        console.log(`Imported #${result.fileId}: ${result.path}`);
      } else {
        skipped += 1;
        if (result.reason === 'still_changing') {
          changing += 1;
          console.log(`Waiting for copy to finish: ${result.path}`);
        }
      }
    } catch (err) {
      console.error(`Failed to import ${filePath}: ${err.message}`);
    }
  }

  if (imported > 0) {
    await driveService.updateStorageStats(userId);
  }

  console.log(`User ${userId} scan complete. Imported ${imported}, skipped ${skipped}.`);
  return { imported, skipped, changing };
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

  const watchers = userDirs.map(({ userDir }) => fs.watch(userDir, { persistent: true }, scheduleScan));

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

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const Module = require('node:module');
const { Readable } = require('node:stream');
const { test } = require('node:test');
const express = require('express');

function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, '..', relative);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = name => Object.hasOwn(mocks, name) ? mocks[name] : Module.createRequire(filename)(name);
  loaded._compile(fs.readFileSync(filename, 'utf8'), filename);
  return loaded.exports;
}

function setup(t, filesystem = fs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harbor-upload-test-'));
  const previous = { ...process.env };
  let storage;
  try {
    process.env.STORAGE_ROOT = path.join(root, 'storage');
    process.env.UPLOAD_TEMP_ROOT = path.join(root, 'staging');
    process.env.MAX_SYSTEM_STORAGE_GB = '';
    storage = load('services/StorageService.js', { fs: filesystem, dotenv: { config() {} } });
  } finally {
    for (const key of ['STORAGE_ROOT', 'UPLOAD_TEMP_ROOT', 'MAX_SYSTEM_STORAGE_GB']) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
  // Tests use fresh private directories and never access configured live storage.
  storage.checkStorageLimits = async () => {};
  t.after(() => fs.promises.rm(root, { recursive: true, force: true }));
  return { storage, root };
}

function dataStream(size, value) {
  return Readable.from((function* () {
    let remaining = size;
    while (remaining > 0) {
      const length = Math.min(64 * 1024, remaining);
      yield Buffer.alloc(length, value);
      remaining -= length;
    }
  })());
}

test('eight simultaneous 32 MiB uploads preserve every byte with out-of-order chunks', async t => {
  const { storage } = setup(t);
  const chunkSize = 8 * 1024 * 1024;
  const fileSize = 4 * chunkSize;
  const users = Array.from({ length: 8 }, (_, i) => i + 1);
  // Match the client's initial ownership handshake before its parallel chunks.
  await Promise.all(users.map(user => storage.saveChunkStream(`upload-${user}`, 0,
    dataStream(chunkSize, user), 0, user, fileSize)));
  await Promise.all(users.flatMap(user => [3, 1, 2].map(index =>
    storage.saveChunkStream(`upload-${user}`, index, dataStream(chunkSize, user + index),
      index * chunkSize, user, fileSize))));
  for (const user of users) {
    assert.deepEqual(await storage.getUploadedChunks(`upload-${user}`, user), [0, 1, 2, 3]);
    const expectedHash = crypto.createHash('sha256');
    for (let index = 0; index < 4; index++) {
      for await (const block of dataStream(chunkSize, user + index)) expectedHash.update(block);
    }
    const saved = await storage.assembleChunks(`upload-${user}`, 4, user, 'large.bin', fileSize, user);
    assert.equal(saved.size, fileSize);
    assert.equal(await storage.hashFile(path.join(storage.storageRoot, saved.path)), expectedHash.digest('hex'));
    assert.deepEqual(await storage.getUploadedChunks(`upload-${user}`, user), []);
  }
});

test('interrupted streams leave no resume marker and the chunk can be retried', async t => {
  const { storage } = setup(t);
  const broken = Readable.from((async function* () {
    yield Buffer.alloc(128 * 1024, 1);
    throw new Error('connection interrupted');
  })());
  await assert.rejects(storage.saveChunkStream('resume', 0, broken, 0, 1, 1024 * 1024), /interrupted/);
  assert.deepEqual(await storage.getUploadedChunks('resume', 1), []);
  await storage.saveChunkStream('resume', 0, dataStream(1024 * 1024, 2), 0, 1, 1024 * 1024);
  assert.deepEqual(await storage.getUploadedChunks('resume', 1), [0]);
  assert.equal(await storage.hashFile(storage.getStagedUploadPath('resume')),
    crypto.createHash('sha256').update(Buffer.alloc(1024 * 1024, 2)).digest('hex'));
});

test('overlapping retries of the same chunk serialize and keep the latest content', async t => {
  const { storage } = setup(t);
  await storage.assertUploadOwner('retry', 1, { create: true });
  await Promise.all([1, 2].map(value =>
    storage.saveChunkStream('retry', 0, dataStream(1024 * 1024, value), 0, 1, 1024 * 1024)));
  assert.equal(await storage.hashFile(storage.getStagedUploadPath('retry')),
    crypto.createHash('sha256').update(Buffer.alloc(1024 * 1024, 2)).digest('hex'));
});

test('simultaneous initial chunks cannot read a partially written ownership record', async t => {
  const { storage } = setup(t);
  await Promise.all([0, 1, 2, 3].map(index => storage.saveChunkStream('first-chunks', index,
    dataStream(1024, index), index * 1024, 1, 4096)));
  assert.deepEqual(await storage.getUploadedChunks('first-chunks', 1), [0, 1, 2, 3]);
  assert.equal(storage.activeOwnerChecks.size, 0);
});

test('finalization rejects gaps and overlaps even when the sparse file has the right size', async t => {
  const { storage } = setup(t);
  await storage.saveChunkStream('gap', 0, dataStream(1, 1), 0, 1, 4);
  await storage.saveChunkStream('gap', 1, dataStream(1, 2), 3, 1, 4);
  assert.equal(await storage.getChunkUploadSize('gap'), 4);
  assert.equal(await storage.getManifestChecksum('gap', 2, 4), null);
  await assert.rejects(storage.assembleChunks('gap', 2, 1, 'gap.bin', 4, 1), /verification failed/);
  await storage.saveChunkStream('overlap', 0, dataStream(3, 1), 0, 1, 4);
  await storage.saveChunkStream('overlap', 1, dataStream(2, 2), 2, 1, 4);
  assert.equal(await storage.getManifestChecksum('overlap', 2, 4), null);
});

test('bounds, ownership, cancellation and finalization checks precede acknowledging a chunk', async t => {
  const { storage } = setup(t);
  await assert.rejects(storage.saveChunkStream('bounds', 0, dataStream(2, 1), 0, 1, 1), /exceeds/);
  assert.deepEqual(await storage.getUploadedChunks('bounds', 1), []);
  await assert.rejects(storage.saveChunkStream('bounds', 0, dataStream(1, 1), 0, 2, 1), { code: 'UPLOAD_FORBIDDEN' });
  await storage.cancelUpload('bounds', 1);
  await assert.rejects(storage.saveChunkStream('bounds', 0, dataStream(1, 1), 0, 1, 1), { code: 'UPLOAD_CANCELLED' });
  await storage.saveUploadReceipt('finalized', { state: 'complete', userId: 1 });
  await assert.rejects(storage.saveChunkStream('finalized', 0, dataStream(1, 1), 0, 1, 1), /finalized/);
  for (const id of ['..', '.', '../escape', 'a/b', '.incoming']) assert.throws(() => storage.getChunkUploadDir(id), /Invalid/);
});

test('legacy chunk clients and empty uploads still finalize correctly', async t => {
  const { storage } = setup(t);
  await storage.saveChunkStream('legacy', 0, dataStream(128, 7), null, 1);
  const saved = await storage.assembleChunks('legacy', 1, 1, 'legacy.txt', 128, 1);
  assert.equal(await storage.hashFile(path.join(storage.storageRoot, saved.path)),
    crypto.createHash('sha256').update(Buffer.alloc(128, 7)).digest('hex'));
  await storage.saveChunkStream('empty', 0, dataStream(0, 0), 0, 1, 0);
  assert.equal((await storage.assembleChunks('empty', 1, 1, 'empty.txt', 0, 1)).size, 0);
});

test('cross-device finalization uses bounded streaming copies and removes partial failures', async t => {
  let active = 0;
  let peak = 0;
  const filesystem = { ...fs, promises: { ...fs.promises,
    rename: async () => { throw Object.assign(new Error('different disk'), { code: 'EXDEV' }); },
    copyFile: async () => { throw new Error('must stream instead of occupying a worker for a whole copy'); }
  }, createReadStream(filename, options) {
    active++;
    peak = Math.max(peak, active);
    const source = fs.createReadStream(filename, options);
    source.on('close', () => active--);
    return source;
  } };
  const { storage, root } = setup(t, filesystem);
  storage.copyConcurrency = 2;
  const staged = await Promise.all([1, 2, 3, 4, 5].map(value => storage.stageIncomingFile(dataStream(4 * 1024 * 1024, value))));
  const saved = await Promise.all(staged.map(file => storage.saveUploadedFile(1, 'shared.bin', file)));
  assert.ok(peak <= 2, `copy concurrency was ${peak}`);
  for (let i = 0; i < saved.length; i++) {
    assert.equal(saved[i].size, staged[i].size);
    assert.equal(await storage.hashFile(path.join(storage.storageRoot, saved[i].path)), staged[i].checksum);
    assert.equal(fs.existsSync(staged[i].path), false);
  }
  const partial = path.join(root, 'partial.bin');
  await assert.rejects(storage.copyFileStreaming(path.join(root, 'missing.bin'), partial), { code: 'ENOENT' });
  assert.equal(fs.existsSync(partial), false);
  const existing = path.join(root, 'existing.bin');
  await fs.promises.writeFile(existing, 'keep');
  await assert.rejects(storage.copyFileStreaming(path.join(storage.storageRoot, saved[0].path), existing), { code: 'EEXIST' });
  assert.equal(await fs.promises.readFile(existing, 'utf8'), 'keep');
});

test('multipart routes stream without buffers and clean up truncated or rejected uploads', async t => {
  const { storage } = setup(t);
  const { chunkUpload, sharedUpload } = load('middleware/upload.js', { '../services/StorageService': storage });
  const app = express();
  app.use((req, res, next) => { req.session = { userId: 1 }; next(); });
  app.post('/chunk', chunkUpload.single('chunk'), (req, res) => {
    assert.equal(req.file.buffer, undefined);
    res.json({ size: req.file.size });
  });
  app.post('/shared', sharedUpload.single('file'), async (req, res) => {
    assert.equal(req.file.buffer, undefined);
    await fs.promises.rm(req.file.path);
    res.sendStatus(403);
  });
  app.use((err, req, res, next) => res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : err.status || 500).json({ error: err.message }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const postChunk = async (id, bytes, declaredSize = bytes) => {
    const form = new FormData();
    form.append('uploadId', id);
    form.append('chunkIndex', '0');
    form.append('chunkOffset', '0');
    form.append('fileSize', String(declaredSize));
    form.append('chunk', new Blob([Buffer.alloc(bytes, 5)]), 'chunk_0');
    return fetch(`${base}/chunk`, { method: 'POST', body: form, signal: AbortSignal.timeout(10000) });
  };
  const good = await postChunk('http-good', 1024 * 1024);
  assert.equal(good.status, 200);
  assert.equal((await good.json()).size, 1024 * 1024);
  assert.equal((await postChunk('http-bounds', 1024, 10)).status, 400);
  assert.deepEqual(await storage.getUploadedChunks('http-bounds', 1), []);
  assert.equal((await postChunk('http-limit', 21 * 1024 * 1024)).status, 413);
  assert.deepEqual(await storage.getUploadedChunks('http-limit', 1), []);
  const form = new FormData();
  form.append('file', new Blob(['private file']), 'small.txt');
  assert.equal((await fetch(`${base}/shared`, { method: 'POST', body: form })).status, 403);
  assert.deepEqual(await fs.promises.readdir(path.join(storage.chunksDir, '.incoming')), []);
});

test('session bursts coalesce activity writes while still reading revocations and persisting changes', async () => {
  let reads = 0;
  let writes = 0;
  let sets = 0;
  let current = { data: JSON.stringify({ userId: 1 }), expiresAt: new Date(Date.now() + 86400000), lastActivityAt: new Date(0) };
  const repository = {
    findBySessionId: async () => { reads++; return current; },
    touchSession: async () => { writes++; await new Promise(resolve => setTimeout(resolve, 10)); },
    createOrUpdateSession: async (...args) => { sets++; assert.equal(args[2], '127.0.0.1'); },
    destroySession: async () => { current = null; }
  };
  const Store = load('config/sessionStore.js', { '../repositories/SessionRepository': repository });
  const store = new Store();
  const call = (method, ...args) => new Promise((resolve, reject) => store[method](...args, (err, value) => err ? reject(err) : resolve(value)));
  await call('get', 'sid');
  await Promise.all(Array.from({ length: 50 }, () => call('touch', 'sid', { userId: 1 })));
  assert.equal(writes, 1);
  await call('touch', 'sid', { userId: 1 });
  assert.equal(writes, 1);
  await call('set', 'sid', { userId: 1, ipAddress: '127.0.0.1', userRole: 'super_admin' });
  assert.equal(sets, 1);
  current = null; // revoked elsewhere, without touching this store's write cache
  assert.equal(await call('get', 'sid'), null);
  assert.equal(reads, 2);
  repository.touchSession = async () => { throw new Error('DB unavailable'); };
  await assert.rejects(call('touch', 'sid', {}), /DB unavailable/);
  assert.equal(store.pendingTouches.size, 0);
});

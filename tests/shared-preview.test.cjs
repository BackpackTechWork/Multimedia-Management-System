const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const express = require('express');

const root = path.resolve(__dirname, '..');
function load(relativePath, mocks) {
  const filename = path.join(root, relativePath);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = name => Object.hasOwn(mocks, name) ? mocks[name] : Module.createRequire(filename)(name);
  loaded._compile(fs.readFileSync(filename, 'utf8'), filename);
  return loaded.exports;
}

test('shared previews and streams authorize guests using the link', async () => {
  const file = { id: 1, userId: 7, folderId: 12, visibility: 'private', originalName: 'sample.txt',
    extension: 'txt', mimeType: 'text/plain', size: 12, path: 'package.json' };
  const baseShare = { id: 1, token: 'valid', fileId: 1, linkAccess: 'anyone' };
  let share = { ...baseShare };
  let session = {};
  const controller = load('controllers/PreviewController.js', {
    '../config/db': {}, '../models/schema': {},
    '../repositories/FileRepository': { findById: async id => id === 1 ? file : null },
    '../repositories/FolderRepository': { findById: async id => ({ id, path: id === 10 ? '10/' : '10/12/' }) },
    '../repositories/ShareRepository': {
      findByToken: async token => token === 'valid' ? share : null,
      userCanAccessShare: async () => false,
      userCanAccessFile: async () => { throw new Error('Guest must not use account authorization'); }
    },
    '../services/StorageService': { storageRoot: root },
    '../services/FileChecksumService': {
      createReadStreamWithHydration: (_file, filename, filesystem, options) => filesystem.createReadStream(filename, options)
    }
  });
  const auth = load('middleware/auth.js', {
    '../repositories/SessionRepository': {}, '../repositories/UserRepository': {}
  });
  const router = load('routes/preview.js', {
    '../controllers/PreviewController': controller, '../middleware/auth': auth
  });
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(root, 'views'));
  app.locals.formatBytes = size => `${size} B`;
  app.use((req, res, next) => { req.session = session; next(); });
  app.use('/preview', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const get = (route, options = {}) => fetch(`http://127.0.0.1:${server.address().port}/preview/${route}`, {
    redirect: 'manual', signal: AbortSignal.timeout(5000), ...options
  });
  try {
    for (const type of ['image', 'pdf', 'excel', 'word', 'presentation', 'video', 'audio', 'unsupported']) {
      const response = await get(`${type}/1?shareToken=valid`);
      assert.equal(response.status, 200, type);
      assert.match(await response.text(), /data-stream-url="\/preview\/stream\/1\?shareToken=valid"/);
    }
    const stream = await get('stream/1?shareToken=valid');
    assert.equal(stream.status, 200);
    assert.equal(await stream.text(), fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const range = await get('stream/1?shareToken=valid', { headers: { Range: 'bytes=0-3' } });
    assert.equal(range.status, 206);
    assert.equal((await range.arrayBuffer()).byteLength, 4);
    share = { ...baseShare, fileId: null, folderId: 10 };
    assert.equal((await get('image/1?shareToken=valid')).status, 200, 'nested shared folder');
    for (const deniedShare of [null, { ...baseShare, expiresAt: new Date(0) },
      { ...baseShare, linkAccess: 'restricted' }, { ...baseShare, passwordHash: 'locked' },
      { ...baseShare, fileId: 2 }]) {
      share = deniedShare;
      for (const route of ['image/1', 'stream/1', 'zip-entry/1?path=sample.txt']) {
        const separator = route.includes('?') ? '&' : '?';
        assert.equal((await get(`${route}${separator}shareToken=valid`)).status, 403, route);
      }
    }
    share = { ...baseShare, passwordHash: 'locked' };
    session = { sharedAccess: { valid: true } };
    assert.equal((await get('image/1?shareToken=valid')).status, 200, 'unlocked password');
    assert.equal((await get('image/1?shareToken=unknown')).status, 403);
    const privatePreview = await get('image/1');
    assert.equal(privatePreview.status, 302);
    assert.equal(privatePreview.headers.get('location'), '/auth/login');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');
const express = require('express');
const session = require('express-session');
const bcrypt = require('bcrypt');

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

test('password shares work without an account; restricted shares also require an invited account', async () => {
  const passwordHash = await bcrypt.hash('guest-password', 4);
  const baseShare = { id: 1, token: 'valid', createdById: 7, fileId: 1,
    linkAccess: 'anyone', passwordHash, allowDownload: true };
  let share = { ...baseShare };
  const file = { id: 1, userId: 7, folderId: 10, path: 'package.json',
    originalName: 'sample.json', extension: 'json', mimeType: 'application/json' };
  const folder = { id: 10, userId: 7, path: '10/', name: 'Shared folder' };
  const controller = load('controllers/ShareController.js', {
    '../config/db': { db: { select: () => ({ from: () => ({ where: async () => [folder] }) }) } },
    '../models/schema': { folders: { id: 'id' } },
    '../repositories/ShareRepository': {
      findByToken: async token => token === 'valid' ? share : null,
      userCanAccessShare: async userId => userId === 9
    },
    '../repositories/FileRepository': { findById: async () => file, findFilesInFolder: async () => [{ files: file }] },
    '../repositories/FolderRepository': { findById: async () => folder, findSubfolders: async () => [] },
    '../repositories/UserRepository': { findById: async () => ({ name: 'Owner' }) },
    '../repositories/JobRepository': {},
    '../services/UploadConflictService': {},
    '../services/StorageService': { storageRoot: root },
    '../services/DriveService': {},
    '../services/FileChecksumService': {
      createReadStreamWithHydration: (_file, filename, filesystem) => filesystem.createReadStream(filename)
    }
  });
  const router = load('routes/share.js', {
    '../controllers/ShareController': controller,
    '../middleware/upload': { sharedUpload: { single: () => (_req, _res, next) => next() } },
    '../middleware/auth': { authGuard: () => { throw new Error('Public shares must not require account authentication'); } },
    '../middleware/security': { csrfProtection: (_req, _res, next) => next() }
  });
  const app = express();
  app.use(express.urlencoded({ extended: false }));
  app.use(session({ secret: 'share-password-test', resave: false, saveUninitialized: false }));
  app.use((req, res, next) => {
    // Exercise signed-in and guest requests without creating real accounts.
    if (req.headers['x-test-user']) req.session.userId = Number(req.headers['x-test-user']);
    res.render = (view, data) => res.json({ view, ...data });
    next();
  });
  app.use('/share', router);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const request = (route = '', options = {}) => fetch(`http://127.0.0.1:${server.address().port}/share/valid${route}`, {
    redirect: 'manual', signal: AbortSignal.timeout(5000), ...options
  });
  const unlock = (password, headers = {}) => request('/password', {
    method: 'POST', headers, body: new URLSearchParams({ password })
  });
  try {
    for (const isFolder of [false, true]) {
      share = { ...baseShare, fileId: isFolder ? null : 1, folderId: isFolder ? 10 : null };
      assert.equal((await (await request()).json()).view, 'share/password');
      assert.equal((await request('/download?fileId=1')).status, 403);
      const wrong = await unlock('wrong');
      assert.equal((await wrong.json()).error, 'Incorrect password');
      assert.equal(wrong.headers.get('set-cookie'), null, 'wrong password must not unlock a session');

      const unlocked = await unlock('guest-password');
      assert.equal(unlocked.status, 302);
      assert.equal(unlocked.headers.get('location'), '/share/valid');
      const cookie = unlocked.headers.get('set-cookie').split(';')[0];
      const headers = { cookie };
      const opened = await (await request('', { headers })).json();
      assert.equal(opened.view, 'share/public');
      assert.equal(opened.isFolder, isFolder);
      const downloaded = await request('/download?fileId=1', { headers });
      assert.equal(downloaded.status, 200);
      assert.equal(await downloaded.text(), fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
      if (isFolder) {
        assert.equal((await (await request('/folders/10', { headers })).json()).view, 'share/public');
      }

      // Changing access must enforce account restrictions even for an unlocked guest.
      share.linkAccess = 'restricted';
      for (const route of ['', '/download?fileId=1']) {
        assert.equal((await request(route, { headers })).status, 403);
      }
      const denied = await unlock('guest-password', headers);
      assert.equal(denied.status, 403);
      assert.equal((await denied.json()).view, 'share/restricted');
      assert.equal((await unlock('guest-password', { 'x-test-user': '8' })).status, 403);
      const invited = await unlock('guest-password', { 'x-test-user': '9' });
      assert.equal(invited.status, 302);
      const invitedHeaders = { cookie: invited.headers.get('set-cookie').split(';')[0] };
      assert.equal((await (await request('', { headers: invitedHeaders })).json()).view, 'share/public');
    }
    share = { ...baseShare, expiresAt: new Date(0) };
    assert.equal((await unlock('guest-password')).status, 410);
    share = { ...baseShare, passwordHash: null };
    assert.equal((await unlock('')).status, 302, 'removed passwords should return to the share');
    share = null;
    assert.equal((await unlock('guest-password')).status, 404);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

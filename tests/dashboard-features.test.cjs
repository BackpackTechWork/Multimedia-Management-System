const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const sharp = require('sharp');
const ejs = require('ejs');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
function load(file, mocks) {
  const filename = path.join(root, file);
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.paths = Module._nodeModulePaths(path.dirname(filename));
  loaded.require = name => Object.hasOwn(mocks, name) ? mocks[name] : Module.createRequire(filename)(name);
  loaded._compile(fs.readFileSync(filename, 'utf8'), filename);
  return loaded.exports;
}

test('everyone access is opt-in and excludes files inside trashed ancestors', async () => {
  const previous = process.env.EVERYONE_FILES_ENABLED;
  const folder = { id: 12, path: '3/9/12/' };
  let owner = { id: 8, role: 'user' };
  let deleted = [];
  const expression = (op, ...args) => ({ op, args });
  const schema = {
    folders: { id: 'id' }, users: { id: 'id', role: 'role' },
    trashItems: { id: 'id', entityType: 'entityType', entityId: 'entityId' }
  };
  function matches(row, clause) {
    const [a, b] = clause.args;
    if (clause.op === 'eq') return row[a] === b;
    if (clause.op === 'inArray') return b.includes(row[a]);
    return clause.op === 'and' ? clause.args.every(c => matches(row, c)) : clause.args.some(c => matches(row, c));
  }
  let reads = 0;
  const service = load('services/EveryoneFilesService.js', {
    '../models/schema': schema,
    'drizzle-orm': Object.fromEntries(['eq', 'and', 'or', 'inArray'].map(op => [op, (...args) => expression(op, ...args)])),
    '../config/db': { db: { select: () => ({ from: table => ({ where: clause => ({ limit: async () => {
      reads++;
      return table === schema.users ? (owner ? [owner] : []) : table === schema.folders ? [folder] : deleted.filter(row => matches(row, clause));
    } }) }) }) } }
  });
  try {
    delete process.env.EVERYONE_FILES_ENABLED;
    assert.equal(await service.canRead({ id: 20, folderId: 12 }, 'file'), false);
    assert.equal(reads, 0);
    process.env.EVERYONE_FILES_ENABLED = 'true';
    assert.equal(await service.canRead({ id: 20, folderId: 12 }, 'file'), true);
    deleted = [{ id: 1, entityType: 'folder', entityId: 3 }];
    assert.equal(await service.canRead({ id: 20, folderId: 12 }, 'file'), false);
    assert.equal(await service.canRead(folder, 'folder'), false);
    deleted = [{ id: 2, entityType: 'file', entityId: 20 }];
    assert.equal(await service.canRead({ id: 20 }, 'file'), false);
    assert.equal(await service.canRead({ id: 21 }, 'file'), true);
    assert.equal(service.isVisibleOwner(owner, 7), true);
    assert.equal(service.isVisibleOwner(owner, '8'), false);
    owner = { id: 8, role: 'super_admin' };
    assert.equal(service.isVisibleOwner(owner, 7), false);
    assert.equal(await service.canRead({ id: 21, userId: 8 }, 'file'), false);
    assert.equal(await service.canRead(folder, 'folder'), false);
    owner = null;
    assert.equal(await service.canRead({ id: 21, userId: 8 }, 'file'), false);
  } finally {
    if (previous === undefined) delete process.env.EVERYONE_FILES_ENABLED;
    else process.env.EVERYONE_FILES_ENABLED = previous;
  }
});

test('everyone browsing grants reads without writes, stays disabled by default, and rejects mismatched owners', async () => {
  let enabled = true;
  let owner = { id: 8, role: 'user' };
  const everyone = { isEnabled: () => enabled, canRead: async item => enabled && Boolean(item),
    isVisibleOwner: require('../services/EveryoneFilesService').isVisibleOwner };
  const file = { id: 4, userId: 8, visibility: 'private' };
  const mocks = {
    '../config/db': { db: {} }, '../services/EveryoneFilesService': everyone,
    '../repositories/FileRepository': { findById: async () => file },
    '../repositories/FolderRepository': { findById: async () => ({ id: 12, userId: 9 }) },
    '../repositories/UserRepository': { findById: async () => owner },
    '../repositories/ShareRepository': { userCanAccessFile: async () => false,
      userCanAccessFolder: async () => false, userCanEditFile: async () => false, userCanEditFolder: async () => false },
    '../services/StorageService': {}, '../services/DriveService': {},
    '../services/UploadConflictService': {}, '../services/FileChecksumService': {},
    '../repositories/SessionRepository': {}, '../repositories/JobRepository': {}
  };
  const controller = load('controllers/DriveController.js', mocks);
  const req = { session: { userId: 7, userRole: 'user' }, path: '/everyone/8', params: { ownerId: '8' }, query: {} };
  assert.equal(await controller.canAccessFile(req, file), true);
  assert.equal(await controller.canEditFile(req, file), false);
  assert.equal(await controller.canEditFolder(req, { id: 12, userId: 8 }), false);
  enabled = false;
  assert.equal(await controller.canAccessFile(req, file), false);
  let status;
  await controller.renderDashboard(req, { sendStatus: value => { status = value; } });
  assert.equal(status, 404);
  enabled = true;
  req.session.userId = 8;
  await controller.renderDashboard(req, { sendStatus: value => { status = value; } });
  assert.equal(status, 404, 'Own drive is excluded from everyone routes');
  req.session.userId = 7;
  owner = { id: 8, role: 'super_admin' };
  await controller.renderDashboard(req, { sendStatus: value => { status = value; } });
  assert.equal(status, 404, 'Super admin drives cannot be browsed through direct everyone routes');
  owner = { id: 8, role: 'user' };
  req.params.folderId = '12';
  await controller.renderDashboard(req, { sendStatus: value => { status = value; } });
  assert.equal(status, 404);
  const preview = load('controllers/PreviewController.js', mocks);
  assert.equal(await preview.checkAccess({ session: { userId: 7 }, query: {} }, 4, { recordRecent: false }), file);
  assert.equal(await preview.checkAccess({ session: {}, query: {} }, 4, { recordRecent: false }), null);
  enabled = false;
  assert.equal(await preview.checkAccess({ session: { userId: 7 }, query: {} }, 4, { recordRecent: false }), null);
});

test('avatars persist across service reloads, normalize images, and reject invalid data', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mms-avatars-'));
  const mocks = { './StorageService': { chunksDir: directory } };
  try {
    const service = load('services/AvatarService.js', mocks);
    const buffer = await sharp({ create: { width: 400, height: 200, channels: 3, background: '#008080' } }).png().toBuffer();
    await service.save(7, buffer);
    const reloaded = load('services/AvatarService.js', mocks);
    assert.equal(reloaded.avatarPath(7), path.join(directory, '.profile-pictures', '7.webp'));
    const metadata = await sharp(fs.readFileSync(reloaded.avatarPath(7))).metadata();
    assert.equal(metadata.width, 256);
    assert.equal(metadata.height, 256);
    assert.equal(metadata.format, 'webp');
    const original = fs.readFileSync(service.avatarPath(7));
    await assert.rejects(service.save(7, Buffer.from('not an image')));
    assert.deepEqual(fs.readFileSync(service.avatarPath(7)), original);
    assert.throws(() => service.avatarPath('../7'));
    await service.save(7, buffer);
    assert.deepEqual(fs.readdirSync(path.dirname(service.avatarPath(7))), ['7.webp']);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('profile-picture routes enforce CSRF, upload limits, authenticated serving, and removal', async () => {
  const express = require('express');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mms-avatar-routes-'));
  const service = load('services/AvatarService.js', { './StorageService': { chunksDir: directory } });
  const next = (_req, _res, done) => done();
  const handlers = new Proxy({ renderProfile: (req, res) => res.json({
    csrf: req.csrfToken(), error: req.session.profileError
  }) }, { get: (object, key) => object[key] || ((_req, res) => res.end()) });
  const router = load('routes/auth.js', {
    '../controllers/AuthController': handlers, '../controllers/UmsAuthController': handlers,
    '../services/UmsAuthService': { isEnabled: () => false },
    '../services/AvatarService': service,
    '../middleware/auth': { authGuard: (req, res, done) => req.session.userId ? done() : res.sendStatus(401), guestGuard: next },
    '../middleware/security': { authLimiter: next, csrfProtection: require('csurf')() }
  });
  const app = express();
  app.use(require('express-session')({ secret: 'test-only-avatar-session-secret', resave: false, saveUninitialized: true }));
  app.use(express.urlencoded({ extended: false }));
  let signedIn = true;
  app.use((req, _res, done) => { req.session.userId = signedIn ? 7 : null; done(); });
  app.use('/auth', router);
  app.use((error, _req, res, _next) => res.sendStatus(error.status || 500));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}/auth`;
  try {
    const initial = await fetch(`${base}/profile`);
    const cookie = initial.headers.get('set-cookie').split(';')[0];
    const { csrf } = await initial.json();
    const fallback = await fetch(`${base}/avatars/7`, { headers: { cookie } });
    assert.equal(fallback.status, 200);
    assert.match(fallback.headers.get('content-type'), /image\/svg\+xml/);
    const originalFallback = await fallback.text();
    assert.match(originalFallback, /<svg/);
    const otherFallback = await fetch(`${base}/avatars/8`, { headers: { cookie } }).then(r => r.text());
    assert.notEqual(otherFallback, originalFallback);
    const image = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#008080' } }).png().toBuffer();
    const form = buffer => { const data = new FormData(); data.append('avatar', new Blob([buffer]), 'picture.png'); return data; };
    const post = (url, data) => fetch(`${base}${url}`, { method: 'POST', headers: { cookie }, body: data, redirect: 'manual' });
    assert.equal((await post('/profile/avatar', form(image))).status, 403);
    assert.equal(fs.existsSync(service.avatarPath(7)), false);
    assert.equal(await fetch(`${base}/avatars/7`, { headers: { cookie } }).then(r => r.text()), originalFallback);
    assert.equal((await post(`/profile/avatar?_csrf=${csrf}`, form(image))).status, 302);
    const saved = await fetch(`${base}/avatars/7`, { headers: { cookie } });
    assert.equal(saved.status, 200);
    assert.match(saved.headers.get('content-type'), /image\/webp/);
    assert.match(saved.headers.get('cache-control'), /private/);
    await saved.arrayBuffer();
    assert.equal((await post(`/profile/avatar?_csrf=${csrf}`, form(Buffer.alloc(5 * 1024 * 1024 + 1)))).status, 302);
    const status = await fetch(`${base}/profile`, { headers: { cookie } }).then(r => r.json());
    assert.match(status.error, /5 MB/);
    assert.equal((await post('/profile/avatar/remove', new URLSearchParams({ _csrf: csrf }))).status, 302);
    assert.equal(fs.existsSync(service.avatarPath(7)), false);
    assert.equal(await fetch(`${base}/avatars/7`, { headers: { cookie } }).then(r => r.text()), originalFallback,
      'Removing an uploaded picture restores the same Blobatar');
    signedIn = false;
    assert.equal((await fetch(`${base}/avatars/7`, { headers: { cookie } })).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

const baseLocals = {
  tab: 'my-drive', userId: 7, userName: 'Example', userEmail: 'example@example.com',
  csrfToken: 'test', currentFolderId: null, currentFolder: null, currentFolderCanEdit: true,
  breadcrumbs: [], folders: [], files: [], sharedSections: null,
  starredFolderIds: new Set(), starredFileIds: new Set(), searchQuery: '', fileType: 'all',
  availableFileTypes: [], sortBy: 'date', sortOrder: 'desc', allUserFolders: [],
  userRootFolders: [], shareUsers: [], storageStats: { totalSize: 0 }, formatBytes: n => `${n} B`
};

test('Blobatar eyes track the cursor across the page, retain photos, and respect reduced motion', async () => {
  const { blobatar } = await import('blobatar/blob');
  const dom = new JSDOM('<img data-blobatar-gaze src="/auth/avatars/7" alt="Your picture"><img data-blobatar-gaze src="/auth/avatars/7" alt=""><img data-blobatar-gaze src="/auth/avatars/8" alt="Photo">', {
    url: 'http://localhost/', runScripts: 'outside-only'
  });
  const w = dom.window;
  let frame;
  let motionChanged;
  let requests = 0;
  const motion = { matches: false, addEventListener: (_event, callback) => { motionChanged = callback; } };
  w.matchMedia = () => motion;
  w.requestAnimationFrame = callback => { frame = callback; return 1; };
  w.fetch = async url => {
    requests++;
    return { ok: true, headers: { get: () => url.endsWith('/8') ? 'image/webp' : 'image/svg+xml' },
      text: async () => blobatar('harbor-drive-user-7') };
  };
  try {
    w.eval(fs.readFileSync(path.join(root, 'public/js/avatar-gaze.js'), 'utf8'));
    await new Promise(resolve => setImmediate(resolve));
    const avatars = w.document.querySelectorAll('svg');
    assert.equal(avatars.length, 2);
    assert.equal(requests, 2, 'Two instances of the same avatar share a request');
    assert.equal(w.document.querySelectorAll('img').length, 1, 'Uploaded photo stays an ordinary image');
    assert.equal(avatars[0].getAttribute('aria-label'), 'Your picture');
    avatars.forEach(svg => { svg.getBoundingClientRect = () => ({ left: 100, top: 100, width: 80, height: 80 }); });
    frame();
    const eyes = avatars[0].lastElementChild;
    w.dispatchEvent(new w.MouseEvent('pointermove', { clientX: 1000, clientY: 140 }));
    frame();
    assert.equal(eyes.getAttribute('transform'), 'translate(3.50 0.00)');
    w.dispatchEvent(new w.MouseEvent('pointermove', { clientX: 0, clientY: 140 }));
    frame();
    assert.equal(eyes.getAttribute('transform'), 'translate(-3.50 0.00)');
    motion.matches = true;
    motionChanged();
    frame();
    assert.equal(eyes.getAttribute('transform'), 'translate(0.00 0.00)');
    assert.equal(eyes.style.transition, 'none');
  } finally { w.close(); }
});

test('dashboard restores list layout before cards and empty toolbar actions give feedback', async () => {
  const html = await ejs.renderFile(path.join(root, 'views/dashboard/index.ejs'), baseLocals);
  const dom = new JSDOM(html, { url: 'http://localhost/', runScripts: 'outside-only', pretendToBeVisual: true });
  const w = dom.window;
  try {
    w.localStorage.setItem('harbor-drive-layout', 'list');
    for (const script of w.document.querySelectorAll('script:not([src])')) {
      if (script.textContent.includes('Restore the layout') || script.textContent.includes('var listLayout')) w.eval(script.textContent);
    }
    assert.ok(w.document.getElementById('items-grid-container').classList.contains('drive-layout-list'));
    assert.equal(w.document.getElementById('layout-list-btn').getAttribute('aria-pressed'), 'true');
    w.matchMedia = () => ({ matches: false, addEventListener() {} });
    w.ResizeObserver = class { observe() {} };
    w.fetch = async () => ({ ok: true, json: async () => ({}) });
    w.eval(fs.readFileSync(path.join(root, 'public/js/drive.js'), 'utf8'));
    w.document.dispatchEvent(new w.Event('DOMContentLoaded'));
    const notices = [];
    w.showDriveToast = message => notices.push(message);
    let targetClicks = 0;
    for (const button of w.document.querySelectorAll('.drive-action-bar button')) {
      button.addEventListener('click', () => targetClicks++);
      button.click();
    }
    assert.equal(notices.length, w.document.querySelectorAll('.drive-action-bar button').length);
    assert.equal(targetClicks, 0, 'No action runs without a selection');
  } finally { w.close(); }
});

test('everyone directory and owner drive render with navigation and no upload empty-state advice', async () => {
  for (const owner of [null, { id: 8, name: 'Second user' }]) {
    const html = await ejs.renderFile(path.join(root, 'views/dashboard/index.ejs'), {
      ...baseLocals, tab: 'everyone', everyoneFilesEnabled: true,
      everyoneOwner: owner, people: owner ? null : [{ id: 8, name: 'Second user' }], currentFolderCanEdit: false
    });
    assert.match(html, /css\/drive.css/);
    assert.match(html, /js\/drive.js/);
    assert.match(html, /\/everyone\/8/);
    assert.doesNotMatch(html, /Drag and drop files here to upload/);
    assert.equal(html.includes('This directory is empty'), Boolean(owner));
  }
});

const assert = require('node:assert/strict');
const { test } = require('node:test');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const express = require('express');
const session = require('express-session');
const { UmsAuthService, config } = require('../services/UmsAuthService');
const safeReturnTo = require('../utils/safeReturnTo');

const settings = { hub: 'https://ums.example', clientId: 'mms-client',
  clientSecret: 'server-only-secret', redirectUri: 'https://mms.example/auth/ums/callback' };

function load(file, mocks) {
  const filename = path.resolve(__dirname, '..', file);
  const instance = new Module(filename, module);
  instance.filename = filename;
  instance.paths = Module._nodeModulePaths(path.dirname(filename));
  instance.require = name => Object.hasOwn(mocks, name) ? mocks[name] : Module.createRequire(filename)(name);
  instance._compile(fs.readFileSync(filename, 'utf8'), filename);
  return instance.exports;
}

test('configuration hides incomplete clients and requires HTTPS in production', () => {
  const env = { UMS_CLIENT_ID: 'client', UMS_CLIENT_SECRET: 'secret',
    UMS_REDIRECT_URI: 'https://mms.example/auth/ums/callback', NODE_ENV: 'production' };
  assert.ok(config(env));
  for (const key of ['UMS_CLIENT_ID', 'UMS_CLIENT_SECRET', 'UMS_REDIRECT_URI']) {
    assert.equal(config({ ...env, [key]: '' }), null);
  }
  for (const url of ['http://mms.example/callback', 'https://user:pass@mms.example/callback',
    'https://mms.example/callback#fragment', 'https://mms.example/callback?query=1']) {
    assert.equal(config({ ...env, UMS_REDIRECT_URI: url }), null);
  }
  assert.equal(config({ ...env, UMS_BASE_URL: 'https://ums.example/path' }), null);
  assert.ok(config({ ...env, NODE_ENV: 'development', UMS_REDIRECT_URI: 'http://localhost:3000/auth/ums/callback' }));
});

test('return paths reject external URLs, backslashes, and control characters', () => {
  for (const bad of ['//evil.example', '/\\evil.example', 'https://evil.example', '/\n/evil', {}, ['//evil']]) {
    assert.equal(safeReturnTo(bad), null);
  }
  assert.equal(safeReturnTo('/share/abc?download=1'), '/share/abc?download=1');
});

test('PKCE state survives serialization, is single use, expires, and supports bounded tabs', () => {
  const ums = new UmsAuthService({ getConfig: () => settings });
  const sess = {};
  const url = new URL(ums.start(sess, '/recent'));
  assert.equal(url.pathname, '/api/v1/oauth/authorize');
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('client_id'), settings.clientId);
  assert.equal(url.searchParams.get('redirect_uri'), settings.redirectUri);
  assert.ok(!url.href.includes(settings.clientSecret));
  const state = url.searchParams.get('state');
  const otherState = new URL(ums.start(sess, '/starred')).searchParams.get('state');
  const saved = JSON.parse(JSON.stringify(sess));
  const entry = ums.consume(saved, state);
  assert.equal(entry.returnTo, '/recent');
  assert.equal(crypto.createHash('sha256').update(entry.verifier).digest('base64url'), url.searchParams.get('code_challenge'));
  assert.equal(ums.consume(saved, state), null);
  assert.ok(ums.consume(saved, otherState));
  for (let n = 0; n < 8; n++) ums.start(sess, '/');
  assert.equal(Object.keys(sess.umsPending).length, 5);
  for (const entry of Object.values(sess.umsPending)) entry.expiresAt = 0;
  assert.equal(ums.consume(sess, Object.keys(sess.umsPending)[0]), null);
  assert.deepEqual(sess.umsPending, {});
  for (const invalid of [undefined, {}, ['abc'], '__proto__', 'a'.repeat(10000)]) {
    assert.equal(ums.consume(sess, invalid), null);
  }
});

test('exchange sends only documented form fields server-side and validates identity', async () => {
  let result = { user: { id: 16, name: 'Visnu', email: 'VISNU@example.com', role: 'admin' } };
  let ok = true;
  const ums = new UmsAuthService({ getConfig: () => settings, fetchImpl: async (url, options) => {
    assert.equal(url, settings.hub + '/api/v1/oauth/token');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    assert.equal(options.body.get('client_secret'), settings.clientSecret);
    assert.equal(options.body.get('code_verifier'), 'verifier');
    assert.equal(options.body.get('code'), 'one-time-code');
    assert.equal(options.body.get('redirect_uri'), settings.redirectUri);
    return { ok, json: async () => result };
  } });
  assert.deepEqual(await ums.exchange('one-time-code', 'verifier'),
    { id: '16', name: 'Visnu', email: 'visnu@example.com' });
  for (const invalid of [null, {}, { id: -1, name: 'A', email: 'a@b.com' },
    { id: '16', name: '', email: 'a@b.com' }, { id: {}, name: 'A', email: 'a@b.com' },
    { id: 16, name: 'A', email: 'bad' }]) {
    result = { user: invalid };
    await assert.rejects(ums.exchange('one-time-code', 'verifier'), /invalid identity/);
  }
  ok = false;
  await assert.rejects(ums.exchange('one-time-code', 'verifier'), /did not approve/);
});

test('real Express routes enforce state, persist sessions, rotate IDs, and keep the password fallback', async t => {
  let exchanges = 0;
  let denied = false;
  let enabled = true;
  const ums = new UmsAuthService({ getConfig: () => enabled ? settings : null,
    fetchImpl: async () => { exchanges++; return { ok: !denied,
      json: async () => ({ user: { id: 10, name: 'Nasreen', email: 'nasreen@example.com' } }) }; } });
  const users = { resolveUmsUser: async () => ({ id: 6, name: 'Nasreen', email: 'nasreen@example.com', role: 'super_admin' }) };
  const controller = load('controllers/UmsAuthController.js', {
    '../services/UmsAuthService': ums, '../repositories/UserRepository': users
  });
  const auth = { renderLogin: (req, res) => res.render('auth/login', { returnTo: null }),
    handleLogin: (req, res) => res.send('password login available') };
  const router = load('routes/auth.js', {
    '../services/UmsAuthService': ums, '../controllers/UmsAuthController': controller,
    '../controllers/AuthController': new Proxy(auth, { get: (object, key) => object[key] || ((req, res) => res.sendStatus(200)) }),
    '../middleware/auth': { authGuard: (req, res, next) => next(), guestGuard: (req, res, next) =>
      req.session.userId ? res.redirect('/') : next() }
  });
  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.resolve(__dirname, '..', 'views'));
  app.use(express.urlencoded({ extended: false }));
  app.use(session({ secret: 'test-session-secret', resave: false, saveUninitialized: false }));
  app.use('/auth', router);
  app.get('/whoami', (req, res) => res.json(req.session));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const get = (route, cookie, extra = {}) => fetch(origin + route, { redirect: 'manual',
    headers: cookie ? { Cookie: cookie } : {}, ...extra });
  const cookieOf = response => response.headers.get('set-cookie')?.split(';')[0];
  const begin = async (returnTo = '/recent') => {
    const response = await get('/auth/ums/redirect?returnTo=' + encodeURIComponent(returnTo));
    assert.equal(response.status, 302);
    return { state: new URL(response.headers.get('location')).searchParams.get('state'), cookie: cookieOf(response) };
  };
  const initial = await begin();
  const wrongSession = await get(`/auth/ums/callback?state=${initial.state}&code=code`);
  assert.equal(wrongSession.status, 401);
  assert.equal(exchanges, 0);
  const forged = await get('/auth/ums/callback?state=forged&code=code', initial.cookie);
  assert.equal(forged.status, 401);
  assert.equal(exchanges, 0);
  const success = await get(`/auth/ums/callback?state=${initial.state}&code=code`, initial.cookie);
  assert.equal(success.status, 302);
  assert.equal(success.headers.get('location'), '/recent');
  assert.equal(success.headers.get('cache-control'), 'no-store');
  assert.equal(success.headers.get('referrer-policy'), 'no-referrer');
  const authenticatedCookie = cookieOf(success);
  assert.notEqual(authenticatedCookie, initial.cookie);
  const who = await (await get('/whoami', authenticatedCookie)).json();
  assert.equal(who.userId, 6);
  assert.equal(who.userRole, 'super_admin');
  assert.ok(!who.umsPending);
  assert.ok(!JSON.stringify(who).includes(settings.clientSecret));
  assert.equal((await (await get('/whoami', initial.cookie)).json()).userId, undefined);
  const replay = await get(`/auth/ums/callback?state=${initial.state}&code=code`, initial.cookie);
  assert.equal(replay.status, 401);
  assert.equal(exchanges, 1);
  const denial = await begin();
  assert.equal((await get(`/auth/ums/callback?state=${denial.state}&error=access_denied`, denial.cookie)).status, 401);
  assert.equal((await get(`/auth/ums/callback?state=${denial.state}&code=code`, denial.cookie)).status, 401);
  assert.equal(exchanges, 1);
  const missing = await begin();
  assert.equal((await get(`/auth/ums/callback?state=${missing.state}`, missing.cookie)).status, 401);
  const external = await begin('/\\evil.example');
  assert.equal((await get(`/auth/ums/callback?state=${external.state}&code=code`, external.cookie)).headers.get('location'), '/');
  denied = true;
  const rejected = await begin();
  const failure = await get(`/auth/ums/callback?state=${rejected.state}&code=code`, rejected.cookie);
  assert.equal(failure.status, 503);
  assert.equal((await (await get('/whoami', rejected.cookie)).json()).userId, undefined);
  const enabledLogin = await get('/auth/login');
  assert.match(await enabledLogin.text(), /Sign in with UMS/);
  enabled = false;
  const fallback = await get('/auth/login');
  const html = await fallback.text();
  assert.doesNotMatch(html, /Sign in with UMS/);
  assert.match(html, /name="password"/);
  assert.equal((await get('/auth/ums/redirect')).status, 503);
  const csrf = html.match(/name="_csrf" value="([^"]+)"/)[1];
  const post = await get('/auth/login', null, { method: 'POST', headers: {
    Cookie: cookieOf(fallback), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ _csrf: csrf }) });
  assert.equal(await post.text(), 'password login available');
});

function repositoryHarness(initial = []) {
  let rows = structuredClone(initial);
  let stats = [];
  let failStats = false;
  const users = { id: 'id', email: 'email', umsUserId: 'umsUserId' };
  const userStorageStats = {};
  const tx = {
    select: () => ({ from: () => ({ where: condition => ({ limit: () => {
      const found = Promise.resolve(rows.filter(row => row[condition.key] === condition.value).slice(0, 1));
      found.for = () => found;
      return found;
    } }) }) }),
    update: () => ({ set: values => ({ where: async condition => {
      Object.assign(rows.find(row => row[condition.key] === condition.value), values);
    } }) }),
    insert: table => ({ values: async values => {
      if (table === users) { const id = rows.length + 1; rows.push({ ...values, id }); return [{ insertId: id }]; }
      if (failStats) throw new Error('storage unavailable');
      stats.push(values);
    } })
  };
  const db = { ...tx, transaction: async action => {
    const before = structuredClone(rows);
    try { return await action(tx); } catch (error) { rows = before; throw error; }
  } };
  const repo = load('repositories/UserRepository.js', {
    '../config/db': { db }, '../models/schema': { users, userStorageStats },
    'drizzle-orm': { eq: (key, value) => ({ key, value }) }
  });
  return { repo, rows: () => rows, stats: () => stats, failStats: () => { failStats = true; } };
}

test('email linking preserves existing account ID, files owner, password, and super admin role', async () => {
  const original = { id: 6, email: 'nasreen@example.com', name: 'Nasreen', role: 'super_admin', passwordHash: 'keep-hash', umsUserId: null };
  const h = repositoryHarness([original]);
  const account = await h.repo.resolveUmsUser({ id: '10', email: original.email, name: 'Different' }, 'unused');
  assert.deepEqual(account, { ...original, umsUserId: '10' });
  assert.equal(h.rows().length, 1);
  assert.equal(h.stats().length, 0);
  const changedEmail = await h.repo.resolveUmsUser({ id: '10', email: 'new@example.com', name: 'New' }, 'unused');
  assert.equal(changedEmail.id, 6);
  assert.equal(changedEmail.email, original.email);
});

test('an email bound to another identity is rejected', async () => {
  const h = repositoryHarness([{ id: 5, email: 'a@example.com', umsUserId: '16' }]);
  await assert.rejects(h.repo.resolveUmsUser({ id: '999', email: 'a@example.com' }), /already linked/);
  assert.equal(h.rows()[0].umsUserId, '16');
});

test('new assigned users get ordinary access and account/stat creation is atomic', async () => {
  const h = repositoryHarness();
  const identity = { id: '29', email: 'a@example.com', name: 'Assigned user', role: 'super_admin' };
  const user = await h.repo.resolveUmsUser(identity, 'random-hash');
  assert.equal(user.role, 'user');
  assert.equal(h.rows()[0].passwordHash, 'random-hash');
  assert.deepEqual(h.stats(), [{ userId: user.id, totalFiles: 0, totalFolders: 0, totalSize: 0 }]);
  const broken = repositoryHarness();
  broken.failStats();
  await assert.rejects(broken.repo.resolveUmsUser(identity, 'random-hash'), /storage unavailable/);
  assert.equal(broken.rows().length, 0);
});

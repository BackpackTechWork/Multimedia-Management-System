const crypto = require('node:crypto');
const getSafeReturnTo = require('../utils/safeReturnTo');

const TTL = 10 * 60 * 1000;
const LIMIT = 5;

function config(env = process.env) {
  if (!env.UMS_CLIENT_ID || !env.UMS_CLIENT_SECRET || !env.UMS_REDIRECT_URI) return null;
  try {
    const hub = new URL(env.UMS_BASE_URL || 'https://ums.quickstopsolution.com');
    const callback = new URL(env.UMS_REDIRECT_URI);
    const secure = url => url.protocol === 'https:' ||
      (env.NODE_ENV !== 'production' && url.protocol === 'http:' &&
       ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
    if (!secure(hub) || !secure(callback) || hub.username || hub.password ||
        hub.pathname !== '/' || hub.search || hub.hash || callback.username ||
        callback.password || callback.search || callback.hash) return null;
    return { hub: hub.origin, clientId: env.UMS_CLIENT_ID,
      clientSecret: env.UMS_CLIENT_SECRET, redirectUri: callback.href };
  } catch {
    return null;
  }
}

function prune(session) {
  return Object.fromEntries(Object.entries(session.umsPending || {})
    .filter(([, entry]) => entry && entry.expiresAt > Date.now()));
}

class UmsAuthService {
  constructor({ getConfig = config, fetchImpl = (...args) => fetch(...args) } = {}) {
    this.getConfig = getConfig;
    this.fetchImpl = fetchImpl;
  }

  isEnabled() { return !!this.getConfig(); }

  start(session, returnTo) {
    const settings = this.getConfig();
    if (!settings) throw new Error('UMS sign-in is not configured. Please use email and password.');
    const state = crypto.randomBytes(32).toString('hex');
    const verifier = crypto.randomBytes(32).toString('base64url');
    const pending = prune(session);
    while (Object.keys(pending).length >= LIMIT) delete pending[Object.keys(pending)[0]];
    pending[state] = { verifier, returnTo: getSafeReturnTo(returnTo),
      expiresAt: Date.now() + TTL };
    session.umsPending = pending;
    const params = new URLSearchParams({ response_type: 'code', client_id: settings.clientId,
      redirect_uri: settings.redirectUri, state,
      code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256' });
    return `${settings.hub}/api/v1/oauth/authorize?${params}`;
  }

  consume(session, state) {
    const pending = prune(session);
    session.umsPending = pending;
    if (typeof state !== 'string' || !/^[a-f0-9]{64}$/.test(state)) return null;
    for (const [known, entry] of Object.entries(pending)) {
      if (known.length === state.length &&
          crypto.timingSafeEqual(Buffer.from(known), Buffer.from(state))) {
        delete pending[known];
        return entry;
      }
    }
    return null;
  }

  async exchange(code, verifier) {
    const settings = this.getConfig();
    if (!settings) throw new Error('UMS sign-in is not configured.');
    const response = await this.fetchImpl(`${settings.hub}/api/v1/oauth/token`, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: settings.clientId,
        client_secret: settings.clientSecret, redirect_uri: settings.redirectUri,
        code, code_verifier: verifier })
    });
    if (!response.ok) throw new Error('UMS did not approve sign-in.');
    const { user } = await response.json();
    if (!user || !((Number.isSafeInteger(user.id) && user.id > 0) ||
        (typeof user.id === 'string' && /^[1-9]\d{0,19}$/.test(user.id))) ||
        typeof user.email !== 'string' || user.email.length > 255 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email.trim()) ||
        typeof user.name !== 'string' || !user.name.trim() || user.name.length > 255) {
      throw new Error('UMS returned an invalid identity.');
    }
    return { id: String(user.id), email: user.email.trim().toLowerCase(), name: user.name.trim() };
  }
}

module.exports = new UmsAuthService();
module.exports.UmsAuthService = UmsAuthService;
module.exports.config = config;

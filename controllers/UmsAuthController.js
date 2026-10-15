const ums = require('../services/UmsAuthService');
const users = require('../repositories/UserRepository');
const crypto = require('node:crypto');
const bcrypt = require('bcrypt');

const save = session => new Promise((resolve, reject) =>
  session.save(error => error ? reject(error) : resolve()));
const regenerate = req => new Promise((resolve, reject) =>
  req.session.regenerate(error => error ? reject(error) : resolve()));

function fail(req, res, message, status = 401, returnTo = null) {
  return res.status(status).render('auth/login', {
    error: message, success: null, email: '', returnTo,
    umsEnabled: ums.isEnabled()
  });
}

exports.redirect = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (!ums.isEnabled()) return fail(req, res,
    'UMS sign-in is not configured. Please use email and password.', 503);
  try {
    const url = ums.start(req.session, req.query.returnTo);
    // The state and verifier must reach the store before UMS can call back.
    await save(req.session);
    return res.redirect(url);
  } catch {
    return fail(req, res, 'Unable to start UMS sign-in. Please try again.', 503);
  }
};

exports.callback = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const pending = ums.consume(req.session, req.query.state);
  try {
    // Persist consumption even for denied or malformed callbacks.
    await save(req.session);
    if (!pending) return fail(req, res, 'This sign-in has expired or is invalid. Please sign in with UMS again.');
    if (req.query.error) return fail(req, res,
      'UMS did not approve sign-in. Check that you have access to Multimedia Management System, then try again.',
      401, pending.returnTo);
    if (typeof req.query.code !== 'string' || !req.query.code || req.query.code.length > 4096) {
      return fail(req, res, 'UMS did not return a valid sign-in code. Please try again.', 401, pending.returnTo);
    }
    const identity = await ums.exchange(req.query.code, pending.verifier);
    // Never use a UMS role as an MMS role. A new local account starts as a user.
    const passwordHash = await bcrypt.hash(crypto.randomBytes(48).toString('base64url'), 10);
    const user = await users.resolveUmsUser(identity, passwordHash);
    await regenerate(req);
    req.session.userId = user.id;
    req.session.userName = user.name;
    req.session.userEmail = user.email;
    req.session.userRole = user.role || 'user';
    req.session.ipAddress = req.ip;
    req.session.userAgent = req.headers['user-agent'];
    req.session.cookie.maxAge = 7 * 24 * 60 * 60 * 1000;
    await save(req.session);
    return res.redirect(pending.returnTo || '/');
  } catch {
    // Do not disclose authorization codes, provider responses, or secrets.
    if (req.session.userId) {
      await new Promise(resolve => req.session.destroy(() => resolve()));
    }
    return fail(req, res, 'Unable to complete UMS sign-in. Please try again or contact your administrator.',
      503, pending?.returnTo);
  }
};

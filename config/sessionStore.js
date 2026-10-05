const session = require('express-session');
const sessionRepository = require('../repositories/SessionRepository');

class DrizzleSessionStore extends session.Store {
  constructor() {
    super();
    this.lastTouches = new Map();
    this.pendingTouches = new Map();
    this.touchIntervalMs = 30 * 1000;
  }

  rememberTouch(sid, time) {
    this.lastTouches.delete(sid);
    this.lastTouches.set(sid, time);
    if (this.lastTouches.size > 10000) this.lastTouches.delete(this.lastTouches.keys().next().value);
  }

  async get(sid, callback) {
    try {
      const sess = await sessionRepository.findBySessionId(sid);
      if (!sess) {
        this.lastTouches.delete(sid);
        return callback(null, null);
      }
      
      if (sess.expiresAt < new Date()) {
        this.lastTouches.delete(sid);
        await sessionRepository.destroySession(sid);
        return callback(null, null);
      }
      
      const parsedData = sess.data ? JSON.parse(sess.data) : null;
      const lastActivity = new Date(sess.lastActivityAt).getTime();
      if (Number.isFinite(lastActivity)) {
        this.rememberTouch(sid, Math.max(lastActivity, this.lastTouches.get(sid) || 0));
      }
      return callback(null, parsedData);
    } catch (err) {
      return callback(err);
    }
  }

  async set(sid, sessionData, callback) {
    try {
      const userId = sessionData.userId || null;
      const lastActivityAt = new Date();
      
      let expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      if (sessionData.cookie && sessionData.cookie.expires) {
        expiresAt = new Date(sessionData.cookie.expires);
      }

      const serializedData = JSON.stringify(sessionData);

      await sessionRepository.createOrUpdateSession(
        sid,
        userId,
        sessionData.ipAddress || null,
        sessionData.userAgent || null,
        serializedData,
        lastActivityAt,
        expiresAt
      );
      this.rememberTouch(sid, lastActivityAt.getTime());
      
      return callback(null);
    } catch (err) {
      return callback(err);
    }
  }

  async destroy(sid, callback) {
    try {
      await sessionRepository.destroySession(sid);
      this.lastTouches.delete(sid);
      return callback(null);
    } catch (err) {
      return callback(err);
    }
  }

  async touch(sid, sessionData, callback) {
    try {
      // Keep reading each session from MySQL so remote revocation is immediate.
      // Only activity/expiry writes are coalesced during bursts of chunk requests.
      if (Date.now() - (this.lastTouches.get(sid) || 0) < this.touchIntervalMs) {
        return callback(null);
      }
      if (this.pendingTouches.has(sid)) {
        await this.pendingTouches.get(sid);
        return callback(null);
      }
      let expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      if (sessionData.cookie && sessionData.cookie.expires) {
        expiresAt = new Date(sessionData.cookie.expires);
      }

      const now = new Date();
      const touching = sessionRepository.touchSession(
        sid,
        now,
        expiresAt
      );
      this.pendingTouches.set(sid, touching);
      try {
        await touching;
        this.rememberTouch(sid, now.getTime());
      } finally {
        if (this.pendingTouches.get(sid) === touching) this.pendingTouches.delete(sid);
      }
      return callback(null);
    } catch (err) {
      return callback(err);
    }
  }
}

module.exports = DrizzleSessionStore;

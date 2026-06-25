const session = require('express-session');
const sessionRepository = require('../repositories/SessionRepository');

class DrizzleSessionStore extends session.Store {
  constructor() {
    super();
  }

  async get(sid, callback) {
    try {
      const sess = await sessionRepository.findBySessionId(sid);
      if (!sess) {
        return callback(null, null);
      }
      
      if (sess.expiresAt < new Date()) {
        await sessionRepository.destroySession(sid);
        return callback(null, null);
      }
      
      const parsedData = sess.data ? JSON.parse(sess.data) : null;
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
        null, // IP and UA are updated inside active middlewares
        null, 
        serializedData,
        lastActivityAt,
        expiresAt
      );
      
      return callback(null);
    } catch (err) {
      return callback(err);
    }
  }

  async destroy(sid, callback) {
    try {
      await sessionRepository.destroySession(sid);
      return callback(null);
    } catch (err) {
      return callback(err);
    }
  }

  async touch(sid, sessionData, callback) {
    try {
      const sess = await sessionRepository.findBySessionId(sid);
      if (!sess) {
        return callback(null);
      }

      let expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      if (sessionData.cookie && sessionData.cookie.expires) {
        expiresAt = new Date(sessionData.cookie.expires);
      }

      await sessionRepository.createOrUpdateSession(
        sid,
        sessionData.userId || sess.userId,
        sess.ipAddress,
        sess.userAgent,
        JSON.stringify(sessionData),
        new Date(),
        expiresAt
      );

      return callback(null);
    } catch (err) {
      return callback(err);
    }
  }
}

module.exports = DrizzleSessionStore;

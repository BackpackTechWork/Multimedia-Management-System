const { db } = require('../config/db');
const { sessions } = require('../models/schema');
const { eq, and, sql, lt } = require('drizzle-orm');

class SessionRepository {
  async findBySessionId(sessionId) {
    const results = await db.select()
      .from(sessions)
      .where(eq(sessions.sessionId, sessionId))
      .limit(1);
    return results[0] || null;
  }

  async findUserSessions(userId) {
    return await db.select()
      .from(sessions)
      .where(eq(sessions.userId, userId))
      .orderBy(sql`${sessions.lastActivityAt} DESC`);
  }

  async createOrUpdateSession(sessionId, userId, ipAddress, userAgent, sessionData, lastActivityAt, expiresAt) {
    const existing = await this.findBySessionId(sessionId);
    
    if (existing) {
      await db.update(sessions)
        .set({
          userId: userId || existing.userId,
          ipAddress,
          userAgent,
          data: sessionData,
          lastActivityAt,
          expiresAt
        })
        .where(eq(sessions.sessionId, sessionId));
    } else {
      await db.insert(sessions).values({
        sessionId,
        userId,
        ipAddress,
        userAgent,
        data: sessionData,
        lastActivityAt,
        expiresAt
      });
    }
  }

  async destroySession(sessionId) {
    await db.delete(sessions).where(eq(sessions.sessionId, sessionId));
  }

  async destroySessionById(id, userId) {
    await db.delete(sessions).where(and(eq(sessions.id, id), eq(sessions.userId, userId)));
  }

  async destroyAllUserSessions(userId) {
    await db.delete(sessions).where(eq(sessions.userId, userId));
  }

  async destroyOtherUserSessions(userId, currentSessionId) {
    await db.delete(sessions).where(
      and(
        eq(sessions.userId, userId),
        sql`${sessions.sessionId} != ${currentSessionId}`
      )
    );
  }

  async cleanupExpired(nowDate = new Date()) {
    return await db.delete(sessions).where(lt(sessions.expiresAt, nowDate));
  }
}

module.exports = new SessionRepository();

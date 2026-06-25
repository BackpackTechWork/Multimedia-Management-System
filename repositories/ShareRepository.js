const { db } = require('../config/db');
const { shares, files, folders } = require('../models/schema');
const { eq, and, sql } = require('drizzle-orm');

class ShareRepository {
  async findByToken(token) {
    const results = await db.select()
      .from(shares)
      .where(eq(shares.token, token))
      .limit(1);
    return results[0] || null;
  }

  async createShare(token, fileId, folderId, passwordHash, expiresAt, allowDownload = true) {
    const [result] = await db.insert(shares).values({
      token,
      fileId,
      folderId,
      passwordHash,
      expiresAt,
      allowDownload
    });
    return result.insertId;
  }

  async deleteShare(id) {
    await db.delete(shares).where(eq(shares.id, id));
  }

  async deleteShareByToken(token) {
    await db.delete(shares).where(eq(shares.token, token));
  }

  async findShareByFileId(fileId) {
    const results = await db.select()
      .from(shares)
      .where(eq(shares.fileId, fileId))
      .limit(1);
    return results[0] || null;
  }

  async findShareByFolderId(folderId) {
    const results = await db.select()
      .from(shares)
      .where(eq(shares.folderId, folderId))
      .limit(1);
    return results[0] || null;
  }
}

module.exports = new ShareRepository();

const { db, pool } = require('../config/db');
const { shares, shareRecipients, users } = require('../models/schema');
const { eq, inArray } = require('drizzle-orm');

class ShareRepository {
  async findByToken(token) {
    const results = await db.select()
      .from(shares)
      .where(eq(shares.token, token))
      .limit(1);
    return results[0] || null;
  }

  async createShare(token, createdById, fileId, folderId, passwordHash, expiresAt, allowDownload = true, linkAccess = 'restricted', linkRole = 'viewer') {
    const [result] = await db.insert(shares).values({
      token,
      createdById,
      fileId,
      folderId,
      passwordHash,
      expiresAt,
      allowDownload,
      linkAccess,
      linkRole
    });
    return result.insertId;
  }

  async updateShare(id, { passwordHash, expiresAt, allowDownload, linkAccess, linkRole }) {
    const values = {
      expiresAt,
      allowDownload,
      linkAccess,
      linkRole
    };

    if (passwordHash !== undefined) {
      values.passwordHash = passwordHash;
    }

    await db.update(shares).set(values).where(eq(shares.id, id));
  }

  async deleteShare(id) {
    await db.delete(shareRecipients).where(eq(shareRecipients.shareId, id));
    await db.delete(shares).where(eq(shares.id, id));
  }

  async deleteShareByToken(token) {
    const share = await this.findByToken(token);
    if (share) {
      await this.deleteShare(share.id);
    }
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

  async findShareRecipients(shareId) {
    const [rows] = await pool.query(`
      SELECT u.id, u.name, u.email
      FROM share_recipients sr
      INNER JOIN users u ON u.id = sr.user_id
      WHERE sr.share_id = ?
      ORDER BY u.name, u.email
    `, [shareId]);

    return rows.map(row => ({
      id: row.id,
      name: row.name,
      email: row.email
    }));
  }

  async deleteOtherSharesForItem(fileId, folderId, keepShareId) {
    const params = [];
    let whereClause = '';

    if (fileId) {
      whereClause = 'file_id = ?';
      params.push(fileId);
    } else if (folderId) {
      whereClause = 'folder_id = ?';
      params.push(folderId);
    } else {
      return;
    }

    params.push(keepShareId);
    const [rows] = await pool.query(`
      SELECT id
      FROM shares
      WHERE ${whereClause} AND id <> ?
    `, params);

    for (const row of rows) {
      await this.deleteShare(row.id);
    }
  }

  async replaceRecipients(shareId, recipientUserIds) {
    await db.delete(shareRecipients).where(eq(shareRecipients.shareId, shareId));

    const uniqueIds = [...new Set(recipientUserIds.map(id => Number(id)).filter(Number.isInteger))];
    if (uniqueIds.length === 0) return;

    await db.insert(shareRecipients).values(uniqueIds.map(userId => ({
      shareId,
      userId
    })));
  }

  async findUsersByEmails(emails) {
    const normalizedEmails = [...new Set(emails.map(email => email.trim().toLowerCase()).filter(Boolean))];
    if (normalizedEmails.length === 0) return [];

    return await db.select({
      id: users.id,
      name: users.name,
      email: users.email
    }).from(users).where(inArray(users.email, normalizedEmails));
  }

  async findUsersByIds(userIds) {
    const normalizedIds = [...new Set((userIds || []).map(id => Number(id)).filter(Number.isInteger))];
    if (normalizedIds.length === 0) return [];

    return await db.select({
      id: users.id,
      name: users.name,
      email: users.email
    }).from(users).where(inArray(users.id, normalizedIds));
  }

  async userCanAccessShare(userId, shareId) {
    if (!userId || !shareId) return false;

    const [rows] = await pool.query(`
      SELECT 1
      FROM share_recipients
      WHERE user_id = ? AND share_id = ?
      LIMIT 1
    `, [userId, shareId]);

    return rows.length > 0;
  }

  async userCanAccessFile(userId, file) {
    if (!userId || !file) return false;

    const [rows] = await pool.query(`
      SELECT 1
      FROM share_recipients sr
      INNER JOIN shares s ON sr.share_id = s.id
      LEFT JOIN folders shared_folder ON s.folder_id = shared_folder.id
      LEFT JOIN folders file_folder ON file_folder.id = ?
      WHERE sr.user_id = ?
        AND (
          s.file_id = ?
          OR (
            s.folder_id IS NOT NULL
            AND file_folder.path IS NOT NULL
            AND file_folder.path LIKE CONCAT(shared_folder.path, '%')
          )
        )
      LIMIT 1
    `, [file.folderId, userId, file.id]);

    return rows.length > 0;
  }

  async userCanAccessFolder(userId, folder) {
    if (!userId || !folder) return false;

    const [rows] = await pool.query(`
      SELECT 1
      FROM share_recipients sr
      INNER JOIN shares s ON sr.share_id = s.id
      INNER JOIN folders shared_folder ON s.folder_id = shared_folder.id
      WHERE sr.user_id = ?
        AND ? LIKE CONCAT(shared_folder.path, '%')
      LIMIT 1
    `, [userId, folder.path]);

    return rows.length > 0;
  }

  async userCanEditFile(userId, file) {
    if (!userId || !file) return false;

    const [rows] = await pool.query(`
      SELECT 1
      FROM share_recipients sr
      INNER JOIN shares s ON sr.share_id = s.id
      LEFT JOIN folders shared_folder ON s.folder_id = shared_folder.id
      LEFT JOIN folders file_folder ON file_folder.id = ?
      WHERE sr.user_id = ?
        AND s.link_role = 'editor'
        AND (
          s.file_id = ?
          OR (
            s.folder_id IS NOT NULL
            AND file_folder.path IS NOT NULL
            AND file_folder.path LIKE CONCAT(shared_folder.path, '%')
          )
        )
      LIMIT 1
    `, [file.folderId, userId, file.id]);

    return rows.length > 0;
  }

  async userCanEditFolder(userId, folder) {
    if (!userId || !folder) return false;

    const [rows] = await pool.query(`
      SELECT 1
      FROM share_recipients sr
      INNER JOIN shares s ON sr.share_id = s.id
      INNER JOIN folders shared_folder ON s.folder_id = shared_folder.id
      WHERE sr.user_id = ?
        AND s.link_role = 'editor'
        AND ? LIKE CONCAT(shared_folder.path, '%')
      LIMIT 1
    `, [userId, folder.path]);

    return rows.length > 0;
  }

  async findSharedByUser(userId) {
    const [folderRows] = await pool.query(`
      SELECT
        f.*,
        s.id AS share_id,
        s.token AS share_token,
        s.link_access AS link_access,
        s.link_role AS link_role,
        s.created_at AS shared_at,
        GROUP_CONCAT(u.email ORDER BY u.email SEPARATOR ', ') AS recipient_emails
      FROM shares s
      INNER JOIN folders f ON s.folder_id = f.id
      LEFT JOIN share_recipients sr ON sr.share_id = s.id
      LEFT JOIN users u ON u.id = sr.user_id
      WHERE s.created_by_id = ? OR (s.created_by_id IS NULL AND f.user_id = ?)
      GROUP BY s.id, f.id
      ORDER BY s.created_at DESC
    `, [userId, userId]);

    const [fileRows] = await pool.query(`
      SELECT
        fi.*,
        s.id AS share_id,
        s.token AS share_token,
        s.link_access AS link_access,
        s.link_role AS link_role,
        s.created_at AS shared_at,
        GROUP_CONCAT(u.email ORDER BY u.email SEPARATOR ', ') AS recipient_emails
      FROM shares s
      INNER JOIN files fi ON s.file_id = fi.id
      LEFT JOIN share_recipients sr ON sr.share_id = s.id
      LEFT JOIN users u ON u.id = sr.user_id
      WHERE s.created_by_id = ? OR (s.created_by_id IS NULL AND fi.user_id = ?)
      GROUP BY s.id, fi.id
      ORDER BY s.created_at DESC
    `, [userId, userId]);

    return {
      folders: folderRows.map(row => this.mapSharedFolder(row, 'by-me')),
      files: fileRows.map(row => this.mapSharedFile(row, 'by-me'))
    };
  }

  async findSharedWithUser(userId) {
    const [folderRows] = await pool.query(`
      SELECT
        f.*,
        s.id AS share_id,
        s.token AS share_token,
        s.link_access AS link_access,
        s.link_role AS link_role,
        s.created_at AS shared_at,
        owner.name AS owner_name,
        owner.email AS owner_email
      FROM share_recipients sr
      INNER JOIN shares s ON sr.share_id = s.id
      INNER JOIN folders f ON s.folder_id = f.id
      INNER JOIN users owner ON owner.id = f.user_id
      WHERE sr.user_id = ?
      ORDER BY s.created_at DESC
    `, [userId]);

    const [fileRows] = await pool.query(`
      SELECT
        fi.*,
        s.id AS share_id,
        s.token AS share_token,
        s.link_access AS link_access,
        s.link_role AS link_role,
        s.created_at AS shared_at,
        owner.name AS owner_name,
        owner.email AS owner_email
      FROM share_recipients sr
      INNER JOIN shares s ON sr.share_id = s.id
      INNER JOIN files fi ON s.file_id = fi.id
      INNER JOIN users owner ON owner.id = fi.user_id
      WHERE sr.user_id = ?
      ORDER BY s.created_at DESC
    `, [userId]);

    return {
      folders: folderRows.map(row => this.mapSharedFolder(row, 'with-me')),
      files: fileRows.map(row => this.mapSharedFile(row, 'with-me'))
    };
  }

  mapSharedFolder(row, scope) {
    return {
      id: row.id,
      userId: row.user_id ?? row.userId,
      parentId: row.parent_id ?? row.parentId,
      name: row.name,
      path: row.path,
      visibility: row.visibility,
      createdAt: row.created_at ?? row.createdAt,
      shareMeta: {
        scope,
        token: row.share_token,
        linkAccess: row.link_access,
        linkRole: row.link_role,
        sharedAt: row.shared_at,
        ownerName: row.owner_name,
        ownerEmail: row.owner_email,
        recipientEmails: row.recipient_emails
      }
    };
  }

  mapSharedFile(row, scope) {
    return {
      id: row.id,
      userId: row.user_id ?? row.userId,
      folderId: row.folder_id ?? row.folderId,
      filename: row.filename,
      originalName: row.original_name ?? row.originalName,
      extension: row.extension,
      mimeType: row.mime_type ?? row.mimeType,
      size: Number(row.size) || 0,
      path: row.path,
      visibility: row.visibility,
      checksum: row.checksum,
      createdAt: row.created_at ?? row.createdAt,
      shareMeta: {
        scope,
        token: row.share_token,
        linkAccess: row.link_access,
        linkRole: row.link_role,
        sharedAt: row.shared_at,
        ownerName: row.owner_name,
        ownerEmail: row.owner_email,
        recipientEmails: row.recipient_emails
      }
    };
  }
}

module.exports = new ShareRepository();

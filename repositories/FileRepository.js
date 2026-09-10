const { db } = require('../config/db');
const { users, files, fileVersions, trashItems, favorites, recentActivity } = require('../models/schema');
const { eq, and, sql, desc, asc, like, inArray } = require('drizzle-orm');

class FileRepository {
  constructor(database = db) { this.database = database; }

  async withUploadLock(ownerId, callback) {
    return this.database.transaction(async tx => {
      await tx.select({ id: users.id }).from(users).where(eq(users.id, ownerId)).for('update');
      return callback(new FileRepository(tx));
    });
  }

  async findById(id) {
    const results = await this.database.select().from(files).where(eq(files.id, id)).limit(1);
    return results[0] || null;
  }

  userScope(userId, includeAll = false) {
    return includeAll ? sql`1 = 1` : eq(files.userId, userId);
  }

  async findUserRootFiles(userId, includeAll = false) {
    return await this.database.select()
      .from(files)
      .leftJoin(trashItems, and(
        eq(trashItems.entityId, files.id),
        eq(trashItems.entityType, 'file')
      ))
      .where(and(
        this.userScope(userId, includeAll),
        sql`${files.folderId} IS NULL`,
        sql`${trashItems.id} IS NULL`
      ));
  }

  async findFilesInFolder(userId, folderId, includeAll = false) {
    return await this.database.select()
      .from(files)
      .leftJoin(trashItems, and(
        eq(trashItems.entityId, files.id),
        eq(trashItems.entityType, 'file')
      ))
      .where(and(
        this.userScope(userId, includeAll),
        folderId ? eq(files.folderId, folderId) : sql`${files.folderId} IS NULL`,
        sql`${trashItems.id} IS NULL`
      ));
  }

  async createFile(userId, folderId, filename, originalName, extension, mimeType, size, path, checksum, visibility = 'private') {
    const [result] = await this.database.insert(files).values({
      userId,
      folderId,
      filename,
      originalName,
      extension,
      mimeType,
      size,
      path,
      checksum,
      visibility
    });
    return result.insertId;
  }

  async replaceUpload(file, saved, mimeType, uploadedBy) {
    await this.database.transaction(async tx => {
      const versions = await tx.select().from(fileVersions)
        .where(eq(fileVersions.fileId, file.id)).orderBy(desc(fileVersions.versionNumber)).limit(1);
      await tx.insert(fileVersions).values({ fileId: file.id, storagePath: file.path,
        versionNumber: (versions[0]?.versionNumber || 0) + 1, size: file.size, uploadedBy });
      await tx.update(files).set({ filename: saved.filename, path: saved.path,
        size: saved.size, checksum: saved.checksum, mimeType, createdAt: new Date() })
        .where(eq(files.id, file.id));
    });
    return file.id;
  }

  async renameFile(id, originalName, extension) {
    await this.database.update(files)
      .set({ originalName, extension })
      .where(eq(files.id, id));
  }

  async updateVisibility(id, visibility) {
    await this.database.update(files).set({ visibility }).where(eq(files.id, id));
  }

  async getVersions(fileId) {
    return await this.database.select()
      .from(fileVersions)
      .where(eq(fileVersions.fileId, fileId))
      .orderBy(desc(fileVersions.versionNumber));
  }

  async createVersion(fileId, storagePath, versionNumber, size, uploadedBy) {
    const [result] = await this.database.insert(fileVersions).values({
      fileId,
      storagePath,
      versionNumber,
      size,
      uploadedBy
    });
    return result.insertId;
  }

  async deleteVersion(versionId) {
    await this.database.delete(fileVersions).where(eq(fileVersions.id, versionId));
  }

  async findVersionById(versionId) {
    const results = await this.database.select().from(fileVersions).where(eq(fileVersions.id, versionId)).limit(1);
    return results[0] || null;
  }

  async searchFiles(userId, { query, type, sortBy, sortOrder, limit, offset, includeAll = false }) {
    let whereConditions = [
      this.userScope(userId, includeAll),
      sql`NOT EXISTS (
        SELECT 1 FROM trash_items 
        WHERE trash_items.entity_id = files.id 
          AND trash_items.entity_type = 'file'
      )`
    ];

    if (query && query.trim() !== '') {
      whereConditions.push(
        sql`MATCH(${files.filename}, ${files.originalName}) AGAINST(${query} IN NATURAL LANGUAGE MODE)`
      );
    }

    if (type && type !== 'all') {
      if (type === 'image') {
        whereConditions.push(like(files.mimeType, 'image/%'));
      } else if (type === 'pdf') {
        whereConditions.push(eq(files.extension, 'pdf'));
      } else if (type === 'audio') {
        whereConditions.push(like(files.mimeType, 'audio/%'));
      } else if (type === 'video') {
        whereConditions.push(like(files.mimeType, 'video/%'));
      } else if (type === 'document') {
        whereConditions.push(inArray(files.extension, ['doc', 'docx', 'txt', 'rtf', 'odt', 'pdf']));
      } else if (type === 'excel') {
        whereConditions.push(inArray(files.extension, ['xls', 'xlsx', 'csv', 'ods']));
      } else if (type === 'markdown') {
        whereConditions.push(eq(files.extension, 'md'));
      } else if (type === 'code') {
        whereConditions.push(inArray(files.extension, ['js', 'ts', 'html', 'css', 'json', 'xml', 'sql', 'php', 'py', 'go', 'rs', 'cpp', 'c', 'cs']));
      }
    }

    let orderByField = desc(files.createdAt);
    const order = sortOrder === 'asc' ? asc : desc;
    if (sortBy === 'name') {
      orderByField = order(files.originalName);
    } else if (sortBy === 'size') {
      orderByField = order(files.size);
    } else if (sortBy === 'date') {
      orderByField = order(files.createdAt);
    }

    const items = await this.database.select()
      .from(files)
      .where(and(...whereConditions))
      .orderBy(orderByField)
      .limit(limit || 20)
      .offset(offset || 0);

    return items;
  }
}

module.exports = new FileRepository();

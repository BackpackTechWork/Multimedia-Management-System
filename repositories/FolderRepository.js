const { db } = require('../config/db');
const { folders, files, trashItems } = require('../models/schema');
const { eq, and, like, sql, ne } = require('drizzle-orm');

class FolderRepository {
  async findById(id) {
    const results = await db.select().from(folders).where(eq(folders.id, id)).limit(1);
    return results[0] || null;
  }

  async findUserRootFolders(userId) {
    return await db.select()
      .from(folders)
      .leftJoin(trashItems, and(
        eq(trashItems.entityId, folders.id),
        eq(trashItems.entityType, 'folder')
      ))
      .where(and(
        eq(folders.userId, userId),
        sql`${folders.parentId} IS NULL`,
        sql`${trashItems.id} IS NULL`
      ));
  }

  async findSubfolders(userId, parentId) {
    return await db.select()
      .from(folders)
      .leftJoin(trashItems, and(
        eq(trashItems.entityId, folders.id),
        eq(trashItems.entityType, 'folder')
      ))
      .where(and(
        eq(folders.userId, userId),
        parentId ? eq(folders.parentId, parentId) : sql`${folders.parentId} IS NULL`,
        sql`${trashItems.id} IS NULL`
      ));
  }

  async createFolder(userId, parentId, name, pathPrefix, visibility = 'private') {
    return await db.transaction(async (tx) => {
      const [insertResult] = await tx.insert(folders).values({
        userId,
        parentId,
        name,
        path: '', // Temporary empty path
        visibility
      });
      const folderId = insertResult.insertId;

      const path = `${pathPrefix}${folderId}/`;
      await tx.update(folders).set({ path }).where(eq(folders.id, folderId));

      return { id: folderId, userId, parentId, name, path, visibility };
    });
  }

  async renameFolder(id, name) {
    await db.update(folders).set({ name }).where(eq(folders.id, id));
  }

  async updateVisibility(id, visibility) {
    await db.update(folders).set({ visibility }).where(eq(folders.id, id));
  }

  async findDescendants(folderPath) {
    return await db.select()
      .from(folders)
      .where(like(folders.path, `${folderPath}%`));
  }

  async moveFolderSubtree(folderId, newParentId, oldPath, newPath) {
    await db.transaction(async (tx) => {
      await tx.update(folders)
        .set({ parentId: newParentId })
        .where(eq(folders.id, folderId));

      await tx.execute(sql`
        UPDATE ${folders}
        SET ${folders.path} = REPLACE(${folders.path}, ${oldPath}, ${newPath})
        WHERE ${folders.path} LIKE ${oldPath + '%'}
      `);
    });
  }

  async getFolderByPath(userId, path) {
    const results = await db.select()
      .from(folders)
      .where(and(eq(folders.userId, userId), eq(folders.path, path)))
      .limit(1);
    return results[0] || null;
  }
}

module.exports = new FolderRepository();

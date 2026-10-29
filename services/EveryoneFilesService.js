const { db } = require('../config/db');
const { folders, trashItems, users } = require('../models/schema');
const { and, eq, inArray, or } = require('drizzle-orm');

function isEnabled() {
  return String(process.env.EVERYONE_FILES_ENABLED || '').toLowerCase() === 'true';
}

function isVisibleOwner(owner, viewerId = null) {
  return Boolean(owner) && owner.role !== 'super_admin'
    && (viewerId == null || Number(owner.id) !== Number(viewerId));
}

// This grants read access only. Existing ownership/share rules still govern writes.
async function canRead(item, type) {
  if (!isEnabled() || !item) return false;
  const [owner] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, item.userId)).limit(1);
  if (!isVisibleOwner(owner)) return false;
  let folder = type === 'folder' ? item : null;
  if (!folder && item.folderId) {
    [folder] = await db.select().from(folders).where(eq(folders.id, item.folderId)).limit(1);
    if (!folder) return false;
  }
  const folderIds = folder
    ? [...new Set([folder.id, ...String(folder.path || '').split('/').filter(Boolean).map(Number)])]
    : [];
  const conditions = [and(eq(trashItems.entityType, type), eq(trashItems.entityId, item.id))];
  if (folderIds.length) conditions.push(and(eq(trashItems.entityType, 'folder'), inArray(trashItems.entityId, folderIds)));
  const deleted = await db.select({ id: trashItems.id }).from(trashItems).where(or(...conditions)).limit(1);
  return deleted.length === 0;
}

module.exports = { isEnabled, canRead, isVisibleOwner };

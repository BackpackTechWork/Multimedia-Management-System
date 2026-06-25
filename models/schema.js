const { mysqlTable, varchar, int, bigint, datetime, text, boolean, uniqueIndex, index } = require('drizzle-orm/mysql-core');
const { relations, sql } = require('drizzle-orm');

const users = mysqlTable('users', {
  id: int('id').primaryKey().autoincrement(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  createdAt: datetime('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  emailIdx: uniqueIndex('email_idx').on(table.email),
}));

const folders = mysqlTable('folders', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id').notNull(),
  parentId: int('parent_id'),
  name: varchar('name', { length: 255 }).notNull(),
  path: varchar('path', { length: 500 }).notNull(), // Materialized path (e.g. "/1/", "/1/2/")
  visibility: varchar('visibility', { length: 20 }).default('private').notNull(), // 'private', 'public'
  createdAt: datetime('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  userIdIdx: index('folders_user_id_idx').on(table.userId),
  parentIdIdx: index('folders_parent_id_idx').on(table.parentId),
  pathIdx: index('folders_path_idx').on(table.path),
}));

const files = mysqlTable('files', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id').notNull(),
  folderId: int('folder_id'), // Nullable for root files
  filename: varchar('filename', { length: 255 }).notNull(), // Unique UUID filename on disk
  originalName: varchar('original_name', { length: 255 }).notNull(),
  extension: varchar('extension', { length: 50 }).notNull(),
  mimeType: varchar('mime_type', { length: 255 }).notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  path: varchar('path', { length: 1000 }).notNull(), // Storage location subpath
  visibility: varchar('visibility', { length: 20 }).default('private').notNull(), // 'private', 'public'
  checksum: varchar('checksum', { length: 64 }).notNull(), // SHA-256 for duplication and verification
  createdAt: datetime('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  userIdIdx: index('files_user_id_idx').on(table.userId),
  folderIdIdx: index('files_folder_id_idx').on(table.folderId),
  visibilityIdx: index('files_visibility_idx').on(table.visibility),
}));

const fileVersions = mysqlTable('file_versions', {
  id: int('id').primaryKey().autoincrement(),
  fileId: int('file_id').notNull(),
  storagePath: varchar('storage_path', { length: 1000 }).notNull(),
  versionNumber: int('version_number').notNull(),
  size: bigint('size', { mode: 'number' }).notNull(),
  uploadedAt: datetime('uploaded_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  uploadedBy: int('uploaded_by').notNull(),
}, (table) => ({
  fileIdIdx: index('versions_file_id_idx').on(table.fileId),
}));

const trashItems = mysqlTable('trash_items', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id').notNull(),
  entityType: varchar('entity_type', { length: 20 }).notNull(), // 'file', 'folder'
  entityId: int('entity_id').notNull(),
  deletedAt: datetime('deleted_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  purgeAt: datetime('purge_at').notNull(), // auto deleted 30 days after deletion
}, (table) => ({
  userIdIdx: index('trash_user_id_idx').on(table.userId),
  purgeAtIdx: index('trash_purge_at_idx').on(table.purgeAt),
}));

const favorites = mysqlTable('favorites', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id').notNull(),
  fileId: int('file_id'),
  folderId: int('folder_id'),
}, (table) => ({
  userIdIdx: index('fav_user_id_idx').on(table.userId),
  fileIdIdx: index('fav_file_id_idx').on(table.fileId),
  folderIdIdx: index('fav_folder_id_idx').on(table.folderId),
}));

const recentActivity = mysqlTable('recent_activity', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id').notNull(),
  fileId: int('file_id').notNull(),
  lastOpenedAt: datetime('last_opened_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  userIdIdx: index('recent_user_id_idx').on(table.userId),
  fileIdIdx: index('recent_file_id_idx').on(table.fileId),
}));

const shares = mysqlTable('shares', {
  id: int('id').primaryKey().autoincrement(),
  token: varchar('token', { length: 255 }).notNull(),
  fileId: int('file_id'),
  folderId: int('folder_id'),
  passwordHash: varchar('password_hash', { length: 255 }), // Nullable optional password
  expiresAt: datetime('expires_at'), // Nullable expiration date
  allowDownload: boolean('allow_download').default(true).notNull(),
  createdAt: datetime('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  tokenIdx: uniqueIndex('share_token_idx').on(table.token),
  fileIdIdx: index('share_file_id_idx').on(table.fileId),
  folderIdIdx: index('share_folder_id_idx').on(table.folderId),
}));

const sessions = mysqlTable('sessions', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id'), // Nullable (guest users)
  sessionId: varchar('session_id', { length: 255 }).notNull(),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: varchar('user_agent', { length: 500 }),
  data: text('data'), // Serialized session data for express-session compatibility
  lastActivityAt: datetime('last_activity_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  createdAt: datetime('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
  expiresAt: datetime('expires_at').notNull(),
}, (table) => ({
  sessionIdIdx: uniqueIndex('sess_id_idx').on(table.sessionId),
  userIdIdx: index('sess_user_id_idx').on(table.userId),
  expiresAtIdx: index('sess_expires_at_idx').on(table.expiresAt),
}));

const activityLogs = mysqlTable('activity_logs', {
  id: int('id').primaryKey().autoincrement(),
  userId: int('user_id').notNull(),
  action: varchar('action', { length: 255 }).notNull(), // e.g. 'upload_file', 'delete_file', etc.
  entityType: varchar('entity_type', { length: 50 }).notNull(), // 'file', 'folder'
  entityId: int('entity_id').notNull(),
  createdAt: datetime('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  userIdIdx: index('log_user_id_idx').on(table.userId),
}));

const userStorageStats = mysqlTable('user_storage_stats', {
  userId: int('user_id').primaryKey().notNull(), // Primary Key matching user id
  totalFiles: bigint('total_files', { mode: 'number' }).default(0).notNull(),
  totalFolders: bigint('total_folders', { mode: 'number' }).default(0).notNull(),
  totalSize: bigint('total_size', { mode: 'number' }).default(0).notNull(),
  updatedAt: datetime('updated_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
});

const jobs = mysqlTable('jobs', {
  id: int('id').primaryKey().autoincrement(),
  type: varchar('type', { length: 50 }).notNull(), // 'thumbnail', 'zip_pack', 'folder_copy', 'trash_purge'
  payload: text('payload').notNull(), // JSON configurations
  status: varchar('status', { length: 20 }).default('pending').notNull(), // 'pending', 'running', 'completed', 'failed'
  createdAt: datetime('created_at').default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => ({
  statusIdx: index('jobs_status_idx').on(table.status),
}));



const usersRelations = relations(users, ({ many, one }) => ({
  folders: many(folders),
  files: many(files),
  sessions: many(sessions),
  activityLogs: many(activityLogs),
  storageStats: one(userStorageStats, { fields: [users.id], references: [userStorageStats.userId] }),
}));

const foldersRelations = relations(folders, ({ one, many }) => ({
  user: one(users, { fields: [folders.userId], references: [users.id] }),
  parent: one(folders, { relationName: 'folderHierarchy', fields: [folders.parentId], references: [folders.id] }),
  subfolders: many(folders, { relationName: 'folderHierarchy' }),
  files: many(files),
  shares: many(shares),
  favorites: many(favorites),
}));

const filesRelations = relations(files, ({ one, many }) => ({
  user: one(users, { fields: [files.userId], references: [users.id] }),
  folder: one(folders, { fields: [files.folderId], references: [folders.id] }),
  versions: many(fileVersions),
  shares: many(shares),
  favorites: many(favorites),
  recents: many(recentActivity),
}));

const fileVersionsRelations = relations(fileVersions, ({ one }) => ({
  file: one(files, { fields: [fileVersions.fileId], references: [files.id] }),
  user: one(users, { fields: [fileVersions.uploadedBy], references: [users.id] }),
}));

const trashItemsRelations = relations(trashItems, ({ one }) => ({
  user: one(users, { fields: [trashItems.userId], references: [users.id] }),
}));

const favoritesRelations = relations(favorites, ({ one }) => ({
  user: one(users, { fields: [favorites.userId], references: [users.id] }),
  file: one(files, { fields: [favorites.fileId], references: [files.id] }),
  folder: one(folders, { fields: [favorites.folderId], references: [folders.id] }),
}));

const recentActivityRelations = relations(recentActivity, ({ one }) => ({
  user: one(users, { fields: [recentActivity.userId], references: [users.id] }),
  file: one(files, { fields: [recentActivity.fileId], references: [files.id] }),
}));

const sharesRelations = relations(shares, ({ one }) => ({
  file: one(files, { fields: [shares.fileId], references: [files.id] }),
  folder: one(folders, { fields: [shares.folderId], references: [folders.id] }),
}));

const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, { fields: [sessions.userId], references: [users.id] }),
}));

const activityLogsRelations = relations(activityLogs, ({ one }) => ({
  user: one(users, { fields: [activityLogs.userId], references: [users.id] }),
}));

const userStorageStatsRelations = relations(userStorageStats, ({ one }) => ({
  user: one(users, { fields: [userStorageStats.userId], references: [users.id] }),
}));

module.exports = {
  users,
  folders,
  files,
  fileVersions,
  trashItems,
  favorites,
  recentActivity,
  shares,
  sessions,
  activityLogs,
  userStorageStats,
  jobs,
  usersRelations,
  foldersRelations,
  filesRelations,
  fileVersionsRelations,
  trashItemsRelations,
  favoritesRelations,
  recentActivityRelations,
  sharesRelations,
  sessionsRelations,
  activityLogsRelations,
  userStorageStatsRelations
};

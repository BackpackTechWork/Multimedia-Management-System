const path = require('path');
const repository = require('../repositories/FileRepository');

class UploadConflictService {
  async entries(ownerId, folderId, source = repository) {
    return (await source.findFilesInFolder(ownerId, folderId)).map(row => row.files || row);
  }

  async check(ownerId, folderId, name) {
    const entries = await this.entries(ownerId, folderId);
    const existing = entries.find(file => file.originalName === name);
    return { conflict: Boolean(existing), replaceFileId: existing?.id || null,
      ...(existing ? { file: { id: existing.id, name: existing.originalName, mimeType: existing.mimeType,
        size: existing.size, createdAt: existing.createdAt } } : {}) };
  }

  async save(options) {
    return repository.withUploadLock(options.ownerId, source => this.saveLocked(options, source));
  }

  async saveLocked({ ownerId, folderId, name, saved, mimeType, replaceFileId, uploadedBy }, source) {
    const entries = await this.entries(ownerId, folderId, source);
    if (replaceFileId) {
      const existing = entries.find(file => file.id === Number(replaceFileId) && file.originalName === name);
      if (!existing) throw new Error('The file to replace has changed or was removed. Please retry the upload.');
      return source.replaceUpload(existing, saved, mimeType, uploadedBy || ownerId);
    }
    const names = new Set(entries.map(file => file.originalName));
    const extension = path.extname(name);
    const stem = name.slice(0, name.length - extension.length);
    let candidate = name;
    for (let index = 1; names.has(candidate); index += 1) {
      const suffix = index === 1 ? ' (copy)' : ` (copy ${index})`;
      candidate = stem.slice(0, Math.max(0, 255 - extension.length - suffix.length)) + suffix + extension;
    }
    return source.createFile(ownerId, folderId, saved.filename, candidate,
      extension.substring(1).toLowerCase(), mimeType, saved.size, saved.path, saved.checksum);
  }
}
module.exports = new UploadConflictService();

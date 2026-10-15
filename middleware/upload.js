const multer = require('multer');
const fs = require('fs');
const storageService = require('../services/StorageService');

function uploadError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function writeRequestStream(req, stream, write) {
  // Multer/Busboy's file stream does not automatically close when the HTTP
  // request disconnects. A pending write would otherwise retain its chunk lock
  // forever, blocking every subsequent retry of the same chunk.
  const abort = () => stream.destroy();
  const close = () => { if (!req.complete) abort(); };
  req.once('aborted', abort);
  req.once('error', abort);
  req.once('close', close);
  return Promise.resolve().then(() => {
    if (req.aborted || (req.destroyed && !req.complete)) abort();
    return write();
  }).finally(() => {
    req.removeListener('aborted', abort);
    req.removeListener('error', abort);
    req.removeListener('close', close);
  });
}

// Chunk metadata must precede the file part, as it does in both upload clients.
// Multer passes a stream here, so concurrent requests never retain whole chunks.
const chunkStorage = {
  _handleFile(req, file, callback) {
    const { uploadId, chunkIndex, chunkOffset, fileSize } = req.body;
    const index = Number(chunkIndex);
    const offset = chunkOffset === undefined ? null : Number(chunkOffset);
    const size = fileSize === undefined ? null : Number(fileSize);
    if (!uploadId || chunkIndex === undefined || !Number.isSafeInteger(index) || index < 0) {
      return callback(uploadError('Invalid upload id or chunk index'));
    }
    if (offset !== null && (!Number.isSafeInteger(offset) || offset < 0 ||
        !Number.isSafeInteger(size) || size < 0 || offset > size)) {
      return callback(uploadError('Invalid chunk offset or file size'));
    }
    writeRequestStream(req, file.stream, () =>
      storageService.saveChunkStream(uploadId, index, file.stream, offset, req.session.userId, size))
      .then(result => callback(null, result), callback);
  },
  _removeFile(req, file, callback) {
    // A multipart error after the stream completed must not leave a resume marker.
    storageService.removeChunk(file.uploadId || req.body.uploadId, file.chunkIndex ?? Number(req.body.chunkIndex))
      .then(() => callback(null), callback);
  }
};

const sharedStorage = {
  _handleFile(req, file, callback) {
    writeRequestStream(req, file.stream, () => storageService.stageIncomingFile(file.stream))
      .then(result => callback(null, result), callback);
  },
  _removeFile(req, file, callback) {
    if (!file.path) return callback(null);
    fs.promises.rm(file.path, { force: true }).then(() => callback(null), callback);
  }
};

module.exports = {
  chunkUpload: multer({ storage: chunkStorage, limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 8 } }),
  sharedUpload: multer({ storage: sharedStorage, limits: { fileSize: 50 * 1024 * 1024, files: 1, fields: 8 } })
};

const fs = require('fs');
const path = require('path');
const yauzl = require('yauzl');
const { db } = require('../config/db');
const { files, recentActivity, shares } = require('../models/schema');
const { eq, and, inArray } = require('drizzle-orm');
const fileRepository = require('../repositories/FileRepository');
const storageService = require('../services/StorageService');

class PreviewController {
  constructor() {
    this.checkAccess = this.checkAccess.bind(this);
    this.previewImage = this.previewImage.bind(this);
    this.previewPdf = this.previewPdf.bind(this);
    this.previewExcel = this.previewExcel.bind(this);
    this.previewPresentation = this.previewPresentation.bind(this);
    this.previewMarkdown = this.previewMarkdown.bind(this);
    this.previewCode = this.previewCode.bind(this);
    this.previewVideo = this.previewVideo.bind(this);
    this.previewAudio = this.previewAudio.bind(this);
    this.previewZip = this.previewZip.bind(this);
    this.serveZipEntry = this.serveZipEntry.bind(this);
    this.serveRawStream = this.serveRawStream.bind(this);
  }

  async fileExists(fullPath) {
    try {
      await fs.promises.access(fullPath, fs.constants.F_OK);
      return true;
    } catch {
      return false;
    }
  }

  async checkAccess(req, fileId, { recordRecent = true } = {}) {
    const userId = req.session.userId;
    const file = await fileRepository.findById(fileId);
    if (!file) return null;

    if (file.userId === userId) {
      if (recordRecent) {
        await db.insert(recentActivity)
          .values({
            userId,
            fileId: file.id,
            lastOpenedAt: new Date()
          })
          .onDuplicateKeyUpdate({
            set: { lastOpenedAt: new Date() }
          });
      }
      return file;
    }

    if (file.visibility === 'public') {
      return file;
    }

    const accessTokens = Object.keys(req.session.sharedAccess || {});
    if (accessTokens.length > 0) {
      const [share] = await db.select()
        .from(shares)
        .where(and(eq(shares.fileId, file.id), inArray(shares.token, accessTokens)))
        .limit(1);

      if (share && (!share.expiresAt || new Date(share.expiresAt) > new Date())) {
        return file;
      }
    }

    return null;
  }

  async previewImage(req, res) {
    const file = await this.checkAccess(req, parseInt(req.params.id));
    if (!file) return res.status(403).send('Access Denied');
    res.render('preview/index', { type: 'image', file, content: null });
  }

  async previewPdf(req, res) {
    const file = await this.checkAccess(req, parseInt(req.params.id));
    if (!file) return res.status(403).send('Access Denied');
    res.render('preview/index', { type: 'pdf', file, content: null });
  }

  async previewExcel(req, res) {
    const file = await this.checkAccess(req, parseInt(req.params.id));
    if (!file) return res.status(403).send('Access Denied');
    res.render('preview/index', { type: 'excel', file, content: null });
  }

  async previewPresentation(req, res) {
    const file = await this.checkAccess(req, parseInt(req.params.id));
    if (!file) return res.status(403).send('Access Denied');
    res.render('preview/index', { type: 'presentation', file, content: null });
  }

  async previewMarkdown(req, res) {
    const file = await this.checkAccess(req, parseInt(req.params.id));
    if (!file) return res.status(403).send('Access Denied');

    try {
      const fullPath = path.join(storageService.storageRoot, file.path);
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      res.render('preview/index', { type: 'markdown', file, content });
    } catch (err) {
      res.status(500).send('Error reading file content');
    }
  }

  async previewCode(req, res) {
    const file = await this.checkAccess(req, parseInt(req.params.id));
    if (!file) return res.status(403).send('Access Denied');

    try {
      const fullPath = path.join(storageService.storageRoot, file.path);
      const content = await fs.promises.readFile(fullPath, 'utf-8');
      res.render('preview/index', { type: 'code', file, content });
    } catch (err) {
      res.status(500).send('Error reading file content');
    }
  }

  async previewVideo(req, res) {
    const file = await this.checkAccess(req, parseInt(req.params.id));
    if (!file) return res.status(403).send('Access Denied');
    res.render('preview/index', { type: 'video', file, content: null });
  }

  async previewAudio(req, res) {
    const file = await this.checkAccess(req, parseInt(req.params.id));
    if (!file) return res.status(403).send('Access Denied');
    res.render('preview/index', { type: 'audio', file, content: null });
  }

  async serveRawStream(req, res) {
    const file = await this.checkAccess(req, parseInt(req.params.id), { recordRecent: false });
    if (!file) return res.status(403).send('Access Denied');

    let filePath = file.path;
    if (req.query.thumbnail) {
      const size = parseInt(req.query.thumbnail, 10);
      const thumbPath = storageService.getThumbnailPath(file.filename, size);
      if (await this.fileExists(thumbPath)) {
        filePath = path.relative(storageService.storageRoot, thumbPath).replace(/\\/g, '/');
      }
    }

    const fullPath = path.join(storageService.storageRoot, filePath);
    if (!(await this.fileExists(fullPath))) {
      return res.status(404).send('File not found');
    }

    const contentType = req.query.thumbnail ? 'image/jpeg' : file.mimeType;
    res.setHeader('Content-Type', contentType);
    
    let contentDisposition = '';
    if (!req.query.thumbnail) {
      const encodedFilename = encodeURIComponent(file.originalName);
      contentDisposition = `inline; filename="${encodedFilename}"; filename*=UTF-8''${encodedFilename}`;
      res.setHeader('Content-Disposition', contentDisposition);
    }
    
    const range = req.headers.range;
    if (range && !req.query.thumbnail) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : file.size - 1;
      const chunksize = (end - start) + 1;
      
      const fileStream = fs.createReadStream(fullPath, { start, end });
      const headers = {
        'Content-Range': `bytes ${start}-${end}/${file.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': file.mimeType,
      };
      if (contentDisposition) {
        headers['Content-Disposition'] = contentDisposition;
      }
      res.writeHead(206, headers);
      fileStream.pipe(res);
    } else {
      fs.createReadStream(fullPath).pipe(res);
    }
  }

  async previewZip(req, res) {
    const file = await this.checkAccess(req, parseInt(req.params.id));
    if (!file) return res.status(403).send('Access Denied');

    try {
      const fullPath = path.join(storageService.storageRoot, file.path);
      const entries = await new Promise((resolve, reject) => {
        const list = [];
        yauzl.open(fullPath, { lazyEntries: true }, (err, zipfile) => {
          if (err) return reject(err);
          zipfile.readEntry();
          zipfile.on('entry', (entry) => {
            list.push({
              path: entry.fileName,
              size: entry.uncompressedSize,
              compressedSize: entry.compressedSize,
              isDir: entry.fileName.endsWith('/'),
              lastModified: entry.getLastModDate()
            });
            zipfile.readEntry();
          });
          zipfile.on('end', () => resolve(list));
          zipfile.on('error', (err) => reject(err));
        });
      });

      res.render('preview/index', { type: 'zip', file, content: JSON.stringify(entries) });
    } catch (err) {
      console.error(err);
      res.status(500).send('Error reading zip archive');
    }
  }

  async serveZipEntry(req, res) {
    const file = await this.checkAccess(req, parseInt(req.params.id), { recordRecent: false });
    if (!file) return res.status(403).send('Access Denied');

    const entryPath = req.query.path;
    if (!entryPath) return res.status(400).send('Missing path parameter');

    try {
      const fullPath = path.join(storageService.storageRoot, file.path);
      const mime = require('mime-types');

      yauzl.open(fullPath, { lazyEntries: true }, (err, zipfile) => {
        if (err) {
          console.error(err);
          return res.status(500).send('Error opening zip file');
        }

        let found = false;
        zipfile.readEntry();
        zipfile.on('entry', (entry) => {
          if (entry.fileName === entryPath) {
            found = true;
            zipfile.openReadStream(entry, (err, readStream) => {
              if (err) {
                console.error(err);
                zipfile.close();
                return res.status(500).send('Error extracting file');
              }

              const filename = path.basename(entryPath);
              const contentType = mime.lookup(filename) || 'application/octet-stream';
              res.setHeader('Content-Type', contentType);

              if (req.query.download === 'true') {
                res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
              } else {
                res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
              }

              readStream.on('end', () => zipfile.close());
              readStream.on('error', (err) => {
                console.error(err);
                zipfile.close();
              });
              
              res.on('close', () => {
                readStream.destroy();
                zipfile.close();
              });

              readStream.pipe(res);
            });
          } else {
            zipfile.readEntry();
          }
        });

        zipfile.on('end', () => {
          if (!found) {
            zipfile.close();
            res.status(404).send('File not found in zip archive');
          }
        });

        zipfile.on('error', (err) => {
          console.error(err);
          zipfile.close();
          if (!res.headersSent) {
            res.status(500).send('Error reading zip archive');
          }
        });
      });
    } catch (err) {
      console.error(err);
      res.status(500).send('Internal Server Error');
    }
  }
}

module.exports = new PreviewController();

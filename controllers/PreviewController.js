const fs = require('fs');
const path = require('path');
const { db } = require('../config/db');
const { files, recentActivity, shares } = require('../models/schema');
const { eq, and, sql } = require('drizzle-orm');
const fileRepository = require('../repositories/FileRepository');
const storageService = require('../services/StorageService');

class PreviewController {
  constructor() {
    this.checkAccess = this.checkAccess.bind(this);
    this.previewImage = this.previewImage.bind(this);
    this.previewPdf = this.previewPdf.bind(this);
    this.previewExcel = this.previewExcel.bind(this);
    this.previewMarkdown = this.previewMarkdown.bind(this);
    this.previewCode = this.previewCode.bind(this);
    this.previewVideo = this.previewVideo.bind(this);
    this.previewAudio = this.previewAudio.bind(this);
    this.serveRawStream = this.serveRawStream.bind(this);
  }

  async checkAccess(req, fileId) {
    const userId = req.session.userId;
    const file = await fileRepository.findById(fileId);
    if (!file) return null;

    if (file.userId === userId) {
      await db.insert(recentActivity)
        .values({
          userId,
          fileId: file.id,
          lastOpenedAt: new Date()
        })
        .onDuplicateKeyUpdate({
          set: { lastOpenedAt: new Date() }
        });
      return file;
    }

    if (file.visibility === 'public') {
      return file;
    }

    const fileShares = await db.select().from(shares).where(eq(shares.fileId, file.id));
    for (let share of fileShares) {
      if (req.session.sharedAccess && req.session.sharedAccess[share.token]) {
        if (!share.expiresAt || new Date(share.expiresAt) > new Date()) {
          return file;
        }
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
    const file = await this.checkAccess(req, parseInt(req.params.id));
    if (!file) return res.status(403).send('Access Denied');

    let filePath = file.path;
    if (req.query.thumbnail) {
      const size = parseInt(req.query.thumbnail, 10);
      const thumbPath = storageService.getThumbnailPath(file.filename, size);
      if (fs.existsSync(thumbPath)) {
        filePath = path.relative(storageService.storageRoot, thumbPath).replace(/\\/g, '/');
      }
    }

    const fullPath = path.join(storageService.storageRoot, filePath);
    if (!fs.existsSync(fullPath)) {
      return res.status(404).send('File not found');
    }

    const contentType = req.query.thumbnail ? 'image/jpeg' : file.mimeType;
    res.setHeader('Content-Type', contentType);
    
    const range = req.headers.range;
    if (range && !req.query.thumbnail) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : file.size - 1;
      const chunksize = (end - start) + 1;
      
      const fileStream = fs.createReadStream(fullPath, { start, end });
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${file.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunksize,
        'Content-Type': file.mimeType,
      });
      fileStream.pipe(res);
    } else {
      fs.createReadStream(fullPath).pipe(res);
    }
  }
}

module.exports = new PreviewController();

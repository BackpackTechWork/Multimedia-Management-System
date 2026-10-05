// Isolated local benchmark of buffered versus streamed multipart intake.
// Uses no database, credentials, live storage or running application instance.
const fs = require('fs');
const path = require('path');
const os = require('os');
const http = require('http');
const { fork } = require('child_process');
const { once } = require('events');
const { performance, monitorEventLoopDelay } = require('perf_hooks');

const MiB = 1024 * 1024;
const chunkSize = 8 * MiB;

if (process.argv[2] === '--worker') {
  runWorker().catch(err => { console.error(err); process.exit(1); });
} else {
  runBenchmark().catch(err => { console.error(err); process.exitCode = 1; });
}

async function runWorker() {
  const mode = process.argv[3];
  const root = process.argv[4];
  process.env.STORAGE_ROOT = path.join(root, 'storage');
  process.env.UPLOAD_TEMP_ROOT = path.join(root, 'staging');
  process.env.MAX_SYSTEM_STORAGE_GB = '';
  const express = require('express');
  const multer = require('multer');
  const storage = require('../services/StorageService');
  const streamed = require('../middleware/upload').chunkUpload;
  const buffered = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * MiB } });
  const app = express();
  const lag = monitorEventLoopDelay({ resolution: 10 });
  lag.enable();
  let peakRSS = process.memoryUsage().rss;
  let peakBuffers = process.memoryUsage().arrayBuffers;
  const sample = () => {
    const memory = process.memoryUsage();
    peakRSS = Math.max(peakRSS, memory.rss);
    peakBuffers = Math.max(peakBuffers, memory.arrayBuffers);
  };
  const sampling = setInterval(sample, 10);
  app.use((req, res, next) => {
    req.session = { userId: Number(req.headers['x-benchmark-user']) };
    next();
  });
  app.post('/chunk', (mode === 'buffered' ? buffered : streamed).single('chunk'), async (req, res, next) => {
    try {
      sample();
      if (mode === 'buffered') {
        await storage.saveChunk(req.body.uploadId, Number(req.body.chunkIndex), req.file.buffer,
          Number(req.body.chunkOffset), req.session.userId);
      }
      res.sendStatus(200);
    } catch (err) { next(err); }
  });
  app.use((err, req, res, next) => res.status(500).send(err.message));
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  process.send({ port: server.address().port });
  process.on('message', async message => {
    if (message.type !== 'finish') return;
    try {
      for (let user = 1; user <= message.users; user++) {
        const indices = await storage.getUploadedChunks(`benchmark-${user}`, user);
        if (indices.length !== message.chunks) throw new Error('Missing chunks');
        if (await storage.getChunkUploadSize(`benchmark-${user}`) !== message.fileSize) throw new Error('Size mismatch');
        if (!await storage.getManifestChecksum(`benchmark-${user}`, message.chunks, message.fileSize)) throw new Error('Manifest mismatch');
      }
      sample();
      clearInterval(sampling);
      lag.disable();
      process.send({ peakRSSMiB: peakRSS / MiB, peakBuffersMiB: peakBuffers / MiB, maxEventLoopDelayMs: lag.max / 1e6 });
      server.close(() => process.exit(0));
    } catch (err) {
      console.error(err);
      process.exit(1);
    }
  });
}

async function uploadChunk(port, user, index, fileSize) {
  const boundary = 'harbor-benchmark-boundary';
  const offset = index * chunkSize;
  const size = Math.min(chunkSize, fileSize - offset);
  const fields = { uploadId: `benchmark-${user}`, chunkIndex: index, chunkOffset: offset, fileSize };
  const prefix = Buffer.from(Object.entries(fields).map(([key, value]) =>
    `--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`).join('') +
    `--${boundary}\r\nContent-Disposition: form-data; name="chunk"; filename="chunk_${index}"\r\nContent-Type: application/octet-stream\r\n\r\n`);
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  const request = http.request({ hostname: '127.0.0.1', port, path: '/chunk', method: 'POST',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': prefix.length + size + suffix.length, 'x-benchmark-user': user } });
  request.setTimeout(60000, () => request.destroy(new Error('Benchmark request timed out')));
  const response = once(request, 'response');
  // Observe errors immediately even while the request body is backpressured.
  response.catch(() => {});
  const write = async buffer => { if (!request.write(buffer)) await once(request, 'drain'); };
  await write(prefix);
  const block = Buffer.alloc(64 * 1024, user);
  for (let sent = 0; sent < size; sent += block.length) await write(block.subarray(0, Math.min(block.length, size - sent)));
  request.end(suffix);
  const [incoming] = await response;
  let body = '';
  for await (const bytes of incoming) body += bytes.toString();
  if (incoming.statusCode !== 200) throw new Error(body);
}

async function runBenchmark() {
  const users = Number(process.argv[2] || 8);
  const fileMiB = Number(process.argv[3] || 128);
  if (!Number.isSafeInteger(users) || users < 1 || users > 32 ||
      !Number.isSafeInteger(fileMiB) || fileMiB < 8 || fileMiB > 2048) {
    throw new Error('Usage: node scripts/benchmark-uploads.js [users: 1-32] [MiB per file: 8-2048]');
  }
  const fileSize = fileMiB * MiB;
  const chunks = Math.ceil(fileSize / chunkSize);
  const totalBytes = users * fileSize;
  const available = await fs.promises.statfs(os.tmpdir());
  if (Number(available.bavail) * Number(available.bsize) < totalBytes + 256 * MiB) {
    throw new Error('Insufficient temporary disk space for this benchmark');
  }
  console.log(`Local intake benchmark: ${users} users x ${fileMiB} MiB, up to 4 chunk requests per user.`);
  console.log('Measures multipart intake and staging only; excludes login/database, finalization and real network latency.');
  const results = [];
  for (const mode of ['buffered', 'streamed']) {
    const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'harbor-upload-benchmark-'));
    const child = fork(__filename, ['--worker', mode, root], { stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    try {
      const [started] = await Promise.race([
        once(child, 'message'),
        once(child, 'exit').then(([code]) => { throw new Error(`Benchmark worker exited (${code})`); })
      ]);
      const startedAt = performance.now();
      await Promise.all(Array.from({ length: users }, async (_, i) => {
        const user = i + 1;
        await uploadChunk(started.port, user, 0, fileSize);
        let cursor = 1;
        await Promise.all(Array.from({ length: Math.min(4, chunks - 1) }, async () => {
          while (cursor < chunks) await uploadChunk(started.port, user, cursor++, fileSize);
        }));
      }));
      const seconds = (performance.now() - startedAt) / 1000;
      const metrics = once(child, 'message');
      child.send({ type: 'finish', users, chunks, fileSize });
      const [summary] = await Promise.race([
        metrics,
        once(child, 'exit').then(([code]) => { throw new Error(`Benchmark verification failed (${code})`); })
      ]);
      results.push({ mode, seconds: Number(seconds.toFixed(2)), MiBPerSecond: Number((totalBytes / MiB / seconds).toFixed(1)),
        peakRSSMiB: Number(summary.peakRSSMiB.toFixed(1)), peakBuffersMiB: Number(summary.peakBuffersMiB.toFixed(1)),
        maxEventLoopDelayMs: Number(summary.maxEventLoopDelayMs.toFixed(1)) });
    } finally {
      if (child.exitCode === null) {
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }
      await fs.promises.rm(root, { recursive: true, force: true });
    }
  }
  console.table(results);
}

const CACHE_VERSION = 'harbor-drive-shell-v16';
const STATIC_ASSETS = [
  '/site.webmanifest', '/favicon.svg', '/apple-touch-icon.png',
  '/css/drive.css', '/css/auth.css', '/css/preview.css',
  '/js/pwa.js', '/js/drive.js', '/js/auth.js', '/js/preview.js', '/js/shortcuts.js',
  '/vendor/inter/index.css', '/vendor/bootstrap-icons/bootstrap-icons.css'
];
const DB_NAME = 'harbor-drive-pwa';
const STORE_NAME = 'upload-finalizations';
const STREAM_PAYLOAD_STORE_NAME = 'upload-payloads';
const activeStreamUploads = new Map();
const STREAM_CHUNK_CONCURRENCY = 4;
let activeStreamChunkRequests = 0;
const streamChunkWaiters = [];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_VERSION).then(cache => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(Promise.all([
    caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_VERSION).map(key => caches.delete(key)))),
    clearStreamPayloads(),
    self.clients.claim(),
    pollTrackedUploads()
  ]));
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;
  const isStatic = STATIC_ASSETS.includes(url.pathname) ||
    url.pathname.startsWith('/vendor/inter/files/') ||
    url.pathname.startsWith('/vendor/bootstrap-icons/fonts/');
  if (!isStatic) return;
  const isAppCode = url.pathname.startsWith('/js/') ||
    url.pathname.startsWith('/css/') ||
    url.pathname === '/site.webmanifest';
  event.respondWith(isAppCode
    ? fetchAndCacheLatest(event.request).catch(async () => (await caches.match(event.request)) || Response.error())
    : caches.match(event.request).then(cached => cached || fetchAndCacheLatest(event.request))
  );
});

async function fetchAndCacheLatest(request) {
  const response = await fetch(request, { cache: 'no-cache' });
  if (response.ok) {
    const cacheCopy = response.clone();
    caches.open(CACHE_VERSION)
      .then(async cache => {
        const requestUrl = new URL(request.url);
        const cachedRequests = await cache.keys();
        await Promise.all(cachedRequests
          .filter(cachedRequest => {
            const cachedUrl = new URL(cachedRequest.url);
            return cachedUrl.pathname === requestUrl.pathname && cachedUrl.href !== requestUrl.href;
          })
          .map(cachedRequest => cache.delete(cachedRequest)));
        await cache.put(request, cacheCopy);
      })
      .catch(err => console.warn('Static asset cache update failed:', err));
  }
  return response;
}

self.addEventListener('message', event => {
  const { type, upload, payload, uploadIds = [] } = event.data || {};
  if (type === 'POLL_UPLOADS') {
    event.waitUntil(pollTrackedUploads());
    return;
  }
  if (type === 'LIST_STREAM_UPLOADS') {
    const uploads = Array.from(activeStreamUploads.values()).map(active => ({
      uploadId: active.uploadId,
      percent: active.percent || 0,
      paused: active.paused
    }));
    event.ports[0]?.postMessage({ uploads, uploadIds: uploads.map(item => item.uploadId) });
    return;
  }
  if (type === 'START_STREAM_UPLOAD' && payload?.uploadId && payload?.file) {
    const port = event.ports[0];
    // Start network transfer immediately. Server-side chunks provide resume
    // safety; copying File blobs into IndexedDB delayed the first request.
    event.waitUntil(startStreamUpload(payload, port, { persistPayload: false }));
    return;
  }
  if (['PAUSE_STREAM_UPLOADS', 'RESUME_STREAM_UPLOADS', 'CANCEL_STREAM_UPLOADS'].includes(type)) {
    const persistenceUpdates = [];
    uploadIds.forEach(uploadId => {
      const active = activeStreamUploads.get(uploadId);
      if (type === 'CANCEL_STREAM_UPLOADS') {
        persistenceUpdates.push(deleteStreamPayload(uploadId).catch(() => {}));
      }
      if (!active) return;
      if (type === 'PAUSE_STREAM_UPLOADS') {
        active.paused = true;
        active.controllers.forEach(controller => controller.abort());
      } else if (type === 'RESUME_STREAM_UPLOADS') {
        active.paused = false;
        active.resumeWaiters.splice(0).forEach(resolve => resolve());
      } else {
        active.cancelled = true;
        active.controllers.forEach(controller => controller.abort());
        active.resumeWaiters.splice(0).forEach(resolve => resolve());
      }
    });
    const updatePromise = Promise.all(persistenceUpdates).then(() => {
      if (type === 'CANCEL_STREAM_UPLOADS') event.ports[0]?.postMessage({ cancelled: true });
    });
    event.waitUntil(updatePromise);
    return;
  }
  if (!upload?.uploadId) return;
  if (type === 'TRACK_UPLOAD') event.waitUntil(putUpload(upload).then(registerUploadSync));
  if (type === 'UPLOAD_FINISHED') event.waitUntil(completeTrackedUpload(upload, true));
});

function startStreamUpload(payload, port = null, { persistPayload = false } = {}) {
  let active = activeStreamUploads.get(payload.uploadId);
  if (active) {
    if (port) active.ports.add(port);
    port?.postMessage({ type: 'PROGRESS', percent: active.percent || 0 });
    return active.promise;
  }

  active = {
    uploadId: payload.uploadId,
    ports: new Set(port ? [port] : []),
    controllers: new Set(),
    resumeWaiters: [],
    paused: false,
    cancelled: false,
    percent: 0,
    promise: null
  };
  active.promise = (persistPayload ? putStreamPayload(payload) : Promise.resolve())
    .then(() => streamUploadInWorker(payload, active))
    .catch(err => {
      if (active.cancelled || (err?.name === 'AbortError' && err?.message === 'Upload cancelled')) {
        sendStreamMessage(active, { type: 'CANCELLED' });
        return;
      }
      const storageFailure = err?.name === 'QuotaExceededError'
        ? 'Not enough browser storage to preserve this upload through a hard refresh'
        : (err.message || 'Background upload failed');
      sendStreamMessage(active, { type: 'ERROR', error: storageFailure });
    })
    .finally(() => activeStreamUploads.delete(payload.uploadId));
  activeStreamUploads.set(payload.uploadId, active);
  return active.promise;
}

function sendStreamMessage(active, message) {
  const enrichedMessage = { ...message, uploadId: active.uploadId };
  active.ports.forEach(port => {
    try { port.postMessage(enrichedMessage); } catch { active.ports.delete(port); }
  });
  if (message.type === 'PROGRESS') {
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(clients => clients.forEach(client => client.postMessage({
        type: 'STREAM_UPLOAD_PROGRESS',
        uploadId: active.uploadId,
        percent: message.percent
      })))
      .catch(() => {});
  }
}

async function acquireStreamChunkSlot() {
  if (activeStreamChunkRequests >= STREAM_CHUNK_CONCURRENCY) {
    await new Promise(resolve => streamChunkWaiters.push(resolve));
  }
  activeStreamChunkRequests += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeStreamChunkRequests -= 1;
    streamChunkWaiters.shift()?.();
  };
}

async function waitForStreamResume(active) {
  while (active.paused && !active.cancelled) {
    await new Promise(resolve => active.resumeWaiters.push(resolve));
  }
  if (active.cancelled) {
    throw Object.assign(new Error('Upload cancelled'), { name: 'AbortError' });
  }
}

function getChunkUploadPercent(completedChunks, totalChunks) {
  if (totalChunks <= 0) return 0;
  const percent = Math.max(0, Math.min((completedChunks / totalChunks) * 98, 98));
  if (percent > 0 && percent < 1) return Math.round(percent * 100) / 100;
  if (percent < 10) return Math.round(percent * 10) / 10;
  return Math.round(percent);
}

async function streamFetch(url, options, active, maxAttempts = 6) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await waitForStreamResume(active);
    const controller = new AbortController();
    active.controllers.add(controller);
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 120000);
    try {
      const response = await fetch(url, { ...options, signal: controller.signal, credentials: 'include' });
      if (response.ok) return response;
      if (response.status >= 400 && response.status < 500 && response.status !== 429) return response;
      throw new Error(`Status ${response.status}`);
    } catch (err) {
      if (active.cancelled) {
        throw Object.assign(new Error('Upload cancelled'), { name: 'AbortError' });
      }
      if (active.paused) {
        await waitForStreamResume(active);
        attempt -= 1;
        continue;
      }
      if (attempt === maxAttempts) {
        if (timedOut) throw new Error('Upload request timed out after repeated attempts');
        throw err;
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(10000, 750 * (2 ** (attempt - 1)))));
    } finally {
      clearTimeout(timeoutId);
      active.controllers.delete(controller);
    }
  }
  throw new Error('Upload retry limit reached');
}

async function streamUploadInWorker(payload, active) {
  const { file, uploadId, filename, folderId, fileSize, totalChunks, chunkSize, isNewUpload, csrfToken, deferStats } = payload;
  try {
    let status = { completed: false, processing: false, uploadedChunks: [] };
    if (!isNewUpload) {
      const statusResponse = await streamFetch(
        `/api/upload/status?uploadId=${encodeURIComponent(uploadId)}`,
        { method: 'GET', cache: 'no-store' },
        active
      );
      if (!statusResponse.ok) throw new Error(`Upload status ${statusResponse.status}`);
      status = await statusResponse.json();
    }
    if (status.completed || status.processing) {
      await deleteStreamPayload(uploadId).catch(() => {});
      sendStreamMessage(active, { type: 'STAGED' });
      return;
    }

    const uploadedChunks = new Set(status.uploadedChunks || []);
    const missingIndices = [];
    for (let index = 0; index < totalChunks; index += 1) {
      if (!uploadedChunks.has(index)) missingIndices.push(index);
    }

    let completedChunks = uploadedChunks.size;
    active.percent = getChunkUploadPercent(completedChunks, totalChunks);
    sendStreamMessage(active, { type: 'PROGRESS', percent: active.percent });

    const uploadChunkAtIndex = async index => {
      await waitForStreamResume(active);
      const start = index * chunkSize;
      const end = Math.min(file.size, start + chunkSize);
      const formData = new FormData();
      formData.append('uploadId', uploadId);
      formData.append('chunkIndex', index);
      formData.append('chunkOffset', start);
      formData.append('fileSize', fileSize);
      formData.append('chunk', file.slice(start, end), `chunk_${index}`);
      const releaseChunkSlot = await acquireStreamChunkSlot();
      let response;
      try {
        await waitForStreamResume(active);
        response = await streamFetch('/api/upload/chunk', {
          method: 'POST',
          headers: { 'x-csrf-token': csrfToken },
          body: formData
        }, active);
      } finally {
        releaseChunkSlot();
      }
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        throw new Error(error.error || `Chunk ${index + 1} failed with status ${response.status}`);
      }
      completedChunks += 1;
      active.percent = getChunkUploadPercent(completedChunks, totalChunks);
      sendStreamMessage(active, { type: 'PROGRESS', percent: active.percent });
    };

    if (completedChunks === 0 && missingIndices.length > 0) {
      await uploadChunkAtIndex(missingIndices.shift());
    }

    let cursor = 0;
    const workers = Array.from({ length: Math.min(3, missingIndices.length) }, async () => {
      while (cursor < missingIndices.length) {
        const index = missingIndices[cursor++];
        await uploadChunkAtIndex(index);
      }
    });
    await Promise.all(workers);

    const completeResponse = await streamFetch('/api/upload/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrfToken },
      body: JSON.stringify({ uploadId, totalChunks, filename, fileSize, folderId, deferStats })
    }, active);
    if (!completeResponse.ok) {
      const error = await completeResponse.json().catch(() => ({}));
      throw new Error(error.error || `Finalization failed with status ${completeResponse.status}`);
    }

    await deleteStreamPayload(uploadId).catch(() => {});
    await putUpload({ uploadId, filename, trackedAt: Date.now() }).catch(() => {});
    await registerUploadSync();
    sendStreamMessage(active, { type: 'STAGED' });
  } catch (err) {
    throw err;
  }
}

self.addEventListener('sync', event => {
  if (event.tag === 'harbor-upload-finalizations') event.waitUntil(pollTrackedUploads());
});

self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Harbor Drive', {
    body: data.body || 'Your background task is complete.',
    icon: '/web-app-manifest-192x192.png', badge: '/favicon-96x96.png',
    data: { url: data.url || '/my-drive' }
  }));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/my-drive';
  event.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windows => {
    const existing = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (existing) {
      existing.navigate(targetUrl);
      return existing.focus();
    }
    return clients.openWindow(targetUrl);
  }));
});

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 2);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: 'uploadId' });
      }
      if (!request.result.objectStoreNames.contains(STREAM_PAYLOAD_STORE_NAME)) {
        request.result.createObjectStore(STREAM_PAYLOAD_STORE_NAME, { keyPath: 'uploadId' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore(storeName, mode, callback) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, mode);
    const request = callback(transaction.objectStore(storeName));
    let result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => {
      db.close();
      resolve(result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error('Browser storage transaction was aborted'));
    };
  });
}

function putUpload(upload) { return withStore(STORE_NAME, 'readwrite', store => store.put({ ...upload, trackedAt: Date.now() })); }
function deleteUpload(uploadId) { return withStore(STORE_NAME, 'readwrite', store => store.delete(uploadId)); }
function getUploads() { return withStore(STORE_NAME, 'readonly', store => store.getAll()); }
function putStreamPayload(payload) { return withStore(STREAM_PAYLOAD_STORE_NAME, 'readwrite', store => store.put(payload)); }
function deleteStreamPayload(uploadId) { return withStore(STREAM_PAYLOAD_STORE_NAME, 'readwrite', store => store.delete(uploadId)); }
function clearStreamPayloads() { return withStore(STREAM_PAYLOAD_STORE_NAME, 'readwrite', store => store.clear()); }

async function registerUploadSync() {
  if ('sync' in self.registration) {
    await self.registration.sync.register('harbor-upload-finalizations').catch(() => {});
  }
}

async function completeTrackedUpload(upload, notify) {
  await deleteUpload(upload.uploadId);
  const openClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  openClients.forEach(client => client.postMessage({ type: 'UPLOAD_SYNCED', upload }));
  if (notify && 'Notification' in self && Notification.permission === 'granted') {
    await self.registration.showNotification('Upload safely stored', {
      body: `${upload.filename || 'Your file'} is now available in Harbor Drive.`,
      icon: '/web-app-manifest-192x192.png', badge: '/favicon-96x96.png',
      tag: `upload-${upload.uploadId}`, data: { url: '/my-drive' }
    });
  }
}

async function pollTrackedUploads() {
  const uploads = await getUploads().catch(() => []);
  let stillProcessing = false;
  await Promise.all(uploads.map(async upload => {
    try {
      const response = await fetch(`/api/upload/status?uploadId=${encodeURIComponent(upload.uploadId)}`, {
        credentials: 'include', cache: 'no-store'
      });
      if (!response.ok) { stillProcessing = true; return; }
      const status = await response.json();
      if (status.completed) {
        await completeTrackedUpload(upload, true);
      } else if (status.failed) {
        await deleteUpload(upload.uploadId);
        if ('Notification' in self && Notification.permission === 'granted') {
          await self.registration.showNotification('Upload needs attention', {
            body: `${upload.filename || 'A file'} could not be stored. Open Harbor Drive to retry.`,
            icon: '/web-app-manifest-192x192.png', tag: `upload-${upload.uploadId}`,
            data: { url: '/my-drive' }
          });
        }
      } else {
        stillProcessing = true;
      }
    } catch { stillProcessing = true; }
  }));
  if (stillProcessing) await registerUploadSync();
}

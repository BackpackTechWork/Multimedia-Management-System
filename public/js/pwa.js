(function () {
  'use strict';

  let registrationPromise = null;
  let deferredInstallPrompt = null;
  const pageUploads = new Map();

  function queryWorker(worker, message, timeoutMs = 5000) {
    return new Promise(resolve => {
      const channel = new MessageChannel();
      let finished = false;
      const finish = value => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        channel.port1.close();
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);
      channel.port1.onmessage = event => finish(event.data);
      try { worker.postMessage(message, [channel.port2]); } catch { finish(null); }
    });
  }

  function isInstalledPwa() {
    return window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
  }

  function syncInstallButtons({ busy = false } = {}) {
    const canInstall = Boolean(deferredInstallPrompt) && !isInstalledPwa();
    document.querySelectorAll('[data-pwa-install]').forEach(button => {
      button.hidden = !canInstall;
      button.disabled = busy;
      button.classList.toggle('inline-flex', canInstall);
      const label = button.querySelector('[data-pwa-install-label]');
      if (label) label.textContent = busy ? 'Opening installer...' : 'Install Harbor Drive';
    });
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    syncInstallButtons();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    syncInstallButtons();
  });

  document.addEventListener('click', async event => {
    const button = event.target.closest?.('[data-pwa-install]');
    if (!button || !deferredInstallPrompt) return;
    syncInstallButtons({ busy: true });
    try {
      await deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
    } catch (err) {
      console.warn('Harbor Drive installation prompt failed:', err);
    } finally {
      deferredInstallPrompt = null;
      syncInstallButtons();
    }
  });

  window.matchMedia?.('(display-mode: standalone)').addEventListener?.('change', () => syncInstallButtons());

  function getRegistration() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    if (!registrationPromise) {
      registrationPromise = navigator.serviceWorker.register('/sw.js', {
        scope: '/',
        updateViaCache: 'none'
      })
        .then(registration => {
          registration.update().catch(err => {
            console.warn('Harbor Drive update check failed:', err);
          });
          if (registration.active) return registration;
          // A broken/blocked worker must not leave uploads waiting forever.
          return new Promise(resolve => {
            const timer = setTimeout(() => resolve(registration), 10000);
            navigator.serviceWorker.ready.then(ready => {
              clearTimeout(timer);
              resolve(ready);
            });
          });
        })
        .catch(err => {
          console.warn('Harbor Drive service worker could not start:', err);
          return null;
        });
    }
    return registrationPromise;
  }

  async function postToWorker(message) {
    const registration = await getRegistration();
    const worker = navigator.serviceWorker.controller || registration?.active;
    worker?.postMessage(message);
  }

  async function prepareUploadNotifications() {
    getRegistration();
    navigator.storage?.persist?.().catch(() => false);
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    try {
      await Notification.requestPermission();
    } catch (err) {
      console.warn('Upload notifications are unavailable:', err);
    }
  }

  function trackUpload(upload) {
    postToWorker({ type: 'TRACK_UPLOAD', upload });
  }

  function uploadFinished(upload) {
    postToWorker({ type: 'UPLOAD_FINISHED', upload });
  }

  async function streamUpload(payload, onProgress) {
    const registration = await getRegistration();
    let worker = navigator.serviceWorker.controller || registration?.active;
    if (!worker || typeof MessageChannel === 'undefined') return { handled: false };

    return await new Promise((resolve, reject) => {
      let channel;
      let generation = 0;
      let settled = false;
      let checking = false;
      let timer;
      const session = { paused: false, check: null, cancel: null };
      const finish = (value, error) => {
        if (settled) return;
        settled = true;
        generation += 1;
        clearInterval(timer);
        channel?.port1.close();
        pageUploads.delete(payload.uploadId);
        if (error) reject(error);
        else resolve(value);
      };
      const attach = (target, resuming) => {
        channel?.port1.close();
        channel = new MessageChannel();
        worker = target;
        const currentGeneration = ++generation;
        channel.port1.onmessage = event => {
          if (settled || generation !== currentGeneration) return;
          const message = event.data || {};
          if (message.type === 'PROGRESS') onProgress?.(message.percent);
          if (message.type === 'STAGED') finish({ handled: true });
          if (message.type === 'ERROR') finish(null, new Error(message.error || 'Upload failed'));
          if (message.type === 'CANCELLED') finish(null, new DOMException('Upload cancelled', 'AbortError'));
        };
        try {
          // Keep the File in the page. If the worker was killed, its replacement
          // resumes from server markers rather than deleting/reuploading chunks.
          worker.postMessage({ type: 'START_STREAM_UPLOAD', payload: {
            ...payload, isNewUpload: resuming ? false : payload.isNewUpload
          } }, [channel.port2]);
        } catch (error) {
          if (!resuming) finish({ handled: false, error });
        }
      };
      session.check = async () => {
        if (settled || checking || session.paused) return;
        checking = true;
        const checkedGeneration = generation;
        try {
          const state = await queryWorker(worker, { type: 'LIST_STREAM_UPLOADS' });
          if (settled || session.paused || generation !== checkedGeneration) return;
          const active = state?.uploads?.find(upload => upload.uploadId === payload.uploadId);
          if (active) {
            onProgress?.(active.percent);
            return;
          }
          // Controller replacement, worker termination, or a lost terminal
          // message: reattach idempotently, checking server state first.
          const nextWorker = navigator.serviceWorker.controller || registration?.active;
          if (nextWorker && navigator.onLine !== false) attach(nextWorker, true);
        } finally {
          checking = false;
        }
      };
      session.cancel = () => finish(null, new DOMException('Upload cancelled', 'AbortError'));
      pageUploads.set(payload.uploadId, session);
      timer = setInterval(session.check, 15000);
      attach(worker, false);
    });
  }

  async function canStreamUploads() {
    const registration = await getRegistration();
    return Boolean(navigator.serviceWorker.controller || registration?.active);
  }

  async function getStreamingUploads() {
    const registration = await getRegistration();
    const worker = navigator.serviceWorker.controller || registration?.active;
    if (!worker || typeof MessageChannel === 'undefined') return [];
    const channel = new MessageChannel();
    return await new Promise(resolve => {
      let settled = false;
      const finish = uploads => {
        if (settled) return;
        settled = true;
        channel.port1.close();
        resolve(uploads);
      };
      const timeoutId = setTimeout(() => finish([]), 1500);
      channel.port1.onmessage = event => {
        clearTimeout(timeoutId);
        const uploads = event.data?.uploads;
        if (Array.isArray(uploads)) {
          finish(uploads);
          return;
        }
        finish((event.data?.uploadIds || []).map(uploadId => ({ uploadId, percent: 0, paused: false })));
      };
      worker.postMessage({ type: 'LIST_STREAM_UPLOADS' }, [channel.port2]);
    });
  }

  async function getStreamingUploadIds() {
    return (await getStreamingUploads()).map(upload => upload.uploadId);
  }

  function pauseUploads(uploadIds) {
    uploadIds.forEach(id => { const session = pageUploads.get(id); if (session) session.paused = true; });
    postToWorker({ type: 'PAUSE_STREAM_UPLOADS', uploadIds });
  }

  function resumeUploads(uploadIds) {
    uploadIds.forEach(id => {
      const session = pageUploads.get(id);
      if (session) { session.paused = false; session.check(); }
    });
    postToWorker({ type: 'RESUME_STREAM_UPLOADS', uploadIds });
  }

  async function cancelUploads(uploadIds) {
    uploadIds.forEach(id => pageUploads.get(id)?.cancel());
    const registration = await getRegistration();
    const worker = navigator.serviceWorker.controller || registration?.active;
    if (!worker || typeof MessageChannel === 'undefined') return;

    const channel = new MessageChannel();
    await new Promise(resolve => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        channel.port1.close();
        resolve();
      };
      const timeoutId = setTimeout(finish, 3000);
      channel.port1.onmessage = () => {
        clearTimeout(timeoutId);
        finish();
      };
      worker.postMessage({ type: 'CANCEL_STREAM_UPLOADS', uploadIds }, [channel.port2]);
    });
  }

  getRegistration().then(registration => {
    const worker = navigator.serviceWorker?.controller || registration?.active;
    worker?.postMessage({ type: 'POLL_UPLOADS' });
  });

  navigator.serviceWorker?.addEventListener('message', event => {
    if (event.data?.type === 'UPLOAD_SYNCED') {
      window.dispatchEvent(new CustomEvent('harbor:upload-synced', { detail: event.data.upload }));
    }
    if (event.data?.type === 'STREAM_UPLOAD_PROGRESS') {
      window.dispatchEvent(new CustomEvent('harbor:upload-progress', { detail: event.data }));
    }
  });

  function checkPageUploads() {
    pageUploads.forEach(session => session.check());
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') checkPageUploads();
  });
  window.addEventListener('pageshow', checkPageUploads);
  window.addEventListener('online', checkPageUploads);
  navigator.serviceWorker?.addEventListener('controllerchange', checkPageUploads);

  window.harborPwa = {
    prepareUploadNotifications,
    trackUpload,
    uploadFinished,
    streamUpload,
    canStreamUploads,
    getStreamingUploads,
    getStreamingUploadIds,
    pauseUploads,
    resumeUploads,
    cancelUploads
  };
})();

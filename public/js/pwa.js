(function () {
  'use strict';

  let registrationPromise = null;
  let deferredInstallPrompt = null;

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
          return navigator.serviceWorker.ready;
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
    const worker = navigator.serviceWorker.controller || registration?.active;
    if (!worker || typeof MessageChannel === 'undefined') return { handled: false };

    const channel = new MessageChannel();
    return await new Promise((resolve, reject) => {
      channel.port1.onmessage = event => {
        const message = event.data || {};
        if (message.type === 'PROGRESS') onProgress?.(message.percent);
        if (message.type === 'STAGED') {
          channel.port1.close();
          resolve({ handled: true });
        }
        if (message.type === 'ERROR') {
          channel.port1.close();
          reject(new Error(message.error || 'Background upload failed'));
        }
      };
      try {
        worker.postMessage({ type: 'START_STREAM_UPLOAD', payload }, [channel.port2]);
      } catch (err) {
        channel.port1.close();
        resolve({ handled: false, error: err });
      }
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
    postToWorker({ type: 'PAUSE_STREAM_UPLOADS', uploadIds });
  }

  function resumeUploads(uploadIds) {
    postToWorker({ type: 'RESUME_STREAM_UPLOADS', uploadIds });
  }

  function cancelUploads(uploadIds) {
    postToWorker({ type: 'CANCEL_STREAM_UPLOADS', uploadIds });
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

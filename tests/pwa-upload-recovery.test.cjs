const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };

function harness({ inactive = false } = {}) {
  const events = () => {
    const listeners = new Map();
    return {
      addEventListener(type, callback) {
        if (!listeners.has(type)) listeners.set(type, []);
        listeners.get(type).push(callback);
      },
      emit(type) { for (const callback of listeners.get(type) || []) callback({}); }
    };
  };
  class Channel {
    constructor() {
      const first = { close() { this.closed = true; } };
      const second = { postMessage(data) { if (!first.closed) first.onmessage?.({ data }); } };
      this.port1 = first;
      this.port2 = second;
    }
  }
  const timers = new Map();
  let nextTimer = 0;
  const setTimer = (callback, delay) => { timers.set(++nextTimer, { callback, delay }); return nextTimer; };
  const makeWorker = () => ({
    starts: [], active: true, silent: false,
    postMessage(message, ports = []) {
      if (this.silent) return;
      if (message.type === 'START_STREAM_UPLOAD') this.starts.push({ ...message, port: ports[0] });
      if (message.type === 'LIST_STREAM_UPLOADS') ports[0].postMessage({
        uploads: this.active ? this.starts.map(item => ({ uploadId: item.payload.uploadId, percent: 20 })) : []
      });
      if (message.type === 'CANCEL_STREAM_UPLOADS') ports[0].postMessage({});
    }
  });
  const worker = makeWorker();
  const registration = { active: inactive ? null : worker, update: async () => {} };
  const serviceWorker = { ...events(), controller: inactive ? null : worker,
    register: async () => registration, ready: new Promise(() => {}) };
  const window = events();
  const document = { ...events(), visibilityState: 'visible', querySelectorAll: () => [] };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/js/pwa.js'), 'utf8'), {
    window, document, navigator: { serviceWorker, onLine: true }, MessageChannel: Channel,
    DOMException, console,
    setTimeout: (callback, delay) => {
      const id = setTimer(() => { timers.delete(id); callback(); }, delay);
      return id;
    },
    setInterval: setTimer,
    clearTimeout: id => timers.delete(id), clearInterval: id => timers.delete(id)
  });
  return { api: window.harborPwa, worker, makeWorker, serviceWorker, document, window, timers,
    async tick(delay) {
      for (const [id, timer] of [...timers]) {
        if (timer.delay === delay && timers.has(id)) timer.callback();
      }
      await flush();
    } };
}

test('a healthy upload is checked without starting duplicate transfers', async () => {
  const h = harness();
  const progress = [];
  const result = h.api.streamUpload({ uploadId: 'healthy', file: {}, isNewUpload: true }, value => progress.push(value));
  await flush();
  await h.tick(15000);
  assert.equal(h.worker.starts.length, 1);
  assert.deepEqual(progress, [20]);
  h.worker.starts[0].port.postMessage({ type: 'STAGED' });
  assert.equal((await result).handled, true);
  assert.equal(h.timers.size, 0);
});

test('returning to a tab recovers a missing worker using the same file and server resume markers', async () => {
  const h = harness();
  const file = { name: 'large.bin', size: 20 * 1024 ** 3 };
  const result = h.api.streamUpload({ uploadId: 'resume', file, isNewUpload: true });
  await flush();
  h.worker.silent = true;
  const replacement = h.makeWorker();
  h.serviceWorker.controller = replacement;
  h.document.emit('visibilitychange');
  await h.tick(5000);
  assert.equal(replacement.starts.length, 1);
  assert.equal(replacement.starts[0].payload.file, file);
  assert.equal(replacement.starts[0].payload.uploadId, 'resume');
  assert.equal(replacement.starts[0].payload.isNewUpload, false);
  // A stale error from the old channel must not abort the replacement.
  h.worker.starts[0].port.postMessage({ type: 'ERROR', error: 'old worker' });
  replacement.starts[0].port.postMessage({ type: 'STAGED' });
  assert.equal((await result).handled, true);
});

test('a lost terminal message resumes instead of leaving the page pending forever', async () => {
  const h = harness();
  const result = h.api.streamUpload({ uploadId: 'terminal', file: {}, isNewUpload: true });
  await flush();
  h.worker.active = false;
  await h.tick(15000);
  assert.equal(h.worker.starts.length, 2);
  assert.equal(h.worker.starts[1].payload.isNewUpload, false);
  h.worker.starts[1].port.postMessage({ type: 'STAGED' });
  await result;
});

test('manual pause is respected and cancel prevents recovery even if the worker vanished', async () => {
  const h = harness();
  const result = h.api.streamUpload({ uploadId: 'cancel', file: {}, isNewUpload: true });
  const rejected = assert.rejects(result, { name: 'AbortError' });
  await flush();
  h.worker.silent = true;
  h.api.pauseUploads(['cancel']);
  h.document.emit('visibilitychange');
  await h.tick(15000);
  assert.equal(h.worker.starts.length, 1);
  const cancel = h.api.cancelUploads(['cancel']);
  await flush();
  await rejected;
  await h.tick(3000);
  await cancel;
  h.window.emit('online');
  assert.equal(h.worker.starts.length, 1);
  assert.equal(h.timers.size, 0);
});

test('worker activation cannot block upload fallback indefinitely', async () => {
  const h = harness({ inactive: true });
  const result = h.api.streamUpload({ uploadId: 'fallback', file: {} });
  await flush();
  await h.tick(10000);
  assert.equal((await result).handled, false);
});

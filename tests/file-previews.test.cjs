const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.attributes = {}; this.listeners = {}; this.classList = { add() {} }; this.textContent = ''; }
  replaceChildren(...children) { this.children = children; }
  append(child) { this.children.push(child); }
  prepend(child) { this.children.unshift(child); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(key, handler) { this.listeners[key] = handler; }
  getContext() { return {}; }
}
function setup(overrides = {}) {
  const revoked = [];
  const window = {};
  const context = {
    window, AbortController, TextDecoder, Uint8Array,
    URL: { createObjectURL: () => 'blob:local-file', revokeObjectURL: value => revoked.push(value) },
    document: { createElement: tag => new Element(tag), querySelectorAll: () => [], head: new Element('head'), body: {} },
    IntersectionObserver: class { observe() {} unobserve() {} }, MutationObserver: class { observe() {} },
    ...overrides
  };
  vm.runInNewContext(fs.readFileSync(path.resolve(__dirname, '../public/js/file-previews.js'), 'utf8'), context);
  return { render: window.renderFilePreview, window, revoked, host: new Element('div') };
}
test('shared image cards retain the share token when requesting a thumbnail', async () => {
  const { render, host } = setup();
  await render(host, { name: 'image.png', mimeType: 'image/png', url: '/preview/stream/7?shareToken=secret' }).ready;
  assert.equal(host.children[0].src, '/preview/stream/7?shareToken=secret&thumbnail=400');
  assert.equal(host.children[0].alt, 'image.png');
});
test('local image previews infer missing MIME types and release object URLs', async () => {
  const { render, host, revoked } = setup();
  const preview = render(host, { name: 'image.png', blob: {} }, { interactive: true });
  await preview.ready;
  assert.equal(host.children[0].src, 'blob:local-file');
  preview.dispose();
  assert.deepEqual(revoked, ['blob:local-file']);
  assert.equal(host.children.length, 0);
});
test('text previews are bounded and render HTML as inert text', async () => {
  const { render, host } = setup();
  let range;
  const payload = '<script>alert(1)</script>';
  await render(host, { name: 'sample.html', blob: { slice: (start, end) => {
    range = [start, end]; return { text: async () => payload };
  } } }).ready;
  assert.deepEqual(range, [0, 4096]);
  assert.equal(host.children[0].tagName, 'pre');
  assert.equal(host.children[0].textContent, payload);
});
test('remote text previews cancel the response after the excerpt', async () => {
  let cancelled = false;
  const { render, host } = setup({ fetch: async (_url, options) => {
    assert.equal(options.headers.Range, 'bytes=0-4095');
    return { ok: true, body: { getReader: () => ({ read: async () => ({ value: new Uint8Array(8000).fill(65) }), cancel: async () => { cancelled = true; } }) } };
  } });
  await render(host, { name: 'sample.txt', url: '/preview/stream/1' }).ready;
  assert.equal(host.children[0].textContent.length, 4096);
  assert.equal(cancelled, true);
});
test('PDF previews render page one and release their worker', async () => {
  const { render, host, window } = setup();
  let destroyed = false;
  window.pdfjsLib = { GlobalWorkerOptions: {}, getDocument: () => ({
    promise: Promise.resolve({ getPage: async number => {
      assert.equal(number, 1);
      return { getViewport: () => ({ width: 500, height: 700 }), render: () => ({ promise: Promise.resolve() }) };
    } }), destroy: async () => { destroyed = true; }
  }) };
  await render(host, { name: 'document.pdf', url: '/preview/stream/1', size: 100 }).ready;
  assert.equal(host.children[0].tagName, 'canvas');
  assert.equal(destroyed, true);
});
test('failed previews leave an understandable fallback', async () => {
  const { render, host } = setup({ fetch: async () => { throw new Error('Offline'); } });
  await render(host, { name: 'sample.txt', url: '/preview/stream/1' }).ready;
  assert.match(host.children[0].textContent, /Preview unavailable/);
});

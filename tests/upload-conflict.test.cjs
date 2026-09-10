const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const { test } = require('node:test');

function setup(entries) {
  const created = [];
  const replaced = [];
  const repository = {
    findFilesInFolder: async (ownerId, folderId) => entries.filter(file => file.userId === ownerId && file.folderId === folderId).map(files => ({ files })),
    withUploadLock: async (_ownerId, callback) => callback(repository),
    createFile: async (...args) => { created.push(args); return 20; },
    replaceUpload: async (...args) => { replaced.push(args); return args[0].id; }
  };
  const filename = path.resolve(__dirname, '../services/UploadConflictService.js');
  const loaded = new Module(filename, module);
  loaded.filename = filename;
  loaded.require = name => name === '../repositories/FileRepository' ? repository : require(name);
  loaded._compile(fs.readFileSync(filename, 'utf8'), filename);
  return { service: loaded.exports, created, replaced };
}
const existing = { id: 7, userId: 1, folderId: 2, originalName: 'photo.jpg', path: 'old', size: 10 };
const options = { ownerId: 1, folderId: 2, name: 'photo.jpg', mimeType: 'image/jpeg',
  saved: { filename: 'new.jpg', path: 'new', size: 20, checksum: 'hash' } };

test('conflicts require the full filename in the same owner and destination', async () => {
  const { service } = setup([existing]);
  assert.deepEqual(await service.check(1, 2, 'photo.jpg'), { conflict: true, replaceFileId: 7, file: { id: 7, name: 'photo.jpg', mimeType: undefined, size: 10, createdAt: undefined } });
  for (const args of [[1, 2, 'photo.png'], [1, 3, 'photo.jpg'], [2, 2, 'photo.jpg']]) {
    assert.equal((await service.check(...args)).conflict, false);
  }
});

test('add as new retains the extension and selects an unused copy name', async () => {
  const { service, created, replaced } = setup([existing, { ...existing, id: 8, originalName: 'photo (copy).jpg' }]);
  await service.save(options);
  assert.equal(created[0][3], 'photo (copy 2).jpg');
  assert.equal(created[0][4], 'jpg');
  assert.equal(replaced.length, 0);
});

test('replace keeps the existing ID and sends the old file to versioning', async () => {
  const { service, created, replaced } = setup([existing]);
  assert.equal(await service.save({ ...options, replaceFileId: 7 }), 7);
  assert.equal(replaced[0][0].path, 'old');
  assert.equal(replaced[0][1].path, 'new');
  assert.equal(created.length, 0);
});

test('replacement cannot target another folder, owner, or renamed file', async () => {
  for (const file of [{ ...existing, folderId: 3 }, { ...existing, userId: 2 }, { ...existing, originalName: 'renamed.jpg' }]) {
    const { service, created, replaced } = setup([file]);
    await assert.rejects(service.save({ ...options, replaceFileId: 7 }), /changed or was removed/);
    assert.equal(created.length + replaced.length, 0);
  }
});

test('extensionless files and dotfiles receive copy names without losing their names', async () => {
  for (const name of ['README', '.env']) {
    const { service, created } = setup([{ ...existing, originalName: name }]);
    await service.save({ ...options, name });
    assert.equal(created[0][3], `${name} (copy)`);
  }
});
const vm = require('node:vm');

test('upload dialog returns explicit replace/copy choices and cancels safely', async () => {
  const script = fs.readFileSync(path.resolve(__dirname, '../views/partials/upload-conflict.ejs'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const choice of ['replace', 'copy', 'cancel']) {
    let onClose;
    const dialog = {
      addEventListener: (_event, callback) => { onClose = callback; },
      showModal() { this.returnValue = choice; onClose(); }
    };
    const window = {};
    vm.runInNewContext(script, {
      window, FormData,
      document: { getElementById: id => id === 'upload-conflict-dialog' ? dialog : {}, activeElement: { focus() {} } },
      fetch: async () => ({ ok: true, json: async () => ({ conflict: true, replaceFileId: 7 }) })
    });
    const result = window.resolveUploadConflict('photo.jpg', '/api/upload/conflict', 2, 'csrf');
    if (choice === 'cancel') await assert.rejects(result, /Upload cancelled/);
    else assert.equal(await result, choice === 'replace' ? 7 : null);
  }
});

test('upload navigation lock allows dialog choices but still blocks page submissions', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../public/js/drive.js'), 'utf8');
  const handler = source.match(/document\.addEventListener\('submit', event => \{([\s\S]*?)\n  \}, true\);/)[1];
  for (const scenario of [
    { method: 'dialog', inDialog: true, blocked: false },
    { method: 'DIALOG', inDialog: true, blocked: false },
    { method: 'post', override: 'dialog', inDialog: true, blocked: false },
    { method: 'dialog', override: 'post', inDialog: true, blocked: true },
    { method: 'post', inDialog: false, blocked: true },
    { method: null, inDialog: false, blocked: true }
  ]) {
    let prevented = false;
    let notified = false;
    vm.runInNewContext(`(() => { ${handler} })()`, {
      hasRefreshSensitiveUploads: () => true,
      explainBlockedNavigation: () => { notified = true; },
      event: {
        target: { getAttribute: () => scenario.method, closest: () => scenario.inDialog ? {} : null },
        submitter: { getAttribute: () => scenario.override ?? null },
        preventDefault: () => { prevented = true; },
        stopImmediatePropagation() {}
      }
    });
    assert.equal(prevented, scenario.blocked);
    assert.equal(notified, scenario.blocked);
  }
});

test('comparison previews preserve shared access, use the local upload, and clean up on close', async () => {
  const script = fs.readFileSync(path.resolve(__dirname, '../views/partials/upload-conflict.ejs'), 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1];
  let close;
  const previews = [];
  let disposed = 0;
  const dialog = { addEventListener: (_event, callback) => { close = callback; }, showModal() { this.returnValue = 'copy'; close(); } };
  const window = { renderFilePreview: (_host, file) => { previews.push(file); return { dispose: () => { disposed++; } }; } };
  const localFile = { name: 'photo.jpg', type: 'image/jpeg', size: 200 };
  vm.runInNewContext(script, {
    window, FormData,
    document: { getElementById: id => id === 'upload-conflict-dialog' ? dialog : {}, activeElement: { focus() {} } },
    fetch: async () => ({ ok: true, json: async () => ({ conflict: true, replaceFileId: 7,
      file: { id: 7, name: 'photo.jpg', mimeType: 'image/jpeg', size: 100 } }) })
  });
  assert.equal(await window.resolveUploadConflict('photo.jpg', '/share/link-token/upload', 2, undefined, localFile), null);
  assert.equal(previews[0].url, '/preview/stream/7?shareToken=link-token');
  assert.equal(previews[1].blob, localFile);
  assert.equal(disposed, 2);
});

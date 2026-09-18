const assert = require('node:assert/strict');
const { test } = require('node:test');
const {
  ensureExtension,
  buildContentDisposition
} = require('../utils/contentDisposition');

test('ensureExtension keeps existing extensions and fills missing ones', () => {
  assert.equal(ensureExtension('report.pdf', 'pdf'), 'report.pdf');
  assert.equal(ensureExtension('report', 'pdf'), 'report.pdf');
  assert.equal(ensureExtension('report', '.PDF'), 'report.PDF');
  assert.equal(ensureExtension('', 'docx'), 'download.docx');
  assert.equal(ensureExtension('notes', ''), 'notes');
});

test('buildContentDisposition uses filename and filename* so browsers keep the extension', () => {
  const header = buildContentDisposition('attachment', 'Quarterly Report.pdf', 'pdf');
  assert.match(header, /^attachment; filename="Quarterly Report\.pdf"; filename\*=UTF-8''Quarterly%20Report\.pdf$/);

  const unicode = buildContentDisposition('attachment', '报告.docx', 'docx');
  assert.match(unicode, /^attachment; filename="__\.docx"; filename\*=UTF-8''/);
  assert.match(unicode, /filename\*=UTF-8''%E6%8A%A5%E5%91%8A\.docx$/);

  const missingExt = buildContentDisposition('attachment', 'invoice', 'xlsx');
  assert.match(missingExt, /filename="invoice\.xlsx"/);
  assert.match(missingExt, /filename\*=UTF-8''invoice\.xlsx$/);

  // Percent-encoding must not be the only filename= value (that causes extension loss).
  assert.doesNotMatch(header, /filename="%/);
});

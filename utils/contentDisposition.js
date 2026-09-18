const path = require('path');

/**
 * Build a browser-safe Content-Disposition value.
 * Percent-encoding inside filename="..." alone is ignored by many browsers,
 * which then save using the URL path (e.g. /download/123) and drop the extension.
 */
function ensureExtension(name, extension) {
  const baseName = String(name || 'download').replace(/[\r\n]/g, ' ').trim() || 'download';
  const ext = String(extension || '').replace(/^\./, '').trim();
  if (!ext) return baseName;

  const currentExt = path.extname(baseName).slice(1);
  if (currentExt) return baseName;
  return `${baseName}.${ext}`;
}

function asciiFallback(name) {
  return name
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_')
    || 'download';
}

function encodeRfc5987(name) {
  return encodeURIComponent(name).replace(/['()*]/g, (char) => (
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  ));
}

function buildContentDisposition(disposition, originalName, extension) {
  const safeName = ensureExtension(originalName, extension);
  const asciiName = asciiFallback(safeName);
  return `${disposition}; filename="${asciiName}"; filename*=UTF-8''${encodeRfc5987(safeName)}`;
}

module.exports = {
  ensureExtension,
  buildContentDisposition
};

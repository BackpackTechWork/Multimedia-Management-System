// Only allow an in-app path; browsers normalize backslashes to slashes.
module.exports = function getSafeReturnTo(value) {
  if (typeof value !== 'string' || !value.startsWith('/') ||
      value.startsWith('//') || /[\\\x00-\x1f\x7f]/.test(value)) return null;
  try {
    const base = 'https://mms.invalid';
    const target = new URL(value, base);
    return target.origin === base ? target.pathname + target.search + target.hash : null;
  } catch {
    return null;
  }
};

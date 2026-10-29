const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const storage = require('./StorageService');
let blobatarModule;

async function defaultAvatar(userId) {
  avatarPath(userId); // Apply the same ID validation as stored pictures.
  blobatarModule ||= import('blobatar/blob');
  const { blobatar } = await blobatarModule;
  return blobatar(`harbor-drive-user-${userId}`, {
    size: 256, background: 'circle', backgroundColor: '#f3f4f6'
  });
}

function avatarPath(userId) {
  if (!/^\d+$/.test(String(userId))) throw new Error('Invalid user');
  return path.join(storage.chunksDir, '.profile-pictures', `${userId}.webp`);
}

async function save(userId, buffer) {
  // Decode and re-encode rather than trusting file names or upload MIME types.
  const image = sharp(buffer, { limitInputPixels: 25000000, animated: false });
  const metadata = await image.metadata();
  if (!['jpeg', 'png', 'webp'].includes(metadata.format)) throw new Error('Choose a JPEG, PNG, or WebP image.');
  const output = await image.rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 85 }).toBuffer();
  const destination = avatarPath(userId);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  const temporary = `${destination}.${crypto.randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, output, { flag: 'wx' });
    await fs.rename(temporary, destination);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

module.exports = { avatarPath, save, defaultAvatar };

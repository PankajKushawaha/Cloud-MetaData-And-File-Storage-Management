const fs = require('fs');
const path = require('path');
let cloudinary = null;

const hasCloudinary = Boolean(
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET
);

if (hasCloudinary) {
  cloudinary = require('cloudinary').v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
  });
}

const uploadDir = path.join(__dirname, '../../uploads');
fs.mkdirSync(uploadDir, { recursive: true });

function safeName(name) {
  return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120);
}

async function upload(buffer, originalName, mimeType, userId) {
  if (hasCloudinary) {
    return new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: `cloudnest/${userId}`,
          resource_type: 'auto',
          type: 'authenticated',
          use_filename: false,
          unique_filename: true,
          overwrite: false
        },
        (error, result) => {
          if (error) return reject(error);
          resolve({
            provider: 'cloudinary',
            // Keep the Cloudinary asset private; only issue short-lived signed delivery URLs.
            url: '',
            storageKey: result.public_id,
            resourceType: result.resource_type,
            format: result.format || '',
            deliveryType: result.type || 'authenticated'
          });
        }
      );
      stream.end(buffer);
    });
  }

  const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}-${safeName(originalName)}`;
  const destination = path.join(uploadDir, unique);
  await fs.promises.writeFile(destination, buffer);
  return {
    provider: 'local',
    url: `/uploads/${encodeURIComponent(unique)}`,
    storageKey: unique,
    resourceType: 'raw',
    format: path.extname(originalName).replace('.', '').toLowerCase(),
    deliveryType: 'local'
  };
}

function localPath(file) {
  if (!file || !file.storageKey) return null;
  const target = path.resolve(uploadDir, path.basename(file.storageKey));
  if (!target.startsWith(path.resolve(uploadDir) + path.sep)) return null;
  return target;
}

function getDeliveryUrl(file, expiresInSeconds = 300) {
  if (!file) throw new Error('File metadata is missing');
  if (file.storageProvider === 'local') return file.url;
  if (file.storageProvider === 'external') return file.url;
  if (file.storageProvider !== 'cloudinary' || !file.storageKey || !cloudinary) throw new Error('Cloud storage reference is missing or Cloudinary is not configured');
  const expiresAt = Math.floor(Date.now() / 1000) + Math.max(60, Math.min(3600, Number(expiresInSeconds) || 300));
  const format = file.format || file.extension || undefined;
  return cloudinary.utils.private_download_url(file.storageKey, format, {
    resource_type: file.resourceType || 'raw',
    type: file.deliveryType || 'authenticated',
    expires_at: expiresAt
  });
}

async function remove(file) {
  if (!file || !file.storageKey) return;
  if (file.storageProvider === 'cloudinary') {
    await cloudinary.uploader.destroy(file.storageKey, { resource_type: file.resourceType || 'image', type: file.deliveryType || 'authenticated', invalidate: true });
    return;
  }
  const target = localPath(file);
  if (!target) return;
  try { await fs.promises.unlink(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
}

module.exports = { upload, remove, localPath, getDeliveryUrl, hasCloudinary };

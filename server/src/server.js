require('dotenv').config();

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const { body, validationResult } = require('express-validator');

const User = require('./models/User');
const Folder = require('./models/Folder');
const File = require('./models/File');
const Share = require('./models/Share');
const Version = require('./models/Version');
const auth = require('./middleware/auth');
const requireRole = require('./middleware/requireRole');
const errorHandler = require('./middleware/errorHandler');
const storage = require('./services/storageService');

const app = express();
const PORT = Number(process.env.PORT) || 4000;
const MONGO = process.env.MONGO_URI;
const MAX_FILE_SIZE = Math.max(1, Number(process.env.MAX_FILE_SIZE_MB) || 50) * 1024 * 1024;
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;
const APP_BASE_URL = (process.env.APP_BASE_URL || process.env.RENDER_EXTERNAL_URL || '').replace(/\/$/, '');

if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('JWT_SECRET must be at least 32 characters.');
  process.exit(1);
}
if (!MONGO) {
  console.error('MONGO_URI is required.');
  process.exit(1);
}

app.disable('x-powered-by');
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '1mb' }));
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

const origins = (process.env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
app.use(cors({ origin: origins.length ? origins : (process.env.NODE_ENV === 'production' ? false : true), credentials: true }));

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many authentication attempts. Try again later.' }
});
app.use('/api/auth/login', authLimiter);
app.use('/api/auth/register', authLimiter);
app.use('/api/auth/forgot-password', authLimiter);
app.use('/api/auth/reset-password', authLimiter);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please slow down.' }
});
app.use('/api/', apiLimiter);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE, files: 1 },
  fileFilter: (req, file, cb) => {
    if (!file.originalname || file.originalname.length > 255) return cb(new Error('Invalid file name'));
    cb(null, true);
  }
});

function validation(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) return res.status(400).json({ success: false, errors: result.array() });
  next();
}

function validId(id) { return mongoose.isValidObjectId(id); }
function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function pageParams(req) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.parseInt(req.query.limit, 10) || DEFAULT_LIMIT));
  return { page, limit, skip: (page - 1) * limit };
}
function uniqueStoredBytes(records) {
  const seen = new Set();
  let total = 0;
  for (const item of records || []) {
    const identity = item.storageKey ? `${item.storageProvider || ''}:${item.storageKey}` : (item.url ? `${item.storageProvider || ''}:${item.url}` : `metadata:${item._id}`);
    if (seen.has(identity)) continue;
    seen.add(identity); total += Number(item.size) || 0;
  }
  return total;
}
function publicFile(file) {
  const result = file && typeof file.toObject === 'function' ? file.toObject() : { ...file };
  // Never expose provider object IDs or raw storage URLs to the browser.
  delete result.storageKey;
  if (['cloudinary', 'local'].includes(result.storageProvider)) result.url = '';
  return result;
}
function setFileDeliveryHeaders(res, file) {
  const mime = file.type || 'application/octet-stream';
  const safeInline = /^(application\/pdf|application\/json|text\/plain|image\/(png|jpeg|gif|webp|avif|bmp)|audio\/|video\/)/i.test(mime);
  const filename = String(file.name || 'download').replace(/[\"\\\r\n]/g, '_');
  res.type(mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Disposition', `${safeInline ? 'inline' : 'attachment'}; filename=\"${filename}\"`);
}

app.get('/api/health', (req, res) => res.json({
  success: true,
  status: 'ok',
  database: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  storage: storage.hasCloudinary ? 'cloudinary' : 'local-development',
  service: 'CloudNest API',
  version: '4.0.0',
  timestamp: new Date().toISOString()
}));

app.post('/api/auth/register',
  body('name').trim().isLength({ min: 2, max: 100 }).withMessage('Name must be 2–100 characters'),
  body('email').trim().isEmail().normalizeEmail().withMessage('Enter a valid email'),
  body('password').isLength({ min: 8, max: 100 }).withMessage('Password must be at least 8 characters'),
  validation,
  async (req, res, next) => {
    try {
      const { name, email, password } = req.body;
      if (await User.findOne({ email })) return res.status(409).json({ success: false, error: 'Email is already registered' });
      const passwordHash = await bcrypt.hash(password, 12);
      const user = await User.create({ name, email, passwordHash });
      res.status(201).json({ success: true, data: { id: user._id, name: user.name, email: user.email } });
    } catch (e) { next(e); }
  }
);

// Password recovery uses a one-time random token delivered through the Resend email API.
// Configure RESEND_API_KEY and RESEND_FROM in server/.env for real email delivery.
async function sendResetEmail(to, resetUrl) {
  if (!process.env.RESEND_API_KEY) return false;
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || 'CloudNest <onboarding@resend.dev>',
      to: [to],
      subject: 'Reset your CloudNest password',
      text: `Use this link to reset your CloudNest password. It expires in 15 minutes:\n\n${resetUrl}\n\nIf you did not request this, ignore this email.`,
      html: `<p>Use this link to reset your CloudNest password. This link expires in 15 minutes.</p><p><a href=\"${resetUrl}\">Reset password</a></p><p>If you did not request this, ignore this email.</p>`
    })
  });
  if (!response.ok) throw new Error(`Email provider returned HTTP ${response.status}`);
  return true;
}

app.post('/api/auth/forgot-password',
  body('email').trim().isEmail().normalizeEmail(), validation,
  async (req, res, next) => {
    try {
      const email = req.body.email;
      const user = await User.findOne({ email });
      const message = 'If an account exists for that email, password reset instructions will be sent.';
      if (!user) return res.json({ success: true, message });

      const rawToken = crypto.randomBytes(32).toString('hex');
      user.resetTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
      user.resetTokenExpires = new Date(Date.now() + 15 * 60 * 1000);
      await user.save();
      const base = APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
      const resetUrl = `${base}/?resetToken=${encodeURIComponent(rawToken)}`;
      if (process.env.RESEND_API_KEY) {
        try {
          await sendResetEmail(user.email, resetUrl);
        } catch (mailError) {
          user.resetTokenHash = undefined;
          user.resetTokenExpires = undefined;
          await user.save();
          console.error('Password reset email could not be sent:', mailError.message);
        }
      } else if (process.env.NODE_ENV !== 'production') {
        console.warn(`[CloudNest development password-reset link] ${resetUrl}`);
      } else {
        user.resetTokenHash = undefined;
        user.resetTokenExpires = undefined;
        await user.save();
        console.error('Password reset requested but RESEND_API_KEY is not configured.');
      }
      res.json({ success: true, message });
    } catch (e) { next(e); }
  }
);

app.post('/api/auth/reset-password',
  body('token').isLength({ min: 32, max: 256 }),
  body('password').isLength({ min: 8, max: 100 }).withMessage('Password must be at least 8 characters'),
  validation,
  async (req, res, next) => {
    try {
      const tokenHash = crypto.createHash('sha256').update(String(req.body.token)).digest('hex');
      const user = await User.findOne({ resetTokenHash: tokenHash, resetTokenExpires: { $gt: new Date() } });
      if (!user) return res.status(400).json({ success: false, error: 'This password-reset link is invalid or has expired. Request a new one.' });
      user.passwordHash = await bcrypt.hash(req.body.password, 12);
      user.resetTokenHash = undefined;
      user.resetTokenExpires = undefined;
      await user.save();
      res.json({ success: true, message: 'Password updated. You can now sign in.' });
    } catch (e) { next(e); }
  }
);

app.post('/api/auth/login',
  body('email').trim().isEmail().normalizeEmail(),
  body('password').isLength({ min: 1 }),
  validation,
  async (req, res, next) => {
    try {
      const { email, password } = req.body;
      const user = await User.findOne({ email }).select('+passwordHash');
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) return res.status(401).json({ success: false, error: 'Invalid email or password' });
      const accessToken = jwt.sign(
        { sub: user._id.toString(), roles: user.roles },
        process.env.JWT_SECRET,
        { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
      );
      res.json({ success: true, data: { accessToken, user: { id: user._id, name: user.name, email: user.email, roles: user.roles, storageUsed: user.storageUsed, storageLimit: user.storageLimit } } });
    } catch (e) { next(e); }
  }
);

app.get('/api/me', auth, (req, res) => res.json({ success: true, data: {
  id: req.user._id, name: req.user.name, email: req.user.email, roles: req.user.roles,
  storageUsed: req.user.storageUsed, storageLimit: req.user.storageLimit, avatar: req.user.avatar
} }));

app.get('/api/admin/users', auth, requireRole('admin'), async (req, res, next) => {
  try {
    const { page, limit, skip } = pageParams(req);
    const [users, total] = await Promise.all([
      User.find({}).select('name email roles storageUsed storageLimit createdAt').sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments({})
    ]);
    res.json({ success: true, data: users, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (e) { next(e); }
});

app.get('/api/dashboard/stats', auth, async (req, res, next) => {
  try {
    const [files, folders, starred, trashed, recent] = await Promise.all([
      File.countDocuments({ owner: req.user._id, isDeleted: false }),
      Folder.countDocuments({ owner: req.user._id }),
      File.countDocuments({ owner: req.user._id, isDeleted: false, isStarred: true }),
      File.countDocuments({ owner: req.user._id, isDeleted: true }),
      File.find({ owner: req.user._id, isDeleted: false }).sort({ updatedAt: -1 }).limit(8).populate('folder', 'name')
    ]);
    res.json({ success: true, data: { files, folders, starred, trashed, storageUsed: req.user.storageUsed, storageLimit: req.user.storageLimit, recent: recent.map(publicFile) } });
  } catch (e) { next(e); }
});

// -------------------- FOLDERS --------------------
app.get('/api/folders', auth, async (req, res, next) => {
  try {
    if (req.query.all === 'true') {
      const folders = await Folder.find({ owner: req.user._id }).sort({ name: 1 });
      return res.json({ success: true, data: folders });
    }
    const parentFolder = req.query.parent ? req.query.parent : null;
    if (parentFolder && !validId(parentFolder)) return res.status(400).json({ success: false, error: 'Invalid parent folder' });
    if (parentFolder && !(await Folder.exists({ _id: parentFolder, owner: req.user._id }))) return res.status(404).json({ success: false, error: 'Parent folder not found' });
    const folders = await Folder.find({ owner: req.user._id, parentFolder }).sort({ name: 1 });
    res.json({ success: true, data: folders });
  } catch (e) { next(e); }
});

app.get('/api/folders/:id', auth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid folder ID' });
    const folder = await Folder.findOne({ _id: req.params.id, owner: req.user._id }).populate('parentFolder', 'name parentFolder');
    if (!folder) return res.status(404).json({ success: false, error: 'Folder not found' });
    res.json({ success: true, data: folder });
  } catch (e) { next(e); }
});

app.get('/api/folders/:id/breadcrumbs', auth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid folder ID' });
    const items = [];
    let current = await Folder.findOne({ _id: req.params.id, owner: req.user._id }).select('name parentFolder');
    while (current) {
      items.unshift({ id: current._id, name: current.name });
      if (!current.parentFolder) break;
      current = await Folder.findOne({ _id: current.parentFolder, owner: req.user._id }).select('name parentFolder');
    }
    res.json({ success: true, data: items });
  } catch (e) { next(e); }
});

app.post('/api/folders', auth,
  body('name').trim().isLength({ min: 1, max: 100 }).withMessage('Folder name is required'),
  body('parentFolder').optional({ values: 'falsy' }).isMongoId(), validation,
  async (req, res, next) => {
    try {
      const parentFolder = req.body.parentFolder || null;
      if (parentFolder && !(await Folder.exists({ _id: parentFolder, owner: req.user._id }))) return res.status(400).json({ success: false, error: 'Invalid parent folder' });
      if (await Folder.exists({ owner: req.user._id, name: req.body.name, parentFolder })) return res.status(409).json({ success: false, error: 'A folder with this name already exists here' });
      const folder = await Folder.create({ name: req.body.name, owner: req.user._id, parentFolder });
      res.status(201).json({ success: true, data: folder });
    } catch (e) { next(e); }
  }
);

app.patch('/api/folders/:id', auth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid folder ID' });
    const folder = await Folder.findOne({ _id: req.params.id, owner: req.user._id });
    if (!folder) return res.status(404).json({ success: false, error: 'Folder not found' });

    const hasName = Object.prototype.hasOwnProperty.call(req.body, 'name');
    const hasParent = Object.prototype.hasOwnProperty.call(req.body, 'parentFolder');
    const name = hasName ? String(req.body.name || '').trim() : folder.name;
    if (hasName && (!name || name.length > 100)) return res.status(400).json({ success: false, error: 'Folder name must be between 1 and 100 characters' });
    if (!hasName && !hasParent) return res.status(400).json({ success: false, error: 'Provide a folder name or destination parent' });

    let parentFolder = folder.parentFolder || null;
    if (hasParent) {
      parentFolder = req.body.parentFolder || null;
      if (parentFolder && !validId(parentFolder)) return res.status(400).json({ success: false, error: 'Invalid destination folder' });
      if (parentFolder && !(await Folder.exists({ _id: parentFolder, owner: req.user._id }))) return res.status(400).json({ success: false, error: 'Invalid destination folder' });

      // Walk up from the destination. A folder cannot be placed inside itself or a descendant.
      const seen = new Set();
      let ancestorId = parentFolder ? String(parentFolder) : null;
      while (ancestorId) {
        if (ancestorId === String(folder._id)) return res.status(400).json({ success: false, error: 'A folder cannot be moved into itself or one of its subfolders' });
        if (seen.has(ancestorId)) return res.status(400).json({ success: false, error: 'Invalid folder hierarchy detected' });
        seen.add(ancestorId);
        const ancestor = await Folder.findOne({ _id: ancestorId, owner: req.user._id }).select('parentFolder');
        ancestorId = ancestor?.parentFolder ? String(ancestor.parentFolder) : null;
      }
    }

    if (await Folder.exists({ _id: { $ne: folder._id }, owner: req.user._id, name, parentFolder })) return res.status(409).json({ success: false, error: 'A folder with this name already exists in the destination' });
    folder.name = name;
    folder.parentFolder = parentFolder;
    await folder.save();
    res.json({ success: true, data: folder });
  } catch (e) { next(e); }
});

app.delete('/api/folders/:id', auth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid folder ID' });
    const root = await Folder.findOne({ _id: req.params.id, owner: req.user._id });
    if (!root) return res.status(404).json({ success: false, error: 'Folder not found' });

    const folderIds = [root._id];
    for (let i = 0; i < folderIds.length; i++) {
      const children = await Folder.find({ owner: req.user._id, parentFolder: folderIds[i] }).select('_id');
      folderIds.push(...children.map(x => x._id));
    }

    const files = await File.find({ owner: req.user._id, folder: { $in: folderIds } });
    const versions = await Version.find({ owner: req.user._id, file: { $in: files.map(f => f._id) } });
    const bytesRemoved = uniqueStoredBytes([...files, ...versions]);
    await Promise.all([...files.map(file => storage.remove(file)), ...versions.map(version => storage.remove(version))]);
    await Version.deleteMany({ owner: req.user._id, file: { $in: files.map(f => f._id) } });
    await Share.deleteMany({ owner: req.user._id, file: { $in: files.map(f => f._id) } });
    await File.deleteMany({ owner: req.user._id, folder: { $in: folderIds } });
    await Folder.deleteMany({ owner: req.user._id, _id: { $in: folderIds } });
    if (bytesRemoved) await User.updateOne({ _id: req.user._id }, { $inc: { storageUsed: -bytesRemoved } });
    res.json({ success: true, message: 'Folder and its contents were deleted' });
  } catch (e) { next(e); }
});

// -------------------- FILES --------------------
app.get('/api/files', auth, async (req, res, next) => {
  try {
    const { page, limit, skip } = pageParams(req);
    const isTrash = req.query.trash === 'true';
    const query = { owner: req.user._id, isDeleted: isTrash };
    if (req.query.search) query.name = { $regex: escapeRegex(String(req.query.search).slice(0, 100)), $options: 'i' };
    if (req.query.starred === 'true') query.isStarred = true;
    if (req.query.folder === 'root') query.folder = null;
    else if (req.query.folder) {
      if (!validId(req.query.folder)) return res.status(400).json({ success: false, error: 'Invalid folder ID' });
      query.folder = req.query.folder;
    }
    const [files, total] = await Promise.all([
      File.find(query).sort({ updatedAt: -1 }).skip(skip).limit(limit).populate('folder', 'name'),
      File.countDocuments(query)
    ]);
    res.json({ success: true, data: files.map(publicFile), pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (e) { next(e); }
});

app.post('/api/files', auth, (req, res) => res.status(400).json({ success: false, error: 'Upload the actual file using POST /api/files/upload. Metadata is created automatically after cloud storage succeeds.' }));

app.post('/api/files/upload', auth, (req, res, next) => {
  upload.single('file')(req, res, async err => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ success: false, error: `File exceeds ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB limit` });
      return next(err);
    }
    let uploaded;
    let createdFile;
    let usageUpdated = false;
    try {
      if (!req.file) return res.status(400).json({ success: false, error: 'Select a file to upload' });
      const folder = req.body.folder || null;
      if (folder && (!validId(folder) || !(await Folder.exists({ _id: folder, owner: req.user._id })))) return res.status(400).json({ success: false, error: 'Invalid folder' });
      if (req.user.storageUsed + req.file.size > req.user.storageLimit) return res.status(413).json({ success: false, error: 'Storage limit exceeded' });

      uploaded = await storage.upload(req.file.buffer, req.file.originalname, req.file.mimetype, req.user._id.toString());
      const extension = path.extname(req.file.originalname).replace('.', '').toLowerCase();
      createdFile = await File.create({
        name: req.file.originalname, originalName: req.file.originalname, extension,
        type: req.file.mimetype || 'application/octet-stream', size: req.file.size,
        url: uploaded.url, storageKey: uploaded.storageKey, storageProvider: uploaded.provider,
        resourceType: uploaded.resourceType, format: uploaded.format || '', deliveryType: uploaded.deliveryType || 'authenticated', folder, owner: req.user._id
      });
      await User.updateOne({ _id: req.user._id }, { $inc: { storageUsed: req.file.size } });
      usageUpdated = true;
      res.status(201).json({ success: true, data: publicFile(await createdFile.populate('folder', 'name')), storageMode: uploaded.provider });
    } catch (e) {
      if (createdFile) {
        try { await File.deleteOne({ _id: createdFile._id }); } catch (cleanupError) { console.error('File metadata cleanup failed:', cleanupError.message); }
      }
      if (usageUpdated && req.file) {
        try { await User.updateOne({ _id: req.user._id }, { $inc: { storageUsed: -req.file.size } }); } catch (cleanupError) { console.error('Storage quota rollback failed:', cleanupError.message); }
      }
      if (uploaded) {
        try { await storage.remove({ storageKey: uploaded.storageKey, storageProvider: uploaded.provider, resourceType: uploaded.resourceType }); }
        catch (cleanupError) { console.error('Upload cleanup failed:', cleanupError.message); }
      }
      next(e);
    }
  });
});

app.patch('/api/files/:id/star', auth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid file ID' });
    if (typeof req.body.starred !== 'boolean') return res.status(400).json({ success: false, error: 'starred must be true or false' });
    const file = await File.findOneAndUpdate({ _id: req.params.id, owner: req.user._id, isDeleted: false }, { $set: { isStarred: req.body.starred } }, { new: true });
    if (!file) return res.status(404).json({ success: false, error: 'File not found' });
    res.json({ success: true, data: publicFile(file) });
  } catch (e) { next(e); }
});

app.patch('/api/files/:id/trash', auth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid file ID' });
    const file = await File.findOne({ _id: req.params.id, owner: req.user._id });
    if (!file) return res.status(404).json({ success: false, error: 'File not found' });
    if (!file.isDeleted) {
      file.isDeleted = true;
      file.deletedAt = new Date();
      await file.save();
    }
    await Share.deleteMany({ file: file._id, owner: req.user._id });
    res.json({ success: true, message: 'File moved to trash' });
  } catch (e) { next(e); }
});

app.patch('/api/files/:id/restore', auth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid file ID' });
    const file = await File.findOne({ _id: req.params.id, owner: req.user._id, isDeleted: true });
    if (!file) return res.status(404).json({ success: false, error: 'File not found in trash' });
    file.isDeleted = false; file.deletedAt = null; await file.save();
    res.json({ success: true, data: publicFile(file) });
  } catch (e) { next(e); }
});

app.patch('/api/files/:id/rename', auth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid file ID' });
    const name = String(req.body.name || '').trim();
    if (!name || name.length > 255) return res.status(400).json({ success: false, error: 'File name is required' });
    const file = await File.findOne({ _id: req.params.id, owner: req.user._id, isDeleted: false });
    if (!file) return res.status(404).json({ success: false, error: 'File not found' });
    file.name = name;
    file.extension = path.extname(name).replace('.', '').toLowerCase();
    await file.save();
    res.json({ success: true, data: publicFile(file) });
  } catch (e) { next(e); }
});

app.patch('/api/files/:id/move', auth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid file ID' });
    const folder = req.body.folder || null;
    if (folder && (!validId(folder) || !(await Folder.exists({ _id: folder, owner: req.user._id })))) return res.status(400).json({ success: false, error: 'Invalid destination folder' });
    const file = await File.findOne({ _id: req.params.id, owner: req.user._id, isDeleted: false });
    if (!file) return res.status(404).json({ success: false, error: 'File not found' });
    file.folder = folder;
    await file.save();
    res.json({ success: true, data: publicFile(await file.populate('folder', 'name')) });
  } catch (e) { next(e); }
});

// -------------------- FILE VERSION HISTORY --------------------
app.get('/api/files/:id/versions', auth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid file ID' });
    const file = await File.findOne({ _id: req.params.id, owner: req.user._id, isDeleted: false });
    if (!file) return res.status(404).json({ success: false, error: 'File not found' });
    const versions = await Version.find({ file: file._id, owner: req.user._id }).sort({ createdAt: -1 }).select('-storageKey -url');
    res.json({ success: true, data: versions });
  } catch (e) { next(e); }
});

// Uploading a new version stores a separate cloud object, preserving previous bytes.
app.post('/api/files/:id/versions', auth, (req, res, next) => {
  upload.single('file')(req, res, async err => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ success: false, error: `File exceeds ${Math.round(MAX_FILE_SIZE / 1024 / 1024)} MB limit` });
      return next(err);
    }
    let uploaded;
    let fileUpdated = false;
    try {
      if (!validId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid file ID' });
      if (!req.file) return res.status(400).json({ success: false, error: 'Select a file for the new version' });
      const file = await File.findOne({ _id: req.params.id, owner: req.user._id, isDeleted: false });
      if (!file) return res.status(404).json({ success: false, error: 'File not found' });
      if (req.user.storageUsed + req.file.size > req.user.storageLimit) return res.status(413).json({ success: false, error: 'Storage limit exceeded' });
      const previousSize = Number(file.size) || 0;
      uploaded = await storage.upload(req.file.buffer, req.file.originalname, req.file.mimetype, req.user._id.toString());
      if (file.storageKey || file.url) await Version.create({
        file: file._id, owner: req.user._id, name: file.name, originalName: file.originalName,
        type: file.type, extension: file.extension, size: previousSize, url: file.url,
        storageKey: file.storageKey, storageProvider: file.storageProvider,
        resourceType: file.resourceType, format: file.format, deliveryType: file.deliveryType
      });
      file.name = req.file.originalname;
      file.originalName = req.file.originalname;
      file.extension = path.extname(req.file.originalname).replace('.', '').toLowerCase();
      file.type = req.file.mimetype || 'application/octet-stream';
      file.size = req.file.size; file.url = uploaded.url; file.storageKey = uploaded.storageKey;
      file.storageProvider = uploaded.provider; file.resourceType = uploaded.resourceType;
      file.format = uploaded.format || ''; file.deliveryType = uploaded.deliveryType || 'authenticated';
      await file.save();
      fileUpdated = true;
      await User.updateOne({ _id: req.user._id }, { $inc: { storageUsed: req.file.size } });
      res.status(201).json({ success: true, data: publicFile(file), message: 'New file version saved' });
    } catch (e) {
      if (uploaded && !fileUpdated) { try { await storage.remove({ storageKey: uploaded.storageKey, storageProvider: uploaded.provider, resourceType: uploaded.resourceType, deliveryType: uploaded.deliveryType }); } catch (cleanupError) { console.error('Version upload cleanup failed:', cleanupError.message); } }
      next(e);
    }
  });
});

app.post('/api/files/:id/versions/:versionId/restore', auth, async (req, res, next) => {
  try {
    if (!validId(req.params.id) || !validId(req.params.versionId)) return res.status(400).json({ success: false, error: 'Invalid file or version ID' });
    const file = await File.findOne({ _id: req.params.id, owner: req.user._id, isDeleted: false });
    const version = await Version.findOne({ _id: req.params.versionId, file: req.params.id, owner: req.user._id });
    if (!file || !version) return res.status(404).json({ success: false, error: 'File or version not found' });
    const currentSize = Number(file.size) || 0;
    if (file.storageKey || file.url) await Version.create({ file: file._id, owner: req.user._id, name: file.name, originalName: file.originalName, type: file.type, extension: file.extension, size: currentSize, url: file.url, storageKey: file.storageKey, storageProvider: file.storageProvider, resourceType: file.resourceType, format: file.format, deliveryType: file.deliveryType });
    for (const key of ['name','originalName','type','extension','size','url','storageKey','storageProvider','resourceType','format','deliveryType']) file[key] = version[key];
    await file.save();
    res.json({ success: true, data: publicFile(file), message: 'Version restored' });
  } catch (e) { next(e); }
});

app.get('/api/files/:id/download', auth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid file ID' });
    const file = await File.findOne({ _id: req.params.id, owner: req.user._id, isDeleted: false });
    if (!file || !(file.storageKey || file.url)) return res.status(404).json({ success: false, error: 'Stored file not found' });
    if (file.storageProvider === 'local') {
      const localPath = storage.localPath(file);
      if (!localPath || !require('fs').existsSync(localPath)) return res.status(404).json({ success: false, error: 'Stored file bytes could not be found' });
      setFileDeliveryHeaders(res, file);
      return res.sendFile(localPath);
    }
    const deliveryUrl = storage.getDeliveryUrl(file, 300);
    res.setHeader('X-CloudNest-External', 'true');
    res.json({ success: true, data: { url: deliveryUrl, expiresInSeconds: 300, external: true } });
  } catch (e) { next(e); }
});

app.delete('/api/files/:id', auth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid file ID' });
    const file = await File.findOne({ _id: req.params.id, owner: req.user._id });
    if (!file) return res.status(404).json({ success: false, error: 'File not found' });
    const versions = await Version.find({ file: file._id, owner: req.user._id });
    await Promise.all([...versions.map(v => storage.remove(v)), storage.remove(file)]);
    await Version.deleteMany({ file: file._id, owner: req.user._id });
    await Share.deleteMany({ file: file._id, owner: req.user._id });
    await File.deleteOne({ _id: file._id });
    if (bytesRemoved) await User.updateOne({ _id: req.user._id }, { $inc: { storageUsed: -bytesRemoved } });
    res.json({ success: true, message: 'File permanently deleted' });
  } catch (e) { next(e); }
});

// -------------------- SHARING --------------------
app.post('/api/files/:id/share', auth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid file ID' });
    const file = await File.findOne({ _id: req.params.id, owner: req.user._id, isDeleted: false });
    if (!file || !(file.storageKey || file.url)) return res.status(404).json({ success: false, error: 'File cannot be shared' });
    const days = Math.min(30, Math.max(1, Number(req.body.expiresInDays) || 7));
    await Share.deleteMany({ file: file._id, owner: req.user._id });
    const share = await Share.create({ file: file._id, owner: req.user._id, token: crypto.randomBytes(24).toString('hex'), expiresAt: new Date(Date.now() + days * 86400000) });
    const base = APP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    res.status(201).json({ success: true, data: { token: share.token, url: `${base}/share/${share.token}`, expiresAt: share.expiresAt } });
  } catch (e) { next(e); }
});

app.delete('/api/files/:id/share', auth, async (req, res, next) => {
  try {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, error: 'Invalid file ID' });
    await Share.deleteMany({ file: req.params.id, owner: req.user._id });
    res.json({ success: true, message: 'Share link revoked' });
  } catch (e) { next(e); }
});

app.get('/share/:token', async (req, res, next) => {
  try {
    const share = await Share.findOne({ token: req.params.token }).populate('file');
    if (!share || !share.file || share.file.isDeleted) return res.status(404).send('This share link is no longer available.');
    if (share.expiresAt && share.expiresAt < new Date()) {
      await Share.deleteOne({ _id: share._id });
      return res.status(410).send('This share link has expired.');
    }
    if (share.file.storageProvider === 'local') {
      const localPath = storage.localPath(share.file);
      if (!localPath || !require('fs').existsSync(localPath)) return res.status(404).send('The stored file is missing.');
      setFileDeliveryHeaders(res, share.file);
      return res.sendFile(localPath);
    }
    return res.redirect(storage.getDeliveryUrl(share.file, 300));
  } catch (e) { next(e); }
});

app.use(express.static(path.join(__dirname, '../../client/public')));
app.get('*', (req, res, next) => req.path.startsWith('/api/') || req.path.startsWith('/share/') ? next() : res.sendFile(path.join(__dirname, '../../client/public/index.html')));
app.use(errorHandler);

async function start() {
  try {
    if (process.env.NODE_ENV === 'production' && !storage.hasCloudinary) {
      throw new Error('Cloudinary credentials are required in production; local disk storage is not durable.');
    }
    if (process.env.NODE_ENV === 'production' && (!APP_BASE_URL || !/^https:\/\//i.test(APP_BASE_URL))) {
      throw new Error('APP_BASE_URL must be the public HTTPS base URL in production.');
    }
    if (process.env.NODE_ENV === 'production' && (!process.env.RESEND_API_KEY || !process.env.RESEND_FROM)) {
      throw new Error('RESEND_API_KEY and RESEND_FROM are required in production for account recovery.');
    }
    await mongoose.connect(MONGO);
    console.log('Connected to MongoDB');
    // Reconcile quota using unique stored objects across current files and version history.
    const [currentFiles, versions] = await Promise.all([File.find({}).select('_id owner size storageKey storageProvider url').lean(), Version.find({}).select('_id owner size storageKey storageProvider url').lean()]);
    const usageByOwner = new Map();
    const byOwner = new Map();
    for (const item of [...currentFiles, ...versions]) {
      const owner = String(item.owner);
      if (!byOwner.has(owner)) byOwner.set(owner, []);
      byOwner.get(owner).push(item);
    }
    for (const [owner, items] of byOwner) usageByOwner.set(owner, uniqueStoredBytes(items));
    await Promise.all([...usageByOwner].map(([owner, bytes]) => User.updateOne({ _id: owner }, { $set: { storageUsed: bytes } })));
    await User.updateMany({ _id: { $nin: [...usageByOwner.keys()] } }, { $set: { storageUsed: 0 } });
    console.log(`Storage mode: ${storage.hasCloudinary ? 'Cloudinary' : 'local development storage'}`);
    if (process.env.NODE_ENV === 'production' && !storage.hasCloudinary) console.warn('WARNING: local uploads are not durable on many hosts. Configure persistent object storage before production use.');
    app.listen(PORT, () => console.log(`CloudNest V4 running on http://localhost:${PORT}`));
  } catch (err) {
    console.error('CloudNest startup failed:', err.message);
    process.exit(1);
  }
}

start();

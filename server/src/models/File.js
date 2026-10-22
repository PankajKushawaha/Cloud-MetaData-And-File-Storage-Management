const mongoose = require('mongoose');

const fileSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 255 },
  originalName: { type: String, default: '', trim: true, maxlength: 255 },
  type: { type: String, default: 'unknown', maxlength: 150 },
  extension: { type: String, default: '', maxlength: 20 },
  size: { type: Number, default: 0, min: 0 },
  url: { type: String, default: '', trim: true, maxlength: 2048 },
  storageKey: { type: String, default: '', maxlength: 500 },
  storageProvider: { type: String, enum: ['local', 'cloudinary', 'external', ''], default: '' },
  resourceType: { type: String, default: 'raw', maxlength: 50 },
  format: { type: String, default: '', maxlength: 30 },
  deliveryType: { type: String, default: 'authenticated', maxlength: 30 },
  checksum: { type: String, default: '', maxlength: 128 },
  folder: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  isStarred: { type: Boolean, default: false },
  isDeleted: { type: Boolean, default: false, index: true },
  deletedAt: { type: Date, default: null }
}, { timestamps: true });

fileSchema.index({ owner: 1, createdAt: -1 });
fileSchema.index({ owner: 1, isDeleted: 1, updatedAt: -1 });
fileSchema.index({ owner: 1, name: 'text' });

module.exports = mongoose.model('File', fileSchema);

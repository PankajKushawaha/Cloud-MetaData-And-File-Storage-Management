const mongoose = require('mongoose');

const versionSchema = new mongoose.Schema({
  file: { type: mongoose.Schema.Types.ObjectId, ref: 'File', required: true, index: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name: { type: String, required: true, maxlength: 255 },
  originalName: { type: String, default: '', maxlength: 255 },
  type: { type: String, default: 'application/octet-stream', maxlength: 150 },
  extension: { type: String, default: '', maxlength: 20 },
  size: { type: Number, default: 0, min: 0 },
  url: { type: String, default: '', maxlength: 2048 },
  storageKey: { type: String, default: '', maxlength: 500 },
  storageProvider: { type: String, enum: ['local', 'cloudinary', 'external', ''], default: '' },
  resourceType: { type: String, default: 'raw', maxlength: 50 },
  format: { type: String, default: '', maxlength: 30 },
  deliveryType: { type: String, default: 'authenticated', maxlength: 30 }
}, { timestamps: true });

versionSchema.index({ owner: 1, file: 1, createdAt: -1 });
module.exports = mongoose.model('Version', versionSchema);

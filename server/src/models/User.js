const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, minlength: 2, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  roles: { type: [String], default: ['user'] },
  storageUsed: { type: Number, default: 0, min: 0 },
  storageLimit: { type: Number, default: 10737418240, min: 0 },
  avatar: { type: String, default: '' },
  resetTokenHash: { type: String, select: false },
  resetTokenExpires: { type: Date, select: false }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);

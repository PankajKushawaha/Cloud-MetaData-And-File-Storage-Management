const mongoose = require('mongoose');

const folderSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  parentFolder: { type: mongoose.Schema.Types.ObjectId, ref: 'Folder', default: null }
}, { timestamps: true });

folderSchema.index({ owner: 1, name: 1, parentFolder: 1 }, { unique: true });
module.exports = mongoose.model('Folder', folderSchema);

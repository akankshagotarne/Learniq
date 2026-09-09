const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  lecture: { type: mongoose.Schema.Types.ObjectId, ref: 'Lecture', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  standard: { type: Number, required: true },
  subject: { type: String, required: true },
  filePath: { type: String, default: null },
  fileUrl: { type: String, default: null },
  isFree: { type: Boolean, default: false },
  price: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  downloadCount: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Note', noteSchema);

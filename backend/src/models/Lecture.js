const mongoose = require('mongoose');

const lectureSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  standard: { type: Number, required: true },
  subject: { type: String, required: true },
  order: { type: Number, default: 1 },
  videoUrl: { type: String, default: null },
  videoPath: { type: String, default: null },
  videoDuration: { type: String, default: '0:00' },
  thumbnail: { type: String, default: null },
  isFree: { type: Boolean, default: false },
  price: { type: Number, default: 0 },
  hasNotes: { type: Boolean, default: false },
  isActive: { type: Boolean, default: true },
  views: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Lecture', lectureSchema);

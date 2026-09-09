const mongoose = require('mongoose');

const courseSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  subject: { type: String, required: true },
  standard: { type: Number, required: true, min: 1, max: 10 },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  thumbnail: { type: String, default: null },
  totalLectures: { type: Number, default: 0 },
  duration: { type: String, default: '0 hrs' },
  rating: { type: Number, default: 4.5, min: 0, max: 5 },
  totalRatings: { type: Number, default: 0 },
  enrolledCount: { type: Number, default: 0 },
  isFree: { type: Boolean, default: false },
  price: { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  tags: [{ type: String }],
  language: { type: String, default: 'English' },
  level: { type: String, enum: ['Beginner', 'Intermediate', 'Advanced'], default: 'Beginner' },
}, { timestamps: true });

module.exports = mongoose.model('Course', courseSchema);

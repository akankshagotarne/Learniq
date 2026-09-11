const mongoose = require('mongoose');

// A single message in a course doubt-clearing chat between one student
// and the course's teacher. Either side can attach a screenshot/photo.
const doubtMessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  senderName: { type: String, required: true },
  senderRole: { type: String, enum: ['student', 'teacher'], required: true },
  message: { type: String, default: '', trim: true },
  attachmentUrl: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});

// One continuous doubt-clearing thread per (course, student) pair -- the
// student can keep asking questions about that course to its teacher
// over time in the same conversation, gated behind enrollment.
const courseDoubtSchema = new mongoose.Schema({
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  studentName: { type: String, required: true },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  teacherName: { type: String, required: true },
  messages: [doubtMessageSchema],
  lastMessageAt: { type: Date, default: Date.now },
  lastSenderRole: { type: String, enum: ['student', 'teacher'], default: 'student' },
}, { timestamps: true });

courseDoubtSchema.index({ course: 1, student: 1 }, { unique: true });
courseDoubtSchema.index({ teacher: 1, lastMessageAt: -1 });

module.exports = mongoose.model('CourseDoubt', courseDoubtSchema);

const mongoose = require('mongoose');

const assignmentSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String, required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  standard: { type: Number, required: true },
  subject: { type: String, required: true },
  dueDate: { type: Date, required: true },
  totalMarks: { type: Number, default: 100 },
  filePath: { type: String, default: null },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const submissionSchema = new mongoose.Schema({
  assignment: { type: mongoose.Schema.Types.ObjectId, ref: 'Assignment', required: true },
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  filePath: { type: String, default: null },
  fileUrl: { type: String, default: null },
  note: { type: String },
  marksObtained: { type: Number, default: null },
  feedback: { type: String },
  isGraded: { type: Boolean, default: false },
  submittedAt: { type: Date, default: Date.now },
}, { timestamps: true });

const Assignment = mongoose.model('Assignment', assignmentSchema);
const AssignmentSubmission = mongoose.model('AssignmentSubmission', submissionSchema);

module.exports = { Assignment, AssignmentSubmission };

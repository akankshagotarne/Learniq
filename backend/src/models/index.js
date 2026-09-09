const mongoose = require('mongoose');

const enrollmentSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  enrolledAt: { type: Date, default: Date.now },
  completedLectures: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Lecture' }],
  completionPercentage: { type: Number, default: 0 },
  isCompleted: { type: Boolean, default: false },
  lastAccessedAt: { type: Date },
}, { timestamps: true });

const paymentSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  lecture: { type: mongoose.Schema.Types.ObjectId, ref: 'Lecture' },
  note: { type: mongoose.Schema.Types.ObjectId, ref: 'Note' },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },
  razorpayOrderId: { type: String },
  razorpayPaymentId: { type: String },
  razorpaySignature: { type: String },
  status: { type: String, enum: ['pending', 'completed', 'failed', 'refunded'], default: 'pending' },
  type: { type: String, enum: ['course', 'lecture', 'note'], required: true },
}, { timestamps: true });

const notificationSchema = new mongoose.Schema({
  recipient: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  title: { type: String, required: true },
  message: { type: String, required: true },
  type: { type: String, enum: ['info', 'success', 'warning', 'quiz', 'live', 'assignment', 'payment', 'announcement'], default: 'info' },
  isRead: { type: Boolean, default: false },
  link: { type: String },
  relatedId: { type: mongoose.Schema.Types.ObjectId },
}, { timestamps: true });

const progressSchema = new mongoose.Schema({
  student: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  standard: { type: Number, required: true },
  subject: { type: String },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  lecturesCompleted: { type: Number, default: 0 },
  totalLectures: { type: Number, default: 0 },
  quizzesTaken: { type: Number, default: 0 },
  avgQuizScore: { type: Number, default: 0 },
  liveClassesAttended: { type: Number, default: 0 },
  assignmentsSubmitted: { type: Number, default: 0 },
  completionPercentage: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now },
}, { timestamps: true });

const badgeSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String },
  icon: { type: String },
  emoji: { type: String },
  condition: { type: String },
  points: { type: Number, default: 10 },
}, { timestamps: true });

const companySchema = new mongoose.Schema({
  name: { type: String, default: 'Learniq' },
  tagline: { type: String },
  mission: { type: String },
  vision: { type: String },
  about: { type: String },
  email: { type: String },
  phone: { type: String },
  address: { type: String },
  website: { type: String },
  founded: { type: String },
  logo: { type: String },
  socialLinks: {
    linkedin: { type: String },
    twitter: { type: String },
    instagram: { type: String },
    youtube: { type: String },
  },
  founders: [{
    name: { type: String },
    role: { type: String },
    description: { type: String },
    photo: { type: String },
  }],
  team: [{
    name: { type: String },
    role: { type: String },
    department: { type: String },
    description: { type: String },
    photo: { type: String },
  }],
}, { timestamps: true });

const Enrollment = mongoose.model('Enrollment', enrollmentSchema);
const Payment = mongoose.model('Payment', paymentSchema);
const Notification = mongoose.model('Notification', notificationSchema);
const Progress = mongoose.model('Progress', progressSchema);
const Badge = mongoose.model('Badge', badgeSchema);
const Company = mongoose.model('Company', companySchema);

module.exports = { Enrollment, Payment, Notification, Progress, Badge, Company };

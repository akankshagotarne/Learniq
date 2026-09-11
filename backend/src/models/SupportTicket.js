const mongoose = require('mongoose');

// A single message inside a support ticket's conversation thread.
// Either the ticket owner (student/teacher) or an admin can post one,
// each optionally carrying a screenshot/photo attachment.
const supportMessageSchema = new mongoose.Schema({
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  senderName: { type: String, required: true },
  senderRole: { type: String, enum: ['student', 'teacher', 'admin'], required: true },
  message: { type: String, default: '', trim: true },
  attachmentUrl: { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
});

const supportTicketSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true }, // ticket owner
  userName: { type: String, required: true },
  userRole: { type: String, enum: ['student', 'teacher'], required: true },
  subject: { type: String, required: true, trim: true },
  category: {
    type: String,
    enum: ['bug', 'glitch', 'live-class', 'payment', 'course-content', 'account', 'other'],
    default: 'other',
  },
  status: { type: String, enum: ['open', 'in-progress', 'resolved'], default: 'open' },
  messages: [supportMessageSchema],
  lastMessageAt: { type: Date, default: Date.now },
  // Set once an admin has replied at least once, so the inbox can flag
  // tickets that are still waiting on a first response.
  firstRespondedAt: { type: Date, default: null },
}, { timestamps: true });

supportTicketSchema.index({ user: 1, lastMessageAt: -1 });
supportTicketSchema.index({ status: 1, lastMessageAt: -1 });

module.exports = mongoose.model('SupportTicket', supportTicketSchema);

const mongoose = require('mongoose');

const liveSessionSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  description: { type: String },
  teacher: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course' },
  standard: { type: Number, required: true },
  subject: { type: String, required: true },
  sessionCode: { type: String, unique: true, required: true },
  joinUrl: { type: String },
  scheduledAt: { type: Date },
  startedAt: { type: Date },
  endedAt: { type: Date },
  status: { type: String, enum: ['scheduled', 'live', 'ended', 'cancelled'], default: 'scheduled' },
  isRecorded: { type: Boolean, default: false },
  recordingUrl: { type: String },
  maxParticipants: { type: Number, default: 50 },
  currentParticipants: { type: Number, default: 0 },
  isChatEnabled: { type: Boolean, default: true },
  activeQuiz: { type: mongoose.Schema.Types.ObjectId, ref: 'Quiz', default: null },
}, { timestamps: true });

const liveParticipantSchema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'LiveSession', required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  joinedAt: { type: Date, default: Date.now },
  leftAt: { type: Date },
  duration: { type: Number, default: 0 }, // minutes
  isCameraOn: { type: Boolean, default: false },
  isMicOn: { type: Boolean, default: false },
}, { timestamps: true });

const liveChatMessageSchema = new mongoose.Schema({
  session: { type: mongoose.Schema.Types.ObjectId, ref: 'LiveSession', required: true },
  sender: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  senderName: { type: String, required: true },
  senderRole: { type: String, required: true },
  message: { type: String, required: true },
  isDeleted: { type: Boolean, default: false },
}, { timestamps: true });

const LiveSession = mongoose.model('LiveSession', liveSessionSchema);
const LiveParticipant = mongoose.model('LiveParticipant', liveParticipantSchema);
const LiveChatMessage = mongoose.model('LiveChatMessage', liveChatMessageSchema);

module.exports = { LiveSession, LiveParticipant, LiveChatMessage };

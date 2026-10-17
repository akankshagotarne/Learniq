const mongoose = require('mongoose');

/**
 * Profile photos. The API server's disk is ephemeral on the current hosting plan (files vanish on every deploy / restart), so a photo
 * is stored here instead - in its OWN collection, never inside the User document. The browser shrinks the photo to a small
 * square first and the server accepts at most 512 KB after checking the real file signature, so documents stay small.
 * `User.avatar` only holds the URL (/api/profile-photos/:userId?v=...). One photo per user: replacing it overwrites the old one,
 * so nothing is orphaned and no photo is shared between users.
 */
const profilePhotoSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  contentType: { type: String, required: true, enum: ['image/jpeg', 'image/png', 'image/webp'] },
  data: { type: Buffer, required: true },
  size: { type: Number, required: true },
}, { timestamps: true });
profilePhotoSchema.index({ user: 1 }, { unique: true });

module.exports = { ProfilePhoto: mongoose.model('ProfilePhoto', profilePhotoSchema) };

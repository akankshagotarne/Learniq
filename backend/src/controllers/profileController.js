/**
 * Profile management.
 *
 * SELF-SERVICE (a signed-in student / teacher edits THEIR OWN account; the account comes from the server-side session, never from
 * the request):
 *   PATCH  /api/auth/profile                 name, phone (+ teacher professional fields)
 *   POST   /api/auth/profile/email-change    start an e-mail change (current password; link is sent to the NEW address)
 *   POST   /api/auth/verify-email-change     confirm it with the token from that link (public: the token is the proof)
 *   POST   /api/auth/change-password
 *   POST   /api/auth/profile/photo           multipart "photo"
 *   DELETE /api/auth/profile/photo
 * ADMIN (routes/admin.js applies protect + authorize('admin')):
 *   PATCH  /api/admin/students/:id   PATCH /api/admin/teachers/:id
 *   POST   /api/admin/users/:id/photo   DELETE /api/admin/users/:id/photo
 * PUBLIC: GET /api/profile-photos/:userId   (a profile picture, like on any site; no other personal data)
 *
 * Field rules live in services/profileUpdates.js. Nothing here passes req.body to the database.
 */
const crypto = require('crypto');
const mongoose = require('mongoose');
const User = require('../models/User');
const { ProfilePhoto } = require('../models/ProfilePhoto');
const { AdminAuditLog } = require('../models/AdminAuditLog');
const identity = require('../services/identity');
const { passwordProblem } = require('../services/passwordPolicy');
const sessions = require('../services/authSessions');
const { getPrimaryClientUrl } = require('../config/clientUrls');
const { sendMail } = require('../services/mailer');
const { ProfileError, plan, assertNoConflicts, apply } = require('../services/profileUpdates');

const OID = /^[a-f0-9]{24}$/i;
const EMAIL_CHANGE_TTL_MS = 30 * 60 * 1000;
const sha256 = (v) => crypto.createHash('sha256').update(String(v)).digest('hex');

/** The user as the API returns it everywhere else (toJSON drops the password hash and tokens); belt and braces for other shapes. */
const safe = (u) => {
  const o = u && typeof u.toJSON === 'function' ? u.toJSON() : { ...u };
  ['password', 'resetPasswordToken', 'resetPasswordExpire', 'pendingEmailTokenHash', 'pendingEmailExpire'].forEach((k) => { delete o[k]; });
  return o;
};

const send = (res, error, label) => {
  if (error instanceof ProfileError) {
    return res.status(error.status).json({ success: false, code: error.code, message: error.message, field: error.field, fields: error.fields, errors: error.errors });
  }
  console.error(`[profile] ${label} failed:`, error && error.message);
  return res.status(500).json({ success: false, message: 'Server error. Nothing was changed; please try again.' });
};

const requirePassword = async (userId, password) => {
  if (typeof password !== 'string' || !password) throw new ProfileError(400, 'PASSWORD_REQUIRED', 'Please enter your current password to confirm this change.', { field: 'currentPassword' });
  const full = await User.findById(userId);
  if (!full || !(await full.comparePassword(password))) throw new ProfileError(403, 'WRONG_PASSWORD', 'The current password is not correct.', { field: 'currentPassword' });
  return full;
};

// ───────────────────────── self-service ─────────────────────────
const updateOwnProfile = async (req, res) => {
  try {
    const user = req.user;
    const p = plan('self', user, req.body);
    await assertNoConflicts(user, p.ident); // a taken number is reported first (same 409 as registration), then the password is checked
    if (p.changed.includes('phone')) await requirePassword(user._id, req.body.currentPassword); // the phone number is a login id
    const updated = await apply(user, p);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, message: p.changed.length ? 'Profile updated.' : 'No changes to save.', changed: p.changed, user: safe(updated) });
  } catch (e) { send(res, e, 'update own profile'); }
};

const requestEmailChange = async (req, res) => {
  try {
    const user = req.user;
    if (!['student', 'teacher'].includes(user.role)) throw new ProfileError(403, 'ROLE_NOT_ALLOWED', 'This account type cannot be edited here.');
    const email = identity.normalizeEmail(req.body && req.body.newEmail);
    if (!email) throw new ProfileError(400, 'INVALID_EMAIL', identity.MESSAGES.INVALID_EMAIL, { field: 'newEmail' });
    if (email === user.email) throw new ProfileError(400, 'EMAIL_UNCHANGED', 'That is already your e-mail address.', { field: 'newEmail' });
    const full = await requirePassword(user._id, req.body.currentPassword);
    await assertNoConflicts(user, { email });

    const token = crypto.randomBytes(32).toString('hex');
    await User.updateOne({ _id: user._id }, { $set: { pendingEmail: email, pendingEmailTokenHash: sha256(token), pendingEmailExpire: new Date(Date.now() + EMAIL_CHANGE_TTL_MS) } });
    const link = `${getPrimaryClientUrl()}/verify-email-change/${token}`;
    let delivered = false;
    try {
      delivered = await sendMail({
        to: email, subject: 'Confirm your new LearnIQ e-mail address',
        html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto"><h2>Confirm your new e-mail</h2><p>Hi ${String(full.name).replace(/[<>]/g, '')},</p><p>Click the button to use this address for your LearnIQ account. The link expires in 30 minutes.</p><p style="margin:24px 0"><a href="${link}" style="background:#8B03ED;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Confirm e-mail</a></p><p>If you did not ask for this, ignore this e-mail: nothing changes.</p></div>`,
      });
    } catch (mailError) { console.error('[profile] e-mail change message failed:', mailError && mailError.message); }
    if (!delivered) {
      await User.updateOne({ _id: user._id }, { $unset: { pendingEmail: 1, pendingEmailTokenHash: 1, pendingEmailExpire: 1 } });
      throw new ProfileError(503, 'EMAIL_NOT_SENT', 'We could not send the confirmation e-mail right now, so your e-mail address was not changed. Please try again later.');
    }
    res.json({ success: true, message: `We sent a confirmation link to ${email}. Your e-mail address changes only after you open it (valid for 30 minutes).`, pendingEmail: email });
  } catch (e) { send(res, e, 'request e-mail change'); }
};

const verifyEmailChange = async (req, res) => {
  try {
    const token = typeof (req.body && req.body.token) === 'string' ? req.body.token.trim() : '';
    if (!/^[a-f0-9]{64}$/i.test(token)) throw new ProfileError(400, 'INVALID_TOKEN', 'This confirmation link is not valid.');
    const user = await User.findOne({ pendingEmailTokenHash: sha256(token), pendingEmailExpire: { $gt: new Date() } });
    if (!user || !user.pendingEmail) throw new ProfileError(400, 'INVALID_TOKEN', 'This confirmation link is invalid or has expired. Please request the change again.');
    await assertNoConflicts(user, { email: user.pendingEmail });
    try {
      await User.updateOne({ _id: user._id }, { $set: { email: user.pendingEmail }, $unset: { pendingEmail: 1, pendingEmailTokenHash: 1, pendingEmailExpire: 1 } });
    } catch (error) {
      const raced = identity.conflictsFromDuplicateKeyError(error);
      if (raced) { const b = identity.conflictBody(raced); throw new ProfileError(409, b.code, b.message, { field: b.field }); }
      throw error;
    }
    res.json({ success: true, message: 'Your e-mail address was updated. Use it the next time you log in.' });
  } catch (e) { send(res, e, 'verify e-mail change'); }
};

const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body || {};
    const full = await requirePassword(req.user._id, currentPassword);
    const problem = passwordProblem(newPassword);
    if (problem) throw new ProfileError(400, 'WEAK_PASSWORD', problem, { field: 'newPassword' });
    if (await full.comparePassword(newPassword)) throw new ProfileError(400, 'PASSWORD_UNCHANGED', 'Please choose a password you are not already using.', { field: 'newPassword' });
    full.password = newPassword; // hashed by the model's pre-save hook, like every password
    full.mustChangePassword = false; // an admin-set temporary password is now replaced
    await full.save();
    // every OTHER device is signed out; this session continues
    try {
      const { AuthSession } = require('../models/AuthSession');
      const keep = req.authSession && req.authSession.sid;
      const others = await AuthSession.find({ user: full._id, status: 'active' });
      for (const s of others) if (s.sid !== keep) await sessions.endSession(s.sid, 'password_reset');
    } catch (e) { console.error('[profile] could not end other sessions:', e && e.message); }
    res.json({ success: true, message: 'Password changed. Other devices were signed out.' });
  } catch (e) { send(res, e, 'change password'); }
};

// ───────────────────────── photos ─────────────────────────
const detectType = (buf) => {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.slice(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.slice(0, 4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
};

const savePhoto = async (userId, file) => {
  if (!file || !file.buffer) throw new ProfileError(400, 'NO_FILE', 'Please choose a photo (JPEG, PNG or WebP).', { field: 'photo' });
  const type = detectType(file.buffer);
  if (!type) throw new ProfileError(400, 'INVALID_IMAGE', 'This file is not a valid JPEG, PNG or WebP image.', { field: 'photo' }); // the real bytes decide, not the file name
  await ProfilePhoto.findOneAndUpdate({ user: userId }, { $set: { contentType: type, data: file.buffer, size: file.buffer.length } }, { upsert: true, new: true });
  const url = `/api/profile-photos/${userId}?v=${Date.now()}`;
  const updated = await User.findByIdAndUpdate(userId, { $set: { avatar: url } }, { new: true });
  return updated;
};
const dropPhoto = async (userId) => {
  await ProfilePhoto.deleteOne({ user: userId });
  return User.findByIdAndUpdate(userId, { $set: { avatar: null } }, { new: true });
};

const uploadOwnPhoto = async (req, res) => {
  try {
    if (!['student', 'teacher'].includes(req.user.role)) throw new ProfileError(403, 'ROLE_NOT_ALLOWED', 'This account type cannot be edited here.');
    res.json({ success: true, message: 'Profile photo updated.', user: safe(await savePhoto(req.user._id, req.file)) });
  } catch (e) { send(res, e, 'upload own photo'); }
};
const removeOwnPhoto = async (req, res) => {
  try { res.json({ success: true, message: 'Profile photo removed.', user: safe(await dropPhoto(req.user._id)) }); } catch (e) { send(res, e, 'remove own photo'); }
};

const servePhoto = async (req, res) => {
  try {
    if (!OID.test(String(req.params.userId))) return res.status(404).end();
    const photo = await ProfilePhoto.findOne({ user: req.params.userId });
    if (!photo) return res.status(404).end();
    res.set({ 'Content-Type': photo.contentType, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Length': String(photo.data.length) });
    res.end(photo.data);
  } catch (e) { res.status(500).end(); }
};

// ───────────────────────── admin ─────────────────────────
const auditAdmin = async (action, admin, target, changedFields) => {
  try {
    await AdminAuditLog.create({ action, admin: admin._id, adminName: admin.name, targetType: target.role, target: target._id, targetLabel: target.name, changedFields, status: 'SUCCESS', at: new Date() });
  } catch (e) { console.error('[profile] audit entry could not be written (the change was applied):', e && e.code ? e.code : 'error'); }
};

const loadTarget = async (id, role) => {
  if (!OID.test(String(id)) || !mongoose.Types.ObjectId.isValid(String(id))) throw new ProfileError(400, 'INVALID_ID', 'Invalid user id.');
  const target = await User.findOne({ _id: id, role });
  if (!target) throw new ProfileError(404, 'NOT_FOUND', `${role === 'teacher' ? 'Teacher' : 'Student'} not found.`);
  return target;
};

const adminEdit = (role) => async (req, res) => {
  try {
    const target = await loadTarget(req.params.id, role);
    const p = plan('admin', target, req.body);
    await assertNoConflicts(target, p.ident);
    const updated = await apply(target, p);
    if (p.changed.length) await auditAdmin('PROFILE_EDITED', req.user, target, p.changed);
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, message: p.changed.length ? `${target.name}'s profile was updated.` : 'No changes to save.', changed: p.changed, user: safe(updated) });
  } catch (e) { send(res, e, `admin edit ${role}`); }
};

const adminUploadPhoto = async (req, res) => {
  try {
    if (!OID.test(String(req.params.id))) throw new ProfileError(400, 'INVALID_ID', 'Invalid user id.');
    const target = await User.findOne({ _id: req.params.id, role: { $in: ['student', 'teacher'] } });
    if (!target) throw new ProfileError(404, 'NOT_FOUND', 'User not found.');
    const updated = await savePhoto(target._id, req.file);
    await auditAdmin('PROFILE_PHOTO_CHANGED', req.user, target, ['avatar']);
    res.json({ success: true, message: 'Profile photo updated.', user: safe(updated) });
  } catch (e) { send(res, e, 'admin upload photo'); }
};
const adminRemovePhoto = async (req, res) => {
  try {
    if (!OID.test(String(req.params.id))) throw new ProfileError(400, 'INVALID_ID', 'Invalid user id.');
    const target = await User.findOne({ _id: req.params.id, role: { $in: ['student', 'teacher'] } });
    if (!target) throw new ProfileError(404, 'NOT_FOUND', 'User not found.');
    const updated = await dropPhoto(target._id);
    await auditAdmin('PROFILE_PHOTO_REMOVED', req.user, target, ['avatar']);
    res.json({ success: true, message: 'Profile photo removed.', user: safe(updated) });
  } catch (e) { send(res, e, 'admin remove photo'); }
};

module.exports = {
  updateOwnProfile, requestEmailChange, verifyEmailChange, changePassword, uploadOwnPhoto, removeOwnPhoto, servePhoto,
  adminEditStudent: adminEdit('student'), adminEditTeacher: adminEdit('teacher'), adminUploadPhoto, adminRemovePhoto, detectType, safe,
};

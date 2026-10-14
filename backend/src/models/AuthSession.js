const mongoose = require('mongoose');

/**
 * One row per sign-in. The JWT carries only { id, sid }; every authenticated request looks the row up by `sid`
 * (middleware/auth.js), so a session can be ended on the server at any time (logout, takeover from another device,
 * password reset, inactivity) and the old token stops working immediately.
 *
 * ONE ACTIVE SESSION PER ACCOUNT is enforced by the database itself: the partial unique index below allows at most one
 * `status: 'active'` row per user, so two simultaneous sign-ins can never both become active (the loser gets E11000).
 */
const authSessionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  sid: { type: String, required: true }, // random 256-bit id, also inside the signed JWT
  status: { type: String, enum: ['active', 'revoked', 'logged_out', 'expired'], default: 'active' },
  // derived on the server from the User-Agent header - never taken from the request body
  device: {
    label: { type: String, default: 'Unknown device' }, // "Chrome on Windows"
    browser: { type: String, default: null },
    os: { type: String, default: null },
    mobile: { type: Boolean, default: false },
  },
  uaHash: { type: String, default: null }, // SHA-256 of the User-Agent (no raw header stored)
  lastActiveAt: { type: Date, required: true },
  expiresAt: { type: Date, required: true }, // the JWT's own expiry
  endedAt: { type: Date, default: null },
  endReason: { type: String, enum: ['logout', 'takeover', 'expired', 'idle', 'password_reset', 'access_revoked'], default: null },
  purgeAt: { type: Date, required: true }, // ended/expired rows are deleted by MongoDB some time after this
}, { timestamps: true });

authSessionSchema.index({ sid: 1 }, { unique: true, name: 'uniq_sid' });
authSessionSchema.index(
  { user: 1 },
  { unique: true, name: 'one_active_session_per_user', partialFilterExpression: { status: 'active' } },
);
authSessionSchema.index({ purgeAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_purgeAt' });

/**
 * A pending "Log out other device & continue". Created ONLY after the password was verified and a live session was
 * found; the raw token goes to that one browser, only its SHA-256 is stored. Single use, ~2 minutes, bound to the user,
 * to the exact conflicting session (`targetSid`) and to the browser's User-Agent.
 */
const sessionTakeoverSchema = new mongoose.Schema({
  tokenHash: { type: String, required: true },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  targetSid: { type: String, required: true },
  uaHash: { type: String, default: null },
  expiresAt: { type: Date, required: true },
  usedAt: { type: Date, default: null },
}, { timestamps: true });
sessionTakeoverSchema.index({ tokenHash: 1 }, { unique: true, name: 'uniq_takeover_token' });
sessionTakeoverSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600, name: 'ttl_takeover' });

const AuthSession = mongoose.models.AuthSession || mongoose.model('AuthSession', authSessionSchema);
const SessionTakeover = mongoose.models.SessionTakeover || mongoose.model('SessionTakeover', sessionTakeoverSchema);

module.exports = { AuthSession, SessionTakeover };

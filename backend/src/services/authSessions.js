/**
 * Server-side sign-in sessions: ONE active session per account.
 *
 *  - Every sign-in (login, takeover, registration, password reset) goes through startSession(), which inserts an
 *    `active` AuthSession row. The partial unique index { user } where status = 'active' (models/AuthSession.js) makes
 *    "two active sessions for one account" impossible even when two devices sign in at the same moment.
 *  - The JWT is { id, sid }. authenticate() (used by middleware/auth.js and the Socket.IO handshake) rejects a token whose
 *    session is not active - so logout / takeover / password reset end the old token immediately, server-side.
 *  - A live session on another device makes the password login return 409 SESSION_CONFLICT with a short-lived,
 *    single-use takeover token (only its hash is stored) bound to: this user, the exact conflicting session and this
 *    browser's User-Agent. Only that token can revoke the other session - never a user id / session id / device name
 *    sent by a client.
 *  - Stale sessions (JWT expired, or no activity for SESSION_IDLE_HOURS) are treated as ended and replaced silently, so
 *    nobody is locked out by a device they forgot to log out of.
 *  - lastActiveAt is written at most once per TOUCH_INTERVAL_MS per session (not on every request).
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { EventEmitter } = require('events');

const models = () => require('../models/AuthSession'); // resolved lazily so tests can substitute in-memory models
const UserModel = () => require('../models/User');

const HOUR = 3600 * 1000;
const config = {
  get idleMs() { const h = Number(process.env.SESSION_IDLE_HOURS); return (Number.isFinite(h) && h > 0 ? h : 72) * HOUR; },
  takeoverTtlMs: 2 * 60 * 1000,
  touchIntervalMs: 60 * 1000,
  purgeAfterMs: 30 * 24 * HOUR,
};

/** emits 'ended' { sid, user, reason } so open Socket.IO connections of that session can be closed */
const sessionEvents = new EventEmitter();

class AuthError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}

const MESSAGES = {
  SESSION_REVOKED: 'You were signed out because your account was signed in on another device.',
  SESSION_PASSWORD_RESET: 'You were signed out because the account password was changed.',
  SESSION_EXPIRED: 'Your session has expired. Please sign in again.',
  SESSION_ENDED: 'You have been signed out. Please sign in again.',
  SESSION_REQUIRED: 'Please sign in again.',
  SESSION_CONFLICT: 'Your account is already logged in on another device.',
  TAKEOVER_EXPIRED: 'This sign-in request has expired. Please sign in again.',
  TAKEOVER_INVALID: 'This sign-in request is not valid. Please sign in again.',
  SESSION_CHANGED: 'Your account\'s active session changed. Please sign in again.',
};

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const uaOf = (req) => String((req && req.headers && req.headers['user-agent']) || '').slice(0, 512);
const uaHash = (req) => sha256(uaOf(req));

/** "Chrome on Windows" etc. from the User-Agent header (display only - it is never used for authorization) */
const describeDevice = (uaRaw) => {
  const ua = String(uaRaw || '');
  let os = null;
  if (/Windows NT/i.test(ua)) os = 'Windows';
  else if (/iPad/i.test(ua)) os = 'iPadOS';
  else if (/iPhone|iPod/i.test(ua)) os = 'iOS';
  else if (/Android/i.test(ua)) os = 'Android';
  else if (/CrOS/i.test(ua)) os = 'ChromeOS';
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS';
  else if (/Linux/i.test(ua)) os = 'Linux';
  let browser = null;
  if (/Edg(e|A|iOS)?\//i.test(ua)) browser = 'Edge';
  else if (/OPR\/|Opera/i.test(ua)) browser = 'Opera';
  else if (/SamsungBrowser/i.test(ua)) browser = 'Samsung Internet';
  else if (/Firefox\/|FxiOS/i.test(ua)) browser = 'Firefox';
  else if (/Chrome\/|CriOS/i.test(ua)) browser = 'Chrome';
  else if (/Safari\//i.test(ua)) browser = 'Safari';
  const mobile = /Mobi|Android|iPhone|iPad|iPod/i.test(ua);
  const label = browser && os ? `${browser} on ${os}` : browser || (os ? `${os} device` : 'Unknown device');
  return { label, browser, os, mobile };
};

const isDuplicateKey = (e) => e && (e.code === 11000 || /E11000/.test(e.message || ''));

/** null when the session may be used now, otherwise the reason it is over */
const deadReason = (s, now = new Date()) => {
  if (!s || s.status !== 'active') return 'ended';
  if (new Date(s.expiresAt).getTime() <= now.getTime()) return 'expired';
  if (new Date(s.lastActiveAt).getTime() <= now.getTime() - config.idleMs) return 'idle';
  return null;
};

/** marks an active-but-stale session as expired; conditional so it never touches a session that changed meanwhile */
const retireStale = async (s, reason, now = new Date()) => {
  const { AuthSession } = models();
  const r = await AuthSession.updateOne({ _id: s._id, status: 'active' }, { $set: { status: 'expired', endedAt: now, endReason: reason } });
  if (r.modifiedCount) sessionEvents.emit('ended', { sid: s.sid, user: String(s.user), reason });
};

/** the user's live session, if any (a stale one is retired on the way) */
const findLiveSession = async (userId, now = new Date()) => {
  const { AuthSession } = models();
  const s = await AuthSession.findOne({ user: userId, status: 'active' });
  if (!s) return null;
  const dead = deadReason(s, now);
  if (dead) { await retireStale(s, dead, now); return null; }
  return s;
};

/** Signs { id, sid } and inserts the active session row. Throws E11000 if the user already has an active session. */
const startSession = async (user, req, now = new Date()) => {
  const { AuthSession } = models();
  const sid = crypto.randomBytes(32).toString('base64url');
  const token = jwt.sign({ id: String(user._id), sid }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '7d' });
  const { exp } = jwt.decode(token);
  const expiresAt = new Date(exp * 1000);
  await AuthSession.create({
    user: user._id, sid, status: 'active', device: describeDevice(uaOf(req)), uaHash: uaHash(req),
    lastActiveAt: now, expiresAt, purgeAt: new Date(expiresAt.getTime() + config.purgeAfterMs),
  });
  return { token, sid, expiresAt };
};

/** Public, non-secret description of a session for the conflict dialog (no ids, no tokens, no IP). */
const publicSession = (s) => ({
  device: (s.device && s.device.label) || 'Unknown device',
  mobile: !!(s.device && s.device.mobile),
  lastActiveAt: new Date(s.lastActiveAt).toISOString(),
  signedInAt: new Date(s.createdAt || s.lastActiveAt).toISOString(),
});

const issueTakeover = async (user, target, req, now = new Date()) => {
  const { SessionTakeover } = models();
  const raw = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(now.getTime() + config.takeoverTtlMs);
  await SessionTakeover.create({ tokenHash: sha256(raw), user: user._id, targetSid: target.sid, uaHash: uaHash(req), expiresAt, usedAt: null });
  return {
    success: false, code: 'SESSION_CONFLICT', message: MESSAGES.SESSION_CONFLICT,
    activeSession: publicSession(target), takeoverToken: raw, takeoverExpiresAt: expiresAt.toISOString(),
  };
};

/**
 * After the password was verified: either a new session ({ token }) or a conflict ({ conflict } - send it as HTTP 409).
 * Concurrency: if another sign-in wins the race between our check and our insert, the unique index rejects our insert
 * and we loop once more - now we see THEIR session and answer with a conflict instead.
 */
const beginLogin = async (user, req) => {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = new Date();
    const live = await findLiveSession(user._id, now);
    if (live) return { conflict: await issueTakeover(user, live, req, now) };
    try {
      return await startSession(user, req, now);
    } catch (e) {
      if (!isDuplicateKey(e)) throw e;
    }
  }
  throw new AuthError(503, 'SESSION_BUSY', 'Please try signing in again.');
};

/**
 * "Log out other device & continue". `checkUser(user)` re-applies the normal sign-in rules (active, teacher approved).
 * Order matters: the token is consumed atomically FIRST (a token works once), then the exact session that was shown to
 * the user is revoked with a conditional update, then the new session is inserted under the unique index.
 */
const takeover = async (rawToken, req, checkUser) => {
  if (typeof rawToken !== 'string' || rawToken.length < 20 || rawToken.length > 200) {
    throw new AuthError(400, 'TAKEOVER_INVALID', MESSAGES.TAKEOVER_INVALID);
  }
  const { AuthSession, SessionTakeover } = models();
  const now = new Date();
  const t = await SessionTakeover.findOneAndUpdate(
    { tokenHash: sha256(rawToken), usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { new: true },
  );
  if (!t) throw new AuthError(401, 'TAKEOVER_EXPIRED', MESSAGES.TAKEOVER_EXPIRED);
  if (t.uaHash !== uaHash(req)) throw new AuthError(401, 'TAKEOVER_INVALID', MESSAGES.TAKEOVER_INVALID);

  const user = await UserModel().findById(t.user);
  const blocked = !user ? 'Invalid email or password.' : checkUser(user);
  if (blocked) throw new AuthError(401, 'LOGIN_BLOCKED', blocked);

  const revoked = await AuthSession.updateOne(
    { sid: t.targetSid, user: user._id, status: 'active' },
    { $set: { status: 'revoked', endedAt: now, endReason: 'takeover' } },
  );
  if (revoked.modifiedCount) sessionEvents.emit('ended', { sid: t.targetSid, user: String(user._id), reason: 'takeover' });
  else if (await findLiveSession(user._id, now)) {
    // the session we showed is gone AND a different one is live now (e.g. someone else took over first): start over
    throw new AuthError(409, 'SESSION_CHANGED', MESSAGES.SESSION_CHANGED);
  }
  try {
    const started = await startSession(user, req, now);
    return { ...started, user };
  } catch (e) {
    if (isDuplicateKey(e)) throw new AuthError(409, 'SESSION_CHANGED', MESSAGES.SESSION_CHANGED);
    throw e;
  }
};

/** Cancel: the pending takeover token can no longer be used. The other device's session is untouched. */
const cancelTakeover = async (rawToken) => {
  if (typeof rawToken !== 'string' || rawToken.length > 200) return;
  const { SessionTakeover } = models();
  await SessionTakeover.updateOne({ tokenHash: sha256(rawToken), usedAt: null }, { $set: { usedAt: new Date() } });
};

/** Ends ONE session (logout). */
const endSession = async (sid, reason = 'logout') => {
  const { AuthSession } = models();
  const r = await AuthSession.updateOne({ sid, status: 'active' }, { $set: { status: 'logged_out', endedAt: new Date(), endReason: reason } });
  if (r.modifiedCount) sessionEvents.emit('ended', { sid, reason });
  return r.modifiedCount > 0;
};

/** Ends every session of a user and voids pending takeovers (password reset). */
const endAllSessions = async (userId, reason = 'password_reset') => {
  const { AuthSession, SessionTakeover } = models();
  const live = await AuthSession.find({ user: userId, status: 'active' });
  await AuthSession.updateMany({ user: userId, status: 'active' }, { $set: { status: 'revoked', endedAt: new Date(), endReason: reason } });
  await SessionTakeover.updateMany({ user: userId, usedAt: null }, { $set: { usedAt: new Date() } });
  live.forEach((s) => sessionEvents.emit('ended', { sid: s.sid, user: String(userId), reason }));
};

const endedCode = (s) => {
  if (s.endReason === 'takeover') return 'SESSION_REVOKED';
  if (s.endReason === 'password_reset') return 'SESSION_PASSWORD_RESET';
  if (s.status === 'expired') return 'SESSION_EXPIRED';
  return 'SESSION_ENDED';
};

/**
 * Verifies a bearer token AND its server-side session. Returns { user, session } or throws AuthError(401).
 * Tokens without a `sid` (issued before sessions existed) are rejected: they could not be revoked.
 */
const authenticate = async (token, { touch = true } = {}) => {
  let decoded;
  try { decoded = jwt.verify(token, process.env.JWT_SECRET); } catch (e) { throw new AuthError(401, 'TOKEN_INVALID', 'Not authorized. Invalid token.'); }
  if (!decoded || typeof decoded.sid !== 'string' || !decoded.id) throw new AuthError(401, 'SESSION_REQUIRED', MESSAGES.SESSION_REQUIRED);
  const { AuthSession } = models();
  const session = await AuthSession.findOne({ sid: decoded.sid });
  if (!session || String(session.user) !== String(decoded.id)) throw new AuthError(401, 'SESSION_ENDED', MESSAGES.SESSION_ENDED);
  const now = new Date();
  if (session.status !== 'active') { const code = endedCode(session); throw new AuthError(401, code, MESSAGES[code]); }
  const dead = deadReason(session, now);
  if (dead) { await retireStale(session, dead, now); throw new AuthError(401, 'SESSION_EXPIRED', MESSAGES.SESSION_EXPIRED); }

  const user = await UserModel().findById(decoded.id).select('-password');
  if (!user) throw new AuthError(401, 'USER_NOT_FOUND', 'User not found.');
  if (!user.isActive) throw new AuthError(401, 'ACCOUNT_DEACTIVATED', 'Account is deactivated.');

  if (touch && now.getTime() - new Date(session.lastActiveAt).getTime() >= config.touchIntervalMs) {
    // throttled, conditional, and never blocks or fails the request
    AuthSession.updateOne({ _id: session._id, status: 'active' }, { $set: { lastActiveAt: now } }).catch(() => {});
  }
  return { user, session };
};

module.exports = {
  config, MESSAGES, AuthError, sessionEvents, describeDevice, deadReason, publicSession,
  startSession, beginLogin, takeover, cancelTakeover, endSession, endAllSessions, authenticate,
};

const crypto = require('crypto');
const referrals = require('../services/referrals');
const mentorReferrals = require('../services/mentorReferrals');
const bcrypt = require('bcryptjs');
const User = require('../models/User');
const { Notification } = require('../models/index');
const { getPrimaryClientUrl } = require('../config/clientUrls');
const identity = require('../services/identity');
const { parseStudentStandard, standardLabel } = require('../constants/standards');
const { passwordProblem } = require('../services/passwordPolicy');
const { sendMail } = require('../services/mailer');

const buildResetEmailHtml = (name, resetUrl) => `
  <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
    <h2 style="color: #1a1a2e;">Reset your password</h2>
    <p>Hi ${String(name || 'there').replace(/[<>&"']/g, '')},</p>
    <p>We received a request to reset your LearnIQ password. Click the button below to choose a new one. This link expires in 15 minutes.</p>
    <p style="margin: 24px 0;">
      <a href="${resetUrl}" style="background: #8B03ED; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">Reset Password</a>
    </p>
    <p>If you didn't request this, you can safely ignore this email.</p>
    <p style="color: #888; font-size: 12px;">If the button doesn't work, copy and paste this link: ${resetUrl}</p>
  </div>
`;

// Sends the reset email through the shared mailer (services/mailer.js: Resend when RESEND_API_KEY is set, EMAIL_FROM as sender).
// true = the provider accepted it; false = no usable provider/sender; throws when the provider refused it.
const sendResetEmail = (user, resetUrl) => sendMail({
  to: user.email,
  subject: 'Reset your LearnIQ password',
  html: buildResetEmailHtml(user.name, resetUrl),
});

// Every token is tied to a server-side session (services/authSessions.js): one active session per account.
const sessions = require('../services/authSessions');

const TEACHER_PENDING_MESSAGE = 'Your account is awaiting admin approval. You will be able to log in after your registration is approved.';
const TEACHER_REJECTED_MESSAGE = 'Your teacher registration was not approved. Please contact LearnIQ support if you think this is a mistake.';

/**
 * One place that decides whether an authenticated account may start a session (password login AND "Log out other device &
 * continue"). The decision is read from the database on every attempt, so approval / suspension take effect immediately.
 * @returns {null | { status: number, code: string, message: string }}
 */
const signInBlock = (user) => {
  if (!user.isActive) return { status: 401, code: 'ACCOUNT_DEACTIVATED', message: 'Your account has been deactivated.' };
  if (user.role === 'teacher' && user.isApproved !== true) {
    const rejected = identity.approvalStatusOf(user) === 'REJECTED';
    return rejected
      ? { status: 403, code: 'TEACHER_REJECTED', message: TEACHER_REJECTED_MESSAGE }
      : { status: 403, code: 'TEACHER_PENDING_APPROVAL', message: TEACHER_PENDING_MESSAGE };
  }
  return null;
};
/** Same rules as above, as the plain message the session service expects (null = allowed). */
const signInBlockReason = (user) => { const b = signInBlock(user); return b ? b.message : null; };

const sendAuthError = (res, e, fallback) => {
  if (e instanceof sessions.AuthError) return res.status(e.status).json({ success: false, code: e.code, message: e.message });
  console.error(fallback, e && e.message);
  return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
};

// @desc   Register user
// @route  POST /api/auth/register
// Students: phone number REQUIRED, email optional. Teachers: email required (phone optional) and the account is created
// PENDING admin approval - no session/token is issued, so a pending teacher can never reach the Teacher Dashboard.
// The role comes from the form but only ever 'student' or 'teacher' is accepted ('admin' cannot be requested here).
const register = async (req, res) => {
  try {
    const { name, email, password, role, phone, referralCode, mentorRef } = req.body || {};
    const fail = (status, code, field, message) => res.status(status).json({ success: false, code, field, message, errors: field ? [{ field, code, message }] : undefined });

    if (typeof name !== 'string' || !name.trim()) return fail(400, 'NAME_REQUIRED', 'name', 'Please enter your full name.');
    const validRole = role === 'teacher' ? 'teacher' : 'student';

    const pwProblem = passwordProblem(password);
    if (pwProblem) return fail(400, 'INVALID_PASSWORD', 'password', pwProblem);

    // Canonical identity values (the same ones the unique indexes are built on)
    // anything other than a blank/absent value counts as "supplied" - so a non-string (e.g. an object) is rejected, never ignored
    const hasEmail = !(email === undefined || email === null || (typeof email === 'string' && email.trim() === ''));
    if (!hasEmail && validRole === 'teacher') return fail(400, 'EMAIL_REQUIRED', 'email', identity.MESSAGES.EMAIL_REQUIRED);
    const emailNormalized = hasEmail ? identity.normalizeEmail(email) : undefined;
    if (hasEmail && !emailNormalized) return fail(400, 'INVALID_EMAIL', 'email', identity.MESSAGES.INVALID_EMAIL);

    const phoneInfo = identity.normalizePhone(phone);
    if (phoneInfo.empty && validRole === 'student') return fail(400, 'PHONE_REQUIRED', 'phone', identity.MESSAGES.PHONE_REQUIRED);
    if (!phoneInfo.empty && !phoneInfo.valid) return fail(400, 'INVALID_PHONE', 'phone', identity.MESSAGES.INVALID_PHONE);
    const phoneNormalized = phoneInfo.valid ? phoneInfo.e164 : undefined;

    // Optional referral code (students only). A code that was typed but is wrong is refused BEFORE the account exists so the student can fix it;
    // a paused program never blocks a registration. Reward/attribution happens after the account is created and can never undo it.
    const refInput = typeof referralCode === 'string' ? referralCode.trim() : '';
    if (refInput) {
      if (validRole !== 'student') return fail(400, 'REFERRAL_NOT_FOR_TEACHERS', 'referralCode', 'Referral codes can only be used when registering as a student.');
      const check = await referrals.validateCode(refInput);
      if (!check.valid && check.reason !== 'DISABLED') return fail(400, 'INVALID_REFERRAL_CODE', 'referralCode', check.message);
    }

    // Friendly pre-check across ALL roles (one shared collection). The unique indexes below remain the final authority.
    const conflict = identity.conflictBody(await identity.findIdentityConflicts(User, { email: emailNormalized, phoneNormalized }));
    if (conflict) return res.status(409).json(conflict);

    const isTeacher = validRole === 'teacher';
    const doc = {
      name: name.trim(),
      password,
      role: validRole,
      phone: phoneInfo.valid ? String(phone).trim() : '',
      phoneNormalized,
      isApproved: !isTeacher, // teachers need admin approval
    };
    if (emailNormalized) doc.email = emailNormalized;
    if (isTeacher) doc.approvalStatus = 'PENDING';

    let user;
    try {
      user = await User.create(doc);
    } catch (createError) {
      // Two simultaneous registrations can both pass the pre-check; MongoDB lets only one of them in.
      const raced = identity.conflictsFromDuplicateKeyError(createError);
      if (raced) return res.status(409).json(identity.conflictBody(raced));
      throw createError;
    }

    // Mentor referral TRACKING (a separate program from the student referral above; it only records who referred whom and never rewards anyone).
    // A wrong / expired link never blocks a registration. Failures are logged inside and never affect the account.
    const mentorInput = typeof mentorRef === 'string' ? mentorRef.trim() : '';
    if (mentorInput) await mentorReferrals.attributeRegistration({ newUser: user, code: mentorInput, source: 'LINK' });

    if (isTeacher) {
      // Deliberately NO session and NO token: the account exists only as a request until an administrator approves it.
      return res.status(201).json({
        success: true,
        pendingApproval: true,
        code: 'TEACHER_PENDING_APPROVAL',
        message: 'Your teacher registration request has been submitted successfully. Please wait for admin approval before logging in.',
      });
    }

    // Referral attribution: only for the account that was JUST created; failures are logged inside and never affect the registration
    if (refInput) await referrals.attributeRegistration({ newUser: user, code: refInput });

    // Welcome notification
    await Notification.create({
      recipient: user._id,
      title: 'Welcome to Learniq! 🎉',
      message: `Hi ${user.name}, welcome to Learniq! Start your learning journey today.`,
      type: 'success',
    });

    // a brand-new account has no other session; startSession still goes through the one-active-session index
    const { token } = await sessions.startSession(user, req);

    res.status(201).json({ success: true, message: 'Registration successful!', token, user: user.toJSON() });
  } catch (error) {
    console.error('Register error:', error && error.message);
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
};

// @desc   Login user
// @route  POST /api/auth/login
// A real bcrypt hash of a throw-away string: unknown accounts still cost one bcrypt compare, so response time does not
// reveal whether an email address / phone number is registered.
const DUMMY_HASH = '$2a$12$EjqOVmHheSBzzeSfHQtspet4TNZSDkiqQ7NoFoKJ5wnbgeoDNRmFK';

const login = async (req, res) => {
  try {
    // `identifier` = email OR phone number. `email` is still accepted so older clients keep working.
    const body = req.body || {};
    const raw = body.identifier !== undefined ? body.identifier : body.email;
    const { password } = body;

    if (typeof raw !== 'string' || !raw.trim() || typeof password !== 'string' || !password) {
      return res.status(400).json({ success: false, message: 'Email or phone number and password are required.' });
    }
    const id = identity.classifyIdentifier(raw);
    if (id.kind === 'invalid') {
      return res.status(400).json({ success: false, code: 'INVALID_IDENTIFIER', field: 'identifier', message: identity.MESSAGES.INVALID_IDENTIFIER });
    }

    let user = null;
    if (id.kind === 'email') {
      user = await User.findOne({ email: id.email });
      if (!user) { await bcrypt.compare(password, DUMMY_HASH).catch(() => false); console.info('[login] refused: no account (email)'); return res.status(401).json({ success: false, message: identity.MESSAGES.LOGIN_FAILED }); }
      if (!(await user.comparePassword(password))) { console.info(`[login] refused: wrong password (email, user ${user._id})`); return res.status(401).json({ success: false, message: identity.MESSAGES.LOGIN_FAILED }); }
    } else {
      // A phone can (in legacy data) be shared by several accounts: never take "the first match". The password decides, and
      // only if EXACTLY ONE eligible account accepts it is that account signed in; anything else fails generically.
      const candidates = await identity.findPhoneCandidates(User, id.e164);
      if (candidates.length === 0) await bcrypt.compare(password, DUMMY_HASH).catch(() => false);
      const accepted = [];
      for (const c of candidates) if (await c.comparePassword(password)) accepted.push(c);
      const eligible = accepted.filter((c) => !signInBlock(c));
      user = eligible.length === 1 ? eligible[0] : (eligible.length === 0 && accepted.length === 1 ? accepted[0] : null);
      if (!user) {
        console.info(`[login] refused: phone, ${candidates.length} account(s) with this number, ${accepted.length} accepted the password, ${eligible.length} eligible`); // counts only
        return res.status(401).json({ success: false, message: identity.MESSAGES.LOGIN_FAILED });
      }
    }

    const blocked = signInBlock(user);
    if (blocked) {
      console.info(`[login] blocked: ${blocked.code} (user ${user._id})`);
      return res.status(blocked.status).json({ success: false, code: blocked.code, message: blocked.message });
    }

    // Password is right. Another device with a LIVE session -> 409 + a short-lived takeover token for THIS attempt only.
    // No token is issued and the other device is not touched unless the user confirms (POST /auth/session/takeover).
    const outcome = await sessions.beginLogin(user, req);
    if (outcome.conflict) return res.status(409).json(outcome.conflict);
    const { token } = outcome;

    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    res.json({
      success: true,
      message: 'Login successful!',
      token,
      user: user.toJSON(),
    });
  } catch (error) {
    if (error instanceof sessions.AuthError) return sendAuthError(res, error);
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
};

// @desc   "Log out other device & continue" - only with the takeover token from THIS browser's 409 login response
// @route  POST /api/auth/session/takeover   { takeoverToken }
const takeoverSession = async (req, res) => {
  try {
    const { token, user } = await sessions.takeover(req.body && req.body.takeoverToken, req, signInBlockReason);
    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });
    res.json({ success: true, message: 'Signed in. The other device has been logged out.', token, user: user.toJSON() });
  } catch (error) {
    sendAuthError(res, error, 'Session takeover error:');
  }
};

// @desc   "Cancel" in the conflict dialog: voids the takeover token; the other device stays signed in
// @route  POST /api/auth/session/takeover/cancel   { takeoverToken }
const cancelSessionTakeover = async (req, res) => {
  try {
    await sessions.cancelTakeover(req.body && req.body.takeoverToken);
    res.json({ success: true });
  } catch (error) {
    sendAuthError(res, error, 'Cancel takeover error:');
  }
};

// @desc   Log out THIS session only
// @route  POST /api/auth/logout
const logout = async (req, res) => {
  try {
    await sessions.endSession(req.authSession.sid, 'logout');
    res.json({ success: true, message: 'Logged out.' });
  } catch (error) {
    sendAuthError(res, error, 'Logout error:');
  }
};

// @desc   Is this session still the active one? (cheap check the app makes on focus / every few minutes)
// @route  GET /api/auth/session
const getSessionStatus = async (req, res) => {
  res.json({ success: true, session: sessions.publicSession(req.authSession) });
};

// @desc   Get current user
// @route  GET /api/auth/me
const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).populate('badges');
    res.json({ success: true, user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// @desc   Update standard (student)
// @route  PUT /api/auth/standard
const updateStandard = async (req, res) => {
  try {
    // 1–10 or "Others" (stored as 99, see constants/standards.js); anything else - 0, 11, 5.5, "abc" - is rejected
    const standard = parseStudentStandard(req.body?.standard);
    if (standard === null) {
      return res.status(400).json({ success: false, code: 'INVALID_STANDARD', message: 'Please choose a standard from 1 to 10, or Others.' });
    }
    const user = await User.findByIdAndUpdate(req.user._id, { currentStandard: standard }, { new: true, runValidators: true });
    await referrals.syncStandard(req.user._id, standard); // keeps the Refer & Earn standard snapshot current (never throws)
    res.json({ success: true, message: `${standardLabel(standard)} selected.`, user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// @desc   Update profile
// @route  PUT /api/auth/profile
const updateProfile = async (req, res) => {
  try {
    const { name, phone, bio, experience, qualification, subjects, standards } = req.body;
    const updateData = {};
    if (name) updateData.name = name;
    if (phone) {
      const phoneInfo = identity.normalizePhone(phone);
      if (!phoneInfo.valid) {
        return res.status(400).json({ success: false, code: 'INVALID_PHONE', field: 'phone', message: identity.MESSAGES.INVALID_PHONE });
      }
      const conflict = identity.conflictBody(await identity.findIdentityConflicts(User, { phoneNormalized: phoneInfo.e164, excludeId: req.user._id }));
      if (conflict) return res.status(409).json(conflict);
      updateData.phone = String(phone).trim();
      updateData.phoneNormalized = phoneInfo.e164;
    }
    if (bio) updateData.bio = bio;
    if (experience) updateData.experience = experience;
    if (qualification) updateData.qualification = qualification;
    if (subjects) updateData.subjects = subjects;
    if (standards) updateData.standards = standards;
    if (req.file) updateData.avatar = `/uploads/avatars/${req.file.filename}`;

    const user = await User.findByIdAndUpdate(req.user._id, updateData, { new: true });
    res.json({ success: true, message: 'Profile updated!', user });
  } catch (error) {
    const raced = identity.conflictsFromDuplicateKeyError(error);
    if (raced) return res.status(409).json(identity.conflictBody(raced));
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// @desc   Forgot password
// @route  POST /api/auth/forgot-password
// SECURITY: the response is ALWAYS the same generic message — it never reveals whether the email is registered,
// whether an email provider is configured, or the reset token/URL (that is only ever delivered by email).
const GENERIC_RESET_RESPONSE = {
  success: true,
  message: 'If an account exists for that email, a password reset link has been sent. Please check your inbox (and spam folder).',
};

// Reset-token helpers, shared by "Forgot password" and the admin "Send password reset" action so there is ONE
// implementation of the secure flow. Only the SHA-256 hash of the token is stored; the raw token exists only inside the
// emailed link. Nothing here ever returns, logs or prints the token or the link.
const RESET_TTL_MS = 15 * 60 * 1000;
// A second reset e-mail for the SAME account within this window is not sent. The check reads the token's stored expiry (the
// database), so it holds across restarts and across several backend instances; a failed delivery discards the token, so a
// failed attempt never blocks the retry.
const RESET_COOLDOWN_MS = 2 * 60 * 1000;

/**
 * Stores a fresh hashed token on the user and returns `{ deliver }`. The emailed link lives only inside that closure —
 * it is not a property of the user document, the return value or any log line.
 */
const issueResetToken = async (user, { cooldown = false } = {}) => {
  if (cooldown && user.resetPasswordToken && user.resetPasswordExpire && new Date(user.resetPasswordExpire).getTime() > Date.now() + RESET_TTL_MS - RESET_COOLDOWN_MS) return null;
  const resetToken = crypto.randomBytes(32).toString('hex');
  user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  user.resetPasswordExpire = Date.now() + RESET_TTL_MS;
  await user.save({ validateBeforeSave: false });
  const resetUrl = `${getPrimaryClientUrl()}/reset-password/${resetToken}`;
  return { deliver: () => deliverResetEmail(user, resetUrl) };
};

const discardResetToken = async (user) => {
  const hash = user.resetPasswordToken;
  user.resetPasswordToken = undefined;
  user.resetPasswordExpire = undefined;
  try {
    // $unset in the database, only if the stored token is still the one we issued (never removes a newer token)
    await User.updateOne({ _id: user._id, resetPasswordToken: hash }, { $unset: { resetPasswordToken: 1, resetPasswordExpire: 1 } });
  } catch (cleanupError) { /* nothing more to do */ }
};

/** @returns {Promise<'sent'|'not_configured'|'failed'>} — the link is only ever delivered by email */
const deliverResetEmail = async (user, resetUrl) => {
  try {
    const emailSent = await sendResetEmail(user, resetUrl);
    if (!emailSent) {
      // The reset link/token is never printed or returned - configure an email provider to receive it.
      console.warn('Password reset requested but no usable email provider/sender is configured (RESEND_API_KEY + EMAIL_FROM, or EMAIL_USER/EMAIL_PASS) - no email was sent.');
      await discardResetToken(user);
      return 'not_configured';
    }
    return 'sent';
  } catch (emailError) {
    console.error('Reset email send failed:', emailError.message);
    await discardResetToken(user);
    return 'failed';
  }
};

// Everything that depends on whether the account exists runs AFTER the response has been sent, so a registered and an unknown
// address take the same time to answer. Nothing here can throw to the caller; failures are logged without tokens or links.
const processForgotPassword = async (email) => {
  try {
    const user = await User.findOne({ email });
    if (!user) return;
    if (user.isActive === false) return; // deactivated accounts are never e-mailed (the public answer stays the same)
    const reset = await issueResetToken(user, { cooldown: true });
    if (!reset) return; // a link was already sent within the last two minutes
    await reset.deliver();
  } catch (error) {
    console.error('Forgot password processing failed:', error && error.message);
  }
};

const forgotPassword = async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (!email || email.length > 254) {
    return res.status(400).json({ success: false, message: 'Please enter your email address.' });
  }
  res.json(GENERIC_RESET_RESPONSE);
  await processForgotPassword(email);
};

const INVALID_RESET = { success: false, message: 'Invalid or expired reset token.' };
const resetPassword = async (req, res) => {
  try {
    const raw = String(req.params.token || '');
    if (!raw || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return res.status(400).json(INVALID_RESET); // issued tokens are 64 hex characters
    const hashedToken = crypto.createHash('sha256').update(raw).digest('hex');
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user || user.isActive === false) {
      return res.status(400).json(INVALID_RESET);
    }

    const { password } = req.body || {};
    const pwProblem = passwordProblem(password);
    if (pwProblem) return res.status(400).json({ success: false, code: 'INVALID_PASSWORD', field: 'password', message: pwProblem });

    // Single use, even for two simultaneous requests: only the request that atomically removes the token may continue.
    const claimed = await User.findOneAndUpdate(
      { _id: user._id, resetPasswordToken: hashedToken, resetPasswordExpire: { $gt: Date.now() } },
      { $unset: { resetPasswordToken: 1, resetPasswordExpire: 1 } },
    );
    if (!claimed) return res.status(400).json(INVALID_RESET);

    user.password = password; // hashed by the User model's pre-save hook (bcrypt, 12 rounds)
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save();

    // A new password signs the account out everywhere (any device that had the old one), then starts ONE new session here
    await sessions.endAllSessions(user._id, 'password_reset');
    if (signInBlockReason(user)) return res.json({ success: true, message: 'Password reset successful! Please sign in.' });
    const { token } = await sessions.startSession(user, req);
    res.json({ success: true, message: 'Password reset successful!', token });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { register, login, takeoverSession, cancelSessionTakeover, logout, getSessionStatus, getMe, updateStandard, updateProfile, forgotPassword, resetPassword, issueResetToken, RESET_TTL_MS, RESET_COOLDOWN_MS };

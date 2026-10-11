const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Resend } = require('resend');
const User = require('../models/User');
const { Notification } = require('../models/index');
const { getPrimaryClientUrl } = require('../config/clientUrls');
const identity = require('../services/identity');
const { parseStudentStandard, standardLabel } = require('../constants/standards');

// Two ways to actually send the reset email, both optional so the server
// still boots before either is configured (forgotPassword then sends nothing
// and never returns the reset link - see forgotPassword below):
//
// 1) Gmail/SMTP via nodemailer - works out of the box for ANY recipient
//    using a Google "App Password", no domain needed. Preferred when set.
// 2) Resend - nicer for production, but without a verified domain it can
//    only deliver to the email address the Resend account was created with.
const smtpTransporter = (process.env.EMAIL_USER && process.env.EMAIL_PASS)
  ? nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com',
      port: Number(process.env.EMAIL_PORT) || 587,
      secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    })
  : null;

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const RESEND_FROM = process.env.RESEND_FROM_EMAIL || 'LearnIQ <onboarding@resend.dev>';

const buildResetEmailHtml = (name, resetUrl) => `
  <div style="font-family: Arial, sans-serif; max-width: 480px; margin: 0 auto;">
    <h2 style="color: #1a1a2e;">Reset your password</h2>
    <p>Hi ${name || 'there'},</p>
    <p>We received a request to reset your LearnIQ password. Click the button below to choose a new one. This link expires in 15 minutes.</p>
    <p style="margin: 24px 0;">
      <a href="${resetUrl}" style="background: #8B03ED; color: #fff; padding: 12px 24px; border-radius: 8px; text-decoration: none; font-weight: bold;">Reset Password</a>
    </p>
    <p>If you didn't request this, you can safely ignore this email.</p>
    <p style="color: #888; font-size: 12px;">If the button doesn't work, copy and paste this link: ${resetUrl}</p>
  </div>
`;

// Sends the reset email through whichever provider is configured.
// Returns true if an email was actually sent, false if neither is set up.
const sendResetEmail = async (user, resetUrl) => {
  if (smtpTransporter) {
    await smtpTransporter.sendMail({
      from: process.env.EMAIL_FROM || `LearnIQ <${process.env.EMAIL_USER}>`,
      to: user.email,
      subject: 'Reset your LearnIQ password',
      html: buildResetEmailHtml(user.name, resetUrl),
    });
    return true;
  }
  if (resend) {
    await resend.emails.send({
      from: RESEND_FROM,
      to: user.email,
      subject: 'Reset your LearnIQ password',
      html: buildResetEmailHtml(user.name, resetUrl),
    });
    return true;
  }
  return false;
};

// Every token is tied to a server-side session (services/authSessions.js): one active session per account.
const sessions = require('../services/authSessions');

/** Same rules for a password login and for "Log out other device & continue". null = allowed. */
const signInBlockReason = (user) => {
  if (!user.isActive) return 'Your account has been deactivated.';
  if (user.role === 'teacher' && !user.isApproved) return 'Your teacher account is pending approval.';
  return null;
};

const sendAuthError = (res, e, fallback) => {
  if (e instanceof sessions.AuthError) return res.status(e.status).json({ success: false, code: e.code, message: e.message });
  console.error(fallback, e && e.message);
  return res.status(500).json({ success: false, message: 'Server error. Please try again.' });
};

// @desc   Register user
// @route  POST /api/auth/register
const register = async (req, res) => {
  try {
    const { name, email, password, role, phone } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ success: false, message: 'Name, email and password are required.' });
    }

    // Password strength
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters with uppercase, lowercase, and number.',
      });
    }

    // Canonical identity values (the same ones the unique indexes are built on)
    const emailNormalized = identity.normalizeEmail(email);
    if (!emailNormalized) {
      return res.status(400).json({ success: false, code: 'INVALID_EMAIL', field: 'email', message: identity.MESSAGES.INVALID_EMAIL });
    }
    const phoneInfo = identity.normalizePhone(phone);
    if (!phoneInfo.empty && !phoneInfo.valid) {
      return res.status(400).json({ success: false, code: 'INVALID_PHONE', field: 'phone', message: identity.MESSAGES.INVALID_PHONE });
    }
    const phoneNormalized = phoneInfo.valid ? phoneInfo.e164 : undefined;

    // Friendly pre-check across ALL roles (one shared collection). The unique indexes below remain the final authority.
    const conflict = identity.conflictBody(await identity.findIdentityConflicts(User, { email: emailNormalized, phoneNormalized }));
    if (conflict) return res.status(409).json(conflict);

    const validRole = ['student', 'teacher'].includes(role) ? role : 'student';
    const isApproved = validRole !== 'teacher'; // teachers need admin approval

    let user;
    try {
      user = await User.create({
        name,
        email: emailNormalized,
        password,
        role: validRole,
        phone: phoneInfo.valid ? phone.toString().trim() : '',
        phoneNormalized,
        isApproved,
      });
    } catch (createError) {
      // Two simultaneous registrations can both pass the pre-check; MongoDB lets only one of them in.
      const raced = identity.conflictsFromDuplicateKeyError(createError);
      if (raced) return res.status(409).json(identity.conflictBody(raced));
      throw createError;
    }

    // Welcome notification
    await Notification.create({
      recipient: user._id,
      title: 'Welcome to Learniq! 🎉',
      message: `Hi ${name}, welcome to Learniq! Start your learning journey today.`,
      type: 'success',
    });

    // a brand-new account has no other session; startSession still goes through the one-active-session index
    const { token } = await sessions.startSession(user, req);

    res.status(201).json({
      success: true,
      message: validRole === 'teacher' ? 'Registration successful! Awaiting admin approval.' : 'Registration successful!',
      token,
      user: user.toJSON(),
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ success: false, message: 'Server error during registration.' });
  }
};

// @desc   Login user
// @route  POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    // Same canonical form as registration (trimmed + lower-cased), so " Student@Example.com " still finds the account
    const loginEmail = identity.normalizeEmail(email);
    const user = loginEmail ? await User.findOne({ email: loginEmail }) : null;
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const blocked = signInBlockReason(user);
    if (blocked) {
      return res.status(401).json({ success: false, message: blocked });
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

/**
 * Stores a fresh hashed token on the user and returns `{ deliver }`. The emailed link lives only inside that closure —
 * it is not a property of the user document, the return value or any log line.
 */
const issueResetToken = async (user) => {
  const resetToken = crypto.randomBytes(32).toString('hex');
  user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
  user.resetPasswordExpire = Date.now() + RESET_TTL_MS;
  await user.save({ validateBeforeSave: false });
  const resetUrl = `${getPrimaryClientUrl()}/reset-password/${resetToken}`;
  return { deliver: () => deliverResetEmail(user, resetUrl) };
};

const discardResetToken = async (user) => {
  try {
    user.resetPasswordToken = undefined;
    user.resetPasswordExpire = undefined;
    await user.save({ validateBeforeSave: false });
  } catch (cleanupError) { /* nothing more to do */ }
};

/** @returns {Promise<'sent'|'not_configured'|'failed'>} — the link is only ever delivered by email */
const deliverResetEmail = async (user, resetUrl) => {
  try {
    const emailSent = await sendResetEmail(user, resetUrl);
    if (!emailSent) {
      // The reset link/token is never printed or returned - configure an email provider to receive it.
      console.warn('Password reset requested but no email provider is configured (EMAIL_USER/EMAIL_PASS or RESEND_API_KEY) - no email was sent.');
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

const forgotPassword = async (req, res) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email) {
      return res.status(400).json({ success: false, message: 'Please enter your email address.' });
    }

    const user = await User.findOne({ email });
    if (!user) return res.json(GENERIC_RESET_RESPONSE);

    const reset = await issueResetToken(user);

    // Sent in the background so the response time does not reveal whether the account exists.
    // Failures are logged (without the token/link) and the unusable token is discarded.
    reset.deliver().catch(() => { /* already handled inside */ });

    return res.json(GENERIC_RESET_RESPONSE);
  } catch (error) {
    console.error('Forgot password error:', error.message);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// @desc   Reset password
// @route  POST /api/auth/reset-password/:token
const resetPassword = async (req, res) => {
  try {
    const hashedToken = crypto.createHash('sha256').update(req.params.token).digest('hex');
    const user = await User.findOne({
      resetPasswordToken: hashedToken,
      resetPasswordExpire: { $gt: Date.now() },
    });

    if (!user) {
      return res.status(400).json({ success: false, message: 'Invalid or expired reset token.' });
    }

    const { password } = req.body;
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    if (!passwordRegex.test(password)) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 8 characters with uppercase, lowercase, and number.',
      });
    }

    user.password = password;
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

module.exports = { register, login, takeoverSession, cancelSessionTakeover, logout, getSessionStatus, getMe, updateStandard, updateProfile, forgotPassword, resetPassword, issueResetToken, RESET_TTL_MS };

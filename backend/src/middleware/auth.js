const { authenticate } = require('../services/authSessions');

const bearer = (req) => (req.headers.authorization && req.headers.authorization.startsWith('Bearer') ? req.headers.authorization.split(' ')[1] : null);

/**
 * Valid JWT + ACTIVE server-side session (services/authSessions.js). A token whose session was ended - logout,
 * "logged in on another device", password reset, expiry/inactivity - gets 401 with a `code` the frontend uses to explain
 * why it returned to the login page.
 */
const protect = async (req, res, next) => {
  const token = bearer(req) || (req.cookies && req.cookies.token) || null;
  if (!token) {
    return res.status(401).json({ success: false, code: 'NO_TOKEN', message: 'Not authorized. No token provided.' });
  }
  let auth;
  try {
    auth = await authenticate(token);
  } catch (error) {
    if (error && error.status === 401) return res.status(401).json({ success: false, code: error.code, message: error.message });
    // database trouble is not the user's fault: do not answer 401 (that would sign everybody out during a blip)
    console.error('Auth check failed:', error && error.message);
    return res.status(503).json({ success: false, code: 'AUTH_UNAVAILABLE', message: 'Please try again in a moment.' });
  }
  req.user = auth.user;
  req.authSession = auth.session;
  // A temporary password chosen by an admin must be replaced first: only the account endpoints needed to do that stay open.
  if (req.user.mustChangePassword === true && !/^\/api\/auth\/(change-password|me|logout|session)/.test(String(req.originalUrl || '').split('?')[0])) {
    return res.status(403).json({ success: false, code: 'PASSWORD_CHANGE_REQUIRED', message: 'Please set a new password before continuing.' });
  }
  return next();
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Role '${req.user && req.user.role}' is not authorized to access this resource.`,
      });
    }
    // A teacher may only use teacher-protected APIs once an admin has approved the account.
    // role/isApproved come from the user protect() loaded from the database on THIS request (never from the
    // request body/query/headers), so an existing token starts working the moment an admin approves the teacher.
    if (req.user.role === 'teacher' && req.user.isApproved !== true) {
      return res.status(403).json({
        success: false,
        code: 'TEACHER_NOT_APPROVED',
        message: 'Teacher account is awaiting admin approval.',
      });
    }
    next();
  };
};

/** Like protect, but a missing / ended session simply means "anonymous". */
const optionalAuth = async (req, res, next) => {
  const token = bearer(req);
  if (token) {
    try {
      const { user, session } = await authenticate(token);
      req.user = user;
      req.authSession = session;
    } catch (e) { /* anonymous */ }
  }
  next();
};

module.exports = { protect, authorize, optionalAuth };

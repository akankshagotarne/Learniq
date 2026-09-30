// Single source of truth for which browser origins may call the API (Express AND Socket.IO).
//  - production: only CLIENT_URL (comma-separated list allowed) + CORS_EXTRA_ORIGINS
//  - development: the above plus the usual localhost dev servers
//  - anything else is rejected — never reflected back, never '*'
const { clean, getClientUrls } = require('./clientUrls');

const DEV_ORIGINS = [
  'http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000',
  'http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'http://127.0.0.1:3000',
];

const getAllowedOrigins = () => {
  const extra = String(process.env.CORS_EXTRA_ORIGINS || '').split(',').map(clean).filter(Boolean);
  const list = [...getClientUrls(), ...extra];
  if (process.env.NODE_ENV !== 'production') list.push(...DEV_ORIGINS);
  return list.map((o) => o.toLowerCase());
};

// No Origin header = not a browser cross-origin call (curl, server-to-server, Razorpay webhook, health checks).
const isOriginAllowed = (origin) => {
  if (!origin) return true;
  return getAllowedOrigins().includes(clean(origin).toLowerCase());
};

const corsOptions = {
  origin: (origin, callback) => callback(null, isOriginAllowed(origin)), // false => no CORS headers, browser blocks it
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};

const socketCorsOptions = {
  origin: (origin, callback) => callback(null, isOriginAllowed(origin)),
  methods: ['GET', 'POST'],
  credentials: true,
};

// Socket.IO: also refuse the connection itself (websocket upgrades are not covered by CORS headers)
const socketAllowRequest = (req, callback) => callback(null, isOriginAllowed(req.headers.origin));

// Browser requests from a foreign origin get a clear 403 instead of being processed.
// (Same-origin calls — Origin host equals this server's own Host — are always fine.)
const rejectDisallowedOrigins = (req, res, next) => {
  const origin = req.headers.origin;
  if (!origin || isOriginAllowed(origin)) return next();
  try { if (new URL(origin).host === req.headers.host) return next(); } catch { /* malformed Origin -> rejected below */ }
  return res.status(403).json({ success: false, message: 'Origin not allowed.' });
};

module.exports = { isOriginAllowed, getAllowedOrigins, corsOptions, socketCorsOptions, socketAllowRequest, rejectDisallowedOrigins };

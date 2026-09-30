// Signed, expiring links for PAID lecture videos / note PDFs stored under /uploads/videos and /uploads/pdfs.
//
//  - The API only hands a file URL to a user who is allowed to see it (see contentAccess.js) and appends a short-lived
//    signature:  /uploads/videos/123.mp4?mt=<expiry>.<hmac>
//  - server.js runs guardPrivateUploads() before express.static: a gated file WITHOUT a valid signature is refused (403).
//  - Everything else under /uploads (avatars, course thumbnails, free lecture files, ...) stays public exactly as before.
//  - A <video>/<a href> tag cannot send an Authorization header, which is why the signature travels in the URL.
const crypto = require('crypto');
const path = require('path');
const rateLimit = require('express-rate-limit');

const GATED_PREFIXES = ['/uploads/videos/', '/uploads/pdfs/'];

const ttlMs = () => {
  const minutes = Number(process.env.MEDIA_URL_TTL_MINUTES);
  return (minutes > 0 ? minutes : 360) * 60 * 1000;
};

// Key derived from JWT_SECRET so a media signature can never be replayed as a login token (and vice versa).
const signingKey = () => (process.env.JWT_SECRET
  ? crypto.createHash('sha256').update(`learniq-media-url:${process.env.JWT_SECRET}`).digest()
  : null);

const isGatedPath = (p) => typeof p === 'string' && GATED_PREFIXES.some((prefix) => p.toLowerCase().startsWith(prefix));

const mac = (key, filePath, exp) => crypto.createHmac('sha256', key).update(`${filePath}|${exp}`).digest('hex');

const createMediaToken = (filePath, now = Date.now()) => {
  const key = signingKey();
  if (!key) return null; // no secret configured -> fail closed
  const exp = now + ttlMs();
  return `${exp}.${mac(key, filePath, exp)}`;
};

const verifyMediaToken = (filePath, token, now = Date.now()) => {
  const key = signingKey();
  if (!key || typeof token !== 'string') return false;
  const [expRaw, sig] = token.split('.');
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp < now || !sig) return false;
  const expected = Buffer.from(mac(key, filePath, exp), 'hex');
  const given = Buffer.from(sig, 'hex');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
};

// "/uploads/videos/x.mp4" -> "/uploads/videos/x.mp4?mt=..." ; external URLs (YouTube, CDN...) and other paths are returned as-is.
const signMediaUrl = (url) => {
  if (!isGatedPath(url)) return url;
  const clean = url.split('?')[0];
  const token = createMediaToken(clean);
  return token ? `${clean}?mt=${token}` : null;
};

const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Only unsigned requests reach the database, so cap them (signed video range-requests never hit this).
const lookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests. Please try again later.' },
});

// Express middleware, mounted at app.use('/uploads', ...) BEFORE express.static.
const guardPrivateUploads = ({ Lecture, Note }) => (req, res, next) => {
  let rel;
  try { rel = decodeURIComponent(req.path); } catch { return res.status(400).json({ success: false, message: 'Bad request.' }); }
  if (rel.includes('\0') || rel.includes('\\') || rel.split('/').includes('..')) {
    return res.status(400).json({ success: false, message: 'Bad request.' });
  }
  // collapse '//' and './' so /uploads//videos/x.mp4 cannot slip past the prefix check (express.static normalises it too)
  const full = path.posix.normalize(`/uploads/${rel}`);
  if (!isGatedPath(full)) return next(); // avatars, doubts, support, assignments, ... unchanged

  if (req.query.mt && verifyMediaToken(full, String(req.query.mt))) return next();

  return lookupLimiter(req, res, async () => {
    try {
      // Case-insensitive on purpose: Windows/macOS file systems ignore case, so /Videos/X.MP4 must not bypass the check.
      const exact = new RegExp(`^${escapeRegExp(full)}$`, 'i');
      const [lectures, notes] = await Promise.all([
        Lecture.find({ $or: [{ videoPath: exact }, { videoUrl: exact }] }).select('isFree').lean(),
        Note.find({ $or: [{ filePath: exact }, { fileUrl: exact }] }).select('isFree').lean(),
      ]);
      const gated = lectures.some((l) => !l.isFree) || notes.some((n) => !n.isFree);
      if (gated) {
        return res.status(403).json({ success: false, message: 'This lesson is for enrolled students. Please sign in and enroll to watch it.' });
      }
      return next(); // free lecture/note, course thumbnail, or a file that is not lecture content
    } catch (err) {
      console.error('Upload access check failed:', err.message);
      return res.status(503).json({ success: false, message: 'Could not verify access. Please try again.' }); // fail closed
    }
  });
};

module.exports = { isGatedPath, createMediaToken, verifyMediaToken, signMediaUrl, guardPrivateUploads, GATED_PREFIXES };

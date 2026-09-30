require('dotenv').config();
const { validateEnv } = require('./config/validateEnv');
// Production must not boot with a missing/placeholder JWT secret (values are never printed)
if (!validateEnv().ok) process.exit(1);

const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const connectDB = require('./config/db');
const { corsOptions, socketCorsOptions, socketAllowRequest, rejectDisallowedOrigins } = require('./config/cors');
const { getPrimaryClientUrl } = require('./config/clientUrls');
const { getTrustProxySetting } = require('./config/trustProxy');
const { guardPrivateUploads } = require('./services/mediaAccess');
const Lecture = require('./models/Lecture');
const Note = require('./models/Note');
const setupSocket = require('./services/socketService');
const { getRazorpayStatus } = require('./services/razorpayClient');

// Routes
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const teacherRoutes = require('./routes/teacher');
const adminRoutes = require('./routes/admin');
const miscRoutes = require('./routes/misc');
const examRoutes = require('./routes/exams');
const olympiadRoutes = require('./routes/olympiad');
const certificateRoutes = require('./routes/certificates');
const { startOlympiadSweeper } = require('./controllers/olympiadController');
const { startPaymentReconciler } = require('./services/paymentReconciler');

const app = express();
const server = http.createServer(app);

// Render sits behind a reverse proxy: trust an exact number of hops (1) — never `true` — so req.ip is the real client
// address and express-rate-limit can key on it. Must be set before any middleware that reads req.ip (see config/trustProxy.js).
app.set('trust proxy', getTrustProxySetting());

// Allowed browser origins: CLIENT_URL (+ CORS_EXTRA_ORIGINS, + localhost when not in production) — see config/cors.js
// Socket.IO
const io = new Server(server, {
  cors: socketCorsOptions,
  allowRequest: socketAllowRequest,
  transports: ['websocket', 'polling'],
});

// Security
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS — only the configured frontend origin(s); other browser origins get no CORS headers and a 403 on /api
app.use('/api', rejectDisallowedOrigins);
app.use(cors(corsOptions));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { success: false, message: 'Too many requests. Please try again later.' },
  // Olympiad answer auto-save has its own per-student limiter (a whole class can share one school IP)
  skip: (req) => req.method === 'PUT' && /^\/olympiad\/exams\/[^/]+\/attempt\/answers/.test(req.path),
});
app.use('/api', limiter);

// Body parsing
// rawBody is kept so the Razorpay webhook signature can be verified against the exact bytes received
app.use(express.json({ limit: '50mb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));

// Static files (uploads)
// Paid lecture videos / PDFs (/uploads/videos, /uploads/pdfs) need a signed link issued by the API to enrolled users;
// avatars, thumbnails, free lecture files and all other uploads are served exactly as before.
app.use('/uploads', guardPrivateUploads({ Lecture, Note }), express.static(path.join(__dirname, '../uploads')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  const isConnected = mongoose.connection.readyState === 1;
  res.json({
    success: true,
    server: 'running',
    database: isConnected ? 'connected' : 'disconnected',
    // non-secret: only whether RAZORPAY_KEY_ID/RAZORPAY_KEY_SECRET are set, and test/live mode
    payments: getRazorpayStatus(),
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/olympiad', olympiadRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api', miscRoutes);

// 404
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.path} not found.` });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? 'Internal server error.' : err.message,
  });
});

// Setup Socket.IO
setupSocket(io);

const PORT = process.env.PORT || 5000;

// Cleanly handle port conflicts (EADDRINUSE)
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`\n==================================================`);
    console.log(`⚠️  Backend is already running on port ${PORT}.`);
    console.log(`==================================================`);
    console.log(`An active instance of the Learniq backend is already running on port ${PORT}.`);
    console.log(`You do not need to start another backend instance.`);
    console.log(`\nTo stop the existing backend process if you wish to restart:`);
    console.log(`  PowerShell: Stop-Process -Id (Get-NetTCPConnection -LocalPort ${PORT}).OwningProcess -Force`);
    console.log(`  Or run:     npx kill-port ${PORT}`);
    console.log(`==================================================\n`);
    process.exit(0);
  } else {
    console.error('❌ Server startup error:', err.message);
    process.exit(1);
  }
});

// Connect to MongoDB first, then start listening
const startServer = async () => {
  try {
    await connectDB();
    startOlympiadSweeper(); // auto-submits Olympiad attempts whose timer has expired
    // Payments never stay PENDING: ~5 minutes after checkout the server asks Razorpay and finalises the record
    const reconciler = startPaymentReconciler();
    console.log(reconciler.started ? '🔁 Payment reconciler: running (every 60 s, first check ~5 min after checkout)' : `⚠️  Payment reconciler NOT running: ${reconciler.reason}`);
    // Make sure the Standard 9 and Standard 10 Olympiad exams exist (no-op when they are already there)
    require('./seed/seedOlympiadAll')({ ifMissing: true })
      .then(({ exams }) => exams.forEach((e) => console.log(`🏆 Olympiad exam ready (Std ${e.standard}): ${e.title}`)))
      .catch((err) => console.error('⚠️  Olympiad auto-seed skipped:', err.message));
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 Client URL: ${getPrimaryClientUrl()}`);
      const proxyHops = app.get('trust proxy');
      console.log(`🔀 Trust proxy: ${proxyHops ? `${proxyHops} hop(s)` : 'off (no reverse proxy)'}`);
      const rzp = getRazorpayStatus();
      console.log(rzp.configured
        ? `💳 Razorpay: configured (${rzp.mode} mode)`
        : '⚠️  Razorpay: NOT configured — set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the backend environment');
    });
  } catch (error) {
    console.error('Startup error:', error.message);
    process.exit(1);
  }
};

startServer();

module.exports = { app, server };

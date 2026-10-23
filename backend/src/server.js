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
const referralRoutes = require('./routes/referrals');
const mentorReferralRoutes = require('./routes/mentorReferrals');
const interviewRoutes = require('./routes/interviews');
const engineeringRoutes = require('./routes/engineering');
const certificateRoutes = require('./routes/certificates');
const aiInterviewRoutes = require('./routes/aiInterviews');
const proctoringRoutes = require('./routes/proctoring');
const { startOlympiadSweeper } = require('./controllers/olympiadController');
const { startExamSweeper } = require('./services/examAttempts');
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
// AI Interview bodies are tiny (a transcript of at most a few hundred characters): cap them at 8kb BEFORE the global 50mb parser
app.use('/api/ai-interviews', express.json({ limit: '8kb', verify: (req, res, buf) => { req.rawBody = buf; } }));
app.use('/api/proctoring', express.json({ limit: '64kb' })); // events + an answers snapshot only
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
app.get('/api/profile-photos/:userId', require('./controllers/profileController').servePhoto); // a profile picture is public, like on any site
app.use('/api/auth', authRoutes);
app.use('/api/student-transactions', require('./routes/studentTransactions')); // student Payments & Transactions + PDF receipts
app.use('/api', apiRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/exams', examRoutes);
app.use('/api/olympiad', olympiadRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/mentor-referrals', mentorReferralRoutes);   // mentor referral TRACKING (never any credits)
app.use('/api/interviews', interviewRoutes); // teacher-led interviews (separate from the AI interview)
app.use('/api/engineering', engineeringRoutes);
app.use('/api/certificates', certificateRoutes);
app.use('/api/ai-interviews', aiInterviewRoutes);
app.use('/api/proctoring', proctoringRoutes);
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
require('./services/interviewSocket')(io); // private 1:1 interview rooms (signalling only)

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

// The unique indexes are what makes "one email / one phone per account" hold under concurrent sign-ups. Mongoose builds them on
// connect; this waits for that and says LOUDLY if it failed (typically: existing duplicate data - run scripts/auditUserIdentities.js).
const verifyUserIndexes = async () => {
  const User = require('./models/User');
  try {
    const { present, dropped } = await require('./services/identity').migrateEmailIndex(User);
    const missing = ['uniq_email', 'uniq_phoneNormalized'].filter((n) => !present.includes(n));
    if (missing.length) throw new Error(`missing index(es): ${missing.join(', ')}`);
    console.log(`🔒 User uniqueness indexes verified: uniq_email, uniq_phoneNormalized${dropped ? ' (replaced the old email_1 index)' : ''}`);
  } catch (err) {
    console.error(`🚨 User uniqueness index check FAILED (${err.message}). New sign-ups are NOT fully protected against duplicates at the database level until this is fixed — run: node src/scripts/auditUserIdentities.js`);
  }
};

// Accounts created before the identity rules have a `phone` but no canonical `phoneNormalized`. Fill it in - only where the number is
// valid and used by no other account (idempotent; never edits `phone`, never deletes or merges). Phone login also copes without it.
const backfillLegacyPhones = async () => {
  try {
    const r = await require('./services/identity').backfillPhoneNormalized(require('./models/User'));
    console.log(`📞 Phone identities: ${r.filled} legacy account(s) filled, ${r.shared} shared number(s) left as is, ${r.invalid} invalid left as is (of ${r.scanned} with a phone)`);
  } catch (err) {
    console.error(`⚠️  Phone identity backfill skipped (${err.message}). Phone login still works for legacy accounts.`);
  }
};

// "One active login per account" is enforced by a partial unique index on AuthSession (models/AuthSession.js).
const verifySessionIndexes = async () => {
  const { AuthSession, SessionTakeover } = require('./models/AuthSession');
  try {
    await Promise.all([AuthSession.init(), SessionTakeover.init()]);
    const names = (await AuthSession.collection.indexes()).map((i) => i.name);
    const missing = ['uniq_sid', 'one_active_session_per_user'].filter((n) => !names.includes(n));
    if (missing.length) throw new Error(`missing index(es): ${missing.join(', ')}`);
    console.log('🔒 Session indexes verified: one active session per account');
  } catch (err) {
    console.error(`🚨 Session index check FAILED (${err.message}). Simultaneous sign-ins are NOT guaranteed to be single-session until this is fixed.`);
  }
};

// Connect to MongoDB first, then start listening
const startServer = async () => {
  try {
    await connectDB();
    await verifyUserIndexes();
    await backfillLegacyPhones();
    await verifySessionIndexes();
    // Certificates: add the type-aware unique indexes BEFORE anything can issue a second certificate type (additive; deletes nothing)
    try {
      const m = await require('./services/certificateMigration').migrateCertificateIndexes(require('./models/Certificate').Certificate);
      console.log(`🎓 Certificate indexes ready (${m.backfilled} legacy certificate(s) typed RESULT, ${m.dropped} old index(es) replaced)`);
    } catch (err) {
      console.error(`🚨 Certificate index migration FAILED (${err.message}). Participation certificates will not be issued until this is fixed.`);
    }
    // Split Exam / Interview entitlements: replace the one-per-exam unique indexes with component-aware ones (additive; rewrites no payment)
    try {
      const m = await require('./services/componentMigration').migrateComponentIndexes({ ...require('./models/Olympiad'), ...require('./models/ExamAccess') });
      console.log(`💳 Component entitlement indexes ready (${m.dropped} old index(es) replaced)`);
    } catch (err) {
      console.error(`🚨 Component index migration FAILED (${err.message}). A second component of the same exam cannot be bought until this is fixed.`);
    }
    const cs = require('./services/certificateRelease').startCertificateSweeper(); // 18 Oct 2026 6:00 PM IST release + certificate generation (persistent: state is in the database)
    console.log(cs.started ? '📜 Certificate release sweeper: running (every 60 s)' : `⚠️  Certificate release sweeper NOT running: ${cs.reason}`);
    startOlympiadSweeper(); // auto-submits Olympiad attempts whose timer has expired
    require('./services/interviews').startInterviewSweeper(); // frees stale interview sessions (nobody present for INTERVIEW_STALE_MINUTES)
    startExamSweeper(); // same for teacher exams (server-owned deadline)
    // Payments never stay PENDING: ~5 minutes after checkout the server asks Razorpay and finalises the record
    const reconciler = startPaymentReconciler();
    console.log(reconciler.started ? '🔁 Payment reconciler: running (every 60 s, first check ~5 min after checkout)' : `⚠️  Payment reconciler NOT running: ${reconciler.reason}`);
    // Interview reminders: only ever sent through a configured provider (Twilio env vars); otherwise nothing is sent or marked sent
    const rem = require('./services/interviewSchedule').startReminderWorker();
    const remProv = require('./services/reminderProvider').status();
    console.log(rem.started
      ? `⏰ Interview reminders: worker running; WhatsApp ${remProv.configured.whatsapp ? 'configured' : 'NOT configured'}, SMS ${remProv.configured.sms ? 'configured' : 'NOT configured'} (unconfigured = no automated reminders)`
      : `⚠️  Interview reminder worker NOT running: ${rem.reason}`);
    // Exam window: only FILLS a missing startDate/endDate from the event calendar; an administrator's saved window is never changed (OLYMPIAD_WINDOW_SYNC=force is the explicit reset)
    require('./services/olympiadSchedule').syncOlympiadWindow()
      .catch((err) => console.error('⚠️  Olympiad window sync skipped:', err.message));
    // Make sure the Standard 9 and Standard 10 Olympiad exams exist (no-op when they are already there)
    require('./seed/seedOlympiadAll')({ ifMissing: true })
      .then(async ({ exams }) => {
        // existing exams keep their questions/marks/etc.; only the display TITLE is brought to "LearnIQ Practice Test – Nth Standard"
        const t = await require('./seed/olympiadTitles').syncOlympiadTitles(require('./models/Olympiad').OlympiadExam);
        if (t.renamed) console.log(`🏷️  Olympiad exam titles updated: ${t.renamed} renamed`);
        const fresh = await require('./models/Olympiad').OlympiadExam.find({ slug: { $in: exams.map((e) => e.slug) } }).select('standard title');
        fresh.forEach((e) => console.log(`🏆 Olympiad exam ready (Std ${e.standard}): ${e.title}`));
      })
      .catch((err) => console.error('⚠️  Olympiad auto-seed skipped:', err.message))
      // Olympiad EVENTS: associate the original exams with their event (additive, idempotent, never changes dates / questions / student records).
      // Anything not unambiguously part of the original Olympiad is only reported (see GET /api/olympiad/admin/events/migration-report). OLYMPIAD_EVENT_MIGRATION=off disables it.
      .then(() => (String(process.env.OLYMPIAD_EVENT_MIGRATION || '').toLowerCase() === 'off' ? null : require('./services/olympiadEvents').migrateLegacy({ apply: true })))
      .then((r) => { if (r && r.plan && r.plan.needsReview.length) console.warn(`⚠️  ${r.plan.needsReview.length} Olympiad exam(s) could not be associated with an event and need review (admin > Olympiad events migration report)`); })
      .catch((err) => console.error('⚠️  Olympiad event migration skipped:', err.message));
    // Make sure the free BE Engineering mock test exists (creates it only when missing; never overwrites admin changes)
    require('./services/engineering').ensureEngineeringExam()
      .then(({ exam, created, questionsAdded }) => console.log(`🎓 Engineering mock test ready: ${exam.title}${created ? ' (created)' : ''}${questionsAdded ? ` (+${questionsAdded} questions)` : ''}`))
      .catch((err) => console.error('⚠️  Engineering exam seed skipped:', err.message));
    // Auto-link Olympiad exams to their teacher (e.g. Nikhil Sir) in production
    require('./scripts/backfillOlympiadTeacher').run({ apply: true, log: () => {} })
      .catch((err) => console.error('⚠️  Olympiad teacher backfill skipped:', err.message));
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

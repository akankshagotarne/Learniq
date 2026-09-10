require('dotenv').config();
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
const setupSocket = require('./services/socketService');

// Routes
const authRoutes = require('./routes/auth');
const apiRoutes = require('./routes/api');
const teacherRoutes = require('./routes/teacher');
const adminRoutes = require('./routes/admin');
const miscRoutes = require('./routes/misc');
const examRoutes = require('./routes/exams');

const app = express();
const server = http.createServer(app);

// Dynamic origin verification supporting Vercel and Render deployments
const isOriginAllowed = (origin) => {
  if (!origin) return true;
  const cleanOrigin = origin.replace(/\/$/, '');
  const configuredClient = process.env.CLIENT_URL ? process.env.CLIENT_URL.replace(/\/$/, '') : null;
  
  if (configuredClient && cleanOrigin.toLowerCase() === configuredClient.toLowerCase()) {
    return true;
  }
  if (['http://localhost:5173', 'http://localhost:5174', 'http://localhost:3000', 'http://127.0.0.1:5173'].includes(cleanOrigin)) {
    return true;
  }
  try {
    const url = new URL(origin);
    if (url.hostname.endsWith('.vercel.app')) {
      return true;
    }
  } catch {}
  return false;
};

// Socket.IO
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      callback(null, isOriginAllowed(origin) ? true : origin);
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
  transports: ['websocket', 'polling'],
});

// Security
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// CORS
app.use(cors({
  origin: (origin, callback) => {
    callback(null, isOriginAllowed(origin) ? true : origin);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 1000,
  message: { success: false, message: 'Too many requests. Please try again later.' },
});
app.use('/api', limiter);

// Body parsing
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Logging
if (process.env.NODE_ENV !== 'production') app.use(morgan('dev'));

// Static files (uploads)
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Health check endpoint
app.get('/api/health', (req, res) => {
  const isConnected = mongoose.connection.readyState === 1;
  res.json({
    success: true,
    server: 'running',
    database: isConnected ? 'connected' : 'disconnected',
  });
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api', apiRoutes);
app.use('/api/teacher', teacherRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/exams', examRoutes);
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
    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🌐 Client URL: ${process.env.CLIENT_URL || 'http://localhost:5173'}`);
    });
  } catch (error) {
    console.error('Startup error:', error.message);
    process.exit(1);
  }
};

startServer();

module.exports = { app, server };

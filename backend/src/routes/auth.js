const express = require('express');
const router = express.Router();
const { register, login, takeoverSession, cancelSessionTakeover, logout, getSessionStatus, getMe, updateStandard, forgotPassword, resetPassword } = require('../controllers/authController');
const profile = require('../controllers/profileController');
const rateLimit = require('express-rate-limit');
const { protect } = require('../middleware/auth');
const { uploadProfilePhoto, handleMulterError } = require('../middleware/upload');

const perUser = (max, windowMs = 60 * 1000) => rateLimit({
  windowMs, max, standardHeaders: true, legacyHeaders: false,
  keyGenerator: (req) => (req.user ? String(req.user._id) : req.ip),
  message: { success: false, code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again.' },
});

router.post('/register', register);
router.post('/login', login);
// one active session per account (services/authSessions.js)
router.post('/session/takeover', takeoverSession);
router.post('/session/takeover/cancel', cancelSessionTakeover);
router.get('/session', protect, getSessionStatus);
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);
router.put('/standard', protect, updateStandard);
// Profile & settings (self-service: the account is always the signed-in one). PUT is kept as an alias of PATCH for older clients.
router.patch('/profile', protect, perUser(30), profile.updateOwnProfile);
router.put('/profile', protect, perUser(30), profile.updateOwnProfile);
router.post('/profile/email-change', protect, perUser(5, 15 * 60 * 1000), profile.requestEmailChange);
router.post('/verify-email-change', perUser(20, 15 * 60 * 1000), profile.verifyEmailChange);
router.post('/change-password', protect, perUser(5, 15 * 60 * 1000), profile.changePassword);
router.post('/profile/photo', protect, perUser(10), uploadProfilePhoto.single('photo'), handleMulterError, profile.uploadOwnPhoto);
router.delete('/profile/photo', protect, perUser(10), profile.removeOwnPhoto);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:token', resetPassword);

module.exports = router;

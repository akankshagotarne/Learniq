const express = require('express');
const router = express.Router();
const { register, login, takeoverSession, cancelSessionTakeover, logout, getSessionStatus, getMe, updateStandard, updateProfile, forgotPassword, resetPassword } = require('../controllers/authController');
const { protect } = require('../middleware/auth');
const { uploadAvatar } = require('../middleware/upload');

router.post('/register', register);
router.post('/login', login);
// one active session per account (services/authSessions.js)
router.post('/session/takeover', takeoverSession);
router.post('/session/takeover/cancel', cancelSessionTakeover);
router.get('/session', protect, getSessionStatus);
router.post('/logout', protect, logout);
router.get('/me', protect, getMe);
router.put('/standard', protect, updateStandard);
router.put('/profile', protect, uploadAvatar.single('avatar'), updateProfile);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password/:token', resetPassword);

module.exports = router;

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const User = require('../models/User');
const { Notification } = require('../models/index');

const generateToken = (id) => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRE || '7d' });

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

    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ success: false, message: 'Email is already registered.' });
    }

    const validRole = ['student', 'teacher'].includes(role) ? role : 'student';
    const isApproved = validRole !== 'teacher'; // teachers need admin approval

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password,
      role: validRole,
      phone: phone || '',
      isApproved,
    });

    // Welcome notification
    await Notification.create({
      recipient: user._id,
      title: 'Welcome to Learniq! 🎉',
      message: `Hi ${name}, welcome to Learniq! Start your learning journey today.`,
      type: 'success',
    });

    const token = generateToken(user._id);

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

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Invalid email or password.' });
    }

    if (!user.isActive) {
      return res.status(401).json({ success: false, message: 'Your account has been deactivated.' });
    }

    if (user.role === 'teacher' && !user.isApproved) {
      return res.status(401).json({ success: false, message: 'Your teacher account is pending approval.' });
    }

    user.lastLogin = new Date();
    await user.save({ validateBeforeSave: false });

    const token = generateToken(user._id);

    res.json({
      success: true,
      message: 'Login successful!',
      token,
      user: user.toJSON(),
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ success: false, message: 'Server error during login.' });
  }
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
    const { standard } = req.body;
    if (!standard || standard < 1 || standard > 10) {
      return res.status(400).json({ success: false, message: 'Standard must be between 1 and 10.' });
    }
    const user = await User.findByIdAndUpdate(req.user._id, { currentStandard: standard }, { new: true });
    res.json({ success: true, message: 'Standard updated!', user });
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
    if (phone) updateData.phone = phone;
    if (bio) updateData.bio = bio;
    if (experience) updateData.experience = experience;
    if (qualification) updateData.qualification = qualification;
    if (subjects) updateData.subjects = subjects;
    if (standards) updateData.standards = standards;
    if (req.file) updateData.avatar = `/uploads/avatars/${req.file.filename}`;

    const user = await User.findByIdAndUpdate(req.user._id, updateData, { new: true });
    res.json({ success: true, message: 'Profile updated!', user });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

// @desc   Forgot password
// @route  POST /api/auth/forgot-password
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      return res.status(404).json({ success: false, message: 'No account found with this email.' });
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = crypto.createHash('sha256').update(resetToken).digest('hex');
    user.resetPasswordExpire = Date.now() + 15 * 60 * 1000; // 15 min
    await user.save({ validateBeforeSave: false });

    // In production: send email with reset link
    // For demo: return the token directly
    const resetUrl = `${process.env.CLIENT_URL}/reset-password/${resetToken}`;

    res.json({
      success: true,
      message: 'Password reset link generated. (Configure email provider to send emails.)',
      resetUrl, // Demo only - remove in production
    });
  } catch (error) {
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

    const token = generateToken(user._id);
    res.json({ success: true, message: 'Password reset successful!', token });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { register, login, getMe, updateStandard, updateProfile, forgotPassword, resetPassword };

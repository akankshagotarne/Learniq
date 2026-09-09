const Razorpay = require('razorpay');
const crypto = require('crypto');
const { Payment, Enrollment, Notification } = require('../models/index');
const Course = require('../models/Course');
const Lecture = require('../models/Lecture');

const getRazorpayInstance = () => {
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_ID.startsWith('rzp_test_YOUR')) {
    return null; // Not configured
  }
  return new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET,
  });
};

// POST /api/payments/create-order
const createOrder = async (req, res) => {
  try {
    const { type, itemId } = req.body; // type: 'course' | 'lecture' | 'note'

    let basePrice = 0;
    let item = null;

    if (type === 'course') {
      item = await Course.findById(itemId);
      basePrice = item?.price || 0;
    } else if (type === 'lecture') {
      item = await Lecture.findById(itemId);
      basePrice = item?.price || 0;
    }

    if (!item) return res.status(404).json({ success: false, message: 'Item not found.' });
    if (basePrice === 0) return res.status(400).json({ success: false, message: 'This item is free.' });

    // Apply 20% Learniq scholarship discount
    const discount = Math.round(basePrice * 0.2);
    const finalAmount = Math.max(1, basePrice - discount);

    const razorpay = getRazorpayInstance();

    if (!razorpay) {
      return res.status(503).json({
        success: false,
        message: 'Razorpay is not configured on the server. Please check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in server environment.',
      });
    }

    const order = await razorpay.orders.create({
      amount: Math.round(finalAmount * 100), // paise
      currency: 'INR',
      notes: { student: req.user._id.toString(), type, itemId: itemId.toString() },
    });

    const payment = await Payment.create({
      student: req.user._id,
      [type]: itemId,
      amount: finalAmount,
      currency: 'INR',
      razorpayOrderId: order.id,
      status: 'pending',
      type,
    });

    res.json({
      success: true,
      order,
      paymentId: payment._id,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    console.error('Error creating payment order:', error);
    res.status(500).json({ success: false, message: error.message || 'Server error creating payment order.' });
  }
};

// POST /api/payments/verify
const verifyPayment = async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, paymentId } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature || !paymentId) {
      return res.status(400).json({ success: false, message: 'Missing required payment verification details.' });
    }

    const payment = await Payment.findById(paymentId);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found.' });

    if (payment.status === 'completed') {
      return res.json({ success: true, message: 'Payment already verified.', payment });
    }

    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret) {
      return res.status(500).json({ success: false, message: 'Razorpay secret key not configured on server.' });
    }

    // Cryptographic HMAC-SHA256 signature verification
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(`${razorpayOrderId}|${razorpayPaymentId}`)
      .digest('hex');

    if (expectedSignature !== razorpaySignature) {
      payment.status = 'failed';
      await payment.save();
      return res.status(400).json({ success: false, message: 'Payment verification failed: Invalid signature.' });
    }

    payment.razorpayPaymentId = razorpayPaymentId;
    payment.razorpaySignature = razorpaySignature;
    payment.status = 'completed';
    await payment.save();

    // Grant access
    if (payment.type === 'course') {
      const existing = await Enrollment.findOne({ student: payment.student, course: payment.course });
      if (!existing) {
        await Enrollment.create({ student: payment.student, course: payment.course });
        await Course.findByIdAndUpdate(payment.course, { $inc: { enrolledCount: 1 } });
      }
    }

    await Notification.create({
      recipient: payment.student,
      title: 'Payment Successful! ✅',
      message: `Your payment of ₹${payment.amount} was successful. Content is now accessible.`,
      type: 'payment',
    });

    res.json({ success: true, message: 'Payment verified and access granted!', payment });
  } catch (error) {
    console.error('Payment verification error:', error);
    res.status(500).json({ success: false, message: 'Server error verifying payment.' });
  }
};

// GET /api/payments/history
const getPaymentHistory = async (req, res) => {
  try {
    const payments = await Payment.find({ student: req.user._id })
      .populate('course', 'title')
      .populate('lecture', 'title')
      .sort({ createdAt: -1 });

    res.json({ success: true, payments });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

module.exports = { createOrder, verifyPayment, getPaymentHistory };

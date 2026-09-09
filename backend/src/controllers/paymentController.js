const Razorpay = require('razorpay');
const crypto = require('crypto');
const { Payment, Enrollment, Notification } = require('../models/index');
const Course = require('../models/Course');
const Lecture = require('../models/Lecture');

const getRazorpayInstance = () => {
  if (!process.env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID.startsWith('rzp_test_YOUR')) {
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

    let amount = 0;
    let item = null;

    if (type === 'course') {
      item = await Course.findById(itemId);
      amount = item?.price || 0;
    } else if (type === 'lecture') {
      item = await Lecture.findById(itemId);
      amount = item?.price || 0;
    }

    if (!item) return res.status(404).json({ success: false, message: 'Item not found.' });
    if (amount === 0) return res.status(400).json({ success: false, message: 'This item is free.' });

    const razorpay = getRazorpayInstance();

    if (!razorpay) {
      // Demo mode: simulate order creation
      const demoPayment = await Payment.create({
        student: req.user._id,
        [type]: itemId,
        amount,
        currency: 'INR',
        razorpayOrderId: 'demo_order_' + Date.now(),
        status: 'pending',
        type,
      });

      return res.json({
        success: true,
        isDemoMode: true,
        message: 'Demo mode: Razorpay not configured. Use RAZORPAY_KEY_ID in .env for real payments.',
        order: {
          id: demoPayment.razorpayOrderId,
          amount: amount * 100,
          currency: 'INR',
          paymentId: demoPayment._id,
        },
        keyId: 'demo_key',
      });
    }

    const order = await razorpay.orders.create({
      amount: amount * 100, // paise
      currency: 'INR',
      notes: { student: req.user._id.toString(), type, itemId },
    });

    const payment = await Payment.create({
      student: req.user._id,
      [type]: itemId,
      amount,
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
    res.status(500).json({ success: false, message: 'Server error creating payment order.' });
  }
};

// POST /api/payments/verify
const verifyPayment = async (req, res) => {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature, paymentId, isDemoMode } = req.body;

    const payment = await Payment.findById(paymentId);
    if (!payment) return res.status(404).json({ success: false, message: 'Payment not found.' });

    if (isDemoMode || process.env.NODE_ENV === 'development') {
      // Demo: mark as completed
      payment.razorpayPaymentId = razorpayPaymentId || 'demo_payment_' + Date.now();
      payment.status = 'completed';
      await payment.save();
    } else {
      // Real verification
      const expectedSignature = crypto
        .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
        .update(razorpayOrderId + '|' + razorpayPaymentId)
        .digest('hex');

      if (expectedSignature !== razorpaySignature) {
        payment.status = 'failed';
        await payment.save();
        return res.status(400).json({ success: false, message: 'Payment verification failed.' });
      }

      payment.razorpayPaymentId = razorpayPaymentId;
      payment.razorpaySignature = razorpaySignature;
      payment.status = 'completed';
      await payment.save();
    }

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

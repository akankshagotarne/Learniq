const crypto = require('crypto');
const mongoose = require('mongoose');
const {
  OlympiadExam, OlympiadQuestion, OlympiadPayment, OlympiadAttempt,
} = require('../models/Olympiad');
const { Notification } = require('../models/index');
const { getRazorpayInstance } = require('../services/razorpayClient');

/**
 * Paid Olympiad examination — all business rules live here on the server:
 * eligibility, availability window, payment verification, attempt policy, timer,
 * evaluation and answer-key protection. The frontend is treated as untrusted.
 *
 * Attempt policy: ONE verified payment = ONE attempt. Once submitted the attempt is
 * COMPLETED and can never be restarted. A paid-but-unstarted registration can be started
 * any time while the exam window is open.
 *
 * Timer policy: deadline = startedAt + duration, both computed on the server. An attempt
 * that is already running when the exam window closes may continue until its own deadline.
 */

const SAVE_GRACE_MS = 10 * 1000; // network-latency allowance around the deadline
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ──────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────
class ApiError extends Error {
  constructor(status, message, code, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const handler = (fn) => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    if (err instanceof ApiError) {
      return res.status(err.status).json({ success: false, message: err.message, code: err.code, ...err.extra });
    }
    console.error('[olympiad] unexpected error:', err);
    return res.status(500).json({
      success: false,
      code: 'SERVER_ERROR',
      message: 'Something went wrong on our side. Please try again in a moment.',
    });
  }
};

const isDuplicateKey = (err) => err && (err.code === 11000 || err.code === 11001);
const oid = (v) => String(v);

const windowState = (exam, now = new Date()) => {
  if (now < exam.startDate) return 'upcoming';
  if (now > exam.endDate) return 'closed';
  return 'open';
};

const loadExam = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(404, 'Examination not found.', 'EXAM_NOT_FOUND');
  const exam = await OlympiadExam.findOne({ _id: id, isPublished: true });
  if (!exam) throw new ApiError(404, 'Examination not found.', 'EXAM_NOT_FOUND');
  return exam;
};

// Admin views must be able to open EVERY exam (published or not) — only the student-facing loadExam hides unpublished ones.
// (Otherwise an unpublished exam is listed in the admin dropdown but its payments/results 404.)
const loadExamAdmin = async (id) => {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(404, 'Examination not found.', 'EXAM_NOT_FOUND');
  const exam = await OlympiadExam.findById(id);
  if (!exam) throw new ApiError(404, 'Examination not found.', 'EXAM_NOT_FOUND');
  return exam;
};

const assertEligibleStudent = (user, exam) => {
  if (user.role !== 'student') {
    throw new ApiError(403, 'Only students can register for this examination.', 'NOT_STUDENT');
  }
  if (user.currentStandard !== exam.standard) {
    throw new ApiError(403, `Only Standard ${exam.standard} students are eligible for this examination.`, 'WRONG_STANDARD');
  }
};

const assertWindowOpen = (exam, purpose) => {
  const state = windowState(exam);
  if (state === 'upcoming') {
    throw new ApiError(403, 'The examination has not started yet.', 'NOT_STARTED');
  }
  if (state === 'closed') {
    throw new ApiError(
      403,
      purpose === 'register' ? 'Registration is closed.' : 'The examination is no longer available.',
      'CLOSED'
    );
  }
};

const maskEmail = (email = '') => {
  const [name, domain] = email.split('@');
  if (!domain) return '';
  return `${name.slice(0, 1)}***@${domain}`;
};

// ──────────────────────────────────────────────
// Evaluation (backend only)
// ──────────────────────────────────────────────
const responsesToObject = (responses) => {
  if (!responses) return {};
  if (responses instanceof Map) return Object.fromEntries(responses.entries());
  return responses;
};

const getSelected = (responses, qid) => {
  const r = responses[qid];
  return r && Number.isInteger(r.selectedOption) ? r.selectedOption : null;
};

const evaluate = (exam, questions, attempt) => {
  const responses = responsesToObject(attempt.responses);
  const bySection = new Map();
  let score = 0; let correct = 0; let wrong = 0; let unanswered = 0; let totalMarks = 0;

  for (const q of questions) {
    totalMarks += q.marks;
    const subject = q.subject || 'General';
    if (!bySection.has(subject)) {
      bySection.set(subject, { subject, total: 0, correct: 0, wrong: 0, unanswered: 0, score: 0, maxScore: 0 });
    }
    const sec = bySection.get(subject);
    sec.total += 1; sec.maxScore += q.marks;

    const selected = getSelected(responses, oid(q._id));
    if (selected === null) {
      unanswered += 1; sec.unanswered += 1;
    } else if (selected === q.correctAnswer) {
      correct += 1; sec.correct += 1; score += q.marks; sec.score += q.marks;
    } else {
      wrong += 1; sec.wrong += 1;
      if (exam.negativeMarking) { score -= exam.negativeMarkValue; sec.score -= exam.negativeMarkValue; }
    }
  }

  const attempted = correct + wrong;
  const submittedAt = attempt.submittedAt || new Date();
  const effectiveEnd = Math.min(submittedAt.getTime(), attempt.deadline.getTime());
  return {
    score: round2(score),
    totalMarks,
    percentage: totalMarks > 0 ? round2((score / totalMarks) * 100) : 0,
    correctCount: correct,
    wrongCount: wrong,
    unansweredCount: unanswered,
    attemptedCount: attempted,
    accuracy: attempted > 0 ? round2((correct / attempted) * 100) : 0,
    timeTakenSeconds: Math.max(0, Math.round((effectiveEnd - attempt.startedAt.getTime()) / 1000)),
    sectionResults: [...bySection.values()].map((s) => ({ ...s, score: round2(s.score) })),
    evaluatedAt: new Date(),
  };
};

const ensureEvaluated = async (attempt) => {
  if (attempt.evaluatedAt) return attempt;
  const exam = await OlympiadExam.findById(attempt.exam);
  const questions = await OlympiadQuestion.find({ exam: attempt.exam })
    .sort('questionNumber')
    .select('+correctAnswer subject marks');
  const result = evaluate(exam, questions, attempt);
  const updated = await OlympiadAttempt.findOneAndUpdate(
    { _id: attempt._id, evaluatedAt: { $exists: false } },
    { $set: result },
    { new: true }
  );
  return updated || OlympiadAttempt.findById(attempt._id);
};

/** Atomically lock the attempt as COMPLETED, then evaluate. Safe to call concurrently / repeatedly. */
const finalizeAttempt = async (attemptId, type, now = new Date()) => {
  const current = await OlympiadAttempt.findById(attemptId);
  if (!current) return null;
  const submittedAt = new Date(Math.min(now.getTime(), current.deadline.getTime()));
  await OlympiadAttempt.findOneAndUpdate(
    { _id: attemptId, status: 'IN_PROGRESS' },
    { $set: { status: 'COMPLETED', submittedAt, submissionType: type } }
  );
  const attempt = await OlympiadAttempt.findById(attemptId);
  return ensureEvaluated(attempt);
};

const isExpired = (attempt, now = new Date()) =>
  attempt.status === 'IN_PROGRESS' && now.getTime() > attempt.deadline.getTime() + SAVE_GRACE_MS;

/** If the timer already ran out, submit automatically (server-side timer enforcement). */
const expireIfNeeded = async (attempt, now = new Date()) => {
  if (attempt && isExpired(attempt, now)) return finalizeAttempt(attempt._id, 'TIMER', now);
  return attempt;
};

// ──────────────────────────────────────────────
// Serialisers (never include answer keys)
// ──────────────────────────────────────────────
const resultSummary = (a) => ({
  score: a.score,
  totalMarks: a.totalMarks,
  percentage: a.percentage,
  correctCount: a.correctCount,
  wrongCount: a.wrongCount,
  unansweredCount: a.unansweredCount,
  attemptedCount: a.attemptedCount,
  accuracy: a.accuracy,
  timeTakenSeconds: a.timeTakenSeconds,
  startedAt: a.startedAt,
  submittedAt: a.submittedAt,
  submissionType: a.submissionType,
  sectionResults: a.sectionResults,
});

const examPublic = (exam) => ({
  _id: exam._id,
  title: exam.title,
  slug: exam.slug,
  description: exam.description,
  conductedBy: exam.conductedBy,
  examType: exam.examType,
  standard: exam.standard,
  startDate: exam.startDate,
  endDate: exam.endDate,
  durationMinutes: exam.durationMinutes,
  totalQuestions: exam.totalQuestions,
  totalMarks: exam.totalMarks,
  negativeMarking: exam.negativeMarking,
  negativeMarkValue: exam.negativeMarkValue,
  fee: exam.fee,
  currency: exam.currency,
  sections: exam.sections,
});

/** Work out where this student is in the pay → start → attempt → result journey. */
const buildState = async (exam, userId, now = new Date()) => {
  const [success, latest, foundAttempt] = await Promise.all([
    OlympiadPayment.findOne({ student: userId, exam: exam._id, status: 'SUCCESS' }),
    OlympiadPayment.findOne({ student: userId, exam: exam._id }).sort({ createdAt: -1 }),
    OlympiadAttempt.findOne({ student: userId, exam: exam._id }),
  ]);
  const payment = success || latest; // a SUCCESS payment always wins
  const attempt = await expireIfNeeded(foundAttempt, now);

  const win = windowState(exam, now);
  const paid = !!success;
  let state; let message = null;

  if (attempt && attempt.status === 'COMPLETED') state = 'completed';
  else if (attempt && attempt.status === 'IN_PROGRESS') state = 'in_progress';
  else if (paid) {
    if (win === 'closed') { state = 'closed'; message = 'The examination is no longer available.'; }
    else state = 'ready';
  } else if (win === 'upcoming') { state = 'upcoming'; message = 'The examination has not started yet.'; }
  else if (win === 'closed') { state = 'closed'; message = 'Registration is closed.'; }
  else state = 'pay';

  return {
    window: win,
    state,
    message,
    paymentStatus: payment ? payment.status : 'NONE',
    attemptStatus: attempt ? attempt.status : 'NOT_STARTED',
    result: attempt && attempt.status === 'COMPLETED' ? resultSummary(attempt) : null,
    remainingSeconds:
      attempt && attempt.status === 'IN_PROGRESS'
        ? Math.max(0, Math.ceil((attempt.deadline.getTime() - now.getTime()) / 1000))
        : null,
  };
};

// ──────────────────────────────────────────────
// Exam listing / details
// ──────────────────────────────────────────────
// GET /api/olympiad/exams
const listExams = handler(async (req, res) => {
  const now = new Date();
  if (req.user.role !== 'student' || !req.user.currentStandard) {
    return res.json({ success: true, exams: [], serverNow: now.toISOString() });
  }
  const exams = await OlympiadExam.find({ isPublished: true, standard: req.user.currentStandard }).sort({ startDate: 1 });
  const out = [];
  for (const exam of exams) {
    out.push({ ...examPublic(exam), ...(await buildState(exam, req.user._id, now)) });
  }
  res.json({ success: true, exams: out, serverNow: now.toISOString() });
});

// GET /api/olympiad/exams/:id
const getExam = handler(async (req, res) => {
  const now = new Date();
  const exam = await loadExam(req.params.id);
  assertEligibleStudent(req.user, exam);
  res.json({
    success: true,
    exam: {
      ...examPublic(exam),
      instructions: exam.instructions,
      ...(await buildState(exam, req.user._id, now)),
    },
    serverNow: now.toISOString(),
  });
});

// GET /api/olympiad/completed
const getCompleted = handler(async (req, res) => {
  if (req.user.role !== 'student') return res.json({ success: true, exams: [] });
  const attempts = await OlympiadAttempt.find({ student: req.user._id, status: 'COMPLETED' })
    .sort({ submittedAt: -1 })
    .populate('exam');
  const exams = [];
  for (const a of attempts) {
    if (!a.exam) continue;
    const done = await ensureEvaluated(a);
    exams.push({ ...examPublic(a.exam), state: 'completed', result: resultSummary(done) });
  }
  res.json({ success: true, exams });
});

// ──────────────────────────────────────────────
// Payments
// ──────────────────────────────────────────────
const markPaymentSuccess = async (paymentDoc, { razorpayPaymentId, razorpaySignature, via }) => {
  try {
    const updated = await OlympiadPayment.findOneAndUpdate(
      { _id: paymentDoc._id, status: { $in: ['PENDING', 'FAILED'] } },
      {
        $set: {
          status: 'SUCCESS',
          razorpayPaymentId,
          ...(razorpaySignature ? { razorpaySignature } : {}),
          verifiedAt: new Date(),
          verifiedVia: via,
        },
        $unset: { failureReason: 1 },
      },
      { new: true }
    );
    if (updated) {
      Notification.create({
        recipient: updated.student,
        title: 'Olympiad payment successful ✅',
        message: `Your payment of ₹${updated.amount} was verified. You can now start the Olympiad examination.`,
        type: 'payment',
        link: '/student/exams',
      }).catch(() => {});
      return { payment: updated, changed: true };
    }
    return { payment: await OlympiadPayment.findById(paymentDoc._id), changed: false };
  } catch (err) {
    if (isDuplicateKey(err)) {
      // The student already holds a SUCCESS payment for this exam (e.g. paid twice through two orders).
      await OlympiadPayment.updateOne(
        { _id: paymentDoc._id },
        { $set: { status: 'FAILED', razorpayPaymentId, failureReason: 'DUPLICATE_PAYMENT_REFUND_REQUIRED' } }
      );
      console.warn(`[olympiad] duplicate successful payment ${razorpayPaymentId} for order ${paymentDoc.razorpayOrderId} — refund required`);
      return { payment: await OlympiadPayment.findOne({ student: paymentDoc.student, exam: paymentDoc.exam, status: 'SUCCESS' }), changed: false, duplicate: true };
    }
    throw err;
  }
};

const safeEqual = (a, b) => {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};

// POST /api/olympiad/exams/:id/payment/order
const createOrder = handler(async (req, res) => {
  const exam = await loadExam(req.params.id);
  assertEligibleStudent(req.user, exam);

  const alreadyPaid = await OlympiadPayment.findOne({ student: req.user._id, exam: exam._id, status: 'SUCCESS' });
  if (alreadyPaid) {
    throw new ApiError(409, 'You have already completed the payment for this examination.', 'ALREADY_PAID');
  }
  const attempt = await OlympiadAttempt.findOne({ student: req.user._id, exam: exam._id });
  if (attempt) throw new ApiError(409, 'You have already registered for this examination.', 'ALREADY_REGISTERED');

  assertWindowOpen(exam, 'register');

  const razorpay = getRazorpayInstance();
  if (!razorpay) {
    console.error('[olympiad] Razorpay is not configured (RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET).');
    throw new ApiError(503, 'Online payments are temporarily unavailable. Please try again later.', 'PAYMENT_UNAVAILABLE');
  }

  // One open order per student+exam: refresh / double-click / retry all get the same order back.
  let payment = await OlympiadPayment.findOne({ student: req.user._id, exam: exam._id, status: 'PENDING' });
  let createdPlaceholder = false;
  if (!payment) {
    try {
      payment = await OlympiadPayment.create({
        student: req.user._id, exam: exam._id, amount: exam.fee, currency: exam.currency, status: 'PENDING',
      });
      createdPlaceholder = true;
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      payment = await OlympiadPayment.findOne({ student: req.user._id, exam: exam._id, status: 'PENDING' });
      if (!payment) throw err;
    }
  }

  if (!payment.razorpayOrderId) {
    let order;
    try {
      order = await razorpay.orders.create({
        amount: Math.round(exam.fee * 100), // paise — always taken from the exam record, never from the client
        currency: exam.currency,
        receipt: `oly_${payment._id}`,
        notes: {
          purpose: 'olympiad',
          examId: oid(exam._id),
          studentId: oid(req.user._id),
          paymentId: oid(payment._id),
        },
      });
    } catch (err) {
      console.error('[olympiad] Razorpay order creation failed:', err && (err.error || err.message || err));
      if (createdPlaceholder) await OlympiadPayment.deleteOne({ _id: payment._id, razorpayOrderId: { $exists: false } });
      throw new ApiError(502, 'We could not start the payment. Please try again.', 'PAYMENT_GATEWAY_ERROR');
    }
    payment = (await OlympiadPayment.findOneAndUpdate(
      { _id: payment._id, razorpayOrderId: { $exists: false } },
      { $set: { razorpayOrderId: order.id } },
      { new: true }
    )) || (await OlympiadPayment.findById(payment._id));
  }

  res.json({
    success: true,
    keyId: process.env.RAZORPAY_KEY_ID,
    paymentId: payment._id,
    order: { id: payment.razorpayOrderId, amount: Math.round(payment.amount * 100), currency: payment.currency },
    exam: { _id: exam._id, title: exam.title, fee: exam.fee },
  });
});

// POST /api/olympiad/exams/:id/payment/verify
const verifyPayment = handler(async (req, res) => {
  const exam = await loadExam(req.params.id);
  const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body || {};
  if ([razorpayOrderId, razorpayPaymentId, razorpaySignature].some((v) => typeof v !== 'string' || !v)) {
    throw new ApiError(400, 'Missing payment verification details.', 'INVALID_REQUEST');
  }

  // Scoped to the logged-in student + this exam: one student cannot verify (or read) another's payment.
  const payment = await OlympiadPayment.findOne({
    razorpayOrderId, student: req.user._id, exam: exam._id,
  });
  if (!payment) throw new ApiError(404, 'Payment record not found.', 'PAYMENT_NOT_FOUND');

  if (payment.status === 'SUCCESS') {
    return res.json({ success: true, paymentStatus: 'SUCCESS', alreadyVerified: true, message: 'Payment already verified.' });
  }
  if (payment.status === 'REFUNDED') {
    throw new ApiError(409, 'This payment has been refunded.', 'PAYMENT_REFUNDED');
  }

  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) {
    console.error('[olympiad] RAZORPAY_KEY_SECRET missing — cannot verify payments.');
    throw new ApiError(503, 'Payment verification is temporarily unavailable. Please contact support.', 'PAYMENT_UNAVAILABLE');
  }
  const expected = crypto.createHmac('sha256', secret).update(`${razorpayOrderId}|${razorpayPaymentId}`).digest('hex');
  if (!safeEqual(expected, razorpaySignature)) {
    await OlympiadPayment.updateOne({ _id: payment._id }, { $set: { failureReason: 'INVALID_SIGNATURE' } });
    throw new ApiError(400, 'Payment verification failed. If money was deducted, it will be reconciled automatically or contact support.', 'VERIFICATION_FAILED');
  }

  const { payment: updated, duplicate } = await markPaymentSuccess(payment, {
    razorpayPaymentId, razorpaySignature, via: 'checkout',
  });
  res.json({
    success: true,
    paymentStatus: updated ? updated.status : 'SUCCESS',
    duplicate: !!duplicate,
    message: 'Payment verified. You can now start the examination.',
  });
});

// GET /api/olympiad/exams/:id/payment/status
const getPaymentStatus = handler(async (req, res) => {
  const exam = await loadExam(req.params.id);
  assertEligibleStudent(req.user, exam);

  let payment = await OlympiadPayment.findOne({ student: req.user._id, exam: exam._id, status: 'SUCCESS' });
  if (!payment) {
    payment = await OlympiadPayment.findOne({ student: req.user._id, exam: exam._id }).sort({ createdAt: -1 });
    // Reconcile with Razorpay if the browser closed before /verify ran (backend-verified, not client-trusted).
    if (payment && payment.status !== 'REFUNDED' && payment.razorpayOrderId) {
      const razorpay = getRazorpayInstance();
      if (razorpay) {
        try {
          const list = await razorpay.orders.fetchPayments(payment.razorpayOrderId);
          const captured = (list.items || []).find(
            (p) => p.status === 'captured' && p.amount === Math.round(payment.amount * 100) && p.currency === payment.currency
          );
          if (captured) {
            ({ payment } = await markPaymentSuccess(payment, { razorpayPaymentId: captured.id, via: 'reconcile' }));
          }
        } catch (err) {
          console.warn('[olympiad] reconcile failed:', err && (err.error || err.message));
        }
      }
    }
  }
  res.json({
    success: true,
    paymentStatus: payment ? payment.status : 'NONE',
    verifiedAt: payment ? payment.verifiedAt : null,
    unlocked: !!payment && payment.status === 'SUCCESS',
  });
});

// POST /api/olympiad/payments/webhook   (Razorpay → server, signed with RAZORPAY_WEBHOOK_SECRET)
const razorpayWebhook = handler(async (req, res) => {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ success: false, message: 'Webhook not configured.' });
  const signature = req.headers['x-razorpay-signature'];
  if (!signature || !req.rawBody) return res.status(400).json({ success: false, message: 'Invalid webhook.' });
  const expected = crypto.createHmac('sha256', secret).update(req.rawBody).digest('hex');
  if (!safeEqual(expected, signature)) return res.status(400).json({ success: false, message: 'Invalid signature.' });

  const { event } = req.body || {};
  const entity = req.body && req.body.payload && req.body.payload.payment && req.body.payload.payment.entity;
  if (!entity || !entity.order_id) return res.json({ success: true, ignored: true });

  const payment = await OlympiadPayment.findOne({ razorpayOrderId: entity.order_id });
  if (!payment) {
    // not an Olympiad order → it may be a course / lecture order (same Razorpay account, same webhook URL)
    const { applyCourseWebhook } = require('../services/paymentReconciler');
    const { handled } = await applyCourseWebhook(event, entity);
    return res.json({ success: true, ...(handled ? {} : { ignored: true }) });
  }

  if (event === 'payment.captured' || event === 'order.paid') {
    if (entity.amount === Math.round(payment.amount * 100) && entity.currency === payment.currency) {
      await markPaymentSuccess(payment, { razorpayPaymentId: entity.id, via: 'webhook' });
    }
  } else if (event === 'payment.failed' && payment.status === 'PENDING') {
    await OlympiadPayment.updateOne(
      { _id: payment._id, status: 'PENDING' },
      { $set: { status: 'FAILED', failureReason: entity.error_description || 'PAYMENT_FAILED' } }
    );
  }
  res.json({ success: true });
});

// ──────────────────────────────────────────────
// Attempt: start / resume / save / submit
// ──────────────────────────────────────────────
const buildAttemptPayload = async (exam, attempt, now = new Date()) => {
  // correctAnswer / explanation are `select: false` → cannot leak from here
  const questions = await OlympiadQuestion.find({ exam: exam._id })
    .sort('questionNumber')
    .select('questionNumber subject questionText options marks image');
  return {
    exam: {
      _id: exam._id, title: exam.title, standard: exam.standard, durationMinutes: exam.durationMinutes,
      totalQuestions: exam.totalQuestions, totalMarks: exam.totalMarks, sections: exam.sections,
    },
    attempt: {
      _id: attempt._id,
      status: attempt.status,
      startedAt: attempt.startedAt,
      deadline: attempt.deadline,
      serverNow: now.toISOString(),
      remainingSeconds: Math.max(0, Math.ceil((attempt.deadline.getTime() - now.getTime()) / 1000)),
    },
    questions: questions.map((q) => ({
      _id: q._id, questionNumber: q.questionNumber, subject: q.subject,
      questionText: q.questionText, options: q.options, marks: q.marks, image: q.image,
    })),
    responses: responsesToObject(attempt.responses),
  };
};

const respondAlreadyCompleted = () => {
  throw new ApiError(
    409,
    'You have already submitted this examination. Your result is available.',
    'ALREADY_COMPLETED'
  );
};

// POST /api/olympiad/exams/:id/start
const startExam = handler(async (req, res) => {
  const now = new Date();
  const exam = await loadExam(req.params.id);
  assertEligibleStudent(req.user, exam);

  let attempt = await OlympiadAttempt.findOne({ student: req.user._id, exam: exam._id });
  if (attempt) {
    attempt = await expireIfNeeded(attempt, now);
    if (attempt.status === 'COMPLETED') respondAlreadyCompleted();
    return res.json({ success: true, resumed: true, ...(await buildAttemptPayload(exam, attempt, now)) });
  }

  assertWindowOpen(exam, 'start');

  const payment = await OlympiadPayment.findOne({ student: req.user._id, exam: exam._id, status: 'SUCCESS' });
  if (!payment) {
    throw new ApiError(402, `Please complete the ₹${exam.fee} payment before starting the examination.`, 'PAYMENT_REQUIRED');
  }

  try {
    attempt = await OlympiadAttempt.create({
      student: req.user._id,
      exam: exam._id,
      payment: payment._id,
      startedAt: now,
      deadline: new Date(now.getTime() + exam.durationMinutes * 60 * 1000),
      status: 'IN_PROGRESS',
    });
  } catch (err) {
    if (!isDuplicateKey(err)) throw err;
    attempt = await OlympiadAttempt.findOne({ student: req.user._id, exam: exam._id }); // double-click / two tabs
    if (attempt.status === 'COMPLETED') respondAlreadyCompleted();
  }
  res.json({ success: true, resumed: false, ...(await buildAttemptPayload(exam, attempt, now)) });
});

// GET /api/olympiad/exams/:id/attempt
const getAttempt = handler(async (req, res) => {
  const now = new Date();
  const exam = await loadExam(req.params.id);
  assertEligibleStudent(req.user, exam);
  let attempt = await OlympiadAttempt.findOne({ student: req.user._id, exam: exam._id });
  if (!attempt) throw new ApiError(404, 'You have not started this examination yet.', 'NO_ATTEMPT');
  attempt = await expireIfNeeded(attempt, now);
  if (attempt.status === 'COMPLETED') respondAlreadyCompleted();
  res.json({ success: true, ...(await buildAttemptPayload(exam, attempt, now)) });
});

/** Validate + atomically persist a batch of answers. Returns false if the attempt was no longer writable. */
const applyAnswers = async (attempt, exam, answers, now) => {
  if (!Array.isArray(answers)) throw new ApiError(400, 'Invalid answers payload.', 'INVALID_REQUEST');
  if (answers.length === 0) return true;
  if (answers.length > 500) throw new ApiError(400, 'Too many answers in one request.', 'INVALID_REQUEST');

  const questions = await OlympiadQuestion.find({ exam: exam._id }).select('_id options');
  const optionCount = new Map(questions.map((q) => [oid(q._id), q.options.length]));
  const existing = responsesToObject(attempt.responses);

  const $set = {};
  for (const a of answers) {
    const qid = a && typeof a.questionId === 'string' ? a.questionId : null;
    if (!qid || !optionCount.has(qid)) {
      throw new ApiError(400, 'One of the questions is not part of this examination.', 'INVALID_QUESTION');
    }
    const sel = a.selectedOption === undefined ? undefined : a.selectedOption;
    if (sel !== undefined && sel !== null && !(Number.isInteger(sel) && sel >= 0 && sel < optionCount.get(qid))) {
      throw new ApiError(400, 'Invalid answer option.', 'INVALID_ANSWER');
    }
    if (a.marked !== undefined && typeof a.marked !== 'boolean') {
      throw new ApiError(400, 'Invalid review flag.', 'INVALID_ANSWER');
    }
    const prev = existing[qid] || {};
    $set[`responses.${qid}`] = {
      selectedOption: sel === undefined ? (prev.selectedOption ?? null) : sel,
      marked: a.marked === undefined ? !!prev.marked : a.marked,
      updatedAt: now,
    };
  }

  const r = await OlympiadAttempt.updateOne(
    { _id: attempt._id, status: 'IN_PROGRESS', deadline: { $gt: new Date(now.getTime() - SAVE_GRACE_MS) } },
    { $set }
  );
  return r.matchedCount > 0;
};

// PUT /api/olympiad/exams/:id/attempt/answers
const saveAnswers = handler(async (req, res) => {
  const now = new Date();
  const exam = await loadExam(req.params.id);
  assertEligibleStudent(req.user, exam);
  let attempt = await OlympiadAttempt.findOne({ student: req.user._id, exam: exam._id });
  if (!attempt) throw new ApiError(404, 'You have not started this examination yet.', 'NO_ATTEMPT');

  if (attempt.status === 'COMPLETED') {
    throw new ApiError(409, 'This examination has already been submitted. Answers can no longer be changed.', 'ALREADY_COMPLETED');
  }
  if (isExpired(attempt, now)) {
    await finalizeAttempt(attempt._id, 'TIMER', now);
    throw new ApiError(409, 'Time is up. Your examination was submitted automatically.', 'TIME_UP');
  }

  const ok = await applyAnswers(attempt, exam, req.body && req.body.answers, now);
  if (!ok) {
    attempt = await OlympiadAttempt.findById(attempt._id);
    if (attempt.status === 'COMPLETED') {
      throw new ApiError(409, 'This examination has already been submitted. Answers can no longer be changed.', 'ALREADY_COMPLETED');
    }
    throw new ApiError(409, 'Time is up. Your examination was submitted automatically.', 'TIME_UP');
  }
  res.json({
    success: true,
    savedAt: now.toISOString(),
    remainingSeconds: Math.max(0, Math.ceil((attempt.deadline.getTime() - now.getTime()) / 1000)),
  });
});

// POST /api/olympiad/exams/:id/submit
const submitExam = handler(async (req, res) => {
  const now = new Date();
  const exam = await loadExam(req.params.id);
  assertEligibleStudent(req.user, exam);
  let attempt = await OlympiadAttempt.findOne({ student: req.user._id, exam: exam._id });
  if (!attempt) throw new ApiError(404, 'You have not started this examination yet.', 'NO_ATTEMPT');

  // Idempotent: double-click / retry after a network failure just returns the stored result.
  if (attempt.status === 'COMPLETED') {
    attempt = await ensureEvaluated(attempt);
    return res.json({ success: true, alreadySubmitted: true, result: resultSummary(attempt) });
  }

  if (isExpired(attempt, now)) {
    attempt = await finalizeAttempt(attempt._id, 'TIMER', now);
    return res.json({ success: true, autoSubmitted: true, result: resultSummary(attempt) });
  }

  // Optional last-second sync of the answers the browser still holds.
  if (req.body && Array.isArray(req.body.answers)) {
    await applyAnswers(attempt, exam, req.body.answers, now);
  }

  const type = now.getTime() > attempt.deadline.getTime() ? 'TIMER' : 'MANUAL';
  attempt = await finalizeAttempt(attempt._id, type, now);
  res.json({ success: true, result: resultSummary(attempt) });
});

// ──────────────────────────────────────────────
// Result & review (only after submission)
// ──────────────────────────────────────────────
const loadCompletedAttempt = async (req) => {
  const exam = await loadExam(req.params.id);
  assertEligibleStudent(req.user, exam);
  let attempt = await OlympiadAttempt.findOne({ student: req.user._id, exam: exam._id });
  if (!attempt) throw new ApiError(404, 'You have not attempted this examination.', 'NO_ATTEMPT');
  attempt = await expireIfNeeded(attempt);
  if (attempt.status !== 'COMPLETED') {
    throw new ApiError(409, 'Your result and the correct answers will be available after you submit the examination.', 'NOT_SUBMITTED');
  }
  attempt = await ensureEvaluated(attempt);
  return { exam, attempt };
};

// GET /api/olympiad/exams/:id/result
const getResult = handler(async (req, res) => {
  const { exam, attempt } = await loadCompletedAttempt(req);
  res.json({
    success: true,
    exam: examPublic(exam),
    result: { ...resultSummary(attempt), totalQuestions: exam.totalQuestions, status: 'COMPLETED' },
  });
});

// GET /api/olympiad/exams/:id/review
const getReview = handler(async (req, res) => {
  const { exam, attempt } = await loadCompletedAttempt(req);
  const questions = await OlympiadQuestion.find({ exam: exam._id })
    .sort('questionNumber')
    .select('+correctAnswer +explanation');
  const responses = responsesToObject(attempt.responses);

  const review = questions.map((q) => {
    const selected = getSelected(responses, oid(q._id));
    let status = 'NOT_ATTEMPTED';
    if (selected !== null) status = selected === q.correctAnswer ? 'CORRECT' : 'INCORRECT';
    return {
      _id: q._id,
      questionNumber: q.questionNumber,
      subject: q.subject,
      questionText: q.questionText,
      options: q.options,
      image: q.image,
      marks: q.marks,
      selectedOption: selected,
      correctAnswer: q.correctAnswer,
      status,
      marksAwarded: status === 'CORRECT' ? q.marks : (status === 'INCORRECT' && exam.negativeMarking ? -exam.negativeMarkValue : 0),
      explanation: q.explanation || null,
    };
  });
  res.json({ success: true, exam: examPublic(exam), review });
});

// ──────────────────────────────────────────────
// Admin
// ──────────────────────────────────────────────
const examStats = async (exam) => {
  const [paymentAgg, registered, attemptAgg] = await Promise.all([
    OlympiadPayment.aggregate([
      { $match: { exam: exam._id } },
      { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
    ]),
    OlympiadPayment.distinct('student', { exam: exam._id, status: 'SUCCESS' }),
    OlympiadAttempt.aggregate([
      { $match: { exam: exam._id } },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
          avgScore: { $avg: '$score' },
          maxScore: { $max: '$score' },
          minScore: { $min: '$score' },
        },
      },
    ]),
  ]);
  const pay = Object.fromEntries(paymentAgg.map((p) => [p._id, p]));
  const att = Object.fromEntries(attemptAgg.map((a) => [a._id, a]));
  const completed = att.COMPLETED;
  return {
    totalRegistrations: registered.length,
    successfulPayments: pay.SUCCESS ? pay.SUCCESS.count : 0,
    failedPayments: pay.FAILED ? pay.FAILED.count : 0,
    pendingPayments: pay.PENDING ? pay.PENDING.count : 0,
    refundedPayments: pay.REFUNDED ? pay.REFUNDED.count : 0,
    unconfirmedPayments: pay.UNCONFIRMED ? pay.UNCONFIRMED.count : 0,
    revenue: pay.SUCCESS ? pay.SUCCESS.amount : 0,
    totalAttempts: (att.COMPLETED ? att.COMPLETED.count : 0) + (att.IN_PROGRESS ? att.IN_PROGRESS.count : 0),
    completedAttempts: completed ? completed.count : 0,
    inProgressAttempts: att.IN_PROGRESS ? att.IN_PROGRESS.count : 0,
    averageScore: completed ? round2(completed.avgScore) : 0,
    highestScore: completed ? completed.maxScore : 0,
    lowestScore: completed ? completed.minScore : 0,
  };
};

// GET /api/olympiad/admin/exams
const adminListExams = handler(async (req, res) => {
  const exams = await OlympiadExam.find().sort({ standard: 1 });
  const out = [];
  for (const exam of exams) {
    out.push({ ...examPublic(exam), isPublished: exam.isPublished !== false, window: windowState(exam), stats: await examStats(exam) });
  }
  res.json({ success: true, exams: out });
});

// POST /api/olympiad/admin/seed — creates / refreshes the Standard 9 and Standard 10 exams and their questions (idempotent)
const adminSeedExam = handler(async (req, res) => {
  const seedOlympiadAll = require('../seed/seedOlympiadAll');
  const { exams, errors } = await seedOlympiadAll({});
  if (exams.length === 0 && errors.length > 0) {
    if (errors.every((e) => /refusing to modify/i.test(e.err.message))) {
      throw new ApiError(409, 'Students have already attempted these exams, so their questions cannot be changed.', 'HAS_ATTEMPTS');
    }
    throw errors[0].err;
  }
  res.json({
    success: true,
    message: 'Olympiad exams are ready.',
    exams: exams.map((e) => ({ _id: e._id, title: e.title, standard: e.standard })),
    skipped: errors.map((e) => e.label),
  });
});

// GET /api/olympiad/admin/exams/:id/attempts
const adminAttempts = handler(async (req, res) => {
  const exam = await loadExamAdmin(req.params.id);
  const attempts = await OlympiadAttempt.find({ exam: exam._id })
    .sort({ score: -1, timeTakenSeconds: 1 })
    .limit(1000)
    .populate('student', 'name email currentStandard');
  res.json({
    success: true,
    attempts: attempts.map((a) => ({
      _id: a._id,
      student: a.student ? { name: a.student.name, email: maskEmail(a.student.email), standard: a.student.currentStandard } : null,
      status: a.status,
      submissionType: a.submissionType,
      startedAt: a.startedAt,
      submittedAt: a.submittedAt,
      score: a.score,
      totalMarks: a.totalMarks,
      percentage: a.percentage,
      correctCount: a.correctCount,
      wrongCount: a.wrongCount,
      unansweredCount: a.unansweredCount,
      timeTakenSeconds: a.timeTakenSeconds,
    })),
  });
});

// One admin-facing shape for an OlympiadPayment (never includes the Razorpay signature).
const toAdminPayment = (p, exam) => {
  const ex = exam || p.exam;
  return {
    _id: p._id,
    student: p.student ? { name: p.student.name, email: maskEmail(p.student.email) } : null,
    exam: ex && ex.title ? { _id: ex._id, title: ex.title, standard: ex.standard } : null,
    amount: p.amount,
    currency: p.currency,
    status: p.status,
    razorpayOrderId: p.razorpayOrderId,
    razorpayPaymentId: p.razorpayPaymentId,
    verifiedAt: p.verifiedAt,
    verifiedVia: p.verifiedVia,
    failureReason: p.failureReason,
    statusBeforeReview: p.statusBeforeReview,
    reviewNote: p.reviewNote,
    archivedAt: p.archivedAt,
    archiveReason: p.archiveReason,
    reconcileState: p.reconcileState,
    createdAt: p.createdAt,
  };
};

// Same status buckets the per-exam stats use; revenue is ONLY verified (SUCCESS) payments.
const summarisePayments = (rows) => {
  const by = Object.fromEntries(rows.map((r) => [r._id, r]));
  const count = (k) => (by[k] ? by[k].count : 0);
  return {
    total: rows.reduce((n, r) => n + r.count, 0),
    successfulPayments: count('SUCCESS'),
    pendingPayments: count('PENDING'),
    failedPayments: count('FAILED'),
    refundedPayments: count('REFUNDED'),
    unconfirmedPayments: count('UNCONFIRMED'),
    revenue: by.SUCCESS ? by.SUCCESS.amount : 0,
  };
};

// ACTIVE view (default) = what the admin normally sees: everything except UNCONFIRMED and archived records.
// A SUCCESS payment is never hidden. `?view=history` returns every record (audit history) — nothing is ever deleted.
const paymentView = (req) => (req.query.view === 'history' ? 'history' : 'active');
const ACTIVE_PAYMENTS = { status: { $ne: 'UNCONFIRMED' }, $or: [{ archivedAt: null }, { status: 'SUCCESS' }] };
const HIDDEN_PAYMENTS = { $or: [{ status: 'UNCONFIRMED' }, { archivedAt: { $ne: null }, status: { $ne: 'SUCCESS' } }] };
const paymentScope = (view) => (view === 'history' ? {} : ACTIVE_PAYMENTS);

// GET /api/olympiad/admin/exams/:id/payments[?view=history]
const adminPayments = handler(async (req, res) => {
  const exam = await loadExamAdmin(req.params.id);
  const view = paymentView(req);
  const [payments, historyCount] = await Promise.all([
    OlympiadPayment.find({ exam: exam._id, ...paymentScope(view) })
      .sort({ createdAt: -1 })
      .limit(1000)
      .populate('student', 'name email'),
    OlympiadPayment.countDocuments({ exam: exam._id, ...HIDDEN_PAYMENTS }),
  ]);
  res.set('Cache-Control', 'no-store');
  res.json({ success: true, view, historyCount, payments: payments.map((p) => toAdminPayment(p, exam)) });
});

// GET /api/olympiad/admin/payments?standard=all|1..10[&view=history]
// Every OlympiadPayment across all exams (published or not), optionally narrowed to one standard.
const adminAllPayments = handler(async (req, res) => {
  const raw = req.query.standard;
  let examFilter = {};
  let standard = 'all';
  if (raw !== undefined && raw !== '' && raw !== 'all') {
    const n = typeof raw === 'string' && /^\d{1,2}$/.test(raw) ? Number(raw) : NaN;
    if (!Number.isInteger(n) || n < 1 || n > 10) throw new ApiError(400, 'Standard must be "all" or a number from 1 to 10.', 'INVALID_STANDARD');
    standard = n;
    const ids = (await OlympiadExam.find({ standard: n }).select('_id')).map((e) => e._id);
    examFilter = { exam: { $in: ids } };
  }
  const view = paymentView(req);
  const filter = { ...examFilter, ...paymentScope(view) };
  const [payments, grouped, historyCount] = await Promise.all([
    OlympiadPayment.find(filter)
      .sort({ createdAt: -1 })
      .limit(5000)
      .populate('student', 'name email')
      .populate('exam', 'title standard'),
    OlympiadPayment.aggregate([
      { $match: filter },
      { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
    ]),
    OlympiadPayment.countDocuments({ ...examFilter, ...HIDDEN_PAYMENTS }),
  ]);
  res.set('Cache-Control', 'no-store'); // live financial figures
  res.json({ success: true, standard, view, payments: payments.map((p) => toAdminPayment(p)), summary: { ...summarisePayments(grouped), historyCount } });
});

// ──────────────────────────────────────────────
// Background sweeper: auto-submit attempts whose timer ran out (browser closed, etc.)
// ──────────────────────────────────────────────
const autoSubmitExpiredAttempts = async () => {
  const cutoff = new Date(Date.now() - SAVE_GRACE_MS);
  const expired = await OlympiadAttempt.find({ status: 'IN_PROGRESS', deadline: { $lt: cutoff } }).select('_id');
  for (const a of expired) {
    try {
      await finalizeAttempt(a._id, 'SYSTEM');
    } catch (err) {
      console.error('[olympiad] auto-submit failed for attempt', oid(a._id), err.message);
    }
  }
  return expired.length;
};

let sweeperTimer = null;
const startOlympiadSweeper = (intervalMs = 60 * 1000) => {
  if (sweeperTimer) return;
  sweeperTimer = setInterval(() => {
    autoSubmitExpiredAttempts().catch((e) => console.error('[olympiad] sweeper error:', e.message));
  }, intervalMs);
  if (sweeperTimer.unref) sweeperTimer.unref();
};

module.exports = {
  listExams, getExam, getCompleted,
  createOrder, verifyPayment, getPaymentStatus, razorpayWebhook,
  startExam, getAttempt, saveAnswers, submitExam,
  getResult, getReview,
  adminListExams, adminAttempts, adminPayments, adminAllPayments, adminSeedExam,
  startOlympiadSweeper, autoSubmitExpiredAttempts,
  // exported for tests
  _internals: { evaluate, windowState, finalizeAttempt, markPaymentSuccess },
};

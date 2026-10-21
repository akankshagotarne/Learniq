const mongoose = require('mongoose');
const { OlympiadPayment, OlympiadExam } = require('../models/Olympiad');
const { Counter } = require('../models/Certificate');
const User = require('../models/User');
const { CreditTransaction } = require('../models/Referral');
const credits = require('./credits');
const { KNOWN, methodLabel, methodShort, captureMethod } = require('./paymentMethod');

/**
 * Student "Payments & Transactions" (read-only history + receipts).
 *
 * ONE source of truth per kind - nothing is copied into a second collection:
 *   money    OlympiadPayment      (Razorpay). Only status SUCCESS is money received; PENDING / FAILED / REFUNDED are shown with their own status.
 *   credits  CreditTransaction    (the append-only credit ledger). A credit movement is NEVER money: it has no amount, no Razorpay ids and
 *                                 never gets a payment receipt - only a "credit transaction statement" that states ₹0.00 was received.
 *
 * Security: the student id ALWAYS comes from the authenticated user (req.user); transaction ids are looked up scoped to that student, so
 * another student's id is simply "not found". Receipts are generated from stored records only; nothing in a request can change an amount,
 * a status or a receipt number.
 */
class TxError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}

const IST = 'Asia/Kolkata';
const PAGE_SIZES = [10, 20, 50];
const MAX_BULK = 25;
const HISTORY_CAP = 2000; // a student's own records, bounded

const PAYMENT_VISIBLE = { removedAt: null, status: { $ne: 'UNCONFIRMED' } }; // admin-removed / unmatched records are not the student's history

const pad = (n, w = 2) => String(n).padStart(w, '0');
const istParts = (d) => {
  const f = new Intl.DateTimeFormat('en-GB', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(d));
  const g = (t) => f.find((p) => p.type === t).value;
  return { y: g('year'), m: g('month'), d: g('day'), hh: g('hour') === '24' ? '00' : g('hour'), mm: g('minute') };
};
const ymd = (d) => { const p = istParts(d); return `${p.y}${p.m}${p.d}`; };
const istDateTime = (d) => (d ? new Intl.DateTimeFormat('en-IN', { timeZone: IST, day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(d)).replace(/\b(am|pm)\b/i, (m) => m.toUpperCase()) + ' IST' : '');
const tail = (id, n = 8) => String(id).slice(-n).toUpperCase();

const inr = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const maskPhone = (p) => {
  const digits = String(p || '').replace(/\D/g, '');
  if (digits.length < 4) return '';
  return `${digits.length > 10 ? `+${digits.slice(0, digits.length - 10)} ` : ''}XXXXXX${digits.slice(-4)}`;
};

// ── typing ───────────────────────────────────────────────────────────────────────────────────────
const PAYMENT_TYPES = { EXAM: 'EXAM_PAYMENT', INTERVIEW: 'INTERVIEW_PAYMENT', PACKAGE: 'PACKAGE_PAYMENT' };
const COMPONENT_LABEL = { EXAM: 'Exam', INTERVIEW: 'Interview', PACKAGE: 'Exam + Interview (package)' };
const CREDIT_META = {
  REFERRAL_REWARD: { type: 'REFERRAL_CREDIT', label: 'Referral Reward', component: 'REFERRAL', componentLabel: 'Referral', method: 'Referral' },
  ADMIN_GRANT: { type: 'ADMIN_CREDIT_GRANT', label: 'Admin Credit Grant', component: 'CREDIT', componentLabel: 'Credit', method: 'Admin' },
  EXAM_REDEMPTION: { type: 'EXAM_CREDIT_USED', label: 'Exam Credit Used', component: 'EXAM', componentLabel: 'Exam', method: 'Exam Credit' },
  INTERVIEW_REDEMPTION: { type: 'INTERVIEW_CREDIT_USED', label: 'Interview Credit Used', component: 'INTERVIEW', componentLabel: 'Interview', method: 'Exam Credit' },
  ADMIN_ADJUSTMENT: { type: 'CREDIT_ADJUSTMENT', label: 'Credit Adjustment', component: 'CREDIT', componentLabel: 'Credit', method: 'Admin' },
  REVERSAL: { type: 'CREDIT_REVERSAL', label: 'Credit Reversal', component: 'CREDIT', componentLabel: 'Credit', method: 'System' },
};
const STATUS_LABEL = { SUCCESS: 'Success', PENDING: 'Pending', FAILED: 'Failed', REFUNDED: 'Refunded' };
const paymentComponent = (p) => (p.component === 'EXAM' || p.component === 'INTERVIEW' ? p.component : 'PACKAGE'); // no component = legacy bundle

const paymentTxnId = (p) => `TXN${ymd(p.verifiedAt || p.createdAt)}${tail(p._id)}`;
const creditTxnId = (t) => `CRD${ymd(t.createdAt)}${tail(t._id)}`;

const paymentRow = (p, titles) => {
  const component = paymentComponent(p);
  const title = titles.get(String(p.exam)) || 'LearnIQ Test';
  const label = component === 'EXAM' ? 'Exam Payment' : component === 'INTERVIEW' ? 'Interview Payment' : 'Test & Interview Package';
  const when = p.status === 'SUCCESS' ? (p.verifiedAt || p.createdAt) : p.createdAt;
  return {
    id: `pay_${p._id}`, kind: 'PAYMENT', type: PAYMENT_TYPES[component], description: label, detail: title,
    component, componentLabel: COMPONENT_LABEL[component],
    amount: p.amount, currency: p.currency || 'INR', creditChange: null,
    method: p.method || null, methodLabel: p.method ? methodShort(p.method) : 'Razorpay',
    status: p.status, statusLabel: STATUS_LABEL[p.status] || p.status,
    date: when, transactionId: paymentTxnId(p), receiptNumber: p.receiptNumber || null,
    receiptAvailable: p.status === 'SUCCESS',
    _sort: new Date(when).getTime(), _src: p,
  };
};
const creditRow = (t) => {
  const m = CREDIT_META[t.type] || { type: 'CREDIT_ADJUSTMENT', label: 'Credit transaction', component: 'CREDIT', componentLabel: 'Credit', method: 'Credit' };
  return {
    id: `crd_${t._id}`, kind: 'CREDIT', type: m.type, description: m.label, detail: t.examTitle || t.reason || '',
    component: m.component, componentLabel: m.componentLabel,
    amount: null, currency: null, creditChange: t.delta,
    method: null, methodLabel: m.method,
    status: 'SUCCESS', statusLabel: 'Success',
    date: t.createdAt, transactionId: creditTxnId(t), receiptNumber: null, receiptAvailable: false, statementAvailable: true,
    _sort: new Date(t.createdAt).getTime(), _src: t,
  };
};

const publicRow = ({ _sort, _src, ...r }) => r;

// ── loading (always scoped to the signed-in student) ────────────────────────────────────────────────
const loadAll = async (studentId) => {
  const [payments, ledger] = await Promise.all([
    OlympiadPayment.find({ student: studentId, ...PAYMENT_VISIBLE }).sort({ createdAt: -1 }).limit(HISTORY_CAP),
    CreditTransaction.find({ student: studentId }).sort({ createdAt: -1 }).limit(HISTORY_CAP),
  ]);
  const hidden = (p) => p.archivedAt && p.status !== 'SUCCESS'; // archived non-success records stay out of the student's view
  const visible = payments.filter((p) => !hidden(p));
  const examIds = [...new Set(visible.map((p) => String(p.exam)))];
  const exams = examIds.length ? await OlympiadExam.find({ _id: { $in: examIds } }) : [];
  const titles = new Map(exams.map((e) => [String(e._id), e.title]));
  return { rows: [...visible.map((p) => paymentRow(p, titles)), ...ledger.map(creditRow)], payments: visible, ledger, titles, exams };
};

// ── query parsing ────────────────────────────────────────────────────────────────────────────────
const TABS = ['all', 'payments', 'credits'];
const oneOf = (v, list, dflt) => { const s = typeof v === 'string' ? v.trim() : ''; return list.includes(s) ? s : dflt; };
const istDayStart = (iso) => new Date(`${iso}T00:00:00+05:30`);
const istDayEnd = (iso) => new Date(`${iso}T23:59:59.999+05:30`);
const isoDay = (v) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime()) ? v : null);

const monthRange = (offset, now = new Date()) => {
  const p = istParts(now); let y = Number(p.y); let m = Number(p.m) - 1 + offset;
  while (m < 0) { m += 12; y -= 1; }
  const first = `${y}-${pad(m + 1)}-01`;
  const next = m === 11 ? `${y + 1}-01-01` : `${y}-${pad(m + 2)}-01`;
  return { from: istDayStart(first), to: new Date(istDayStart(next).getTime() - 1) };
};

const parseQuery = (q = {}, now = new Date()) => {
  const f = {
    tab: oneOf(q.tab, TABS, 'all'),
    type: oneOf(q.type, ['EXAM_PAYMENT', 'INTERVIEW_PAYMENT', 'PACKAGE_PAYMENT', 'REFERRAL_CREDIT', 'EXAM_CREDIT_USED', 'INTERVIEW_CREDIT_USED', 'ADMIN_CREDIT_GRANT', 'CREDIT_ADJUSTMENT', 'CREDIT_REVERSAL'], ''),
    status: oneOf(q.status, ['SUCCESS', 'PENDING', 'FAILED', 'REFUNDED'], ''),
    component: oneOf(q.component, ['EXAM', 'INTERVIEW', 'PACKAGE', 'CREDIT', 'REFERRAL'], ''),
    method: oneOf(q.method, [...Object.keys(KNOWN), 'other'], ''),
    search: typeof q.search === 'string' ? q.search.trim().slice(0, 80).toLowerCase() : '',
    limit: PAGE_SIZES.includes(Number(q.limit)) ? Number(q.limit) : 10,
    page: Math.max(1, Math.min(500, Number.parseInt(q.page, 10) || 1)),
    from: null, to: null,
  };
  const range = oneOf(q.range, ['current_month', 'previous_month'], '');
  if (range) Object.assign(f, monthRange(range === 'current_month' ? 0 : -1, now));
  else {
    const a = isoDay(q.from); const b = isoDay(q.to);
    if (a) f.from = istDayStart(a);
    if (b) f.to = istDayEnd(b);
    if (f.from && f.to && f.from > f.to) throw new TxError(400, 'The start date must be before the end date.', 'INVALID_DATE_RANGE');
  }
  return f;
};

const methodGroup = (r) => (r.kind !== 'PAYMENT' ? null : (r.method && KNOWN[r.method] ? r.method : 'other'));
const matches = (r, f) => {
  if (f.tab === 'payments' && r.kind !== 'PAYMENT') return false;
  if (f.tab === 'credits' && r.kind !== 'CREDIT') return false;
  if (f.type && r.type !== f.type) return false;
  if (f.status && r.status !== f.status) return false;
  if (f.component && r.component !== f.component) return false;
  if (f.method && methodGroup(r) !== f.method) return false;
  const t = new Date(r.date).getTime();
  if (f.from && t < f.from.getTime()) return false;
  if (f.to && t > f.to.getTime()) return false;
  if (f.search) {
    const src = r._src || {};
    const hay = [r.transactionId, r.receiptNumber, r.description, r.detail, src.razorpayOrderId, src.razorpayPaymentId].filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(f.search)) return false;
  }
  return true;
};

// ── summary (money and credits are kept apart) ──────────────────────────────────────────────────────
const summarize = async (studentId, { payments, ledger }) => {
  const sum = (list) => list.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const ok = payments.filter((p) => p.status === 'SUCCESS');
  const earned = ledger.filter((t) => t.type === 'REFERRAL_REWARD').reduce((s, t) => s + t.delta, 0);
  const granted = ledger.filter((t) => t.type === 'ADMIN_GRANT' || (t.type === 'ADMIN_ADJUSTMENT' && t.delta > 0)).reduce((s, t) => s + t.delta, 0);
  const used = ledger.filter((t) => t.type === 'EXAM_REDEMPTION' || t.type === 'INTERVIEW_REDEMPTION').reduce((s, t) => s - t.delta, 0);
  return {
    money: {
      totalPaid: sum(ok), successfulCount: ok.length,
      pendingCount: payments.filter((p) => p.status === 'PENDING').length,
      failedCount: payments.filter((p) => p.status === 'FAILED').length,
      refundedAmount: sum(payments.filter((p) => p.status === 'REFUNDED')), currency: 'INR',
    },
    credits: { earned, grantedByAdmin: granted, used, balance: await credits.getBalance(studentId) },
  };
};

const list = async (user, query) => {
  const f = parseQuery(query);
  const all = await loadAll(user._id);
  const filtered = all.rows.filter((r) => matches(r, f)).sort((a, b) => b._sort - a._sort);
  const pages = Math.max(1, Math.ceil(filtered.length / f.limit));
  const page = Math.min(f.page, pages);
  return {
    items: filtered.slice((page - 1) * f.limit, page * f.limit).map(publicRow),
    pagination: { page, limit: f.limit, total: filtered.length, pages },
    summary: await summarize(user._id, all),
    filters: { tab: f.tab },
  };
};

// ── detail ──────────────────────────────────────────────────────────────────────────────────────────
const parseId = (raw) => {
  const m = /^(pay|crd)_([a-f0-9]{24})$/i.exec(typeof raw === 'string' ? raw : '');
  if (!m) throw new TxError(400, 'That transaction id is not valid.', 'INVALID_TRANSACTION');
  return { kind: m[1].toLowerCase(), oid: m[2] };
};

const NOT_FOUND = () => new TxError(404, 'Transaction not found.', 'TRANSACTION_NOT_FOUND');

const loadPaymentFor = async (user, oid) => {
  const p = await OlympiadPayment.findOne({ _id: oid, student: user._id, ...PAYMENT_VISIBLE });
  if (!p || (p.archivedAt && p.status !== 'SUCCESS')) throw NOT_FOUND();
  return p;
};
const loadCreditFor = async (user, oid) => {
  const t = await CreditTransaction.findOne({ _id: oid, student: user._id });
  if (!t) throw NOT_FOUND();
  return t;
};

const studentFacts = async (user, exam) => {
  const u = (await User.findById(user._id)) || user;
  return {
    name: String(u.name || '').replace(/\s+/g, ' ').trim(),
    email: u.email || '',
    phone: maskPhone(u.phone),
    standard: exam && exam.standard != null ? exam.standard : (u.currentStandard != null ? u.currentStandard : null),
    studentId: `LQS-${tail(u._id)}`,
    accountType: 'Student',
  };
};
const standardText = (s) => (s === 99 ? 'Others' : s == null ? '' : `Standard ${s}`);

const purposeOf = (p, title) => {
  const c = paymentComponent(p);
  const what = c === 'EXAM' ? 'Exam Access' : c === 'INTERVIEW' ? 'Interview Access' : 'Exam & Interview Access';
  return `${title || 'LearnIQ Test'} — ${what}`;
};

const detail = async (user, rawId) => {
  const { kind, oid } = parseId(rawId);
  if (kind === 'pay') {
    const p = await loadPaymentFor(user, oid);
    const exam = await OlympiadExam.findById(p.exam);
    const titles = new Map([[String(p.exam), exam && exam.title]]);
    const row = paymentRow(p, titles);
    const snap = p.receiptSnapshot || (await studentFacts(user, exam));
    return {
      ...publicRow(row), purpose: purposeOf(p, exam && exam.title),
      student: { name: snap.name, email: snap.email, phone: snap.phone, standard: standardText(snap.standard), studentId: snap.studentId, accountType: snap.accountType },
      payment: {
        razorpayOrderId: p.razorpayOrderId || null, razorpayPaymentId: p.status === 'SUCCESS' ? p.razorpayPaymentId || null : null,
        verifiedAt: p.verifiedAt || null, paymentMethod: row.method ? methodLabel(row.method) : 'Razorpay',
        failureNote: p.status === 'FAILED' ? 'The payment was not completed.' : null,
      },
    };
  }
  const t = await loadCreditFor(user, oid);
  const row = creditRow(t);
  return {
    ...publicRow(row),
    credit: { source: t.source, reason: t.reason || null, relatedTitle: t.examTitle || null, balanceAfter: await balanceAfter(user._id, t), moneyReceived: 0 },
  };
};

const balanceAfter = async (studentId, tx) => {
  const all = await CreditTransaction.find({ student: studentId }).limit(HISTORY_CAP);
  const at = new Date(tx.createdAt).getTime();
  return all.filter((x) => new Date(x.createdAt).getTime() < at || (new Date(x.createdAt).getTime() === at && String(x._id) <= String(tx._id))).reduce((s, x) => s + x.delta, 0);
};

// ── receipts ────────────────────────────────────────────────────────────────────────────────────────
const assertReceiptEligible = (p) => {
  if (p.status !== 'SUCCESS' || !p.razorpayPaymentId || !p.verifiedAt) {
    throw new TxError(409, 'A receipt is only available for a verified successful payment.', 'RECEIPT_NOT_AVAILABLE');
  }
};

/** The receipt number is assigned ONCE (atomic counter + conditional write) and never changes; the student's details are frozen with it. */
const ensureReceipt = async (user, p, exam) => {
  assertReceiptEligible(p);
  if (p.receiptNumber) return p;
  await captureMethod(OlympiadPayment, p);
  const year = istParts(p.verifiedAt).y;
  const counter = await Counter.findOneAndUpdate({ _id: `receipt:${year}` }, { $inc: { seq: 1 } }, { upsert: true, new: true });
  const number = `LQ-REC-${year}-${pad(counter.seq, 6)}`;
  const snapshot = await studentFacts(user, exam);
  const won = await OlympiadPayment.findOneAndUpdate(
    { _id: p._id, receiptNumber: { $in: [null, undefined] } },
    { $set: { receiptNumber: number, receiptIssuedAt: new Date(), receiptSnapshot: snapshot } },
    { new: true },
  );
  if (won) return won;
  return OlympiadPayment.findById(p._id); // a concurrent request assigned it first: use that number
};

const receiptData = async (user, p, exam) => {
  const issued = await ensureReceipt(user, p, exam);
  const snap = issued.receiptSnapshot || (await studentFacts(user, exam));
  return {
    receiptNumber: issued.receiptNumber, issuedAt: issued.receiptIssuedAt,
    student: { ...snap, standardText: standardText(snap.standard) },
    purpose: purposeOf(issued, exam && exam.title), componentLabel: COMPONENT_LABEL[paymentComponent(issued)], component: paymentComponent(issued),
    paidAt: issued.verifiedAt, amount: issued.amount, currency: issued.currency || 'INR',
    methodText: issued.method ? methodLabel(issued.method) : 'Razorpay', status: 'SUCCESS',
    transactionId: paymentTxnId(issued), orderId: issued.razorpayOrderId || '', paymentId: issued.razorpayPaymentId || '',
  };
};

const receiptFile = async (user, rawId) => {
  const { kind, oid } = parseId(rawId);
  if (kind !== 'pay') throw new TxError(400, 'A credit transaction has no payment receipt. Download its credit statement instead.', 'NOT_A_PAYMENT');
  const p = await loadPaymentFor(user, oid);
  const exam = await OlympiadExam.findById(p.exam);
  const data = await receiptData(user, p, exam);
  return { data, filename: `LearnIQ_Receipt_${data.receiptNumber}.pdf` };
};

const statementData = async (user, t) => {
  const facts = await studentFacts(user, null);
  const m = CREDIT_META[t.type] || { label: 'Credit transaction', componentLabel: 'Credit' };
  return {
    transactionId: creditTxnId(t), at: t.createdAt, student: { ...facts, standardText: standardText(facts.standard) },
    typeLabel: m.label, componentLabel: m.componentLabel, creditChange: t.delta,
    source: { REFERRAL: 'Referral reward', ADMIN: 'LearnIQ administrator', EXAM: 'Redeemed for an exam or interview', SYSTEM: 'System' }[t.source] || t.source,
    related: t.examTitle || '', reason: t.reason || '', balanceAfter: await balanceAfter(user._id, t),
  };
};
const statementFile = async (user, rawId) => {
  const { kind, oid } = parseId(rawId);
  if (kind !== 'crd') throw new TxError(400, 'A credit statement is only available for a credit transaction.', 'NOT_A_CREDIT');
  const t = await loadCreditFor(user, oid);
  return { data: await statementData(user, t), filename: `LearnIQ_Credit_Statement_${creditTxnId(t)}.pdf` };
};

/** Combined receipts for the selected payments. Ineligible or foreign ids are counted as excluded, never rendered. */
const bulkReceipts = async (user, ids) => {
  if (!Array.isArray(ids) || !ids.length) throw new TxError(400, 'Select at least one transaction.', 'NOTHING_SELECTED');
  const unique = [...new Set(ids.map((x) => String(x)))];
  if (unique.length > MAX_BULK) throw new TxError(400, `You can download up to ${MAX_BULK} receipts at a time.`, 'TOO_MANY');
  const receipts = []; let excluded = 0;
  for (const raw of unique) {
    try {
      const { kind, oid } = parseId(raw);
      if (kind !== 'pay') { excluded += 1; continue; }
      const p = await loadPaymentFor(user, oid);
      if (p.status !== 'SUCCESS') { excluded += 1; continue; }
      receipts.push(await receiptData(user, p, await OlympiadExam.findById(p.exam)));
    } catch (e) {
      if (e instanceof TxError) { excluded += 1; continue; }
      throw e;
    }
  }
  if (!receipts.length) throw new TxError(409, 'None of the selected transactions has a payment receipt.', 'RECEIPT_NOT_AVAILABLE');
  receipts.sort((a, b) => a.receiptNumber.localeCompare(b.receiptNumber));
  return { receipts, included: receipts.length, excluded, filename: `LearnIQ_Payment_Receipts_${ymd(new Date())}.pdf` };
};

module.exports = {
  TxError, list, detail, receiptFile, statementFile, bulkReceipts,
  // exported for tests / the PDF module
  parseQuery, parseId, istDateTime, inr, standardText, MAX_BULK, PAGE_SIZES,
};

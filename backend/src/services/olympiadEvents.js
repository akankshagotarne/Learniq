/**
 * Olympiad EVENTS (models/OlympiadEvent.js): create / edit / publish / cancel / delete-draft, the legacy migration, the derived
 * status and the student-facing access rules.
 *
 * HOW THE EXISTING SYSTEM IS MODELLED (inspected, not assumed)
 *   - One OlympiadExam document per standard. It carries the schedule (startDate / endDate / duration), the fee, the questions and
 *     everything a student does hangs off it: payments, access grants, attempts, results, interviews, certificates.
 *   - So an EVENT is the new parent: OlympiadExam.event -> OlympiadEvent. Every record that already points at an exam therefore
 *     belongs to exactly one event, with no student record copied, moved or re-labelled. Two events can fall on the same date and
 *     still stay distinct because identity is the event _id, never the date or a student's name.
 *   - Creating an event creates ONLY the event and its per-standard exam configuration (+ optionally copies the question bank of an
 *     older event). Registrations, attempts, payments, interviews and certificates of an older event are never cloned.
 *
 * STATUS (derived, never stored): draft | upcoming | registration_open | registration_closed | live | completed | cancelled.
 *   Event status, registration state, a student's exam state and result publication are separate concepts and are not conflated.
 * All administrator-facing times are Asia/Kolkata (IST). Nothing here hardcodes a particular exam date.
 */
const mongoose = require('mongoose');
const { OlympiadEvent } = require('../models/OlympiadEvent');
const { OlympiadExam, OlympiadQuestion, OlympiadPayment, OlympiadAttempt } = require('../models/Olympiad');
const { formatIST, parseInstant } = require('./engineering');
const { ordinal } = require('../seed/olympiadTitles');

class EventError extends Error {
  constructor(status, message, code, extra = {}) { super(message); this.status = status; this.code = code; this.extra = extra; }
}

const IST = 'Asia/Kolkata';
const IST_OFFSET = '+05:30';
const MAX_DURATION_MIN = 600;
const STANDARDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const STATUSES = ['draft', 'upcoming', 'registration_open', 'registration_closed', 'live', 'completed', 'cancelled'];
const LEGACY_SLUG = /^learniq-all-india-olympiad-2026-std-(\d{1,2})$/;
const DEFAULT_INSTRUCTIONS = [
  'Read every question carefully before choosing an answer.',
  'Each student has exactly one attempt. The timer keeps running once the examination has started.',
  'Do not refresh, close or leave the examination page. Your answers are saved automatically.',
  'The examination is submitted automatically when the time is over.',
];

const oid = (v) => String(v && v._id ? v._id : v);
const isOid = (v) => typeof v === 'string' && /^[a-f0-9]{24}$/i.test(v);
const ymdIST = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
const istDay = (d) => new Date(d).toLocaleDateString('en-GB', { timeZone: IST, day: 'numeric', month: 'long', year: 'numeric' });
const istMidnight = (d) => new Date(`${ymdIST(d)}T00:00:00.000${IST_OFFSET}`);
const clean = (v, max) => String(v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const slugify = (s) => String(s).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'olympiad-event';
const isDuplicateKey = (e) => e && (e.code === 11000 || e.code === 11001);
const time = (d) => (d ? new Date(d).getTime() : NaN);

// ──────────────────────────────────────────────
// Derived status (pure)
// ──────────────────────────────────────────────
/** The event's overall exam window: earliest start .. latest close of its exams (falls back to the event day). */
const windowOf = (event, exams = []) => {
  const starts = exams.map((e) => time(e.startDate)).filter(Number.isFinite);
  const ends = exams.map((e) => time(e.endDate)).filter(Number.isFinite);
  return {
    start: starts.length ? new Date(Math.min(...starts)) : new Date(event.examDate),
    end: ends.length ? new Date(Math.max(...ends)) : new Date(time(event.examDate) + 24 * 3600 * 1000),
  };
};

/** Registration state: not_open | open | closed. Follows the optional registration window, else the exam window. */
const registrationState = (event, exams = [], now = new Date()) => {
  if (event.state !== 'published') return 'closed';
  const { end } = windowOf(event, exams);
  if (event.registrationOpensAt && now < new Date(event.registrationOpensAt)) return 'not_open';
  if (event.registrationClosesAt && now >= new Date(event.registrationClosesAt)) return 'closed';
  if (now >= end) return 'closed';
  return 'open';
};

const deriveStatus = (event, exams = [], now = new Date()) => {
  if (event.state === 'cancelled') return 'cancelled';
  if (event.state !== 'published') return 'draft';
  const { start, end } = windowOf(event, exams);
  if (now >= end) return 'completed';
  if (now >= start) return 'live';
  const reg = registrationState(event, exams, now);
  if (reg === 'not_open') return 'upcoming';
  if (reg === 'closed') return 'registration_closed';
  return 'registration_open';
};

// ──────────────────────────────────────────────
// Validation (pure)
// ──────────────────────────────────────────────
const parseStandards = (raw, errors) => {
  if (!Array.isArray(raw) || !raw.length) { errors.standards = 'Choose at least one standard (1 to 10).'; return null; }
  const list = [...new Set(raw.map((v) => (typeof v === 'number' ? v : /^\d{1,2}$/.test(String(v)) ? Number(v) : NaN)))];
  if (list.some((n) => !STANDARDS.includes(n))) { errors.standards = 'Standards must be numbers from 1 to 10.'; return null; }
  return list.sort((a, b) => a - b);
};

const parseExamConfig = (raw, base, errors, prefix, now) => {
  const c = { ...base };
  const err = (k, m) => { errors[`${prefix}${k}`] = m; };
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const allowed = ['startDate', 'endDate', 'durationMinutes', 'fee', 'totalQuestions', 'totalMarks', 'instructions'];
  const unknown = Object.keys(src).filter((k) => !allowed.includes(k));
  if (unknown.length) err('', `Unknown settings: ${unknown.join(', ')}.`);
  if (src.startDate !== undefined) { const d = parseInstant(src.startDate); if (d) c.startDate = d; else err('startDate', 'Enter a valid start date and time.'); }
  if (src.endDate !== undefined) { const d = parseInstant(src.endDate); if (d) c.endDate = d; else err('endDate', 'Enter a valid closing date and time.'); }
  if (src.durationMinutes !== undefined) {
    const m = src.durationMinutes;
    if (!Number.isInteger(m) || m < 1 || m > MAX_DURATION_MIN) err('durationMinutes', `Duration must be a whole number of minutes between 1 and ${MAX_DURATION_MIN}.`); else c.durationMinutes = m;
  }
  if (src.fee !== undefined) {
    const f = src.fee;
    if (typeof f !== 'number' || !Number.isFinite(f) || f < 1 || f > 100000 || Math.round(f * 100) !== f * 100) err('fee', 'The fee must be at least ₹1 (at most two decimals).'); else c.fee = f;
  }
  for (const k of ['totalQuestions', 'totalMarks']) {
    if (src[k] === undefined) continue;
    if (!Number.isInteger(src[k]) || src[k] < 0 || src[k] > 1000) err(k, `${k === 'totalQuestions' ? 'Total questions' : 'Total marks'} must be a whole number from 0 to 1000.`); else c[k] = src[k];
  }
  if (src.instructions !== undefined) {
    const ok = Array.isArray(src.instructions) && src.instructions.length >= 1 && src.instructions.length <= 20 && src.instructions.every((t) => typeof t === 'string' && t.trim() && t.length <= 500);
    if (!ok) err('instructions', 'Provide 1-20 instruction lines of at most 500 characters each.'); else c.instructions = src.instructions.map((t) => clean(t, 500));
  }
  if (c.startDate && c.endDate && !errors[`${prefix}startDate`] && !errors[`${prefix}endDate`]) {
    if (c.endDate <= c.startDate) err('endDate', 'The closing time must be after the start time.');
    else if (c.endDate.getTime() > now.getTime() + 5 * 366 * 24 * 3600 * 1000) err('endDate', 'The closing time cannot be more than five years ahead.');
  }
  return c;
};

/** Validates a "create event" request. Returns { errors, value }. Never trusts anything the browser sends. */
const validateCreate = (body, now = new Date()) => {
  const errors = {};
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  if (!b) return { errors: { _: 'Invalid request.' }, value: null };
  const allowed = ['name', 'description', 'reference', 'standards', 'schedule', 'standardConfig', 'registrationOpensAt', 'registrationClosesAt', 'copyFromEventId', 'copyQuestions', 'publish'];
  const unknown = Object.keys(b).filter((k) => !allowed.includes(k));
  if (unknown.length) errors._ = `These settings are not accepted: ${unknown.join(', ')}.`;

  const name = typeof b.name === 'string' ? clean(b.name, 160) : '';
  if (name.length < 3) errors.name = 'The event name must be 3-160 characters.';
  const description = typeof b.description === 'string' ? b.description.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim() : '';
  if (description.length > 1000) errors.description = 'The description can be at most 1000 characters.';
  const reference = typeof b.reference === 'string' ? clean(b.reference, 60) : '';
  const standards = parseStandards(b.standards, errors);

  const schedule = parseExamConfig(b.schedule, {}, errors, 'schedule.', now);
  if (!errors['schedule.startDate'] && !schedule.startDate) errors['schedule.startDate'] = 'Enter the examination start date and time.';
  if (!errors['schedule.endDate'] && !schedule.endDate) errors['schedule.endDate'] = 'Enter the examination closing date and time.';
  if (!errors['schedule.durationMinutes'] && !schedule.durationMinutes) errors['schedule.durationMinutes'] = 'Enter the examination duration in minutes.';
  if (!errors['schedule.fee'] && schedule.fee === undefined) errors['schedule.fee'] = 'Enter the registration fee (at least ₹1).';

  const perStandard = {};
  if (b.standardConfig !== undefined) {
    if (!b.standardConfig || typeof b.standardConfig !== 'object' || Array.isArray(b.standardConfig)) errors.standardConfig = 'Invalid standard-specific settings.';
    else {
      for (const [k, v] of Object.entries(b.standardConfig)) {
        const n = /^\d{1,2}$/.test(k) ? Number(k) : NaN;
        if (!STANDARDS.includes(n) || (standards && !standards.includes(n))) { errors[`standardConfig.${k}`] = `Standard ${k} is not part of this event.`; continue; }
        perStandard[n] = parseExamConfig(v, schedule, errors, `standardConfig.${n}.`, now);
      }
    }
  }

  let opens = null; let closes = null;
  if (b.registrationOpensAt) { opens = parseInstant(b.registrationOpensAt); if (!opens) errors.registrationOpensAt = 'Enter a valid registration opening date and time.'; }
  if (b.registrationClosesAt) { closes = parseInstant(b.registrationClosesAt); if (!closes) errors.registrationClosesAt = 'Enter a valid registration closing date and time.'; }
  if (opens && closes && closes <= opens) errors.registrationClosesAt = 'Registration must close after it opens.';

  if (b.copyFromEventId !== undefined && b.copyFromEventId !== '' && !isOid(String(b.copyFromEventId))) errors.copyFromEventId = 'Choose a valid event to copy settings from.';
  for (const f of ['copyQuestions', 'publish']) if (b[f] !== undefined && typeof b[f] !== 'boolean') errors[f] = `${f} must be true or false.`;
  if (b.publish === true && b.copyQuestions !== true) errors.publish = 'An event can be published only when every exam has questions. Save it as a draft, or copy the questions from an earlier event.';

  if (Object.keys(errors).length) return { errors, value: null };
  const configs = {};
  standards.forEach((n) => { configs[n] = perStandard[n] || schedule; });
  // the registration window must not close after every exam has closed
  const lastEnd = Math.max(...Object.values(configs).map((c) => c.endDate.getTime()));
  if (closes && closes.getTime() > lastEnd) return { errors: { registrationClosesAt: 'Registration cannot close after the examination closes.' }, value: null };
  return {
    errors,
    value: {
      name, description, reference, standards, configs, registrationOpensAt: opens, registrationClosesAt: closes,
      copyFromEventId: b.copyFromEventId ? String(b.copyFromEventId) : null, copyQuestions: b.copyQuestions === true, publish: b.publish === true,
    },
  };
};

const EDITABLE_EVENT = ['name', 'description', 'reference', 'registrationOpensAt', 'registrationClosesAt'];
const CONTROL = ['expectedUpdatedAt'];

const validateEventEdit = (event, body, exams = []) => {
  const errors = {};
  const b = body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  if (!b) return { errors: { _: 'Invalid request.' }, unknown: [], changes: [], next: {} };
  const unknown = Object.keys(b).filter((k) => !EDITABLE_EVENT.includes(k) && !CONTROL.includes(k));
  if (unknown.length) return { errors, unknown, changes: [], next: {} };
  const changes = []; const next = {};
  const put = (field, previous, value, same) => { if (!same) { changes.push({ field, previous, next: value }); next[field] = value; } };
  if (b.name !== undefined) {
    const n = typeof b.name === 'string' ? clean(b.name, 160) : '';
    if (n.length < 3) errors.name = 'The event name must be 3-160 characters.'; else put('name', event.name, n, n === event.name);
  }
  if (b.description !== undefined) {
    const t = typeof b.description === 'string' ? b.description.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ' ').trim() : null;
    if (t === null || t.length > 1000) errors.description = 'The description can be at most 1000 characters.'; else put('description', event.description || '', t, t === (event.description || ''));
  }
  if (b.reference !== undefined) {
    const t = typeof b.reference === 'string' ? clean(b.reference, 60) : null;
    if (t === null) errors.reference = 'Invalid reference.'; else put('reference', event.reference || '', t, t === (event.reference || ''));
  }
  let opens = event.registrationOpensAt ? new Date(event.registrationOpensAt) : null;
  let closes = event.registrationClosesAt ? new Date(event.registrationClosesAt) : null;
  const parseNullable = (raw, field, label) => {
    if (raw === null || raw === '') return { ok: true, value: null };
    const d = parseInstant(raw);
    if (!d) { errors[field] = `Enter a valid ${label} date and time, or leave it empty.`; return { ok: false }; }
    return { ok: true, value: d };
  };
  let touched = false;
  if (b.registrationOpensAt !== undefined) { const r = parseNullable(b.registrationOpensAt, 'registrationOpensAt', 'registration opening'); if (r.ok) { opens = r.value; touched = true; } }
  if (b.registrationClosesAt !== undefined) { const r = parseNullable(b.registrationClosesAt, 'registrationClosesAt', 'registration closing'); if (r.ok) { closes = r.value; touched = true; } }
  if (touched && !errors.registrationOpensAt && !errors.registrationClosesAt) {
    if (opens && closes && closes <= opens) errors.registrationClosesAt = 'Registration must close after it opens.';
    else {
      const { end } = windowOf(event, exams);
      if (closes && closes > end) errors.registrationClosesAt = 'Registration cannot close after the examination closes.';
      else {
        const same = (a, c) => (a ? a.getTime() : null) === (c ? new Date(c).getTime() : null);
        if (b.registrationOpensAt !== undefined) put('registrationOpensAt', event.registrationOpensAt || null, opens, same(opens, event.registrationOpensAt));
        if (b.registrationClosesAt !== undefined) put('registrationClosesAt', event.registrationClosesAt || null, closes, same(closes, event.registrationClosesAt));
      }
    }
  }
  return { errors, unknown: [], changes, next };
};

// ──────────────────────────────────────────────
// Reading
// ──────────────────────────────────────────────
const NOT_ENGINEERING = { examType: { $ne: 'engineering' } };

const examsOfEvent = async (eventId) => OlympiadExam.find({ event: eventId, ...NOT_ENGINEERING }).sort({ standard: 1 });

/** Exam ids that belong to an event (used by every event-scoped admin query). */
const examIdsOfEvent = async (eventId) => (await OlympiadExam.find({ event: eventId, ...NOT_ENGINEERING }).select('_id')).map((e) => e._id);

const loadEvent = async (id) => {
  if (!isOid(String(id))) throw new EventError(404, 'Olympiad event not found.', 'EVENT_NOT_FOUND');
  const event = await OlympiadEvent.findById(id);
  if (!event) throw new EventError(404, 'Olympiad event not found.', 'EVENT_NOT_FOUND');
  return event;
};

/** Registrations / submissions use the SAME counting rules as Olympiad Student Analytics (one source of truth). */
const countsFor = async (eventId) => {
  const analytics = require('./olympiadAnalytics');
  const data = await analytics.loadRegistrations({ exam: 'all', standard: 'all', event: String(eventId) });
  const registered = data.rows.filter((r) => r.registered);
  return {
    registrations: registered.length,
    submissions: registered.filter((r) => r.examStatus === 'SUBMITTED').length,
    students: new Set(registered.map((r) => r.studentId)).size,
    needsReview: data.rows.filter((r) => r.flags && r.flags.length).length,
  };
};

const eventView = (event, exams, counts, now = new Date()) => {
  const { start, end } = windowOf(event, exams);
  return {
    _id: oid(event), name: event.name, slug: event.slug, reference: event.reference || '', description: event.description || '',
    examDate: event.examDate, examDateIST: istDay(event.examDate),
    standards: (event.standards && event.standards.length ? event.standards : exams.map((e) => e.standard)).slice().sort((a, b) => a - b),
    state: event.state, status: deriveStatus(event, exams, now), registration: registrationState(event, exams, now),
    startDate: start, endDate: end, startDateIST: formatIST(start), endDateIST: formatIST(end),
    registrationOpensAt: event.registrationOpensAt || null, registrationClosesAt: event.registrationClosesAt || null,
    registrationOpensAtIST: event.registrationOpensAt ? formatIST(event.registrationOpensAt) : '', registrationClosesAtIST: event.registrationClosesAt ? formatIST(event.registrationClosesAt) : '',
    examCount: exams.length, isLegacy: !!event.isLegacy,
    cancelledAt: event.cancelledAt || null, cancelReason: event.cancelReason || '',
    updatedAt: event.updatedAt || event.createdAt || null,
    ...(counts || {}),
  };
};

const examSummary = (e, now) => ({
  _id: oid(e), title: e.title, standard: e.standard, startDate: e.startDate, endDate: e.endDate,
  startDateIST: formatIST(e.startDate), endDateIST: formatIST(e.endDate), durationMinutes: e.durationMinutes,
  totalQuestions: e.totalQuestions, totalMarks: e.totalMarks, fee: e.fee, isPublished: e.isPublished !== false,
  status: e.isPublished === false ? 'draft' : now < e.startDate ? 'upcoming' : now >= e.endDate ? 'closed' : 'live',
});

/** Admin list: every event (with real counts) + optional search / standard / status / date filters. */
const listEvents = async (query = {}, now = new Date()) => {
  const events = await OlympiadEvent.find({}).sort({ examDate: -1 });
  const search = typeof query.search === 'string' ? query.search.trim().toLowerCase().slice(0, 100) : '';
  let std = null;
  if (query.standard !== undefined && query.standard !== '' && query.standard !== 'all') {
    std = /^\d{1,2}$/.test(String(query.standard)) ? Number(query.standard) : NaN;
    if (!STANDARDS.includes(std)) throw new EventError(400, 'Standard must be "all" or a number from 1 to 10.', 'INVALID_STANDARD');
  }
  const status = query.status && query.status !== 'all' ? String(query.status) : null;
  if (status && !STATUSES.includes(status)) throw new EventError(400, 'Invalid status.', 'INVALID_STATUS');
  const day = (s, end) => {
    if (s === undefined || s === '') return null;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? new Date(`${s}T${end ? '23:59:59.999' : '00:00:00'}${IST_OFFSET}`) : null;
    if (!d || Number.isNaN(d.getTime())) throw new EventError(400, 'Dates must be in YYYY-MM-DD format.', 'INVALID_DATE');
    return d;
  };
  const from = day(query.from, false); const to = day(query.to, true);
  const out = [];
  for (const ev of events) {
    const exams = await examsOfEvent(ev._id);
    const view = eventView(ev, exams, null, now);
    if (search && !`${view.name} ${view.reference}`.toLowerCase().includes(search)) continue;
    if (std !== null && !view.standards.includes(std)) continue;
    if (status && view.status !== status) continue;
    if (from && new Date(ev.examDate) < from) continue;
    if (to && new Date(ev.examDate) > to) continue;
    out.push({ ...view, ...(await countsFor(ev._id)) });
  }
  return out;
};

/** Light list for the shared selector (no counts): real events only, newest first, with the sensible default. */
const eventOptions = async (now = new Date()) => {
  const events = await OlympiadEvent.find({}).sort({ examDate: -1 });
  const options = [];
  for (const ev of events) {
    const exams = await examsOfEvent(ev._id);
    const v = eventView(ev, exams, null, now);
    options.push({ _id: v._id, name: v.name, examDate: v.examDate, examDateIST: v.examDateIST, status: v.status, state: v.state, standards: v.standards, isLegacy: v.isLegacy });
  }
  const pick = (st) => options.filter((o) => st.includes(o.status));
  const live = pick(['live']);
  const upcoming = pick(['registration_open', 'registration_closed', 'upcoming']).sort((a, b) => new Date(a.examDate) - new Date(b.examDate));
  const done = pick(['completed']);
  const defaultEventId = (live[0] || upcoming[0] || done[0] || options[0] || {})._id || null;
  return { options, defaultEventId };
};

const eventDetail = async (id, now = new Date()) => {
  const event = await loadEvent(id);
  const exams = await examsOfEvent(event._id);
  return { event: eventView(event, exams, await countsFor(event._id), now), exams: exams.map((e) => examSummary(e, now)) };
};

// ──────────────────────────────────────────────
// Writing
// ──────────────────────────────────────────────
const auditRows = async (event, exams, admin, field, previous, next, note) => {
  try {
    const { OlympiadExamAudit } = require('../models/OlympiadExamAudit');
    const changeId = require('crypto').randomBytes(8).toString('hex');
    for (const e of exams.length ? exams : [null]) {
      if (!e) break;
      await OlympiadExamAudit.create({ exam: e._id, examTitle: e.title, standard: e.standard, admin: admin._id, adminName: admin.name, changeId, field: `event:${field}`, previous, next, success: true, ...(note ? { note: String(note).slice(0, 300) } : {}) });
    }
  } catch (err) { console.error('[olympiad-events] audit write failed:', err.message); }
};

const uniqueSlug = async (base) => {
  let slug = base;
  for (let i = 2; i < 50; i += 1) {
    if (!(await OlympiadEvent.findOne({ slug })) && !(await OlympiadExam.findOne({ slug: `${slug}-std-1` }))) return slug;
    slug = `${base}-${i}`;
  }
  return `${base}-${require('crypto').randomBytes(3).toString('hex')}`;
};

/** Create ONLY the new event and its intended examination configurations. Nothing belonging to an older event is cloned. */
const createEvent = async (body, admin, now = new Date()) => {
  const { errors, value } = validateCreate(body, now);
  if (!value) throw new EventError(400, 'Please correct the highlighted fields.', 'VALIDATION_ERROR', { errors });

  const dupe = (await OlympiadEvent.find({})).find((e) => e.name.trim().toLowerCase() === value.name.toLowerCase());
  if (dupe) throw new EventError(409, 'An Olympiad event with this name already exists. Use a different name (for example, include the date).', 'DUPLICATE_NAME', { errors: { name: 'This name is already used by another event.' } });

  let source = null; let sourceExams = [];
  if (value.copyFromEventId) {
    source = await OlympiadEvent.findById(value.copyFromEventId);
    if (!source) throw new EventError(404, 'The event to copy settings from was not found.', 'SOURCE_NOT_FOUND', { errors: { copyFromEventId: 'This event no longer exists.' } });
    sourceExams = await examsOfEvent(source._id);
  }
  const srcFor = (std) => sourceExams.find((e) => e.standard === std) || null;
  if (value.copyQuestions) {
    const missing = value.standards.filter((n) => !srcFor(n));
    if (missing.length) throw new EventError(422, `The selected event has no Standard ${missing.join(', ')} exam to copy questions from.`, 'NOTHING_TO_COPY', { errors: { copyQuestions: `No source exam for Standard ${missing.join(', ')}.` } });
  }

  const slug = await uniqueSlug(slugify(value.name));
  const firstStart = new Date(Math.min(...Object.values(value.configs).map((c) => c.startDate.getTime())));
  let event;
  try {
    event = await OlympiadEvent.create({
      name: value.name, slug, reference: value.reference || undefined, description: value.description || undefined,
      examDate: istMidnight(firstStart), standards: value.standards, state: 'draft',
      registrationOpensAt: value.registrationOpensAt, registrationClosesAt: value.registrationClosesAt, createdBy: admin._id, updatedBy: admin._id,
    });
  } catch (err) {
    if (isDuplicateKey(err)) throw new EventError(409, 'An Olympiad event with this name already exists.', 'DUPLICATE_NAME', { errors: { name: 'This name is already used by another event.' } });
    throw err;
  }

  const created = [];
  try {
    for (const std of value.standards) {
      const cfg = value.configs[std];
      const src = srcFor(std);
      const srcQuestions = value.copyQuestions && src ? await OlympiadQuestion.find({ exam: src._id }).select('+correctAnswer +explanation').sort({ questionNumber: 1 }) : [];
      const exam = await OlympiadExam.create({
        event: event._id, title: `${value.name} – ${ordinal(std)} Standard`, slug: `${slug}-std-${std}`,
        description: src ? src.description : undefined, conductedBy: src ? src.conductedBy : undefined, teacher: src ? src.teacher : undefined,
        examType: 'olympiad', category: src ? src.category : undefined, standard: std, accessMode: 'payment', accessEnabled: true, hardClose: false,
        instructions: cfg.instructions || (src && src.instructions && src.instructions.length ? src.instructions : DEFAULT_INSTRUCTIONS),
        sections: src ? (src.sections || []).map((s) => ({ name: s.name, questionCount: s.questionCount, marks: s.marks })) : [],
        startDate: cfg.startDate, endDate: cfg.endDate, durationMinutes: cfg.durationMinutes,
        totalQuestions: srcQuestions.length ? srcQuestions.length : (cfg.totalQuestions || 0),
        totalMarks: srcQuestions.length ? srcQuestions.reduce((s, q) => s + (q.marks || 0), 0) : (cfg.totalMarks || 0),
        negativeMarking: src ? !!src.negativeMarking : false, negativeMarkValue: src ? src.negativeMarkValue || 0 : 0,
        fee: cfg.fee, currency: 'INR', isPublished: false,
        ...(src && src.proctoring ? { proctoring: typeof src.proctoring.toObject === 'function' ? src.proctoring.toObject() : src.proctoring } : {}),
      });
      created.push(exam);
      if (srcQuestions.length) {
        await OlympiadQuestion.insertMany(srcQuestions.map((q) => ({
          exam: exam._id, questionNumber: q.questionNumber, subject: q.subject, questionText: q.questionText, options: q.options,
          correctAnswer: q.correctAnswer, marks: q.marks, explanation: q.explanation, image: q.image,
        })));
      }
    }
  } catch (err) {
    // roll back ONLY what this call created (brand-new documents; nothing historical is touched)
    for (const e of created) { await OlympiadQuestion.deleteMany({ exam: e._id }).catch(() => {}); await OlympiadExam.deleteOne({ _id: e._id }).catch(() => {}); }
    await OlympiadEvent.deleteOne({ _id: event._id }).catch(() => {});
    if (isDuplicateKey(err)) throw new EventError(409, 'An exam with the same identifier already exists. Choose a different event name.', 'DUPLICATE_EXAM', { errors: { name: 'This name clashes with an existing exam identifier.' } });
    console.error('[olympiad-events] create failed, rolled back:', err.message);
    throw new EventError(500, 'The event could not be created. Nothing was saved; please try again.', 'CREATE_FAILED');
  }
  await auditRows(event, created, admin, 'created', null, event.name);
  if (value.publish) return { ...(await publishEvent(event._id, admin, now)), created: true };
  return { ...(await eventDetail(event._id, now)), created: true };
};

const updateEvent = async (id, body, admin, now = new Date()) => {
  const event = await loadEvent(id);
  const exams = await examsOfEvent(event._id);
  const { unknown, errors, changes, next } = validateEventEdit(event, body || {}, exams);
  if (unknown.length) throw new EventError(400, `These settings cannot be changed here: ${unknown.join(', ')}.`, 'INVALID_REQUEST');
  if (body.expectedUpdatedAt !== undefined) {
    const expected = new Date(body.expectedUpdatedAt).getTime();
    const current = event.updatedAt ? new Date(event.updatedAt).getTime() : null;
    if (Number.isNaN(expected) || (current !== null && expected !== current)) throw new EventError(409, 'This event was changed by someone else. Reload it to see the latest values, then apply your change again.', 'STALE_EVENT');
  }
  if (Object.keys(errors).length) throw new EventError(400, 'Please correct the highlighted fields.', 'VALIDATION_ERROR', { errors });
  if (event.state === 'cancelled') throw new EventError(409, 'A cancelled event cannot be edited.', 'EVENT_CANCELLED');
  if (next.name) {
    const clash = (await OlympiadEvent.find({})).find((e) => oid(e) !== oid(event) && e.name.trim().toLowerCase() === next.name.toLowerCase());
    if (clash) throw new EventError(409, 'An Olympiad event with this name already exists.', 'DUPLICATE_NAME', { errors: { name: 'This name is already used by another event.' } });
  }
  if (!changes.length) return { ...(await eventDetail(event._id, now)), changed: [] };
  const guard = { _id: event._id };
  if (event.updatedAt) guard.updatedAt = event.updatedAt;
  const set = { ...next, updatedBy: admin._id };
  const updated = await OlympiadEvent.findOneAndUpdate(guard, { $set: set }, { new: true });
  if (!updated) throw new EventError(409, 'This event was changed by someone else while you were saving. Reload it and apply your change again.', 'STALE_EVENT');
  for (const c of changes) await auditRows(updated, exams, admin, c.field, c.previous, c.next);
  return { ...(await eventDetail(updated._id, now)), changed: changes.map((c) => c.field) };
};

const holdsRecords = async (examIds) => {
  if (!examIds.length) return false;
  const { OlympiadAccessGrant } = require('../models/ExamAccess');
  const [pay, att, grant] = await Promise.all([
    OlympiadPayment.countDocuments({ exam: { $in: examIds } }), OlympiadAttempt.countDocuments({ exam: { $in: examIds } }),
    OlympiadAccessGrant.countDocuments({ exam: { $in: examIds } }),
  ]);
  return pay + att + grant > 0;
};

const publishEvent = async (id, admin, now = new Date()) => {
  const event = await loadEvent(id);
  if (event.state === 'cancelled') throw new EventError(409, 'A cancelled event cannot be published.', 'EVENT_CANCELLED');
  const exams = await examsOfEvent(event._id);
  if (!exams.length) throw new EventError(422, 'This event has no examinations.', 'NOT_READY');
  if (event.state !== 'published') {
    const empty = [];
    for (const e of exams) if ((await OlympiadQuestion.countDocuments({ exam: e._id })) < 1) empty.push(e.standard);
    if (empty.length) throw new EventError(422, `These exams have no questions yet, so the event cannot be published: Standard ${empty.join(', ')}.`, 'NOT_READY', { standards: empty });
  }
  await OlympiadEvent.updateOne({ _id: event._id }, { $set: { state: 'published', publishedAt: event.publishedAt || now, updatedBy: admin._id } });
  await OlympiadExam.updateMany({ event: event._id, ...NOT_ENGINEERING }, { $set: { isPublished: true } });
  await auditRows(event, exams, admin, 'state', event.state, 'published');
  return eventDetail(event._id, now);
};

/** published -> draft: only while nobody has registered (otherwise the event must be cancelled, which keeps every record). */
const unpublishEvent = async (id, admin, now = new Date()) => {
  const event = await loadEvent(id);
  if (event.state !== 'published') throw new EventError(409, 'Only a published event can be moved back to draft.', 'INVALID_STATE');
  const exams = await examsOfEvent(event._id);
  if (await holdsRecords(exams.map((e) => e._id))) throw new EventError(409, 'Students have already registered for this event, so it cannot go back to draft. Cancel the event instead; all records are kept.', 'HAS_RECORDS');
  await OlympiadEvent.updateOne({ _id: event._id }, { $set: { state: 'draft', updatedBy: admin._id } });
  await OlympiadExam.updateMany({ event: event._id, ...NOT_ENGINEERING }, { $set: { isPublished: false } });
  await auditRows(event, exams, admin, 'state', 'published', 'draft');
  return eventDetail(event._id, now);
};

/** Cancelling keeps every registration, payment, attempt, result, interview and certificate; it only stops new access. */
const cancelEvent = async (id, body, admin, now = new Date()) => {
  const event = await loadEvent(id);
  if (event.state === 'cancelled') throw new EventError(409, 'This event is already cancelled.', 'INVALID_STATE');
  const reason = body && typeof body.reason === 'string' ? clean(body.reason, 300) : '';
  const exams = await examsOfEvent(event._id);
  await OlympiadEvent.updateOne({ _id: event._id }, { $set: { state: 'cancelled', cancelledAt: now, cancelReason: reason || undefined, updatedBy: admin._id } });
  await auditRows(event, exams, admin, 'state', event.state, 'cancelled', reason);
  return eventDetail(event._id, now);
};

/** Deleting is allowed ONLY for an unused draft event; it can never be used to remove submissions, payments or other records. */
const deleteEvent = async (id, admin) => {
  const event = await loadEvent(id);
  if (event.isLegacy) throw new EventError(409, 'The original event holds historical records and cannot be deleted.', 'PROTECTED');
  if (event.state !== 'draft') throw new EventError(409, 'Only a draft event can be deleted. Cancel a published event instead; its records are kept.', 'NOT_DRAFT');
  const exams = await examsOfEvent(event._id);
  const ids = exams.map((e) => e._id);
  const protectedKinds = [];
  if (ids.length) {
    const { OlympiadAccessGrant } = require('../models/ExamAccess');
    const { Certificate } = require('../models/Certificate');
    const { TeacherInterview } = require('../models/TeacherInterview');
    const counts = await Promise.all([
      OlympiadPayment.countDocuments({ exam: { $in: ids } }), OlympiadAttempt.countDocuments({ exam: { $in: ids } }),
      OlympiadAccessGrant.countDocuments({ exam: { $in: ids } }), Certificate.countDocuments({ exam: { $in: ids } }), TeacherInterview.countDocuments({ exam: { $in: ids } }),
    ]);
    ['payments', 'attempts', 'access grants', 'certificates', 'interviews'].forEach((k, i) => { if (counts[i] > 0) protectedKinds.push(k); });
  }
  if (protectedKinds.length) throw new EventError(409, `This event has ${protectedKinds.join(', ')} and cannot be deleted.`, 'HAS_RECORDS');
  for (const e of exams) { await OlympiadQuestion.deleteMany({ exam: e._id }); await OlympiadExam.deleteOne({ _id: e._id }); }
  await OlympiadEvent.deleteOne({ _id: event._id });
  return { deleted: true, name: event.name, examsRemoved: exams.length };
};

// ──────────────────────────────────────────────
// Student-facing rules (server side; the UI only mirrors them)
// ──────────────────────────────────────────────
/** The event of an exam (or null for an exam outside the event model). Always a fresh read: an admin change is effective immediately, nothing is cached. */
const eventOfExam = async (exam) => {
  if (!exam || !exam.event) return null;
  return OlympiadEvent.findById(exam.event);
};

/**
 * Students must never reach a DRAFT event's exams, and a CANCELLED event accepts no new registration / start.
 * `purpose`: 'view' (draft blocked) | 'register' | 'start' (draft and cancelled blocked) | 'register' also enforces the event registration window.
 * @throws {EventError} with a student-safe message
 */
const assertEventAvailable = async (exam, purpose = 'view', now = new Date()) => {
  const event = await eventOfExam(exam);
  if (!event) return null;
  if (event.state === 'draft') throw new EventError(404, 'Examination not found.', 'EXAM_NOT_FOUND');
  if (event.state === 'cancelled' && purpose !== 'view') throw new EventError(403, 'This Olympiad event has been cancelled.', 'EVENT_CANCELLED');
  if (purpose === 'register') {
    const exams = await examsOfEvent(event._id);
    const reg = registrationState(event, exams, now);
    if (reg === 'not_open') throw new EventError(403, `Registration for this Olympiad opens on ${formatIST(event.registrationOpensAt)}.`, 'REGISTRATION_NOT_OPEN');
    if (reg === 'closed') throw new EventError(403, 'Registration is closed.', 'CLOSED');
  }
  return event;
};

/** { eventId, eventName } for a list of exams (one query). */
const eventLabels = async (exams) => {
  const ids = [...new Set(exams.map((e) => (e.event ? oid(e.event) : null)).filter(Boolean))];
  if (!ids.length) return new Map();
  const events = await OlympiadEvent.find({ _id: { $in: ids } }).select('name examDate state');
  return new Map(events.map((e) => [oid(e), { eventId: oid(e), eventName: e.name, eventDate: e.examDate, eventState: e.state }]));
};

// ──────────────────────────────────────────────
// Legacy migration (additive; reversible with `$unset: { event }`)
// ──────────────────────────────────────────────
/**
 * Read-only plan: which existing exams can be associated with an event WITHOUT guessing.
 *   - Only the exams of the original Olympiad (the seeded `learniq-all-india-olympiad-2026-std-N` records) are associated; they are
 *     all one occasion, so they form ONE event named after the earliest start date stored on them (the stored dates are never altered).
 *   - Any other exam without an event is listed under `needsReview` and left untouched.
 */
const planLegacy = async () => {
  const unlinked = await OlympiadExam.find({ ...NOT_ENGINEERING, event: null });
  const matched = []; const needsReview = [];
  for (const e of unlinked) {
    if (LEGACY_SLUG.test(String(e.slug || '')) && Number.isFinite(time(e.startDate))) matched.push(e);
    else needsReview.push({ _id: oid(e), title: e.title, standard: e.standard, slug: e.slug, reason: Number.isFinite(time(e.startDate)) ? 'The exam was not part of the original Olympiad (unrecognised identifier).' : 'The exam has no start date.' });
  }
  const perExam = [];
  for (const e of matched) {
    const [payments, attempts] = await Promise.all([OlympiadPayment.countDocuments({ exam: e._id }), OlympiadAttempt.countDocuments({ exam: e._id })]);
    perExam.push({ _id: oid(e), title: e.title, standard: e.standard, slug: e.slug, startDate: e.startDate, payments, attempts });
  }
  const start = matched.length ? new Date(Math.min(...matched.map((e) => time(e.startDate)))) : null;
  return {
    toAssociate: perExam,
    proposedEvent: start ? { name: `LearnIQ Olympiad — ${istDay(start)}`, slug: `learniq-olympiad-${ymdIST(start)}`, examDate: istMidnight(start), standards: matched.map((e) => e.standard).sort((a, b) => a - b) } : null,
    needsReview,
    alreadyAssociated: await OlympiadExam.countDocuments({ ...NOT_ENGINEERING, event: { $ne: null } }),
  };
};

/** Applies the plan. Idempotent (safe on every start-up) and race-safe: each exam is updated only while it still has no event. */
const migrateLegacy = async ({ apply = false, log = console.log } = {}) => {
  const plan = await planLegacy();
  if (!apply || !plan.proposedEvent) return { applied: false, plan, associated: 0 };
  const p = plan.proposedEvent;
  let event = await OlympiadEvent.findOne({ slug: p.slug });
  if (!event) {
    try {
      event = await OlympiadEvent.create({ name: p.name, slug: p.slug, examDate: p.examDate, standards: p.standards, state: 'published', isLegacy: true, publishedAt: new Date() });
      log(`📅 Olympiad event created for the original exams: ${p.name}`);
    } catch (err) { if (isDuplicateKey(err)) event = await OlympiadEvent.findOne({ slug: p.slug }); else throw err; }
  }
  let associated = 0;
  for (const row of plan.toAssociate) {
    const r = await OlympiadExam.updateOne({ _id: row._id, event: null }, { $set: { event: event._id } });
    if ((r.modifiedCount !== undefined ? r.modifiedCount : r.nModified) > 0) associated += 1;
  }
  if (associated) {
    const all = await examsOfEvent(event._id);
    await OlympiadEvent.updateOne({ _id: event._id }, { $set: { standards: all.map((e) => e.standard).sort((a, b) => a - b) } });
    log(`📅 ${associated} existing Olympiad exam(s) associated with "${event.name}" (no dates, questions or student records changed)`);
  }
  return { applied: true, plan, associated, eventId: oid(event) };
};

module.exports = {
  EventError, STATUSES, STANDARDS, MAX_DURATION_MIN,
  windowOf, registrationState, deriveStatus, validateCreate, validateEventEdit,
  examsOfEvent, examIdsOfEvent, loadEvent, eventView, listEvents, eventOptions, eventDetail,
  createEvent, updateEvent, publishEvent, unpublishEvent, cancelEvent, deleteEvent,
  eventOfExam, assertEventAvailable, eventLabels, planLegacy, migrateLegacy, slugify,
};

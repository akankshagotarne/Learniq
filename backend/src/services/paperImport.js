/**
 * Question-paper import for the 24 October 2026 Olympiad (Standards 1-10), driven by the files in data/oct24/.
 *
 *   plan(eventId)   read-only report: what an import WOULD do (found / insert / update / unchanged / duplicates avoided / manual review / images).
 *   apply(eventId)  performs it. Safe to run any number of times:
 *     - an imported question has a stable identity (`<set>:std<N>:q<n>` in OlympiadQuestion.sourceRef) and is matched on
 *       (exam, questionNumber), so a re-run updates in place and never creates a second copy;
 *     - only the exams of THE chosen event are touched, and only an event dated 24 Oct 2026 (IST) that is not the original/legacy event;
 *     - an exam that already has attempts keeps its questions untouched (reported as locked) - answers of real students are never invalidated;
 *     - content that the source PDF itself does not contain is NEVER invented: it is listed in `review` and blocks publishing the event.
 *
 * The answer key stays on the server (OlympiadQuestion.correctAnswer is select:false); it is never part of any response of this module.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const cfg = require('../config/oct24Event');
const { OlympiadEvent } = require('../models/OlympiadEvent');
const { OlympiadExam, OlympiadQuestion, OlympiadAttempt } = require('../models/Olympiad');
const events = require('./olympiadEvents');
const { ordinal } = require('../seed/olympiadTitles');

const { EventError } = events;
const IST = 'Asia/Kolkata';
const ymdIST = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
const oid = (v) => String(v && v._id ? v._id : v);
const sameInstant = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);
const PUBLIC_ROOT = path.join(__dirname, '..', '..', '..', 'frontend', 'public');

const locks = new Set(); // one import per event at a time inside this process; the unique indexes guard across processes

/** Reads and validates one standard's paper file. Returns { paper, problems } - problems make the standard un-importable. */
const loadPaper = (standard, dir = cfg.DATA_DIR) => {
  const file = path.join(dir, `std${standard}.json`);
  if (!fs.existsSync(file)) return { paper: null, problems: [`Paper file std${standard}.json is missing.`] };
  let paper;
  try { paper = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return { paper: null, problems: [`std${standard}.json is not valid JSON.`] }; }
  const problems = []; const warnings = [];
  if (paper.standard !== standard) problems.push(`The file says Standard ${paper.standard}.`);
  const seen = new Set();
  for (const q of paper.questions || []) {
    const tag = `Q${q.n}`;
    if (!Number.isInteger(q.n) || q.n < 1) problems.push(`${tag}: invalid question number.`);
    if (seen.has(q.n)) problems.push(`${tag}: appears twice in the source file.`);
    seen.add(q.n);
    if (!q.text || !String(q.text).trim()) problems.push(`${tag}: empty question text.`);
    if (!Array.isArray(q.options) || q.options.length < 2 || q.options.some((o) => !String(o).trim())) problems.push(`${tag}: options are missing or empty.`);
    else if (new Set(q.options.map((o) => String(o).trim())).size !== q.options.length) {
      // identical option text in the source: harmless when only wrong options repeat (the key is unambiguous), blocking when the KEY itself repeats
      const key = String(q.options[q.answer] || '').trim();
      if (q.options.filter((o) => String(o).trim() === key).length > 1) problems.push(`${tag}: the correct answer's text appears twice among the options.`);
      else warnings.push({ question: q.n, issue: 'Two wrong options have identical text in the source paper (kept as printed; the correct answer is unambiguous).' });
    }
    if (!Number.isInteger(q.answer) || !q.options || q.answer < 0 || q.answer >= q.options.length) problems.push(`${tag}: the correct answer is missing or out of range.`);
    if (!Number.isInteger(q.section) || !paper.sections || !paper.sections[q.section]) problems.push(`${tag}: it does not belong to a section.`);
  }
  return { paper, problems, warnings };
};

/** Question numbers the paper should contain but does not (e.g. a question cut off in the source PDF). */
const reviewOf = (standard, paper) => {
  const review = [...(paper.review || [])];
  const have = new Set((paper.questions || []).map((q) => q.n));
  const expected = cfg.expectedQuestions[standard];
  for (let n = 1; n <= expected; n += 1) {
    if (!have.has(n) && !review.some((r) => r.question === n)) review.push({ question: n, issue: 'Missing from the imported paper.' });
  }
  return review.sort((a, b) => a.question - b.question);
};

const questionDoc = (examId, paper, q) => {
  const sec = paper.sections[q.section];
  return {
    exam: examId, questionNumber: q.n, subject: sec.name, section: sec.name, sectionMr: sec.nameMr || undefined,
    questionText: String(q.text).trim(), questionTextMr: q.textMr ? String(q.textMr).trim() : undefined,
    visual: q.visual ? String(q.visual).trim() : undefined, image: q.image || undefined,
    options: q.options.map((o) => String(o).trim()), correctAnswer: q.answer, marks: q.marks ?? 1,
    explanation: q.explanation || undefined, sourceRef: `${cfg.PAPER_SET}:std${paper.standard}:q${q.n}`,
    provenance: q.provenance ? { kind: q.provenance.kind, fields: q.provenance.fields, original: q.provenance.original || undefined, basis: q.provenance.basis } : undefined,
  };
};
const FIELDS = ['subject', 'section', 'sectionMr', 'questionText', 'questionTextMr', 'visual', 'image', 'correctAnswer', 'marks', 'explanation', 'sourceRef'];
const provKey = (p) => (p && p.kind ? JSON.stringify({ kind: p.kind, fields: [...(p.fields || [])], original: p.original || null, basis: p.basis || null }) : null);
const differs = (existing, doc) => FIELDS.some((f) => (existing[f] ?? undefined) !== (doc[f] ?? undefined)) || JSON.stringify(existing.options || []) !== JSON.stringify(doc.options) || provKey(existing.provenance) !== provKey(doc.provenance);

/** The event must be the real 24 Oct 2026 event: never the original (17 Oct / legacy) one, never a cancelled one. */
const loadTarget = async (eventId) => {
  const event = await events.loadEvent(eventId);
  if (event.isLegacy) throw new EventError(422, 'This is the original event; the 24 October papers can only be imported into the 24 October 2026 event.', 'WRONG_EVENT');
  if (event.state === 'cancelled') throw new EventError(409, 'A cancelled event cannot receive a question paper.', 'EVENT_CANCELLED');
  if (ymdIST(event.examDate) !== cfg.EVENT_DAY) throw new EventError(422, `This event is dated ${ymdIST(event.examDate)}; the papers belong to the 24 October 2026 event.`, 'WRONG_EVENT');
  return event;
};

/** The Olympiad events that may receive this import (for the admin's selector). */
const candidates = async () => {
  const all = await OlympiadEvent.find({});
  return all.filter((e) => !e.isLegacy && e.state !== 'cancelled' && ymdIST(e.examDate) === cfg.EVENT_DAY).map((e) => ({ _id: oid(e), name: e.name, state: e.state, paperSet: e.paperSet || null }));
};

const settingsDiff = (event) => {
  const t = { examFee: cfg.FEES.exam, interviewFee: cfg.FEES.interview, registrationClosesAt: cfg.registrationClosesAt, interviewOpensAt: cfg.interview.opensAt, interviewClosesAt: cfg.interview.closesAt, resultsPublishAt: cfg.resultsPublishAt, paperSet: cfg.PAPER_SET };
  return Object.entries(t).map(([field, target]) => {
    const current = event[field] ?? null;
    const same = target instanceof Date ? sameInstant(current, target) : current === target;
    return { field, current, target, changed: !same };
  });
};

const imageState = (image) => {
  if (!image) return null;
  const local = path.join(PUBLIC_ROOT, image.replace(/^\/+/, ''));
  return fs.existsSync(local) ? 'found' : 'not-checkable-on-this-host';
};

const planStandard = async (event, standard, exam) => {
  const { paper, problems, warnings } = loadPaper(standard);
  const out = { completions: paper ? (paper.completions || []) : [], warnings: warnings || [], standard, source: paper && paper.source, found: paper ? (paper.questions || []).length : 0, expected: cfg.expectedQuestions[standard], examId: exam ? oid(exam) : null, examExists: !!exam, problems, review: [], inserted: 0, updated: 0, unchanged: 0, removed: 0, duplicatesAvoided: 0, imagesAssociated: 0, imageFiles: [], locked: false, lockedReason: null, durationInPdf: paper ? paper.durationMinutes : null, durationNow: exam ? exam.durationMinutes : null, sourceIssues: paper ? paper.sourceIssues || [] : [] };
  if (!paper || problems.length) return { out, paper: null };
  out.review = reviewOf(standard, paper);
  const attempts = exam ? await OlympiadAttempt.countDocuments({ exam: exam._id }) : 0;
  out.attempts = attempts;
  const existing = exam ? await OlympiadQuestion.find({ exam: exam._id }).select('+correctAnswer +explanation') : [];
  const byNo = new Map(existing.map((q) => [q.questionNumber, q]));
  const incoming = new Set();
  for (const q of paper.questions) {
    incoming.add(q.n);
    const doc = questionDoc(exam ? exam._id : null, paper, q);
    const cur = byNo.get(q.n);
    if (!cur) out.inserted += 1;
    else { out.duplicatesAvoided += 1; if (differs(cur, doc)) out.updated += 1; else out.unchanged += 1; }
    if (q.image) { out.imagesAssociated += 1; out.imageFiles.push({ question: q.n, image: q.image, file: imageState(q.image) }); }
  }
  out.removed = existing.filter((q) => !incoming.has(q.questionNumber)).length;
  if (attempts > 0 && (out.inserted || out.updated || out.removed)) {
    out.locked = true; out.lockedReason = `${attempts} student attempt(s) already exist for this exam; its questions are not changed.`;
  }
  return { out, paper };
};

const summarize = (rows) => ({
  standards: rows.length,
  found: rows.reduce((s, r) => s + r.found, 0), inserted: rows.reduce((s, r) => s + r.inserted, 0), updated: rows.reduce((s, r) => s + r.updated, 0),
  unchanged: rows.reduce((s, r) => s + r.unchanged, 0), duplicatesAvoided: rows.reduce((s, r) => s + r.duplicatesAvoided, 0),
  manualReview: rows.reduce((s, r) => s + r.review.length, 0), sourceWarnings: rows.reduce((s, r) => s + (r.warnings || []).length, 0), completed: rows.reduce((s, r) => s + (r.completions || []).length, 0), imagesAssociated: rows.reduce((s, r) => s + r.imagesAssociated, 0),
  examsToCreate: rows.filter((r) => !r.examExists).length, locked: rows.filter((r) => r.locked).length,
});

const parseStandards = (raw) => {
  if (raw === undefined || raw === null || raw === 'all') return events.STANDARDS;
  const list = [...new Set((Array.isArray(raw) ? raw : [raw]).map(Number))];
  if (!list.length || list.some((n) => !events.STANDARDS.includes(n))) throw new EventError(400, 'Standards must be numbers from 1 to 10.', 'INVALID_STANDARD');
  return list.sort((a, b) => a - b);
};

/** Read-only. Never writes. */
const plan = async (eventId, { standards } = {}) => {
  const event = await loadTarget(eventId);
  const list = parseStandards(standards);
  const exams = await events.examsOfEvent(event._id);
  const rows = [];
  for (const std of list) rows.push((await planStandard(event, std, exams.find((e) => e.standard === std))).out);
  const blocking = rows.filter((r) => r.problems.length).map((r) => ({ standard: r.standard, problems: r.problems }));
  return {
    dryRun: true, event: { _id: oid(event), name: event.name, state: event.state, paperSet: event.paperSet || null }, paperSet: cfg.PAPER_SET,
    settings: settingsDiff(event), rows, summary: summarize(rows), blocking, canApply: blocking.length === 0,
  };
};

const audit = async (admin, exam, field, previous, next, note) => {
  try {
    const { OlympiadExamAudit } = require('../models/OlympiadExamAudit');
    await OlympiadExamAudit.create({ exam: exam._id, examTitle: exam.title, standard: exam.standard, admin: admin._id, adminName: admin.name, changeId: crypto.randomBytes(8).toString('hex'), field, previous, next, success: true, ...(note ? { note: String(note).slice(0, 300) } : {}) });
  } catch (err) { console.error('[paper-import] audit write failed:', err.message); }
};

const createExam = async (event, std, paper) => OlympiadExam.create({
  event: event._id, title: `${event.name} – ${ordinal(std)} Standard`, slug: `${event.slug}-std-${std}`, examType: 'olympiad', standard: std,
  accessMode: 'payment', accessEnabled: true, hardClose: false, instructions: events.DEFAULT_INSTRUCTIONS,
  startDate: cfg.examWindow.start, endDate: cfg.examWindow.end, durationMinutes: paper.durationMinutes || 60,
  fee: cfg.FEES.exam + cfg.FEES.interview, currency: 'INR', isPublished: event.state === 'published',
});

const upsertQuestion = async (examId, doc) => {
  const cur = await OlympiadQuestion.findOne({ exam: examId, questionNumber: doc.questionNumber }).select('+correctAnswer +explanation');
  if (!cur) {
    try { await OlympiadQuestion.create(doc); return 'inserted'; } catch (err) {
      if (!(err && (err.code === 11000 || err.code === 11001))) throw err; // a concurrent run inserted it first: fall through to update
    }
  } else if (!differs(cur, doc)) return 'unchanged';
  const { exam, questionNumber, ...rest } = doc;
  const set = {}; const unset = {};
  for (const [k, v] of Object.entries(rest)) { if (v === undefined) unset[k] = ''; else set[k] = v; }
  await OlympiadQuestion.updateOne({ exam: examId, questionNumber }, { $set: set, ...(Object.keys(unset).length ? { $unset: unset } : {}) });
  return 'updated';
};

/** Performs the import + applies the agreed event settings. Idempotent. */
const apply = async (eventId, admin, { standards, applyDurations = false, applySettings = true } = {}) => {
  const key = String(eventId);
  if (locks.has(key)) throw new EventError(409, 'An import for this event is already running.', 'IMPORT_RUNNING');
  locks.add(key);
  try {
    const event = await loadTarget(eventId);
    const list = parseStandards(standards);
    const exams = await events.examsOfEvent(event._id);
    const rows = []; const loaded = [];
    for (const std of list) { const r = await planStandard(event, std, exams.find((e) => e.standard === std)); rows.push(r.out); loaded.push(r.paper); }
    const blocking = rows.filter((r) => r.problems.length);
    if (blocking.length) throw new EventError(422, `Some papers have problems; nothing was imported: ${blocking.map((b) => `Std ${b.standard}`).join(', ')}.`, 'PAPER_INVALID', { blocking: blocking.map((b) => ({ standard: b.standard, problems: b.problems })) });

    const now = new Date();
    for (let i = 0; i < list.length; i += 1) {
      const std = list[i]; const paper = loaded[i]; const row = rows[i];
      let exam = exams.find((e) => e.standard === std);
      if (!exam) { exam = await createExam(event, std, paper); row.created = true; row.examId = oid(exam); }
      const counts = { inserted: 0, updated: 0, unchanged: 0 };
      if (!row.locked) {
        for (const q of paper.questions) counts[await upsertQuestion(exam._id, questionDoc(exam._id, paper, q))] += 1;
        const keep = paper.questions.map((q) => q.n);
        const removed = await OlympiadQuestion.deleteMany({ exam: exam._id, questionNumber: { $nin: keep } });
        row.removed = removed && (removed.deletedCount ?? removed.n ?? 0);
        row.inserted = counts.inserted; row.updated = counts.updated; row.unchanged = counts.unchanged;
      } else { row.inserted = 0; row.updated = 0; row.unchanged = 0; row.removed = 0; }

      const sections = paper.sections.map((s) => ({ name: s.name, nameMr: s.nameMr, questionCount: paper.questions.filter((q) => paper.sections[q.section] === s).length, marks: paper.questions.filter((q) => paper.sections[q.section] === s).reduce((m, q) => m + (q.marks ?? 1), 0) }));
      const set = { examFee: cfg.FEES.exam, interviewFee: cfg.FEES.interview };
      if (!row.locked) {
        Object.assign(set, {
          sections, totalQuestions: paper.questions.length, totalMarks: paper.questions.reduce((m, q) => m + (q.marks ?? 1), 0),
          description: paper.title,
          paperImport: { set: cfg.PAPER_SET, source: paper.source, importedAt: now, questionCount: paper.questions.length, review: row.review, completions: paper.completions || [] },
        });
        if (applyDurations && paper.durationMinutes && paper.durationMinutes !== exam.durationMinutes) set.durationMinutes = paper.durationMinutes;
      }
      if (applySettings && !exam.resultsPublishedAt) Object.assign(set, { resultsPublishAt: cfg.resultsPublishAt, resultsScheduleSeeded: true });
      await OlympiadExam.updateOne({ _id: exam._id }, { $set: set });
      await audit(admin, exam, 'paperImport', null, { set: cfg.PAPER_SET, ...counts, review: row.review.length, locked: row.locked }, row.lockedReason);
    }

    const evSet = { paperSet: cfg.PAPER_SET, updatedBy: admin._id };
    const all = await events.examsOfEvent(event._id);
    evSet.standards = all.map((e) => e.standard).sort((a, b) => a - b);
    if (applySettings) Object.assign(evSet, { examFee: cfg.FEES.exam, interviewFee: cfg.FEES.interview, registrationClosesAt: cfg.registrationClosesAt, interviewOpensAt: cfg.interview.opensAt, interviewClosesAt: cfg.interview.closesAt, resultsPublishAt: cfg.resultsPublishAt });
    await OlympiadEvent.updateOne({ _id: event._id }, { $set: evSet });

    const fresh = await OlympiadEvent.findById(event._id);
    const readiness = await readinessOf(event._id);
    return {
      dryRun: false, event: { _id: oid(fresh), name: fresh.name, state: fresh.state, paperSet: fresh.paperSet }, paperSet: cfg.PAPER_SET,
      settings: settingsDiff(fresh), rows, summary: summarize(rows), blocking: [], canApply: true,
      needsReview: rows.filter((r) => r.review.length).map((r) => ({ standard: r.standard, review: r.review })),
      readiness,
      note: 'The event stays in its current state; publishing is a separate step and is blocked while a paper has unresolved review items.',
    };
  } finally { locks.delete(key); }
};

/** Server-side completeness check of every exam of the event (what publishing will enforce). Reasons only - never answers. */
const readinessOf = async (eventId) => {
  const { validateExam } = require('./paperValidation');
  const exams = await events.examsOfEvent(eventId);
  const rows = [];
  for (const e of exams) rows.push(await validateExam(e));
  return { ready: rows.length > 0 && rows.every((r) => r.ok), standards: rows };
};

/** Exams of an event whose imported paper still has unresolved content (blocks publishing). */
const unresolvedReview = async (eventId) => {
  const exams = await events.examsOfEvent(eventId);
  return exams.filter((e) => e.paperImport && e.paperImport.review && e.paperImport.review.length)
    .map((e) => ({ standard: e.standard, review: e.paperImport.review.map((r) => ({ question: r.question, issue: r.issue })) }));
};

module.exports = { loadPaper, reviewOf, plan, apply, candidates, unresolvedReview, readinessOf, loadTarget };

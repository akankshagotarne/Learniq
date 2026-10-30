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
const paperSets = require('../config/paperSets');
const defaultCfg = require('../config/oct24Event');
const { OlympiadEvent } = require('../models/OlympiadEvent');
const { OlympiadExam, OlympiadQuestion, OlympiadAttempt } = require('../models/Olympiad');
const events = require('./olympiadEvents');
const { ordinal } = require('../seed/olympiadTitles');
const { isTranslationOnly, optionLanguageIssue } = require('./optionLanguage');

const { EventError } = events;
const IST = 'Asia/Kolkata';
const ymdIST = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(d));
const oid = (v) => String(v && v._id ? v._id : v);
const sameInstant = (a, b) => (a ? new Date(a).getTime() : null) === (b ? new Date(b).getTime() : null);
const PUBLIC_ROOT = path.join(__dirname, '..', '..', '..', 'frontend', 'public');

const MAX_PAPER_BYTES = 40 * 1024 * 1024; // one standard's file (diagrams are embedded); far above the real ~0.1-0.4 MB

/**
 * Looks at the private paper folder WITHOUT reading any question: is it configured, does it exist, can the server read it.
 * Returns { state, message, hint } where state is 'not-configured' | 'folder-missing' | 'unreadable' | 'ok'.
 * The folder path itself is never returned (it is an environment value).
 */
const inspectFolder = (cfg = defaultCfg) => {
  const dir = cfg.DATA_DIR;
  if (!dir) return { state: 'not-configured', message: 'Question paper storage is not configured on the server.', hint: 'Set OLYMPIAD_PAPER_DIR to a private folder on the server that contains the paper files (see docs/EXAM_DATA_SECURITY.md), or run the import script from the administrator\'s computer.' };
  let st = null; try { st = fs.statSync(dir); } catch (e) { st = null; }
  if (!st || !st.isDirectory()) return { state: 'folder-missing', message: 'The configured question paper folder does not exist on the server.', hint: `OLYMPIAD_PAPER_DIR is set, but the folder (and its "${path.basename(dir)}" sub-folder, if used) was not found. Render's free plan has no persistent disk, so files placed on the server are lost at every restart.` };
  try { fs.accessSync(dir, fs.constants.R_OK); } catch (e) { return { state: 'unreadable', message: 'The question paper folder exists but the server may not read it.', hint: 'Check the folder permissions for the user the backend runs as.' }; }
  return { state: 'ok', message: '', hint: '' };
};

const locks = new Set(); // one import per event at a time inside this process; the unique indexes guard across processes

/** Reads and validates one standard's paper file. Returns { paper, problems } - problems make the standard un-importable. */
const loadPaper = (standard, dir, cfg = defaultCfg) => {
  if (!dir) dir = cfg.DATA_DIR;
  if (!dir) return { paper: null, problems: ['The paper source folder is not configured: set OLYMPIAD_PAPER_DIR (a private folder outside the repository, see docs/EXAM_DATA_SECURITY.md).'] };
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
    if (paper.bilingual && q.textMr && Array.isArray(q.options)) { const why = optionLanguageIssue(q.options, q.optionsMrExempt); if (why) problems.push(`${tag}: ${why}`); }
    if (!Number.isInteger(q.answer) || !q.options || q.answer < 0 || q.answer >= q.options.length) problems.push(`${tag}: the correct answer is missing or out of range.`);
    if (!Number.isInteger(q.section) || !paper.sections || !paper.sections[q.section]) problems.push(`${tag}: it does not belong to a section.`);
  }
  return { paper, problems, warnings };
};

/** Question numbers the paper should contain but does not (e.g. a question cut off in the source PDF). */
const reviewOf = (standard, paper, cfg = defaultCfg) => {
  const review = [...(paper.review || [])];
  const have = new Set((paper.questions || []).map((q) => q.n));
  const expected = cfg.expectedQuestions[standard];
  for (let n = 1; n <= expected; n += 1) {
    if (!have.has(n) && !review.some((r) => r.question === n)) review.push({ question: n, issue: 'Missing from the imported paper.' });
  }
  return review.sort((a, b) => a.question - b.question);
};

const questionDoc = (examId, paper, q, cfg = defaultCfg) => {
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

/** A difference that only adds / corrects Marathi labels on the options (and the provenance note): safe even where students already have attempts,
 *  because answers are stored as option indexes and every other field - text, order, key, marks, section - is identical. */
const onlyTranslation = (existing, doc) => !FIELDS.some((f) => (existing[f] ?? undefined) !== (doc[f] ?? undefined)) && isTranslationOnly(existing.options || [], doc.options);

/** The event must be the real 24 Oct 2026 event: never the original (17 Oct / legacy) one, never a cancelled one. */
const loadTarget = async (eventId) => {
  const event = await events.loadEvent(eventId);
  if (event.isLegacy) throw new EventError(422, 'This is the original event; the question papers can only be imported into a dated 2026 event.', 'WRONG_EVENT');
  if (event.state === 'cancelled') throw new EventError(409, 'A cancelled event cannot receive a question paper.', 'EVENT_CANCELLED');
  const cfg = paperSets.byDay(ymdIST(event.examDate));
  if (!cfg) throw new EventError(422, `This event is dated ${ymdIST(event.examDate)}; there is no question paper set for that day (known: ${paperSets.SETS.map((x) => x.EVENT_DAY).join(', ')}).`, 'WRONG_EVENT');
  return { event, cfg };
};

/** The Olympiad events that may receive this import (for the admin's selector). */
const candidates = async () => {
  const all = await OlympiadEvent.find({});
  return all.filter((e) => !e.isLegacy && e.state !== 'cancelled' && paperSets.byDay(ymdIST(e.examDate))).map((e) => ({ _id: oid(e), name: e.name, state: e.state, day: ymdIST(e.examDate), paperSet: e.paperSet || null }));
};

const settingsDiff = (event, cfg) => {
  if (cfg.APPLY_EVENT_SETTINGS === false) return [];
  const t = { examFee: cfg.FEES.exam, interviewFee: cfg.FEES.interview, registrationClosesAt: cfg.registrationClosesAt, interviewOpensAt: cfg.interview.opensAt, interviewClosesAt: cfg.interview.closesAt, resultsPublishAt: cfg.resultsPublishAt, paperSet: cfg.PAPER_SET };
  return Object.entries(t).map(([field, target]) => {
    const current = event[field] ?? null;
    const same = target instanceof Date ? sameInstant(current, target) : current === target;
    return { field, current, target, changed: !same };
  });
};

const imageState = (image) => {
  if (!image) return null;
  if (/^data:image\//.test(image)) return 'embedded';
  const local = path.join(PUBLIC_ROOT, image.replace(/^\/+/, ''));
  return fs.existsSync(local) ? 'found' : 'not-checkable-on-this-host';
};

const planStandard = async (event, standard, exam, cfg) => {
  const { paper, problems, warnings } = loadPaper(standard, undefined, cfg);
  const out = { completions: paper ? (paper.completions || []) : [], warnings: warnings || [], standard, source: paper && paper.source, found: paper ? (paper.questions || []).length : 0, expected: cfg.expectedQuestions[standard], examId: exam ? oid(exam) : null, examExists: !!exam, problems, review: [], inserted: 0, updated: 0, unchanged: 0, removed: 0, duplicatesAvoided: 0, imagesAssociated: 0, imageFiles: [], locked: false, lockedReason: null, durationInPdf: paper ? paper.durationMinutes : null, durationNow: exam ? exam.durationMinutes : null, sourceIssues: paper ? paper.sourceIssues || [] : [] };
  const target = cfg.durations ? cfg.durations[standard] : null;
  out.durationTarget = target || null;
  out.durationUpdate = !!(exam && target && exam.durationMinutes !== target);
  if (paper && target && paper.durationMinutes && paper.durationMinutes !== target) out.warnings.push({ question: 0, issue: `The paper file says ${paper.durationMinutes} minutes; the configured duration is ${target}.` });
  if (!paper || problems.length) return { out, paper: null };
  out.review = reviewOf(standard, paper, cfg);
  const attempts = exam ? await OlympiadAttempt.countDocuments({ exam: exam._id }) : 0;
  out.attempts = attempts;
  const existing = exam ? await OlympiadQuestion.find({ exam: exam._id }).select('+correctAnswer +explanation') : [];
  const byNo = new Map(existing.map((q) => [q.questionNumber, q]));
  const incoming = new Set(); let safe = 0;
  for (const q of paper.questions) {
    incoming.add(q.n);
    const doc = questionDoc(exam ? exam._id : null, paper, q, cfg);
    const cur = byNo.get(q.n);
    if (!cur) out.inserted += 1;
    else { out.duplicatesAvoided += 1; if (differs(cur, doc)) { out.updated += 1; if (onlyTranslation(cur, doc)) safe += 1; } else out.unchanged += 1; }
    if (q.image) { out.imagesAssociated += 1; out.imageFiles.push({ question: q.n, image: q.image, file: imageState(q.image) }); }
  }
  out.removed = existing.filter((q) => !incoming.has(q.questionNumber)).length;
  // Students have already attempted this exam: its questions are not changed - EXCEPT Marathi-label additions, which are applied in place
  // (they alter no answer, order, key, mark or English text). Anything else pending keeps the exam locked, as before.
  if (attempts > 0 && (out.inserted || out.removed || out.updated > safe)) {
    out.locked = true; out.lockedReason = `${attempts} student attempt(s) already exist for this exam; its questions are not changed${safe ? ` (${safe} Marathi-translation update(s) are still applied)` : ''}.`;
    out.updated = safe;
  } else if (attempts > 0 && safe) out.translationOnly = true;
  return { out, paper };
};

const summarize = (rows) => ({
  standards: rows.length,
  found: rows.reduce((s, r) => s + r.found, 0), inserted: rows.reduce((s, r) => s + r.inserted, 0), updated: rows.reduce((s, r) => s + r.updated, 0),
  unchanged: rows.reduce((s, r) => s + r.unchanged, 0), duplicatesAvoided: rows.reduce((s, r) => s + r.duplicatesAvoided, 0),
  manualReview: rows.reduce((s, r) => s + r.review.length, 0), sourceWarnings: rows.reduce((s, r) => s + (r.warnings || []).length, 0), completed: rows.reduce((s, r) => s + (r.completions || []).length, 0), imagesAssociated: rows.reduce((s, r) => s + r.imagesAssociated, 0),
  examsToCreate: rows.filter((r) => !r.examExists).length, durationUpdates: rows.filter((r) => r.durationUpdate).length, locked: rows.filter((r) => r.locked).length,
});

/** The duration plan shown by the dry run: one line per standard. */
const durationPlan = (rows) => rows.map((r) => ({ standard: r.standard, examId: r.examId, currentMinutes: r.durationNow, targetMinutes: r.durationTarget, updateRequired: !!r.durationUpdate }));

const parseStandards = (raw) => {
  if (raw === undefined || raw === null || raw === 'all') return events.STANDARDS;
  const list = [...new Set((Array.isArray(raw) ? raw : [raw]).map(Number))];
  if (!list.length || list.some((n) => !events.STANDARDS.includes(n))) throw new EventError(400, 'Standards must be numbers from 1 to 10.', 'INVALID_STANDARD');
  return list.sort((a, b) => a - b);
};

/** Read-only. Never writes. */
const plan = async (eventId, { standards } = {}) => {
  const { event, cfg } = await loadTarget(eventId);
  const list = parseStandards(standards);
  const eventInfo = { _id: oid(event), name: event.name, state: event.state, paperSet: event.paperSet || null };
  const folder = inspectFolder(cfg);
  if (folder.state !== 'ok') {
    // What is already in the database for this event (the papers may have been imported from the administrator's computer).
    const have = await events.examsOfEvent(event._id);
    const imported = [];
    for (const std of list) {
      const ex = have.find((e) => e.standard === std);
      const done = !!(ex && ex.paperImport && ex.paperImport.set === cfg.PAPER_SET);
      imported.push({ standard: std, imported: done, questions: ex ? await OlympiadQuestion.countDocuments({ exam: ex._id }) : 0, expected: cfg.expectedQuestions[std], durationMinutes: ex ? ex.durationMinutes : null });
    }
    // ONE global message instead of the same problem repeated for every standard; nothing was read, nothing is ready.
    return { dryRun: true, event: eventInfo, paperSet: cfg.PAPER_SET, settings: [], rows: [], summary: summarize([]), blocking: [{ standard: null, problems: [folder.message] }], canApply: false,
      storage: { state: folder.state, message: folder.message, hint: folder.hint, standards: [], imported } };
  }
  const exams = await events.examsOfEvent(event._id);
  const rows = [];
  for (const std of list) rows.push((await planStandard(event, std, exams.find((e) => e.standard === std), cfg)).out);
  const blocking = rows.filter((r) => r.problems.length).map((r) => ({ standard: r.standard, problems: r.problems }));
  const fileStatus = (r) => (!r.problems.length ? 'ok' : r.problems.some((x) => /is missing\.$/.test(x) && /^Paper file/.test(x)) ? 'missing' : 'invalid');
  const perStandard = rows.map((r) => ({ standard: r.standard, file: `std${r.standard}.json`, status: fileStatus(r), questions: r.found, expected: r.expected, problems: r.problems }));
  const state = perStandard.every((x) => x.status === 'ok') ? (rows.some((r) => r.review.length) ? 'invalid' : 'valid') : perStandard.some((x) => x.status === 'invalid') ? 'invalid' : 'files-missing';
  const messages = { valid: 'All papers were read and passed the checks.', 'files-missing': 'The folder is configured, but some paper files are missing.', invalid: 'Paper files were found, but some are invalid or incomplete.' };
  return {
    dryRun: true, event: eventInfo, paperSet: cfg.PAPER_SET,
    settings: settingsDiff(event, cfg), rows, summary: summarize(rows), durations: durationPlan(rows), blocking, canApply: blocking.length === 0,
    storage: { state, message: messages[state], hint: '', standards: perStandard },
  };
};

const audit = async (admin, exam, field, previous, next, note) => {
  try {
    const { OlympiadExamAudit } = require('../models/OlympiadExamAudit');
    await OlympiadExamAudit.create({ exam: exam._id, examTitle: exam.title, standard: exam.standard, admin: admin._id, adminName: admin.name, changeId: crypto.randomBytes(8).toString('hex'), field, previous, next, success: true, ...(note ? { note: String(note).slice(0, 300) } : {}) });
  } catch (err) { console.error('[paper-import] audit write failed:', err.message); }
};

const createExam = async (event, std, paper, cfg) => OlympiadExam.create({
  event: event._id, title: `${event.name} – ${ordinal(std)} Standard`, slug: `${event.slug}-std-${std}`, examType: 'olympiad', standard: std,
  accessMode: 'payment', accessEnabled: true, hardClose: false, instructions: events.DEFAULT_INSTRUCTIONS,
  startDate: cfg.examWindow.start, endDate: cfg.examWindow.end, durationMinutes: (cfg.durations && cfg.durations[std]) || paper.durationMinutes || 60,
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
    const { event, cfg } = await loadTarget(eventId);
    const folder = inspectFolder(cfg);
    if (folder.state !== 'ok') throw new EventError(422, folder.message, 'PAPER_STORAGE_UNAVAILABLE', { storage: { state: folder.state } });
    if (cfg.APPLY_EVENT_SETTINGS === false) applySettings = false;
    const list = parseStandards(standards);
    const exams = await events.examsOfEvent(event._id);
    const rows = []; const loaded = [];
    for (const std of list) { const r = await planStandard(event, std, exams.find((e) => e.standard === std), cfg); rows.push(r.out); loaded.push(r.paper); }
    const blocking = rows.filter((r) => r.problems.length);
    if (blocking.length) throw new EventError(422, `Some papers have problems; nothing was imported: ${blocking.map((b) => `Std ${b.standard}`).join(', ')}.`, 'PAPER_INVALID', { blocking: blocking.map((b) => ({ standard: b.standard, problems: b.problems })) });

    const now = new Date();
    for (let i = 0; i < list.length; i += 1) {
      const std = list[i]; const paper = loaded[i]; const row = rows[i];
      let exam = exams.find((e) => e.standard === std);
      if (!exam) { exam = await createExam(event, std, paper, cfg); row.created = true; row.examId = oid(exam); }
      const counts = { inserted: 0, updated: 0, unchanged: 0 };
      if (!row.locked) {
        for (const q of paper.questions) counts[await upsertQuestion(exam._id, questionDoc(exam._id, paper, q, cfg))] += 1;
        const keep = paper.questions.map((q) => q.n);
        const removed = await OlympiadQuestion.deleteMany({ exam: exam._id, questionNumber: { $nin: keep } });
        row.removed = removed && (removed.deletedCount ?? removed.n ?? 0);
        row.inserted = counts.inserted; row.updated = counts.updated; row.unchanged = counts.unchanged;
      } else {
        let n = 0;
        for (const q of paper.questions) { const doc = questionDoc(exam._id, paper, q, cfg); const cur = await OlympiadQuestion.findOne({ exam: exam._id, questionNumber: q.n }).select('+correctAnswer +explanation'); if (cur && differs(cur, doc) && onlyTranslation(cur, doc)) { await OlympiadQuestion.updateOne({ exam: exam._id, questionNumber: q.n }, { $set: { options: doc.options, ...(doc.provenance ? { provenance: doc.provenance } : {}) } }); n += 1; } }
        row.inserted = 0; row.updated = n; row.unchanged = 0; row.removed = 0;
      }

      const sections = paper.sections.map((s) => ({ name: s.name, nameMr: s.nameMr, questionCount: paper.questions.filter((q) => paper.sections[q.section] === s).length, marks: paper.questions.filter((q) => paper.sections[q.section] === s).reduce((m, q) => m + (q.marks ?? 1), 0) }));
      const set = cfg.APPLY_EVENT_SETTINGS === false ? {} : { examFee: cfg.FEES.exam, interviewFee: cfg.FEES.interview };
      if (!row.locked) {
        Object.assign(set, {
          sections, totalQuestions: paper.questions.length, totalMarks: paper.questions.reduce((m, q) => m + (q.marks ?? 1), 0),
          description: paper.title,
          paperImport: { set: cfg.PAPER_SET, source: paper.source, importedAt: now, questionCount: paper.questions.length, review: row.review, completions: paper.completions || [] },
        });
        if (cfg.durations && cfg.durations[std]) { if (cfg.durations[std] !== exam.durationMinutes) { set.durationMinutes = cfg.durations[std]; row.durationChanged = true; } }
        else if (applyDurations && paper.durationMinutes && paper.durationMinutes !== exam.durationMinutes) set.durationMinutes = paper.durationMinutes;
      }
      if (applySettings && !exam.resultsPublishedAt) Object.assign(set, { resultsPublishAt: cfg.resultsPublishAt, resultsScheduleSeeded: true });
      await OlympiadExam.updateOne({ _id: exam._id }, { $set: set });
      if (set.durationMinutes) { row.durationNow = set.durationMinutes; row.durationUpdate = false; }
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
      settings: settingsDiff(fresh, cfg), rows, summary: summarize(rows), durations: durationPlan(rows), blocking: [], canApply: true,
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

module.exports = { inspectFolder, loadPaper, reviewOf, plan, apply, candidates, unresolvedReview, readinessOf, loadTarget };

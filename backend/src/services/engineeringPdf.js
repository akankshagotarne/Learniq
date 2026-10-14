/**
 * BE Engineering mock test - PDF reports (A4 portrait, generated from the stored records, never from a template/screenshot).
 *   renderExamReport(exam, data)           whole-exam report: summary, ranked results, participation, proctoring summary
 *   renderAttemptReport(exam, detail)      one student's result report (admin)
 * Structure follows the supplied reference report (title, exam line, summary strip, "Students" table with repeated headings).
 * The logo and the fonts are bundled files (assets/report) - nothing is fetched from the network while generating.
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const fontkit = require('fontkit');
const { formatIST } = require('./engineering');

const ASSETS = path.join(__dirname, '..', '..', 'assets', 'report');
const LOGO_FILE = path.join(ASSETS, 'learniq-logo.png');
const FONT_FILES = {
  regular: path.join(ASSETS, 'fonts', 'DejaVuSans.ttf'),
  bold: path.join(ASSETS, 'fonts', 'DejaVuSans-Bold.ttf'),
  indicRegular: path.join(ASSETS, 'fonts', 'FreeSans.ttf'),
  indicBold: path.join(ASSETS, 'fonts', 'FreeSansBold.ttf'),
};
const LOGO_PX = 1254;                                       // the supplied logo is 1254 x 1254
const LOGO_CONTENT = { x: 280, y: 270, w: 700, h: 790 };   // the logo itself inside its white margins (a clip - the image is never stretched)

const C = { brand: '#5B3FD9', ink: '#14182B', muted: '#5F6678', line: '#D9DCE6', soft: '#F3F2FD', head: '#EFEEFB', ok: '#157347', warn: '#B45309', bad: '#B42318' };
const PAGE = { w: 595.28, h: 841.89, m: 36 };
const CONTENT_W = PAGE.w - PAGE.m * 2;

const coverage = {}; // font key -> fontkit font (for glyph checks)
const glyphFont = (key) => { if (!coverage[key]) coverage[key] = fontkit.openSync(FONT_FILES[key]); return coverage[key]; };
const supports = (key, s) => { const f = glyphFont(key); for (const ch of s) { if (!f.hasGlyphForCodePoint(ch.codePointAt(0))) return false; } return true; };

/** Strip control characters; choose the bundled font that can draw the whole string (Latin -> DejaVu, Devanagari -> FreeSans). */
const prepare = (value) => {
  const s = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').trim();
  if (supports('regular', s)) return { text: s, indic: false };
  if (supports('indicRegular', s)) return { text: s, indic: true };
  const f = glyphFont('regular');
  return { text: Array.from(s).map((ch) => (f.hasGlyphForCodePoint(ch.codePointAt(0)) ? ch : '?')).join(''), indic: false };
};

const fmtDuration = (sec) => {
  if (sec == null || !Number.isFinite(sec)) return '-';
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60); const r = s % 60;
  return m > 0 ? `${m}m ${String(r).padStart(2, '0')}s` : `${r}s`;
};
const fmtNum = (n) => (n == null ? '-' : (Math.round(n * 100) / 100).toString());
const fmtPct = (n) => (n == null ? '-' : `${(Math.round(n * 10) / 10).toString()}%`);

// ── document helpers ────────────────────────────────────────────────────────────────────────────────
const open = (info) => {
  const doc = new PDFDocument({ size: 'A4', margin: PAGE.m, bufferPages: true, info: { Title: info.title, Author: 'LearnIQ', Subject: info.subject || '', Creator: 'LearnIQ' } });
  Object.entries(FONT_FILES).forEach(([k, f]) => doc.registerFont(k, f));
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  return { doc, done };
};

const setFont = (doc, { bold = false, indic = false, size = 9, color = C.ink }) => {
  doc.font(indic ? (bold ? 'indicBold' : 'indicRegular') : (bold ? 'bold' : 'regular')).fontSize(size).fillColor(color);
};

/** Wrap by words, and hard-break any single token (long e-mail address) that does not fit - so nothing is ever clipped. */
const wrap = (doc, text, width) => {
  const lines = []; let line = '';
  const push = () => { if (line) lines.push(line); line = ''; };
  for (const word of String(text).split(' ')) {
    if (!word) continue;
    if (doc.widthOfString(word) <= width) {
      const t = line ? `${line} ${word}` : word;
      if (doc.widthOfString(t) <= width) line = t; else { push(); line = word; }
      continue;
    }
    push();
    let chunk = '';
    for (const ch of Array.from(word)) {
      if (doc.widthOfString(chunk + ch) > width && chunk) { lines.push(chunk); chunk = ch; } else chunk += ch;
    }
    line = chunk;
  }
  push();
  return lines.length ? lines : [''];
};

const drawLogo = (doc, x, y, height) => {
  const k = height / LOGO_CONTENT.h;
  const w = LOGO_CONTENT.w * k;
  doc.save();
  doc.rect(x, y, w, height).clip();
  doc.image(LOGO_FILE, x - LOGO_CONTENT.x * k, y - LOGO_CONTENT.y * k, { width: LOGO_PX * k, height: LOGO_PX * k });
  doc.restore();
  return w;
};

const header = (doc, { title, lines }) => {
  const logoH = 62;
  const w = drawLogo(doc, PAGE.m, PAGE.m, logoH);
  const x = PAGE.m + w + 14; const width = PAGE.w - PAGE.m - x;
  const t = prepare(title); setFont(doc, { bold: true, indic: t.indic, size: 15.5, color: C.ink });
  doc.text(t.text, x, PAGE.m + 2, { width, lineGap: 1 });
  let y = doc.y + 3;
  for (const l of lines) {
    const p = prepare(l); setFont(doc, { indic: p.indic, size: 8.6, color: C.muted });
    doc.text(p.text, x, y, { width }); y = doc.y + 1.5;
  }
  const bottom = Math.max(y, PAGE.m + logoH) + 8;
  doc.moveTo(PAGE.m, bottom).lineTo(PAGE.w - PAGE.m, bottom).lineWidth(1.2).strokeColor(C.brand).stroke();
  return bottom + 12;
};

const bottomLimit = () => PAGE.h - PAGE.m - 22; // leave room for the footer

const heading = (doc, y, text, note) => {
  if (y + 40 > bottomLimit()) { doc.addPage(); y = PAGE.m; }
  setFont(doc, { bold: true, size: 11.5, color: C.ink });
  doc.text(text, PAGE.m, y, { width: CONTENT_W });
  y = doc.y + 2;
  if (note) { const p = prepare(note); setFont(doc, { indic: p.indic, size: 8, color: C.muted }); doc.text(p.text, PAGE.m, y, { width: CONTENT_W }); y = doc.y + 2; }
  return y + 4;
};

/** Summary cards: `cards` = [{label, value, sub?}], `perRow` per line. */
const cards = (doc, y, items, perRow = 4) => {
  const gap = 8; const w = (CONTENT_W - gap * (perRow - 1)) / perRow; const h = 50;
  const rows = Math.ceil(items.length / perRow);
  if (y + rows * (h + gap) > bottomLimit()) { doc.addPage(); y = PAGE.m; }
  items.forEach((it, i) => {
    const cx = PAGE.m + (i % perRow) * (w + gap); const cy = y + Math.floor(i / perRow) * (h + gap);
    doc.roundedRect(cx, cy, w, h, 6).lineWidth(0.8).fillAndStroke(C.soft, C.line);
    setFont(doc, { size: 7.2, color: C.muted }); doc.text(it.label.toUpperCase(), cx + 9, cy + 8, { width: w - 18, characterSpacing: 0.3 });
    setFont(doc, { bold: true, size: 15, color: it.color || C.ink }); doc.text(String(it.value), cx + 9, cy + 20, { width: w - 18, lineBreak: false });
    if (it.sub) { setFont(doc, { size: 6.8, color: C.muted }); doc.text(it.sub, cx + 9, cy + 39, { width: w - 18, lineBreak: false }); }
  });
  return y + rows * (h + gap);
};

/**
 * Table with a header row that is repeated on every page. columns: [{key, label, width, align?, bold?}] (widths in pt).
 * A cell value may be a string or {text, color, bold}.
 */
const table = (doc, y, columns, rows, { fontSize = 7.6, pad = 4, emptyText = 'No records.' } = {}) => {
  const total = columns.reduce((a, c) => a + c.width, 0);
  const drawHead = (yy) => {
    setFont(doc, { bold: true, size: fontSize - 0.4, color: C.muted });
    const heads = columns.map((c) => wrap(doc, c.label.toUpperCase(), c.width - pad * 2));
    const h = Math.max(...heads.map((l) => l.length)) * (fontSize + 2.2) + pad * 2;
    doc.rect(PAGE.m, yy, total, h).fill(C.head);
    let x = PAGE.m;
    columns.forEach((c, i) => {
      setFont(doc, { bold: true, size: fontSize - 0.4, color: C.muted });
      heads[i].forEach((ln, k) => doc.text(ln, x + pad, yy + pad + k * (fontSize + 2.2), { width: c.width - pad * 2, align: c.align || 'left', lineBreak: false }));
      x += c.width;
    });
    return yy + h;
  };
  if (!rows.length) {
    setFont(doc, { size: 8.5, color: C.muted }); doc.text(emptyText, PAGE.m, y, { width: CONTENT_W });
    return doc.y + 6;
  }
  y = drawHead(y);
  for (const row of rows) {
    // measure
    const cellsPrepared = columns.map((c) => {
      const v = row[c.key]; const obj = v && typeof v === 'object' ? v : { text: v };
      const p = prepare(obj.text == null ? '' : obj.text);
      setFont(doc, { bold: !!(obj.bold || c.bold), indic: p.indic, size: fontSize, color: obj.color || C.ink });
      return { p, obj, lines: wrap(doc, p.text, c.width - pad * 2) };
    });
    const lh = fontSize + 2.4;
    const h = Math.max(...cellsPrepared.map((c) => c.lines.length)) * lh + pad * 2 - 1;
    if (y + h > bottomLimit()) { doc.addPage(); y = drawHead(PAGE.m); }
    let x = PAGE.m;
    cellsPrepared.forEach((cp, i) => {
      const c = columns[i];
      setFont(doc, { bold: !!(cp.obj.bold || c.bold), indic: cp.p.indic, size: fontSize, color: cp.obj.color || C.ink });
      cp.lines.forEach((ln, k) => doc.text(ln, x + pad, y + pad - 0.5 + k * lh, { width: c.width - pad * 2, align: c.align || 'left', lineBreak: false }));
      x += c.width;
    });
    y += h;
    doc.moveTo(PAGE.m, y).lineTo(PAGE.m + total, y).lineWidth(0.5).strokeColor(C.line).stroke();
  }
  return y + 8;
};

const paragraphs = (doc, y, items, { size = 8, color = C.muted } = {}) => {
  for (const t of items) {
    const p = prepare(t);
    setFont(doc, { indic: p.indic, size, color });
    const h = doc.heightOfString(p.text, { width: CONTENT_W - 10 });
    if (y + h > bottomLimit()) { doc.addPage(); y = PAGE.m; }
    doc.circle(PAGE.m + 3, y + size / 2 + 0.5, 1.2).fill(color);
    setFont(doc, { indic: p.indic, size, color });
    doc.text(p.text, PAGE.m + 10, y, { width: CONTENT_W - 10 });
    y = doc.y + 2.5;
  }
  return y + 4;
};

/** Footer + "Page X of Y" on every page (needs bufferPages). */
const footers = (doc, label, generatedAt) => {
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i += 1) {
    doc.switchToPage(range.start + i);
    doc.page.margins.bottom = 0;   // the footer sits inside the bottom margin; without this pdfkit appends a blank page per footer line
    const y = PAGE.h - PAGE.m + 4;
    doc.moveTo(PAGE.m, y - 6).lineTo(PAGE.w - PAGE.m, y - 6).lineWidth(0.5).strokeColor(C.line).stroke();
    setFont(doc, { size: 7.2, color: C.muted });
    doc.text(`LearnIQ · ${label} · Generated ${generatedAt}`, PAGE.m, y, { width: CONTENT_W - 70, lineBreak: false });
    doc.text(`Page ${i + 1} of ${range.count}`, PAGE.w - PAGE.m - 70, y, { width: 70, align: 'right', lineBreak: false });
  }
};

// ── content ─────────────────────────────────────────────────────────────────────────────────────────
const STATUS_LABEL = { COMPLETED: 'Submitted', AUTO_SUBMITTED: 'Auto-submitted', IN_PROGRESS: 'In progress', NOT_ATTEMPTED: 'Not attempted' };
const TERMINATION_LABEL = {
  FACE_ABSENCE_LIMIT: 'Face-absence limit', MULTIPLE_FACES_LIMIT: 'Multiple-faces limit', MOBILE_PHONE_REPEATED: 'Repeated phone flag',
  STRICT_POLICY_VIOLATION: 'Strict-policy violation', CAMERA_FAILURE: 'Camera failure',
};
const COUNTER_LABEL = [
  ['faceAbsence', 'Face not visible'], ['multiFace', 'Multiple faces detected'], ['phone', 'Suspected phone'],
  ['fullscreenExit', 'Full-screen exits'], ['tabSwitch', 'Tab switches'], ['windowBlur', 'Window focus lost'],
  ['camera', 'Camera interruptions'], ['copyPaste', 'Copy / paste attempts'], ['network', 'Network interruptions'],
];

/** `data` = { summary, rows (all participants), completed (ranked rows), sessions, eventsBySession } */
const renderExamReport = async (exam, data, now = new Date()) => {
  const generatedAt = formatIST(now);
  const { doc, done } = open({ title: `${exam.title} - Report`, subject: 'Examination report' });
  const s = data.summary;
  let y = header(doc, {
    title: exam.title,
    lines: [
      `${exam.category || 'BE Engineering'} · Free proctored MCQ examination · ${exam.totalQuestions} questions · ${exam.totalMarks} marks · ${exam.durationMinutes} minutes`,
      `Opens ${formatIST(exam.startDate)} · Closes ${formatIST(exam.endDate)}`,
      `Report generated ${generatedAt}`,
    ],
  });

  y = cards(doc, y, [
    { label: 'Approved students', value: s.approved, sub: `of ${s.totalRequests} requests` },
    { label: 'Started', value: s.started, sub: `${s.inProgress} in progress` },
    { label: 'Completed', value: s.completed, sub: 'submitted attempts' },
    { label: 'Auto-submitted', value: s.autoSubmitted, sub: 'timer, deadline or proctoring' },
    { label: 'Not attempted', value: s.notAttempted, sub: 'approved, never started' },
    { label: 'Average score', value: s.averageScore == null ? '-' : `${fmtNum(s.averageScore)}/${exam.totalMarks}`, sub: s.averageScore == null ? '' : fmtPct((s.averageScore / exam.totalMarks) * 100) },
    { label: 'Median time', value: fmtDuration(s.medianTimeSeconds), sub: 'completed attempts' },
    { label: 'Flagged attempts', value: s.flaggedAttempts, sub: 'proctoring evidence', color: s.flaggedAttempts ? C.warn : C.ink },
  ]);

  y = heading(doc, y + 2, 'How the numbers are calculated');
  y = paragraphs(doc, y, [
    'Score = number of correct answers (1 mark each, no negative marking; maximum 40). Score % = score / 40 x 100.',
    'Rank: completed attempts only, ordered by score (highest first), then time taken (lowest first), then submission time (earliest first).',
    'Percentile = (students who scored lower + half of those with the same score, including the student) / completed attempts x 100. It is a relative standing, not the score %.',
    'Completed = every finished attempt (including auto-submitted). Auto-submitted = finished by the timer, the closing time or the proctoring rules. Not attempted = approved students with no attempt.',
    'Flags are evidence-based counts of face-not-visible, multiple-faces, suspected-phone, full-screen-exit and tab-switch events. They are indications for review, not proof of misconduct.',
  ]);

  y = heading(doc, y + 2, 'Ranked results', `${data.completed.length} completed attempt${data.completed.length === 1 ? '' : 's'}`);
  const rows = data.completed.map((r) => ({
    rank: String(r.rank), name: { text: r.name, bold: true }, email: r.email, college: r.college, branch: r.branch,
    score: `${fmtNum(r.score)}/${r.maxMarks}`, pct: fmtPct(r.percentage), ptl: fmtNum(r.percentile), time: fmtDuration(r.timeTakenSeconds),
    status: { text: r.status === 'AUTO_SUBMITTED' ? 'Auto submitted' : STATUS_LABEL[r.status], color: r.status === 'AUTO_SUBMITTED' ? C.warn : C.ink },
    flags: { text: String(r.flagCount), color: r.flagCount ? C.bad : C.muted },
  }));
  y = table(doc, y, [
    { key: 'rank', label: 'Rank', width: 31 }, { key: 'name', label: 'Student', width: 74 }, { key: 'email', label: 'Email', width: 77 },
    { key: 'college', label: 'College', width: 56 }, { key: 'branch', label: 'Branch', width: 50 }, { key: 'score', label: 'Score', width: 38 },
    { key: 'pct', label: 'Score %', width: 38 }, { key: 'ptl', label: 'Pctl', width: 32 }, { key: 'time', label: 'Time', width: 38 },
    { key: 'status', label: 'Status', width: 50 }, { key: 'flags', label: 'Flags', width: 37, align: 'right' },
  ], rows, { pad: 3, emptyText: 'No attempt has been completed yet.' });

  const pending = data.rows.filter((r) => r.status === 'NOT_ATTEMPTED' || r.status === 'IN_PROGRESS').sort((a, b) => String(a.name).localeCompare(String(b.name)));
  y = heading(doc, y + 4, 'Participation - approved students who have not completed the test', `${pending.length} student${pending.length === 1 ? '' : 's'}`);
  y = table(doc, y, [
    { key: 'name', label: 'Student', width: 120 }, { key: 'email', label: 'Email', width: 150 }, { key: 'college', label: 'College', width: 110 },
    { key: 'branch', label: 'Branch', width: 80 }, { key: 'status', label: 'Status', width: 50 },
  ], pending.map((r) => ({ name: { text: r.name, bold: true }, email: r.email, college: r.college, branch: r.branch, status: STATUS_LABEL[r.status] })),
  { emptyText: 'Every approved student has completed the test.' });

  // proctoring summary
  y = heading(doc, y + 4, 'Proctoring summary', 'Counts of recorded proctoring events. No video, images or audio are recorded or stored.');
  const totals = Object.fromEntries(COUNTER_LABEL.map(([k]) => [k, 0]));
  let affected = 0;
  for (const sess of data.sessions) {
    const c = sess.counts || {};
    COUNTER_LABEL.forEach(([k]) => { totals[k] += Number(c[k]) || 0; });
  }
  affected = data.rows.filter((r) => r.attemptId && r.flagged).length;
  y = table(doc, y, [
    { key: 'type', label: 'Event type', width: 300 }, { key: 'count', label: 'Total events', width: 110, align: 'right' }, { key: 'note', label: '', width: 100 },
  ], [
    ...COUNTER_LABEL.map(([k, label]) => ({ type: label, count: String(totals[k]), note: '' })),
    { type: { text: 'Attempts with at least one flag', bold: true }, count: { text: String(affected), bold: true }, note: '' },
    { type: { text: 'Attempts ended by the proctoring rules', bold: true }, count: { text: String(data.rows.filter((r) => r.terminated).length), bold: true }, note: '' },
  ]);

  const flagged = data.rows.filter((r) => r.attemptId && r.flagged).sort((a, b) => b.flagCount - a.flagCount || String(a.name).localeCompare(String(b.name)));
  y = heading(doc, y + 2, 'Flagged attempts', `${flagged.length} attempt${flagged.length === 1 ? '' : 's'} with proctoring evidence to review`);
  y = table(doc, y, [
    { key: 'name', label: 'Student', width: 92 }, { key: 'flags', label: 'Flags', width: 28, align: 'right' }, { key: 'mix', label: 'Event counts', width: 170 },
    { key: 'first', label: 'First / last flagged (IST)', width: 130 }, { key: 'outcome', label: 'Outcome', width: 90 },
  ], flagged.map((r) => {
    const sess = data.sessions.find((x) => String(x.attempt) === r.attemptId);
    const c = (sess && sess.counts) || {};
    const mix = COUNTER_LABEL.filter(([k]) => (c[k] || 0) > 0 && ['faceAbsence', 'multiFace', 'phone', 'fullscreenExit', 'tabSwitch'].includes(k)).map(([k, l]) => `${l}: ${c[k]}`).join(', ');
    const ev = (data.eventsBySession.get(String(sess && sess._id)) || []);
    const first = ev[0]; const last = ev[ev.length - 1];
    return {
      name: { text: r.name, bold: true }, flags: String(r.flagCount), mix: mix || '-',
      first: first ? `${formatIST(first.occurredAt, { seconds: true }).replace(' IST', '')}${last && last !== first ? ` / ${formatIST(last.occurredAt, { seconds: true }).replace(' IST', '')}` : ''}` : '-',
      outcome: r.terminated ? { text: `Ended: ${TERMINATION_LABEL[r.terminationReason] || r.terminationReason}`, color: C.bad } : STATUS_LABEL[r.status],
    };
  }), { emptyText: 'No attempt was flagged.' });

  footers(doc, exam.title, generatedAt);
  doc.end();
  return done;
};

const renderAttemptReport = async (exam, detail, now = new Date()) => {
  const generatedAt = formatIST(now);
  const { doc, done } = open({ title: `${exam.title} - Result`, subject: 'Individual result report' });
  const st = detail.student || {};
  let y = header(doc, {
    title: `${exam.title} - Result report`,
    lines: [`${st.name || 'Student'} · ${st.email || ''}`, `Report generated ${generatedAt}`],
  });
  y = table(doc, y, [{ key: 'k', label: 'Student details', width: 140 }, { key: 'v', label: '', width: 370 }], [
    { k: 'Name', v: st.name || '-' }, { k: 'Email', v: st.email || '-' }, { k: 'College', v: st.college || '-' }, { k: 'Branch', v: st.branch || '-' },
    { k: 'Degree / year', v: [st.degree, st.year].filter(Boolean).join(' · ') || '-' }, { k: 'Roll number', v: st.rollNumber || '-' },
    { k: 'Started', v: detail.startedAt ? formatIST(detail.startedAt, { seconds: true }) : '-' },
    { k: 'Submitted', v: detail.submittedAt ? formatIST(detail.submittedAt, { seconds: true }) : '-' },
    { k: 'Status', v: STATUS_LABEL[detail.status] || detail.status },
  ], { fontSize: 8.2 });
  const r = detail.result;
  if (r) {
    y = cards(doc, y, [
      { label: 'Score', value: `${fmtNum(r.score)}/${r.maxMarks}`, sub: fmtPct(r.percentage) },
      { label: 'Correct', value: r.correct, color: C.ok }, { label: 'Incorrect', value: r.incorrect, color: C.bad }, { label: 'Unanswered', value: r.unanswered },
      { label: 'Time taken', value: fmtDuration(r.timeTakenSeconds) },
      { label: 'Rank', value: detail.rank == null ? '-' : `${detail.rank}`, sub: detail.rankOf ? `of ${detail.rankOf} completed` : '' },
      { label: 'Percentile', value: detail.percentile == null ? '-' : fmtNum(detail.percentile), sub: 'relative standing' },
      { label: 'Proctoring flags', value: detail.proctoring ? detail.proctoring.flagCount : 0, color: detail.proctoring && detail.proctoring.flagCount ? C.warn : C.ink },
    ]);
    y = heading(doc, y + 2, 'Question-wise marks');
    const letter = (i) => (i == null ? '-' : 'ABCD'[i]);
    y = table(doc, y, [
      { key: 'n', label: '#', width: 26 }, { key: 'subject', label: 'Section', width: 190 }, { key: 'sel', label: 'Selected', width: 64, align: 'center' },
      { key: 'cor', label: 'Correct', width: 64, align: 'center' }, { key: 'res', label: 'Result', width: 90 }, { key: 'marks', label: 'Marks', width: 76, align: 'right' },
    ], detail.questions.map((q) => ({
      n: String(q.questionNumber), subject: q.subject || '', sel: letter(q.selectedOption), cor: letter(q.correctOption),
      res: { text: q.status === 'CORRECT' ? 'Correct' : q.status === 'INCORRECT' ? 'Incorrect' : 'Unanswered', color: q.status === 'CORRECT' ? C.ok : q.status === 'INCORRECT' ? C.bad : C.muted },
      marks: `${fmtNum(q.marksAwarded)}/${q.marks}`,
    })));
  } else {
    y = heading(doc, y + 2, 'Result');
    y = paragraphs(doc, y, ['This attempt has not been submitted yet, so there is no result.']);
  }
  const p = detail.proctoring;
  y = heading(doc, y + 4, 'Proctoring', p ? `Status: ${p.status}${p.terminationReason ? ` · Ended by: ${TERMINATION_LABEL[p.terminationReason] || p.terminationReason}` : ''}` : 'No proctoring session was recorded.');
  if (p) {
    y = table(doc, y, [{ key: 'time', label: 'Time (IST)', width: 130 }, { key: 'type', label: 'Event', width: 180 }, { key: 'sev', label: 'Severity', width: 70 }, { key: 'note', label: 'Counted / detail', width: 130 }],
      p.events.filter((e) => e.type !== 'SESSION_STARTED').map((e) => ({
        time: formatIST(e.occurredAt, { seconds: true }).replace(' IST', ''), type: e.type.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()), sev: e.severity,
        note: [e.counted ? `warning ${e.warningNumber || ''}`.trim() : '', e.confidence != null ? `confidence ${Math.round(e.confidence * 100)}%` : '', e.durationMs ? `${Math.round(e.durationMs / 100) / 10}s` : ''].filter(Boolean).join(' · ') || '-',
      })), { emptyText: 'No proctoring events were recorded.' });
  }
  footers(doc, `${exam.title} - ${st.name || 'result'}`, generatedAt);
  doc.end();
  return done;
};

module.exports = { renderExamReport, renderAttemptReport, fmtDuration, prepare, LOGO_FILE, STATUS_LABEL };

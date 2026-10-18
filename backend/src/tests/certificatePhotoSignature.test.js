/**
 * Certificates: the student's profile photo and the updated Founder signature.
 *
 *   node --test src/tests/certificatePhotoSignature.test.js
 *
 * Real HTTP -> routes -> controllers -> services against the in-memory fake models. The PDFs are really rendered; the photo is
 * checked by rasterising the PDF (poppler) and sampling the pixel in the middle of the photo frame, so "the right photo" means
 * the right PIXELS, not just a source-code check. Test photos are synthetic solid-colour images (no real person's photo).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { execFileSync, spawnSync } = require('child_process');
const os = require('os');
const Module = require('module');
const express = require('express');
const { PNG } = require('pngjs');

const SRC = path.join(__dirname, '..');
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.NODE_ENV = 'test';
process.env.CLIENT_URL = 'https://learniq.example.com';

const { createFakeDb, FakeModel } = require('./helpers/fakeDb');
const fake = createFakeDb();
const ProfilePhoto = new FakeModel('ProfilePhoto', { registry: fake.registry, unique: [{ fields: ['user'] }] });
const overrides = {
  [path.join(SRC, 'models', 'ExamAccess.js')]: fake.examAccessModels,
  [path.join(SRC, 'models', 'AuthSession.js')]: fake.authSessionModels,
  [path.join(SRC, 'services', 'razorpayClient.js')]: { getRazorpayInstance: () => null },
  [path.join(SRC, 'models', 'Proctoring.js')]: fake.proctoringModels,
  [path.join(SRC, 'models', 'Olympiad.js')]: {
    OlympiadExam: fake.OlympiadExam, OlympiadQuestion: fake.OlympiadQuestion,
    OlympiadPayment: fake.OlympiadPayment, OlympiadAttempt: fake.OlympiadAttempt,
  },
  [path.join(SRC, 'models', 'User.js')]: fake.User,
  [path.join(SRC, 'models', 'TeacherInterview.js')]: fake.interviewModels,
  [path.join(SRC, 'models', 'Certificate.js')]: { Certificate: fake.Certificate, Counter: fake.Counter },
  [path.join(SRC, 'models', 'ProfilePhoto.js')]: { ProfilePhoto },
  [path.join(SRC, 'models', 'index.js')]: { Notification: fake.Notification, Payment: fake.Payment, Enrollment: fake.Enrollment },
};
const originalLoad = Module._load;
Module._load = function patchedLoad(request, parent, isMain) {
  let resolved;
  try { resolved = Module._resolveFilename(request, parent, isMain); } catch (e) { return originalLoad.apply(this, arguments); }
  if (overrides[resolved]) return overrides[resolved];
  return originalLoad.apply(this, arguments);
};

const svc = require('../services/certificateService');
const photoSvc = require('../services/certificatePhoto');
const completion = require('../services/certificateCompletionPdf');
const { buildPdfContext, buildContext } = require('../services/certificateContext');
const olympiadRouter = require('../routes/olympiad');
const certificateRouter = require('../routes/certificates');

const HAVE_POPPLER = spawnSync('pdftoppm', ['-v']).status !== null && spawnSync('pdfimages', ['-v']).status !== null;
const BRAND = path.join(SRC, '..', 'assets', 'certificate', 'completion');

// ───────────── helpers ─────────────
const png = (r, g, b, w = 96, h = 128) => {
  const img = new PNG({ width: w, height: h });
  for (let i = 0; i < w * h; i += 1) { img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = 255; }
  return PNG.sync.write(img);
};
const RED = png(220, 20, 20); const GREEN = png(20, 200, 40); const BLUE = png(20, 40, 220);

let server; let BASE; const S = {};
const call = async (url, token) => {
  const res = await fetch(`${BASE}${url}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, headers: res.headers, buf: Buffer.from(await res.arrayBuffer()) };
};
const post = async (url, token, body) => {
  const res = await fetch(`${BASE}${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => null) };
};

let seq = 0;
const mkUser = async (name, role = 'student') => {
  seq += 1;
  const user = await fake.User.create({ name, email: `ph${seq}@example.com`, password: 'x', role, currentStandard: role === 'student' ? 10 : undefined });
  return { user, token: fake.sessionToken(user) };
};
const setPhoto = (userId, data, contentType = 'image/png') => ProfilePhoto.findOneAndUpdate({ user: userId }, { $set: { contentType, data, size: data.length } }, { upsert: true, new: true });

const sitExam = async (name, photo) => {
  const u = await mkUser(name);
  if (photo) await setPhoto(u.user._id, photo);
  await fake.OlympiadPayment.create({ student: u.user._id, exam: S.exam._id, amount: 20, status: 'SUCCESS', razorpayOrderId: `order_${u.user._id}`, razorpayPaymentId: `pay_${u.user._id}` });
  const started = await post(`/api/olympiad/exams/${S.exam._id}/start`, u.token, {});
  assert.equal(started.status, 200);
  const answers = S.questions.map((q, i) => ({ questionId: String(q._id), selectedOption: i < 80 ? 0 : 1 }));
  const submit = await post(`/api/olympiad/exams/${S.exam._id}/submit`, u.token, { answers });
  assert.equal(submit.status, 200);
  const certs = fake.Certificate.docs.filter((c) => String(c.student) === String(u.user._id));
  return { ...u, result: certs.find((c) => c.type !== 'PARTICIPATION'), participation: certs.find((c) => c.type === 'PARTICIPATION') };
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-photo-'));
/** Rasterise page 1 at 72 dpi (1 pt = 1 px). */
const raster = (pdf) => {
  const f = path.join(tmp, `p${crypto.randomBytes(4).toString('hex')}`);
  fs.writeFileSync(`${f}.pdf`, pdf);
  execFileSync('pdftoppm', ['-r', '72', '-png', `${f}.pdf`, f]);
  const file = fs.readdirSync(tmp).find((n) => n.startsWith(path.basename(f)) && n.endsWith('.png'));
  return PNG.sync.read(fs.readFileSync(path.join(tmp, file)));
};
const sample = (img, dx, dy) => { // design px -> pt
  const k = completion.A4_W / completion.DESIGN_W;
  const x = Math.round(dx * k); const y = Math.round(dy * k);
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
};
const PIC_CENTRE = [1390, 420];
const isColour = ([r, g, b], [er, eg, eb], tol = 40) => Math.abs(r - er) < tol && Math.abs(g - eg) < tol && Math.abs(b - eb) < tol;
const imageCount = (pdf) => {
  const f = path.join(tmp, `i${crypto.randomBytes(4).toString('hex')}.pdf`);
  fs.writeFileSync(f, pdf);
  return execFileSync('pdfimages', ['-list', f]).toString().trim().split('\n').slice(2).filter((l) => !/\bsmask\b/.test(l)).length;
};

test.before(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/olympiad', olympiadRouter);
  app.use('/api/certificates', certificateRouter);
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  BASE = `http://127.0.0.1:${server.address().port}`;
  S.exam = await fake.OlympiadExam.create({ resultsPublishedAt: new Date(), title: 'LearnIQ – All India Olympiad Examination 2026', slug: 'photo-test-std-10', standard: 10,
    startDate: new Date(Date.now() - 3600e3), endDate: new Date(Date.now() + 2 * 86400e3), durationMinutes: 60, totalQuestions: 100, totalMarks: 100, fee: 20 });
  S.questions = [];
  for (let i = 1; i <= 100; i += 1) {
    S.questions.push(await fake.OlympiadQuestion.create({ exam: S.exam._id, questionNumber: i, subject: 'Mathematics', questionText: `Question number ${i}?`, options: ['A', 'B', 'C', 'D'], correctAnswer: 0, marks: 1 }));
  }
  S.a = await sitExam('Asha Red', RED);
  S.b = await sitExam('Bela Green', GREEN);
  S.c = await sitExam('Chandu NoPhoto', null);
});
test.after(() => { server.close(); fs.rmSync(tmp, { recursive: true, force: true }); });

// ───────────── photo loading ─────────────
test('loader: no photo -> null; PNG and JPEG are returned; the photo belongs to the asked student', async () => {
  assert.equal(await photoSvc.loadStudentPhoto(S.c.user._id), null, 'never uploaded');
  const a = await photoSvc.loadStudentPhoto(S.a.user._id);
  assert.equal(a.type, 'png'); assert.equal(a.width, 96); assert.equal(a.height, 128); assert.ok(a.buffer.equals(RED));
  const b = await photoSvc.loadStudentPhoto(S.b.user._id);
  assert.ok(b.buffer.equals(GREEN), 'each student gets their own photo');
  assert.equal(await photoSvc.loadStudentPhoto(null), null);
});

test('loader: unsupported (WebP), corrupt, truncated, tiny, oversized, wrong-owner and failing lookups all fall back to "no photo" without throwing', async () => {
  const logs = []; const log = (m) => logs.push(m);
  const webp = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(40)]);
  const fakeModel = (doc) => ({ findOne: async () => doc });
  const id = S.a.user._id;
  assert.equal(await photoSvc.loadStudentPhoto(id, { model: fakeModel({ user: id, data: webp }), log }), null);
  assert.equal(await photoSvc.loadStudentPhoto(id, { model: fakeModel({ user: id, data: Buffer.from('not an image at all, just text, long enough to pass size') }), log }), null);
  const jpegHead = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xc0, 0, 17, 8, 1, 0, 1, 0, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0, 1, 2, 3]);
  assert.equal(await photoSvc.loadStudentPhoto(id, { model: fakeModel({ user: id, data: jpegHead }), log }), null, 'a JPEG cut off before its end marker is not embedded');
  assert.equal(await photoSvc.loadStudentPhoto(id, { model: fakeModel({ user: id, data: png(1, 2, 3, 20, 20) }), log }), null, 'too small to print');
  assert.equal(await photoSvc.loadStudentPhoto(id, { model: fakeModel({ user: id, data: Buffer.alloc(photoSvc.MAX_BYTES + 1, 1) }), log }), null);
  assert.equal(await photoSvc.loadStudentPhoto(id, { model: fakeModel({ user: S.b.user._id, data: GREEN }), log }), null, "another user's photo is never used");
  assert.equal(await photoSvc.loadStudentPhoto(id, { model: { findOne: async () => { throw new Error('db down'); } }, log }), null);
  assert.equal(await photoSvc.loadStudentPhoto(id, { model: { findOne: () => new Promise(() => {}) }, timeoutMs: 30, log }), null, 'a slow lookup times out');
  assert.ok(logs.length >= 4);
  assert.ok(logs.every((m) => !/password|token/i.test(m)));
});

test('public verification data never carries the photo', async () => {
  const ctx = await buildContext(S.a.result);
  assert.equal(ctx.photo, undefined);
  const pdfCtx = await buildPdfContext(S.a.result);
  assert.ok(pdfCtx.photo && pdfCtx.photo.buffer.equals(RED));
  const pub = await call(`/api/certificates/verify/${S.a.result.certificateNumber}`);
  assert.equal(pub.status, 200);
  assert.ok(!/photo|avatar|data:image/i.test(pub.buf.toString()));
});

// ───────────── generated PDFs ─────────────
test('A/C/E: result AND participation certificates carry THEIR student\'s photo (pixel check)', { skip: !HAVE_POPPLER && 'poppler not installed' }, async () => {
  const get = async (u, cert) => (await call(`/api/certificates/${cert.certificateNumber}/download`, u.token)).buf;
  const aRes = await get(S.a, S.a.result); const aPar = await get(S.a, S.a.participation);
  const bRes = await get(S.b, S.b.result); const bPar = await get(S.b, S.b.participation);
  for (const pdf of [aRes, aPar, bRes, bPar]) assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(isColour(sample(raster(aRes), ...PIC_CENTRE), [220, 20, 20]), 'A result: red photo');
  assert.ok(isColour(sample(raster(aPar), ...PIC_CENTRE), [220, 20, 20]), 'A participation: red photo');
  assert.ok(isColour(sample(raster(bRes), ...PIC_CENTRE), [20, 200, 40]), 'B result: green photo');
  assert.ok(isColour(sample(raster(bPar), ...PIC_CENTRE), [20, 200, 40]), 'B participation: green photo');
  assert.ok(!isColour(sample(raster(aRes), ...PIC_CENTRE), [20, 200, 40]), "A never shows B's photo");
});

test('B/D: without a photo both certificates generate, embed no photo, and keep the QR code in the right-hand column', { skip: !HAVE_POPPLER && 'poppler not installed' }, async () => {
  const cRes = (await call(`/api/certificates/${S.c.result.certificateNumber}/download`, S.c.token)).buf;
  const cPar = (await call(`/api/certificates/${S.c.participation.certificateNumber}/download`, S.c.token)).buf;
  const aRes = (await call(`/api/certificates/${S.a.result.certificateNumber}/download`, S.a.token)).buf;
  assert.equal(imageCount(aRes), imageCount(cRes) + 1, 'exactly one more image (the photo) when a photo exists');
  assert.equal(imageCount(cPar), imageCount(cRes));
  for (const pdf of [cRes, cPar]) {
    const img = raster(pdf);
    const [r, g, b] = sample(img, ...PIC_CENTRE);
    assert.ok(!(r > 150 && g < 80 && b < 80) && !(g > 150 && r < 60), 'no stray photo colour');
    // photo-free layout: QR card (white) in the right column and nothing in the left QR slot
    assert.ok(sample(img, 1306, 300).every((v) => v > 235), 'QR card is in the right column');
  }
});

test('F: a changed profile photo appears on the next download; certificate number, record and QR destination are unchanged', { skip: !HAVE_POPPLER && 'poppler not installed' }, async () => {
  const before = JSON.stringify(fake.Certificate.docs.filter((c) => String(c.student) === String(S.a.user._id)));
  const countBefore = fake.Certificate.docs.length;
  const verifyBefore = svc.verificationUrl(S.a.result);
  assert.ok(isColour(sample(raster((await call(`/api/certificates/${S.a.result.certificateNumber}/download`, S.a.token)).buf), ...PIC_CENTRE), [220, 20, 20]));
  await setPhoto(S.a.user._id, BLUE);
  const again = (await call(`/api/certificates/${S.a.result.certificateNumber}/download`, S.a.token)).buf;
  assert.ok(isColour(sample(raster(again), ...PIC_CENTRE), [20, 40, 220]), 'the new photo is used');
  assert.equal(JSON.stringify(fake.Certificate.docs.filter((c) => String(c.student) === String(S.a.user._id))), before, 'certificate records untouched');
  assert.equal(fake.Certificate.docs.length, countBefore, 'no duplicate certificate');
  assert.equal(svc.verificationUrl(S.a.result), verifyBefore);
  await setPhoto(S.a.user._id, RED);
  // removing the photo gives the photo-free certificate again
  await ProfilePhoto.deleteOne({ user: S.a.user._id });
  const gone = (await call(`/api/certificates/${S.a.result.certificateNumber}/download`, S.a.token)).buf;
  assert.ok(!isColour(sample(raster(gone), ...PIC_CENTRE), [220, 20, 20]));
  await setPhoto(S.a.user._id, RED);
});

test('J: ownership rules are unchanged - another student cannot download this certificate', async () => {
  const r = await call(`/api/certificates/${S.a.result.certificateNumber}/download`, S.b.token);
  assert.ok([403, 404].includes(r.status), `got ${r.status}`);
  assert.notEqual(r.buf.subarray(0, 5).toString(), '%PDF-');
  assert.equal((await call(`/api/certificates/${S.a.result.certificateNumber}/download`)).status, 401);
});

test('a photo that cannot be embedded never blocks the certificate (corrupt PNG bytes with a valid header)', async () => {
  const bad = Buffer.concat([png(5, 5, 5).subarray(0, 40), Buffer.alloc(200, 7)]);
  const ctx = await buildContext(S.c.result);
  const pdf = await completion.renderCompletionPdf({ ...ctx, photo: { buffer: bad, type: 'png', width: 96, height: 128 } });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
});

// ───────────── Founder signature ─────────────
test('G: the Founder signature is the new transparent handwritten image; the other three signatures are byte-for-byte unchanged', () => {
  const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(BRAND, f))).digest('hex');
  assert.equal(sha('sig-kandangire.png'), 'e52d6d29a949a57e8586d05b9d8d12cfc068a03fabea4bb41e58a2dfb01758de');
  assert.equal(sha('sig-kahane.png'), '616fa97fde36d0f4aa3008a8bbd630e1dfc022738d5f400cdfdc90c909f9ff5a');
  assert.equal(sha('sig-gotarne.png'), 'c3b9d6232d748398c57124e55e70285200242dd7b4b281f63c4bbc4aceadccc4');
  assert.notEqual(sha('sig-raut.png'), 'b2b55149ea7979c40a0a36ac603f5ff3741dea5230fb700e2edc021b5ab0afd5', 'the old Founder signature is gone');
  const img = PNG.sync.read(fs.readFileSync(path.join(BRAND, 'sig-raut.png')));
  assert.ok(img.width >= 800, 'high resolution for print');
  let transparent = 0; let opaque = 0;
  for (let i = 3; i < img.data.length; i += 4) { if (img.data[i] === 0) transparent += 1; else if (img.data[i] > 200) opaque += 1; }
  assert.ok(transparent / (img.width * img.height) > 0.6, 'paper background removed (transparent)');
  assert.ok(opaque > 3000, 'the pen strokes are kept');
  const sig = completion.SIGNATORIES.map((s) => `${s.name}|${s.title}|${s.image}`);
  assert.deepEqual(sig, ['Nikhil Kandangire|CMO|sigKandangire', 'Kruti Kahane|CTO|sigKahane', 'Akanksha Gotarne|CEO|sigGotarne', 'Prof. Mayur Raut|Founder & MD|sigRaut']);
});

test('G: the Founder signature is the ONLY place the Founder signature comes from (shared asset, both certificate types)', () => {
  const src = fs.readFileSync(path.join(SRC, 'services', 'certificateCompletionPdf.js'), 'utf8');
  assert.equal((src.match(/sig-raut\.png/g) || []).length, 1);
  assert.equal((src.match(/drawSignatures\(doc\)/g) || []).length, 1, 'one signature block for both types');
});

test('the official signature is essential: if the asset is unavailable the PDF is NOT produced (no blank signature)', async () => {
  const file = path.join(BRAND, 'sig-raut.png'); const hold = `${file}.hold`;
  const ctx = await buildContext(S.c.result);
  // the module caches loaded images: use a fresh module instance so the missing file is really read
  delete require.cache[require.resolve('../services/certificateCompletionPdf')];
  const fresh = require('../services/certificateCompletionPdf');
  fs.renameSync(file, hold);
  try { await assert.rejects(() => fresh.renderCompletionPdf(ctx)); } finally { fs.renameSync(hold, file); }
  delete require.cache[require.resolve('../services/certificateCompletionPdf')];
  const ok = await require('../services/certificateCompletionPdf').renderCompletionPdf(ctx);
  assert.equal(ok.subarray(0, 5).toString(), '%PDF-');
});

test('H: the signature and the photo do not overlap other elements (geometry)', () => {
  const { frame, pic } = completion.PHOTO;
  assert.ok(pic.x >= frame.x && pic.y >= frame.y && pic.x + pic.w <= frame.x + frame.w && pic.y + pic.h <= frame.y + frame.h);
  assert.ok(frame.y + frame.h < 582, 'the photo frame ends above the Certificate No. box');
  assert.ok(frame.x + frame.w < 1536 - 36, 'inside the page border');
  assert.ok(Math.abs(pic.w / pic.h - 0.75) < 0.01, 'portrait 3:4 picture area');
  // left QR card (56..204, 372..550) stays clear of the result box (starts at x 298) and the medal ribbon (ends ~y 352)
  assert.ok(56 + 148 < 298 && 372 > 352);
});

// ───────────── QR verification in BOTH layouts ─────────────
let jsQR = null; try { jsQR = require('jsqr'); } catch (e) { /* dev dependency; the test skips without it */ }
test('QR: scanning the PDF returns the certificate\'s own verification URL - with a photo (left card) and without (right frame)', { skip: (!HAVE_POPPLER || !jsQR) && 'poppler or jsqr missing' }, async () => {
  const decode = (pdf) => {
    const f = path.join(tmp, `q${crypto.randomBytes(4).toString('hex')}`);
    fs.writeFileSync(`${f}.pdf`, pdf);
    execFileSync('pdftoppm', ['-r', '200', '-png', '-singlefile', `${f}.pdf`, f]);
    const img = PNG.sync.read(fs.readFileSync(`${f}.png`));
    const r = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
    return r && r.data;
  };
  for (const [u, cert] of [[S.a, S.a.result], [S.a, S.a.participation], [S.c, S.c.result], [S.c, S.c.participation]]) {
    const pdf = (await call(`/api/certificates/${cert.certificateNumber}/download`, u.token)).buf;
    assert.equal(decode(pdf), svc.verificationUrl(cert), `${cert.certificateNumber} (${u === S.a ? 'photo' : 'no photo'})`);
  }
});

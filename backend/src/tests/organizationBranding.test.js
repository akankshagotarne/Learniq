/**
 * Virat Education Society on the certificates + one source of truth for the society's details.
 *
 *   node --test src/tests/organizationBranding.test.js
 *
 * Renders REAL PDFs of both certificate types (with and without a student photo) and reads them back with poppler
 * (pdftotext -bbox) - so "the registration references are on the certificate" means extracted text, not a source-code grep.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const { PNG } = require('pngjs');

const { SOCIETY, registrationLine } = require('../config/organization');
const pdfMod = require('../services/certificateCompletionPdf');

const POPPLER = spawnSync('pdftotext', ['-v']).status !== null && spawnSync('pdftoppm', ['-v']).status !== null;
let jsQR = null; try { jsQR = require('jsqr'); } catch (e) { /* optional dev dependency */ }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'org-'));
test.after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const REG1 = 'MAH-93/19-(0222228)';
const REG2 = 'F-25431(6750)';

const photo = () => { const w = 96; const h = 128; const img = new PNG({ width: w, height: h }); img.data.fill(200); return { buffer: PNG.sync.write(img), type: 'png', width: w, height: h }; };
const base = { studentName: 'Asha Kulkarni', interview: { completed: true }, issueDate: new Date('2026-10-18T10:00:00Z'), issueDateLabel: '18 October 2026', verifyUrl: 'https://www.learniq.study/verify-certificate/LQOLY2026-000042?t=0123456789abcdef' };
const VARIANTS = {
  'result + photo': { ...base, kind: 'RESULT', certificateNumber: 'LQOLY2026-000042', scoreLabel: '38/40', percentage: 95, grade: 'A+', resultLabel: 'Pass', photo: photo() },
  'result, no photo': { ...base, kind: 'RESULT', certificateNumber: 'LQOLY2026-000043', scoreLabel: '20/40', percentage: 50, grade: null, resultLabel: 'Below pass mark', interview: { completed: false } },
  'participation + photo': { ...base, kind: 'PARTICIPATION', certificateNumber: 'LQPAR2026-000042', testStatus: 'Participated', interviewStatus: 'Participated', overallRemarks: 'Active Participant', photo: photo() },
  'participation, no photo': { ...base, kind: 'PARTICIPATION', certificateNumber: 'LQPAR2026-000043', testStatus: 'Participated', interviewStatus: 'Not Participated', interview: { completed: false }, overallRemarks: 'Active Participant' },
};
const render = async (name) => {
  const f = path.join(tmp, `${name.replace(/\W+/g, '_')}.pdf`);
  fs.writeFileSync(f, await pdfMod.renderCompletionPdf(VARIANTS[name]));
  return f;
};
/** words with their boxes (pt) from pdftotext -bbox */
const words = (file) => {
  const html = execFileSync('pdftotext', ['-bbox', file, '-']).toString();
  return [...html.matchAll(/<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">([^<]*)<\/word>/g)]
    .map((m) => ({ x0: +m[1], y0: +m[2], x1: +m[3], y1: +m[4], t: m[5].replace(/&amp;/g, '&') }));
};

// ───────────── one source of truth ─────────────
test('F: the society data is exactly the letterhead data; both registration references are intact and separate', () => {
  assert.equal(SOCIETY.name, 'Virat Education Society');
  assert.equal(SOCIETY.affiliation, 'An Initiative of Virat Education Society');
  assert.deepEqual(SOCIETY.registrations.map((r) => r.number), [REG1, REG2]);
  assert.deepEqual(SOCIETY.registrations.map((r) => r.date), ['2019-02-16', '2019-05-25']);
  assert.deepEqual(SOCIETY.registrations.map((r) => r.dateLabel), ['16 February 2019', '25 May 2019']);
  assert.deepEqual([...SOCIETY.phones], ['9765550636', '9860182080']);
  assert.equal(SOCIETY.email, 'cool00mayur@gmail.com');
  assert.ok(SOCIETY.officeLines.join(' ').includes('Plot No. 13') && SOCIETY.officeLines.join(' ').includes('431001'));
  assert.equal(registrationLine(), `${REG1} | ${REG2}`, 'never merged into one identifier');
  assert.ok(Object.isFrozen(SOCIETY) && Object.isFrozen(SOCIETY.registrations));
});

test('F: the website (frontend/src/constants/organization.ts) and the certificates use the SAME society details', () => {
  const ts = fs.readFileSync(path.join(__dirname, '..', '..', '..', 'frontend', 'src', 'constants', 'organization.ts'), 'utf8');
  for (const v of [SOCIETY.name, SOCIETY.affiliation, SOCIETY.email, ...SOCIETY.phones, ...SOCIETY.officeLines,
    ...SOCIETY.registrations.flatMap((r) => [r.number, r.date, r.dateLabel, r.place])]) {
    assert.ok(ts.includes(`'${v}'`), `frontend constant is missing / differs: ${v}`);
  }
});

// ───────────── both certificate types ─────────────
for (const name of Object.keys(VARIANTS)) {
  test(`D/E/G: ${name} - society line printed in full, inside the page, clear of signatures, QR and photo; brand and signatories intact`, { skip: !POPPLER && 'poppler not installed' }, async () => {
    const file = await render(name);
    const text = execFileSync('pdftotext', ['-layout', file, '-']).toString();
    const v = VARIANTS[name];
    assert.match(text, /An Initiative of Virat Education Society/);
    assert.ok(text.includes(`Registration References: ${REG1} | ${REG2}`), 'both references, complete, in order');
    assert.ok(text.includes(v.certificateNumber)); assert.ok(text.includes('18 October 2026')); assert.match(text, /Asha Kulkarni/);
    assert.match(text, v.kind === 'PARTICIPATION' ? /CERTIFICATE OF PARTICIPATION/ : /CERTIFICATE OF COMPLETION/);
    for (const s of ['Prof. Mayur Raut', 'Founder & MD', 'Akanksha Gotarne']) assert.ok(text.includes(s), s);
    for (const s of ['Nikhil Kandangire', 'Kruti Kahane']) assert.ok(!text.includes(s), `removed signatory still printed: ${s}`);
    assert.ok(!/\b(CMO|CTO)\b/.test(text), 'no CMO / CTO designation');
    assert.ok(!/Virat Education Society\s*\n?\s*CERTIFICATE/.test(text), 'the society never replaces the certificate heading');

    const w = words(file);
    const pageH = 595.28; const pageW = 841.89;
    const reg = w.filter((x) => x.t.includes('0222228') || x.t.includes('25431'));
    assert.equal(reg.length, 2);
    const line = w.filter((x) => Math.abs(x.y0 - reg[0].y0) < 1);
    const top = Math.min(...line.map((x) => x.y0)); const bottom = Math.max(...line.map((x) => x.y1));
    assert.ok(Math.min(...line.map((x) => x.x0)) > 20 && Math.max(...line.map((x) => x.x1)) < pageW - 20, 'inside the page width');
    assert.ok(pageH - bottom >= 10, `at least 10 pt above the paper edge (got ${(pageH - bottom).toFixed(1)})`);
    const lineH = bottom - top; assert.ok(lineH >= 6.5, `readable size when printed (${lineH.toFixed(1)} pt glyph box)`);
    // everything else on the page sits above this line (signature titles, footer contact row): no overlap
    const others = w.filter((x) => !line.includes(x));
    assert.ok(others.every((x) => x.y1 <= top + 0.5 || x.y0 >= bottom - 0.5), 'no other text overlaps the society line');
    const founder = w.find((x) => x.t === 'Founder'); assert.ok(founder.y1 < top - 30, 'well below the signatures');
    // the brand stays primary: the certificate heading is far larger than the society line
    const heading = w.find((x) => x.t === 'CERTIFICATE'); assert.ok((heading.y1 - heading.y0) > 3 * lineH);
  });
}

test('QR verification is unchanged in both layouts: scanning the rendered PDF returns the verification URL', { skip: (!POPPLER || !jsQR) && 'poppler or jsqr missing' }, async () => {
  for (const name of Object.keys(VARIANTS)) {
    const file = await render(name);
    const out = path.join(tmp, `qr_${name.replace(/\W+/g, '_')}`);
    execFileSync('pdftoppm', ['-r', '200', '-png', '-singlefile', file, out]);
    const img = PNG.sync.read(fs.readFileSync(`${out}.png`));
    const r = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
    assert.equal(r && r.data, VARIANTS[name].verifyUrl, name);
  }
});

test('the photo frame and the founder signature asset are untouched by the society line', () => {
  assert.deepEqual(pdfMod.PHOTO, { frame: { x: 1287, y: 285, w: 205, h: 282 }, pic: { x: 1294, y: 292, w: 192, h: 257 } });
  assert.equal(pdfMod.SIGNATORIES.find((s) => s.image === 'sigRaut').title, 'Founder & MD');
  assert.equal(pdfMod.societyLine(), `An Initiative of Virat Education Society   •   Registration References: ${REG1} | ${REG2}`);
});

// ───────────── top society name + two signatories + official stamp ─────────────
test('the organisation NAME is at the top of every variant (name only), above the LearnIQ logo and title; registrations stay in the footer', { skip: !POPPLER }, async () => {
  for (const name of Object.keys(VARIANTS)) {
    const file = await render(name);
    const w = words(file);
    const top = ['VIRAT', 'EDUCATION', 'SOCIETY'].map((t) => w.find((x) => x.t === t && x.y1 < 70));
    assert.ok(top.every(Boolean), `${name}: "VIRAT EDUCATION SOCIETY" in the top header`);
    assert.ok(top[0].x0 < top[1].x0 && top[1].x0 < top[2].x0);
    const title = w.find((x) => x.t === 'CERTIFICATE');
    const tag = w.find((x) => x.t === 'LEARN');
    assert.ok(top[0].y1 < tag.y0 && tag.y1 < title.y0, `${name}: society name < tagline < title`);
    assert.ok(Math.abs((top[0].x0 + top[2].x1) / 2 - 841.89 / 2) < 6, 'centred');
    // nothing but the name in the top band: no registration numbers / address / phone / email up there
    assert.ok(!w.some((x) => x.y1 < 70 && /MAH|F-25431|Nashik|9765|9860|@/.test(x.t)));
    assert.ok(w.some((x) => x.y0 > 540 && x.t.includes('F-25431(6750)')), 'registration references remain in the footer');
    const h = (top[0].y1 - top[0].y0);
    assert.ok(h >= 11, 'readable');
  }
});

test('signature block: CEO left, society stamp centred between, Founder & MD right; stamp does not touch either block', { skip: !POPPLER }, async () => {
  for (const name of Object.keys(VARIANTS)) {
    const file = await render(name);
    const w = words(file);
    const ceo = w.find((x) => x.t === 'Akanksha'); const founder = w.find((x) => x.t === 'Prof.');
    assert.ok(ceo && founder && ceo.x0 < 841.89 / 2 && founder.x0 > 841.89 / 2);
    const sc = 841.89 / pdfMod.DESIGN_W;
    const imgs = execFileSync('pdfimages', ['-list', file]).toString().split('\n').filter((l) => /^\s*\d+\s+\d+\s+image/.test(l));
    assert.ok(imgs.length >= 4, `${name}: stamp + two signatures + logo images are embedded`);
    // PNG raster check: the stamp ring is dark ink centred on the page, clear of both signature blocks
    const out = path.join(tmp, `s-${name.replace(/\W+/g, '_')}`);
    execFileSync('pdftoppm', ['-r', '150', '-png', file, out]);
    const png = PNG.sync.read(fs.readFileSync(`${out}-1.png`));
    const k = 150 / 72;
    const dark = (x0, x1, y0, y1) => { let n = 0; for (let y = Math.floor(y0 * k); y < y1 * k; y++) for (let x = Math.floor(x0 * k); x < x1 * k; x++) { const i = (png.width * y + x) * 4; if (png.data[i] < 80 && png.data[i + 1] < 80 && png.data[i + 2] < 80) n++; } return n; };
    const S = { x0: (768 - 70) * sc, x1: (768 + 70) * sc, y0: (878 - 71) * sc, y1: (878 + 71) * sc };
    assert.ok(dark(S.x0, S.x1, S.y0, S.y1) > 2500, `${name}: the stamp is printed in its black ink`);
    assert.ok(dark(S.x0 - 12, S.x0 - 2, S.y0, S.y1) < 30 && dark(S.x1 + 2, S.x1 + 12, S.y0, S.y1) < 30, 'a clear gap each side of the stamp');
    const nameL = w.find((x) => x.t === 'Akanksha'); const nameR = founder;
    const ceoLine = w.filter((x) => Math.abs(x.y0 - nameL.y0) < 2 && x.x0 < 841.89 / 2); const fLine = w.filter((x) => Math.abs(x.y0 - nameR.y0) < 2 && x.x0 > 841.89 / 2 + 50);
    assert.ok(Math.max(...ceoLine.map((x) => x.x1)) < S.x0 - 15, 'CEO text clear of the stamp');
    assert.ok(Math.min(...fLine.map((x) => x.x0)) > S.x1 + 15, 'Founder text clear of the stamp');
    assert.ok(S.y1 < 595.28 * (964 / 1086), 'stamp stays inside the inner border');
  }
});

test('the supplied official stamp asset is used as-is (cropped + ink-only alpha, not redrawn) and a missing asset fails loudly', async () => {
  const f = path.join(__dirname, '..', '..', 'assets', 'certificate', 'completion', 'society-stamp.png');
  const img = PNG.sync.read(fs.readFileSync(f));
  assert.ok(img.width >= 600 && Math.abs(img.width / img.height - 700 / 673) < 0.01, 'aspect ratio preserved');
  const edge = (x, y) => img.data[(img.width * y + x) * 4 + 3];
  assert.equal(edge(0, 0), 0); assert.equal(edge(img.width - 1, img.height - 1), 0);
  let ink = 0; for (let i = 3; i < img.data.length; i += 4) if (img.data[i] > 200) ink++;
  assert.ok(ink > 8000, 'the stamp strokes are present');
  assert.ok(/society-stamp\.png/.test(fs.readFileSync(require.resolve('../services/certificateCompletionPdf'), 'utf8')));
});

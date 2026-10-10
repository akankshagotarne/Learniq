/**
 * Unit tests for the episode logic that decides when a camera observation becomes ONE warning.
 * Controlled detector readings - this verifies the application logic, not the real-world accuracy of the models.
 *   npm run test:unit
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEpisodeTracker, createFaceCheck } from '../src/proctoring/episodes.ts';

const CFG = { faceAbsenceThresholdMs: 4000, multiFacePersistenceMs: 2500, phonePersistenceMs: 1500, phoneConfidence: 0.5, recoveryMs: 1500, maxGapMs: 3000 };

/** feed readings every `every` ms from t0 to t1 with a fixed reading */
const run = (tr: ReturnType<typeof createEpisodeTracker>, t0: number, t1: number, every: number, faceCount: number | null, phoneScore: number | null = null) => {
  const out = [];
  for (let t = t0; t <= t1; t += every) out.push(...tr.observe({ at: t, faceCount, phoneScore }));
  return out;
};

test('12: a single missed frame never creates a face warning', () => {
  const tr = createEpisodeTracker(CFG);
  let eps = run(tr, 0, 2000, 500, 1);
  eps = eps.concat(run(tr, 2500, 2500, 500, 0)); // one frame without a face
  eps = eps.concat(run(tr, 3000, 20000, 500, 1));
  assert.equal(eps.length, 0);
});

test('11: a long absence is ONE episode; it is confirmed only after the threshold', () => {
  const tr = createEpisodeTracker(CFG);
  let eps = run(tr, 0, 3500, 500, 0);
  assert.equal(eps.length, 0, 'not yet 4 s');
  eps = run(tr, 4000, 60000, 500, 0); // a whole minute away
  assert.equal(eps.length, 1);
  assert.equal(eps[0].type, 'FACE_MISSING');
  assert.ok(eps[0].durationMs >= 4000);
});

test('13: the face returning ends the episode (after recovery) so the next absence is a new warning', () => {
  const tr = createEpisodeTracker(CFG);
  let n = run(tr, 0, 5000, 500, 0).length;
  n += run(tr, 5500, 6000, 500, 1).length;   // back for only 1 s (< recovery 1.5 s): same episode continues
  n += run(tr, 6500, 12000, 500, 0).length;
  assert.equal(n, 1, 'short return = still the same episode');
  n += run(tr, 12500, 16000, 500, 1).length; // back for 3.5 s: episode over
  n += run(tr, 16500, 22000, 500, 0).length; // gone again
  assert.equal(n, 2);
});

test('detection gaps (stalled inference / hidden tab) do not turn into a face warning', () => {
  const tr = createEpisodeTracker(CFG);
  const eps = [
    ...tr.observe({ at: 0, faceCount: 0, phoneScore: null }),
    ...tr.observe({ at: 10000, faceCount: 0, phoneScore: null }), // 10 s without readings
    ...tr.observe({ at: 10500, faceCount: 1, phoneScore: null }),
  ];
  assert.equal(eps.length, 0);
});

test('16-18: multiple faces - one warning per episode, flicker tolerated, new episode after recovery', () => {
  const tr = createEpisodeTracker(CFG);
  let eps = run(tr, 0, 1000, 500, 2);
  eps = eps.concat(run(tr, 1500, 1500, 500, 1));  // one frame of a single face (detector flicker)
  eps = eps.concat(run(tr, 2000, 30000, 500, 2)); // keeps going
  assert.equal(eps.length, 1);
  assert.equal(eps[0].faceCount, 2);
  run(tr, 30500, 33000, 500, 1);                  // alone again for 2.5 s
  eps = run(tr, 33500, 37000, 500, 3);
  assert.equal(eps.length, 1, 'independent second episode');
  assert.equal(eps[0].faceCount, 3);
});

test('a brief second face (2 readings, < 2.5 s) is not a warning', () => {
  const tr = createEpisodeTracker(CFG);
  assert.equal(run(tr, 0, 500, 500, 2).length + run(tr, 1000, 9000, 500, 1).length, 0);
});

test('21-23: phone - confidence threshold, persistence, one warning per episode', () => {
  const tr = createEpisodeTracker(CFG);
  assert.equal(run(tr, 0, 10000, 500, 1, 0.31).length, 0, 'below 0.5 never counts');
  let eps = run(tr, 10500, 30000, 500, 1, 0.78);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].type, 'MOBILE_PHONE_DETECTED');
  assert.equal(eps[0].confidence, 0.78);
  run(tr, 30500, 33000, 500, 1, 0);               // phone removed (> 1.5 s)
  eps = run(tr, 33500, 36000, 500, 1, 0.7);
  assert.equal(eps.length, 1, 'reappearance = new independent detection');
});

test('disabled rules produce nothing', () => {
  const tr = createEpisodeTracker({ ...CFG, faceMonitoring: false, phoneDetection: false });
  assert.equal(run(tr, 0, 20000, 500, 0, 0.99).length, 0);
});

test('6-8: pre-exam face check needs exactly one face held for 2 s', () => {
  const fc = createFaceCheck(2000);
  assert.equal(fc.observe(0, 0), 'no_face');
  assert.equal(fc.observe(500, 2), 'multiple');
  assert.equal(fc.observe(1000, 1), 'steadying');
  assert.equal(fc.observe(2500, 1), 'steadying');
  assert.equal(fc.observe(3000, 1), 'ok');
  assert.equal(fc.observe(3500, 0), 'no_face', 'leaving the frame restarts the check');
});

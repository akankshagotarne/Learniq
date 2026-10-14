/**
 * Tests for the phone detection, debounce, deduplication, and warning system.
 * Verifies that partial phone presence (score ~0.35–0.45) correctly triggers warnings,
 * deduplicates across continuous exposure, and rearms after recovery.
 *
 * Run:
 *   npm run test:unit
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createEpisodeTracker } from '../src/proctoring/episodes.ts';
import { DEFAULT_PROCTORING_POLICY } from '../src/proctoring/types.ts';

const POLICY = {
  ...DEFAULT_PROCTORING_POLICY,
  phoneConfidence: 0.35, // the fixed threshold
  phonePersistenceMs: 1500,
  recoveryMs: 1500,
  maxGapMs: 3000,
};

const feedObservations = (
  tracker: ReturnType<typeof createEpisodeTracker>,
  t0: number,
  t1: number,
  stepMs: number,
  faceCount: number,
  phoneScore: number | null
) => {
  const events = [];
  for (let t = t0; t <= t1; t += stepMs) {
    events.push(...tracker.observe({ at: t, faceCount, phoneScore }));
  }
  return events;
};

test('TEST C & D — Partially visible phone with score 0.38 triggers warning after persistence', () => {
  const tr = createEpisodeTracker(POLICY);
  // Phone score 0.38 (typical for partial or angled smartphone)
  // Before 1500ms: no episode yet (debouncing)
  let eps = feedObservations(tr, 0, 1000, 200, 1, 0.38);
  assert.equal(eps.length, 0, 'Must not fire before phonePersistenceMs (1500ms)');

  // At 1600ms+: persistence satisfied -> exactly 1 episode
  eps = feedObservations(tr, 1200, 2000, 200, 1, 0.38);
  assert.equal(eps.length, 1, 'Should trigger confirmed episode after persistence');
  assert.equal(eps[0].type, 'MOBILE_PHONE_DETECTED');
  assert.equal(eps[0].confidence, 0.38);
});

test('TEST C — Sub-threshold detection (score 0.25) is ignored and never generates warnings', () => {
  const tr = createEpisodeTracker(POLICY);
  const eps = feedObservations(tr, 0, 10000, 200, 1, 0.25);
  assert.equal(eps.length, 0, 'Score 0.25 is below 0.35 threshold and must never count');
});

test('TEST F — The reported bug: a phone scoring 0.40 failed on old 0.50 threshold but succeeds on 0.35', () => {
  // Old policy (0.50 threshold)
  const oldTracker = createEpisodeTracker({ ...POLICY, phoneConfidence: 0.50 });
  const oldEvents = feedObservations(oldTracker, 0, 5000, 200, 1, 0.40);
  assert.equal(oldEvents.length, 0, 'Old policy with 0.50 failed to detect 0.40 phone');

  // Fixed policy (0.35 threshold)
  const fixedTracker = createEpisodeTracker(POLICY);
  const fixedEvents = feedObservations(fixedTracker, 0, 5000, 200, 1, 0.40);
  assert.equal(fixedEvents.length, 1, 'Fixed policy with 0.35 correctly detects 0.40 phone');
  assert.equal(fixedEvents[0].type, 'MOBILE_PHONE_DETECTED');
});

test('TEST G — Warning deduplication: phone held continuously in view produces only ONE episode', () => {
  const tr = createEpisodeTracker(POLICY);
  // Student holds smartphone in camera view continuously for 20 seconds
  const eps = feedObservations(tr, 0, 20000, 200, 1, 0.42);
  assert.equal(eps.length, 1, 'Continuous episode must emit exactly ONE warning, not repeated warnings per frame');
});

test('TEST H — Detection rearming: removing phone and bringing it back triggers second independent episode', () => {
  const tr = createEpisodeTracker(POLICY);
  // Episode 1: Phone visible from 0 to 3000ms
  const eps1 = feedObservations(tr, 0, 3000, 200, 1, 0.45);
  assert.equal(eps1.length, 1, 'First episode emitted');

  // Phone removed from 3200ms to 6000ms (> recoveryMs 1500ms)
  const epsClear = feedObservations(tr, 3200, 6000, 200, 1, 0);
  assert.equal(epsClear.length, 0, 'No warning when phone removed');

  // Episode 2: Phone re-introduced from 6200ms to 9000ms
  const eps2 = feedObservations(tr, 6200, 9000, 200, 1, 0.45);
  assert.equal(eps2.length, 1, 'Second distinct episode emitted after recovery');
});

// ── configurable phone confidence: 1 % .. 100 % on the detector's 0-1 scale ──
import { detectorScoreFloor } from '../src/proctoring/episodes.ts';

test('detector score floor follows the saved confidence (1 % -> ~0.01, never 0.25 and never 1.0)', () => {
  assert.ok(Math.abs(detectorScoreFloor(0.01) - 0.0095) < 1e-9);
  assert.ok(detectorScoreFloor(0.01) < 0.01, 'a score of exactly 1 % still passes the detector');
  assert.ok(detectorScoreFloor(0.3) < 0.3 && detectorScoreFloor(0.3) > 0.299);
  assert.ok(detectorScoreFloor(1) < 1 && detectorScoreFloor(1) > 0.999);
  assert.ok(detectorScoreFloor(0.1) < 0.25, 'values below the old 0.25 detector floor are now reachable');
  assert.equal(detectorScoreFloor(undefined), 0.3495, 'missing -> default 0.35');
  assert.equal(detectorScoreFloor(Number.NaN), 0.3495);
});

test('a 1 % threshold confirms a phone episode from a 2 % score; a 50 % threshold ignores it', () => {
  const mk = (c: number) => createEpisodeTracker({ ...POLICY, phoneConfidence: c });
  const feed = (tr: ReturnType<typeof createEpisodeTracker>) => { const out = []; for (let t = 0; t <= 3000; t += 500) out.push(...tr.observe({ at: t, faceCount: 1, phoneScore: 0.02 })); return out; };
  assert.equal(feed(mk(0.01)).length, 1);
  assert.equal(feed(mk(0.5)).length, 0);
});

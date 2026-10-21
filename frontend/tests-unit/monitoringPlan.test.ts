/**
 * Which models an exam's proctoring policy needs. Pure logic: run with `npm run test:unit`.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { monitoringPlan, ASSET_MB } from '../src/proctoring/plan.ts';

const ALL = { cameraRequired: true, faceMonitoring: true, multiFaceMonitoring: true, phoneDetection: true };

test('every AI feature on (the default): both models and the runtime are needed - nothing was relaxed', () => {
  const p = monitoringPlan(ALL);
  assert.deepEqual([p.face, p.phone, p.detector], [true, true, true]);
  assert.equal(p.approxMb, Math.round(ASSET_MB.wasm + ASSET_MB.face + ASSET_MB.phone));
});
test('phone detection off: no phone model', () => {
  const p = monitoringPlan({ ...ALL, phoneDetection: false });
  assert.deepEqual([p.face, p.phone, p.detector], [true, false, true]);
  assert.ok(p.approxMb < monitoringPlan(ALL).approxMb);
});
test('face and multi-face off, phone on: only the phone model', () => {
  const p = monitoringPlan({ ...ALL, faceMonitoring: false, multiFaceMonitoring: false });
  assert.deepEqual([p.face, p.phone, p.detector], [false, true, true]);
});
test('either face feature alone still needs the face model', () => {
  assert.equal(monitoringPlan({ ...ALL, phoneDetection: false, multiFaceMonitoring: false }).face, true);
  assert.equal(monitoringPlan({ ...ALL, phoneDetection: false, faceMonitoring: false }).face, true);
});
test('no AI feature on: nothing to download', () => {
  const p = monitoringPlan({ ...ALL, faceMonitoring: false, multiFaceMonitoring: false, phoneDetection: false });
  assert.deepEqual([p.face, p.phone, p.detector, p.approxMb], [false, false, false, 0]);
});
test('camera not required: no model, whatever the feature flags say', () => {
  const p = monitoringPlan({ ...ALL, cameraRequired: false });
  assert.deepEqual([p.face, p.phone, p.detector], [false, false, false]);
});

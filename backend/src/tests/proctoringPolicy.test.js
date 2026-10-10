/** Pure policy / rule logic (no HTTP, no database). */
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolvePolicy, validatePolicyInput, applyPolicyEdit, publicPolicy, DEFAULT_POLICY } = require('../services/proctoring/policy');
const { deriveStatus, terminationFor } = require('../services/proctoring/service');

test('defaults match the LearnIQ rules and proctoring is off until enabled', () => {
  assert.equal(DEFAULT_POLICY.maxFaceAbsenceWarnings, 5);
  assert.equal(DEFAULT_POLICY.maxMultiFaceWarnings, 3);
  assert.equal(DEFAULT_POLICY.maxPhoneWarnings, 2);
  assert.equal(DEFAULT_POLICY.enabled, false);
  assert.deepEqual(publicPolicy({}), { enabled: false });
  assert.equal(resolvePolicy({ enabled: true }).switchAction, 'WARN_AND_REQUIRE_FULLSCREEN');
  assert.equal(resolvePolicy({ enabled: true, strictMode: true }).switchAction, 'AUTO_SUBMIT_ON_CONFIRMED_SWITCH', 'strict mode defaults to the strict response');
});

test('validation rejects wrong types, out-of-range numbers and unknown keys', () => {
  assert.throws(() => validatePolicyInput({ enabled: 'yes' }));
  assert.throws(() => validatePolicyInput({ maxFaceAbsenceWarnings: 0 }));
  assert.throws(() => validatePolicyInput({ phoneConfidence: 0.1 }));
  assert.throws(() => validatePolicyInput({ hacked: true }));
  assert.throws(() => validatePolicyInput([]));
  assert.deepEqual(validatePolicyInput({ enabled: true, phoneConfidence: 0.555, version: 99 }), { enabled: true, phoneConfidence: 0.56 }, 'version is server-managed');
});

test('edits bump the version only when something changed; strict mode switches the action', () => {
  const a = applyPolicyEdit({ enabled: true, version: 3 }, { enabled: true });
  assert.equal(a.changed, false); assert.equal(a.policy.version, 3);
  const b = applyPolicyEdit({ enabled: true, version: 3 }, { strictMode: true });
  assert.equal(b.changed, true); assert.equal(b.policy.version, 4); assert.equal(b.policy.switchAction, 'AUTO_SUBMIT_ON_CONFIRMED_SWITCH');
});

test('termination thresholds: 5th face, 3rd multi-face, phone AFTER 2 warnings, strict switch, camera grace', () => {
  const s = { policy: resolvePolicy({ enabled: true }) };
  assert.equal(terminationFor('FACE_MISSING', s, 4), null);
  assert.equal(terminationFor('FACE_MISSING', s, 5), 'FACE_ABSENCE_LIMIT');
  assert.equal(terminationFor('MULTIPLE_FACES', s, 2), null);
  assert.equal(terminationFor('MULTIPLE_FACES', s, 3), 'MULTIPLE_FACES_LIMIT');
  assert.equal(terminationFor('MOBILE_PHONE_DETECTED', s, 2), null, '2 warnings are allowed');
  assert.equal(terminationFor('MOBILE_PHONE_DETECTED', s, 3), 'MOBILE_PHONE_REPEATED');
  assert.equal(terminationFor('TAB_SWITCH', s, 10), null, 'not strict');
  assert.equal(terminationFor('WINDOW_BLUR', s, 50), null);
  const strict = { policy: resolvePolicy({ enabled: true, strictMode: true }) };
  assert.equal(terminationFor('TAB_SWITCH', strict, 1), 'STRICT_POLICY_VIOLATION');
  assert.equal(terminationFor('FULLSCREEN_NOT_RESTORED', strict, 0), 'STRICT_POLICY_VIOLATION');
  assert.equal(terminationFor('CAMERA_NOT_RESTORED', s, 0), null);
  assert.equal(terminationFor('CAMERA_NOT_RESTORED', { policy: resolvePolicy({ enabled: true, cameraFailureAction: 'AUTO_SUBMIT_AFTER_GRACE' }) }, 0), 'CAMERA_FAILURE');
});

test('status model: technical events are not flags; violations are; auto-submission and review win', () => {
  assert.equal(deriveStatus({ counts: {} }), 'NOT_FLAGGED');
  assert.equal(deriveStatus({ counts: { network: 1, camera: 1, windowBlur: 2 } }), 'MONITORING_EVENTS');
  assert.equal(deriveStatus({ counts: { faceAbsence: 1 } }), 'FLAGGED_FOR_REVIEW');
  assert.equal(deriveStatus({ status: 'COMPLETED', terminationReason: 'MULTIPLE_FACES_LIMIT', counts: {} }), 'AUTO_SUBMITTED');
  assert.equal(deriveStatus({ status: 'COMPLETED', terminationReason: 'MANUAL_SUBMISSION', counts: {} }), 'NOT_FLAGGED');
  assert.equal(deriveStatus({ status: 'COMPLETED', terminationReason: 'FACE_ABSENCE_LIMIT', counts: {}, review: { reviewedAt: new Date() } }), 'REVIEWED');
});

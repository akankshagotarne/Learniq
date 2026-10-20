/** Live-class client rules (countdown, main-stage choice, chat presentation).   npm run test:unit */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chatPresentation, chooseStage, deadlineFrom, fractionLeft, initials, msLeft, secLabel, secondsLeft, stageState, thumbnailsFor } from '../src/features/live/logic.ts';

const P = (socketId: string, extra: Record<string, unknown> = {}) => ({ socketId, userId: `u-${socketId}`, name: socketId, role: 'student', isHost: false, isTeacher: false, isCameraOn: false, isMicOn: false, isScreenSharing: false, ...extra }) as any;
const host = P('H', { isHost: true, isTeacher: true, role: 'teacher', isCameraOn: true });
const s1 = P('S1'); const s2 = P('S2');
const stage = (extra: Record<string, unknown> = {}) => ({ mode: 'everyone', layout: 'speaker', hostSocketId: 'H', screenShareSocketId: null, spotlightSocketId: null, featuredSocketIds: [], ...extra }) as any;

test('countdown comes from the server-told remaining time on a local monotonic clock, rounded up, never negative', () => {
  let t = 1000; const clock = () => t;
  const d = deadlineFrom(15000, clock);
  assert.equal(secondsLeft(d, clock), 15);
  t += 800; assert.equal(secondsLeft(d, clock), 15);            // 14.2 s left still shows 15
  t += 400; assert.equal(secondsLeft(d, clock), 14);
  t += 14000; assert.equal(msLeft(d, clock), 0); assert.equal(secondsLeft(d, clock), 0);
  t += 5000; assert.equal(msLeft(d, clock), 0);                  // never negative
  assert.equal(deadlineFrom(-50, clock), t);                     // a late-arriving question has no time, not negative time
});
test('a wrong device clock cannot change the window (only the monotonic clock matters)', () => {
  let mono = 0; const realDateNow = Date.now;
  Date.now = () => realDateNow() + 3 * 3600e3;                   // device clock jumps 3 h
  try { const d = deadlineFrom(15000, () => mono); mono += 5000; assert.equal(secondsLeft(d, () => mono), 10); } finally { Date.now = realDateNow; }
});
test('progress fraction is 1 -> 0 and capped', () => {
  let t = 0; const c = () => t; const d = deadlineFrom(15000, c);
  assert.equal(fractionLeft(d, 15000, c), 1); t = 7500; assert.equal(fractionLeft(d, 15000, c), 0.5); t = 20000; assert.equal(fractionLeft(d, 15000, c), 0);
  assert.equal(fractionLeft(d, 0, c), 0);
});
test('answer time label matches the rank card wording ("2.4 sec")', () => {
  assert.equal(secLabel(2400), '2.4 sec'); assert.equal(secLabel(2449), '2.4 sec'); assert.equal(secLabel(2450), '2.5 sec'); assert.equal(secLabel(15000), '15.0 sec'); assert.equal(secLabel(0), '0.0 sec');
});
test('main stage: screen share beats spotlight beats the host camera - never an arbitrary student', () => {
  const all = [host, s1, s2];
  assert.deepEqual(chooseStage(stage(), all), { kind: 'host', socketId: 'H' });
  assert.deepEqual(chooseStage(stage({ mode: 'spotlight', spotlightSocketId: 'S1' }), all), { kind: 'spotlight', socketId: 'S1' });
  assert.deepEqual(chooseStage(stage({ mode: 'spotlight', spotlightSocketId: 'S1', screenShareSocketId: 'H' }), all), { kind: 'screen', socketId: 'H' });
  assert.deepEqual(chooseStage(stage({ spotlightSocketId: 'S1' }), all), { kind: 'host', socketId: 'H' });       // spotlight only counts in spotlight mode
  assert.deepEqual(chooseStage(stage({ mode: 'spotlight', spotlightSocketId: 'GONE' }), all), { kind: 'host', socketId: 'H' }); // spotlit person left
  assert.deepEqual(chooseStage(stage(), [s1, s2]), { kind: 'none', socketId: null });                          // host away
  assert.deepEqual(chooseStage(null, all), { kind: 'none', socketId: null });
});
test('thumbnails: a student sees only people the server connected them to (plus self); the host sees everyone but the stage', () => {
  const all = [host, s1, s2]; const ch = chooseStage(stage(), all);
  const peers = [{ socketId: 'H', userId: 'u-H', send: true, receive: true }, { socketId: 'S2', userId: 'u-S2', send: false, receive: false }];
  assert.deepEqual(thumbnailsFor(all, ch, 'S1', peers, false).map((p) => p.socketId), ['S1']);
  assert.deepEqual(thumbnailsFor(all, ch, 'H', [], true).map((p) => p.socketId), ['S1', 'S2']);
  const open = [...peers.slice(0, 1), { socketId: 'S2', userId: 'u-S2', send: true, receive: true }];
  assert.deepEqual(thumbnailsFor(all, ch, 'S1', open, false).map((p) => p.socketId), ['S1', 'S2']);
});
test('stage state explains what is missing instead of showing a blank box', () => {
  const ch = { kind: 'host' as const, socketId: 'H' };
  assert.equal(stageState(ch, host, true, true), 'camera');
  assert.equal(stageState(ch, host, false, true), 'connecting');
  assert.equal(stageState(ch, { ...host, isCameraOn: false }, false, true), 'camera-off');
  assert.equal(stageState({ kind: 'none', socketId: null }, undefined, false, false), 'host-away');
  assert.equal(stageState({ kind: 'screen', socketId: 'H' }, host, true, true), 'screen');
});
test('chat is docked only on wide screens; a slide-over on tablets; a bottom sheet on phones', () => {
  for (const w of [320, 360, 375, 390, 430, 639]) assert.equal(chatPresentation(w), 'sheet');
  for (const w of [640, 768, 1023]) assert.equal(chatPresentation(w), 'slideover');
  for (const w of [1024, 1280, 1920]) assert.equal(chatPresentation(w), 'docked');
});
test('initials', () => { assert.equal(initials('Akanksha Mahendra Gotarne'), 'AM'); assert.equal(initials('  '), '?'); assert.equal(initials('priya'), 'P'); });

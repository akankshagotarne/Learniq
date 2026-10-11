/**
 * The REAL Mongoose schemas behind single-session login (no database needed): the indexes MongoDB will build, and the
 * validators. The in-memory fake used by singleSession.test.js mirrors exactly these indexes.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { AuthSession, SessionTakeover } = require('../models/AuthSession');

const indexes = (Model) => Model.schema.indexes().map(([fields, opts]) => ({ fields, ...opts }));

test('AuthSession: unique sid, ONE active session per user (partial unique index), TTL purge', () => {
  const idx = indexes(AuthSession);
  const sid = idx.find((i) => i.name === 'uniq_sid');
  assert.deepEqual(sid.fields, { sid: 1 }); assert.equal(sid.unique, true);
  const one = idx.find((i) => i.name === 'one_active_session_per_user');
  assert.deepEqual(one.fields, { user: 1 });
  assert.equal(one.unique, true);
  assert.deepEqual(one.partialFilterExpression, { status: 'active' });
  const ttl = idx.find((i) => i.name === 'ttl_purgeAt');
  assert.deepEqual(ttl.fields, { purgeAt: 1 }); assert.equal(ttl.expireAfterSeconds, 0);
});

test('SessionTakeover: unique token hash and automatic cleanup', () => {
  const idx = indexes(SessionTakeover);
  assert.equal(idx.find((i) => i.name === 'uniq_takeover_token').unique, true);
  assert.ok(idx.find((i) => i.name === 'ttl_takeover').expireAfterSeconds > 0);
  assert.equal(SessionTakeover.schema.path('token'), undefined, 'the raw takeover token is never stored');
});

test('AuthSession validation: status values and required fields', () => {
  const ok = new AuthSession({ user: new mongoose.Types.ObjectId(), sid: 'abc', lastActiveAt: new Date(), expiresAt: new Date(), purgeAt: new Date() });
  assert.equal(ok.validateSync(), undefined);
  assert.equal(ok.status, 'active');
  const bad = new AuthSession({ user: new mongoose.Types.ObjectId(), sid: 'abc', status: 'superuser', lastActiveAt: new Date(), expiresAt: new Date(), purgeAt: new Date() });
  assert.ok(bad.validateSync().errors.status);
  assert.ok(new AuthSession({}).validateSync().errors.sid);
});

/** Real Mongoose User model (no database needed): index definitions, normalisation hook, and the data-audit logic. */
const test = require('node:test');
const assert = require('node:assert/strict');
const User = require('../models/User');
const { normalizeEmail, normalizePhone, conflictsFromDuplicateKeyError, conflictBody } = require('../services/identity');
const { analyzeUsers } = require('../scripts/auditUserIdentities');

const find = (key) => User.schema.indexes().find(([fields]) => Object.keys(fields).join() === key);
const mk = (over) => new User({ name: 'A', email: 'a@example.com', password: 'Str0ngPass1', ...over });

test('schema declares the global unique indexes', () => {
  const [, emailOpts] = find('email');
  assert.equal(emailOpts?.unique ?? User.schema.path('email').options.unique, true);
  const [fields, opts] = find('phoneNormalized');
  assert.deepEqual(fields, { phoneNormalized: 1 });
  assert.equal(opts.unique, true);
  assert.deepEqual(opts.partialFilterExpression, { phoneNormalized: { $type: 'string' } }, 'partial: accounts without a phone never collide');
  assert.equal(opts.name, 'uniq_phoneNormalized');
});

test('email is stored trimmed + lower-cased by the schema', () => {
  assert.equal(mk({ email: '  Student@Example.COM ' }).email, 'student@example.com');
});

test('pre-validate hook fills phoneNormalized for every save path', async () => {
  const u = mk({ phone: '+91 98765 43210' }); await u.validate();
  assert.equal(u.phoneNormalized, '+919876543210');
  const none = mk({ phone: '' }); await none.validate();
  assert.equal(none.phoneNormalized, undefined);
  const bad = mk({ phone: '123' }); await bad.validate();
  assert.equal(bad.phoneNormalized, undefined, 'never stores a junk value in the unique field');
  const other = mk({ phone: '9876543210' }); await other.validate();
  assert.equal(other.phoneNormalized, u.phoneNormalized, 'equivalent formats -> identical canonical value');
});

test('an unrelated save of a legacy account (no phoneNormalized yet) does not touch it', async () => {
  const legacy = User.hydrate({ _id: new User()._id, name: 'Old', email: 'old@example.com', password: 'hashed-password', phone: '9876543210' });
  legacy.name = 'Renamed';
  await legacy.validate();
  assert.equal(legacy.phoneNormalized, undefined);
});

test('normalisers', () => {
  assert.equal(normalizeEmail('  A@B.co '), 'a@b.co');
  assert.equal(normalizeEmail('first.last+tag@gmail.com'), 'first.last+tag@gmail.com', 'no provider-specific rewriting');
  for (const bad of [null, undefined, '', 'a', 'a@b', {}, 'x y@z.com']) assert.equal(normalizeEmail(bad), null);
  assert.equal(normalizePhone(undefined).empty, true);
  assert.equal(normalizePhone('   ').empty, true);
  assert.equal(normalizePhone('abc').valid, false);
  assert.equal(normalizePhone('+44 7911 123456').e164, '+447911123456');
  assert.equal(normalizePhone('9876543210').e164, '+919876543210');
});

test('duplicate-key errors map to the right field and never expose index names', () => {
  assert.deepEqual(conflictsFromDuplicateKeyError({ code: 11000, keyPattern: { email: 1 } }), { email: true, phone: false });
  assert.deepEqual(conflictsFromDuplicateKeyError({ code: 11000, keyPattern: { phoneNormalized: 1 } }), { email: false, phone: true });
  assert.deepEqual(conflictsFromDuplicateKeyError({ code: 11000, message: 'E11000 duplicate key error collection: db.users index: uniq_phoneNormalized dup key' }), { email: false, phone: true });
  assert.deepEqual(conflictsFromDuplicateKeyError({ code: 11000, message: 'E11000 ... index: email_1 dup key' }), { email: true, phone: false });
  assert.equal(conflictsFromDuplicateKeyError({ code: 11000, keyPattern: { somethingElse: 1 } }), null);
  assert.equal(conflictsFromDuplicateKeyError(new Error('boom')), null);
  assert.equal(conflictBody({ email: false, phone: false }), null);
});

test('data audit: finds cross-role duplicates and case-variant emails, and only proposes SAFE fixes', () => {
  const r = analyzeUsers([
    { _id: 1, role: 'student', email: 'one@example.com', phone: '9876543210' },
    { _id: 2, role: 'teacher', email: 'two@example.com', phone: '+91 98765 43210' },   // same phone as 1, other role
    { _id: 3, role: 'student', email: 'Dup@Example.com', phone: '9000000003' },
    { _id: 4, role: 'teacher', email: 'dup@example.com', phone: '' },                   // same email as 3 after lower-casing
    { _id: 5, role: 'student', email: 'Mixed@Example.com', phone: '9000000005' },       // fixable: no clash
    { _id: 6, role: 'student', email: 'six@example.com', phone: '12' },                 // invalid phone
    { _id: 7, role: 'student', email: 'seven@example.com', phone: '9000000007', phoneNormalized: '+919000000007' }, // already done
  ]);
  assert.equal(r.phoneConflicts.length, 1);
  assert.deepEqual(r.phoneConflicts[0].accounts.map((a) => a.role).sort(), ['student', 'teacher']);
  assert.equal(r.emailConflicts.length, 1);
  assert.deepEqual(r.safeEmailFixes.map((f) => f.id), ['5'], 'conflicting emails are never auto-changed');
  assert.deepEqual(r.safePhoneFixes.map((f) => f.id).sort(), ['3', '5']);
  assert.equal(r.invalidPhone.length, 1);
  assert.ok(!r.safePhoneFixes.some((f) => ['1', '2'].includes(f.id)), 'conflicting phones are never auto-assigned');
  assert.doesNotMatch(JSON.stringify(r), /one@example|9876543210/, 'report never prints full emails or phone numbers');
});

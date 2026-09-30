/**
 * Frontend wiring checks for the admin Student / Teacher profile pages (source-level — no browser needed).
 *
 *   npm run test:adminprofiles
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const FE = path.join(__dirname, '..', '..', '..', 'frontend', 'src');
const read = (p) => fs.readFileSync(path.join(FE, p), 'utf8');
const exists = fs.existsSync(path.join(FE, 'App.tsx'));
const opts = { skip: exists ? false : 'frontend sources are not next to the backend in this checkout' };

const PROFILE_FILES = [
  'pages/admin/AdminStudentProfile.tsx', 'pages/admin/AdminTeacherProfile.tsx', 'components/admin/ProfileParts.tsx',
  'services/adminProfiles.ts', 'types/adminProfile.ts',
];

test('profile routes exist and are admin-only', opts, () => {
  const app = read('App.tsx');
  for (const [route, page] of [['/admin/students/:id', 'AdminStudentProfile'], ['/admin/teachers/:id', 'AdminTeacherProfile']]) {
    const m = app.match(new RegExp(`<Route path="${route.replace(/[/:]/g, (c) => `\\${c}`)}" element=\\{[\\s\\S]*?\\} />`));
    assert.ok(m, `route ${route}`);
    assert.match(m[0], /ProtectedRoute roles=\{\['admin'\]\}/, `${route} is admin-only`);
    assert.match(m[0], new RegExp(`<${page} />`));
  }
});

test('clicking a student / teacher row opens the profile; the row buttons do not also navigate', opts, () => {
  const s = read('pages/admin/AdminStudents.tsx');
  assert.match(s, /navigate\(`\/admin\/students\/\$\{student\._id\}`\)/);
  assert.match(s, /e\.stopPropagation\(\)/, 'the Deactivate/Activate button stops the row click');
  const t = read('pages/admin/AdminTeachers.tsx');
  assert.match(t, /navigate\(`\/admin\/teachers\/\$\{teacher\._id\}`\)/);
  assert.match(t, /onClick=\{e => e\.stopPropagation\(\)\}/, 'the Approve/Reject/Deactivate buttons stop the row click');
  for (const src of [s, t]) {
    assert.match(src, /role="link" tabIndex=\{0\}/, 'keyboard accessible');
    assert.match(src, /<ConfirmDialog/, 'deactivation asks for confirmation');
  }
});

test('no profile file can display or request a password: no password field, no password value, only the reset-email endpoint', opts, () => {
  for (const f of PROFILE_FILES) {
    const src = read(f);
    assert.ok(!/\.password\b|password:|passwordHash|resetPasswordToken|\btoken\b/i.test(src.replace(/Send password reset|send-password-reset|sendPasswordReset|password reset|choose a new password|Passwords are stored securely[^"<]*/gi, '')),
      `${f} must not touch a password/token field`);
  }
  const svc = read('services/adminProfiles.ts');
  const endpoints = [...svc.matchAll(/api\.(get|post|put)\(`([^`]+)`/g)].map((m) => `${m[1].toUpperCase()} ${m[2].replace(/\$\{[^}]+\}/g, ':id')}`).sort();
  assert.deepEqual(endpoints, ['GET /admin/students/:id', 'GET /admin/teachers/:id', 'POST /admin/users/:id/send-password-reset', 'PUT /admin/users/:id']);
});

test('destructive profile actions require confirmation; activation and approval do not', opts, () => {
  const s = read('pages/admin/AdminStudentProfile.tsx');
  assert.match(s, /setPending\('deactivate'\)/); assert.match(s, /setPending\('reset'\)/);
  assert.match(s, /open=\{pending === 'deactivate'\}/); assert.match(s, /open=\{pending === 'reset'\}/);
  const t = read('pages/admin/AdminTeacherProfile.tsx');
  for (const k of ['deactivate', 'unapprove', 'reset']) assert.match(t, new RegExp(`open=\\{pending === '${k}'\\}`), `teacher ${k} confirmation`);
  assert.match(t, /Approve teacher/); assert.match(t, /Revoke approval/);
});

test('profile pages have loading, error (with retry), empty states, back navigation and tabs', opts, () => {
  const parts = read('components/admin/ProfileParts.tsx');
  assert.match(parts, /ProfileSkeleton/); assert.match(parts, /role="alert"/); assert.match(parts, /EmptyState/);
  for (const f of ['pages/admin/AdminStudentProfile.tsx', 'pages/admin/AdminTeacherProfile.tsx']) {
    const src = read(f);
    assert.match(src, /<ProfileSkeleton/); assert.match(src, /<ProfileError/); assert.match(src, /<BackButton/); assert.match(src, /<Tabs</);
    assert.match(src, /<EmptyState/);
  }
  const s = read('pages/admin/AdminStudentProfile.tsx');
  for (const label of ['Overview', 'Courses', 'Olympiad', 'Payments']) assert.match(s, new RegExp(`label: '${label}'`));
  assert.match(s, /Razorpay references are masked/);
});

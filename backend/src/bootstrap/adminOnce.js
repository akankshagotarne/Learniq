/**
 * TEMPORARY one-time bootstrap hook (to be removed again right after use).
 *
 * It does NOTHING unless BOOTSTRAP_ADMIN_ONCE=1 is set in the environment together with NEW_ADMIN_EMAIL / NEW_ADMIN_PHONE /
 * NEW_ADMIN_PASSWORD. It reuses scripts/createAdmin.js (idempotent; never modifies an existing account; reports conflicts;
 * never prints the password or a hash). Only a status line is logged. The operator removes the variables right afterwards.
 */
const runBootstrapAdminOnce = async ({ User, identity, env = process.env, log = console.log } = {}) => {
  if (env.BOOTSTRAP_ADMIN_ONCE !== '1') return null;
  const { run } = require('../scripts/createAdmin');
  const input = { email: env.NEW_ADMIN_EMAIL, phone: env.NEW_ADMIN_PHONE, password: env.NEW_ADMIN_PASSWORD, name: env.NEW_ADMIN_NAME };
  const say = (m) => log(`🛂 admin bootstrap: ${m}`);
  try {
    await run({ User, identity, input, check: true, log: say });
    const r = await run({ User, identity, input, apply: true, log: say });
    say(`result ${r.status}${r.reason ? ` (${r.reason})` : ''}`);
    return r;
  } catch (e) {
    say(`failed: ${String(e && e.message).replace(/\s+/g, ' ').slice(0, 200)}`);
    return { status: 'ERROR' };
  }
};

module.exports = { runBootstrapAdminOnce };

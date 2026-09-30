/**
 * One-off script: update the admin account's email + password in the live DB.
 * Usage: node src/scripts/updateAdminPassword.js
 * Reads ADMIN_EMAIL and ADMIN_PASSWORD from backend/.env
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

async function main () {
  const email    = (process.env.ADMIN_EMAIL    || '').trim().toLowerCase();
  const password =  process.env.ADMIN_PASSWORD || '';

  if (!email || password.length < 8) {
    console.error('❌  Set ADMIN_EMAIL and ADMIN_PASSWORD (≥8 chars) in backend/.env first.');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI);
  console.log('✅  Connected to MongoDB');

  const db   = mongoose.connection.db;
  const hash = await bcrypt.hash(password, 12);

  // Update by role=admin (handles the case where the email was different before)
  const result = await db.collection('users').findOneAndUpdate(
    { role: 'admin' },
    { $set: { email, password: hash } },
    { returnDocument: 'after' }
  );

  if (!result || !result._id) {
    console.error('❌  No admin user found in the database. Run the seed script first.');
  } else {
    console.log(`✅  Admin updated → email: ${result.email}`);
  }

  await mongoose.disconnect();
}

main().catch(err => { console.error(err); process.exit(1); });

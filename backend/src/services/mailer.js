const nodemailer = require('nodemailer');
const { Resend } = require('resend');

/**
 * Minimal transactional mailer for the account e-mails sent by the profile features (e-mail change confirmation).
 * Uses the SAME environment configuration as the password-reset e-mail: SMTP (EMAIL_USER / EMAIL_PASS) first, otherwise Resend.
 * @returns {Promise<boolean>} true when an e-mail was handed to a provider, false when none is configured.
 */
let smtp = null;
const smtpTransporter = () => {
  if (!(process.env.EMAIL_USER && process.env.EMAIL_PASS)) return null;
  if (!smtp) {
    smtp = nodemailer.createTransport({
      host: process.env.EMAIL_HOST || 'smtp.gmail.com', port: Number(process.env.EMAIL_PORT) || 587, secure: false,
      auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASS },
    });
  }
  return smtp;
};

const sendMail = async ({ to, subject, html }) => {
  const t = smtpTransporter();
  if (t) {
    await t.sendMail({ from: process.env.EMAIL_FROM || `LearnIQ <${process.env.EMAIL_USER}>`, to, subject, html });
    return true;
  }
  if (process.env.RESEND_API_KEY) {
    await new Resend(process.env.RESEND_API_KEY).emails.send({ from: process.env.RESEND_FROM_EMAIL || 'LearnIQ <onboarding@resend.dev>', to, subject, html });
    return true;
  }
  return false;
};

module.exports = { sendMail };

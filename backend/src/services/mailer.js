const nodemailer = require('nodemailer');
const { Resend } = require('resend');

/**
 * The ONE place that sends application e-mails (password reset, e-mail change confirmation ...).
 *
 * Provider choice (explicit, never silently overridden):
 *   1. RESEND_API_KEY set            -> Resend (the SDK already in package.json)
 *   2. else EMAIL_USER + EMAIL_PASS  -> SMTP (nodemailer) - only for environments where Resend is NOT configured
 *   3. else                          -> nothing configured: sendMail resolves false
 *
 * Sender: EMAIL_FROM, e.g.  LearnIQ <no-reply@send.learniq.study>  (RESEND_FROM_EMAIL is still honoured as an older alias).
 * In production the Resend sandbox sender (onboarding@resend.dev) is NEVER used: without a real sender nothing is sent.
 *
 * Contract: resolves true = the provider ACCEPTED the message; resolves false = no usable provider/sender (nothing was sent);
 * throws MailDeliveryError = the provider refused it. API keys, tokens and links are never logged or placed in an error message.
 */
class MailDeliveryError extends Error {
  constructor(provider, detail) { super(`E-mail delivery failed (${provider}${detail ? `: ${detail}` : ''})`); this.name = 'MailDeliveryError'; this.provider = provider; }
}

const SANDBOX_SENDER = 'LearnIQ <onboarding@resend.dev>';

const providerFor = (env = process.env) => {
  if (env.RESEND_API_KEY) return 'resend';
  if (env.EMAIL_USER && env.EMAIL_PASS) return 'smtp';
  return null;
};

/** The address part of "Name <a@b.c>" (or a bare address), lower-cased; '' when none. */
const addressOf = (from) => { const m = /<([^<>]+)>/.exec(String(from || '')); return (m ? m[1] : String(from || '')).trim().toLowerCase(); };
const domainOf = (from) => { const a = addressOf(from); const i = a.lastIndexOf('@'); return i > 0 ? a.slice(i + 1) : ''; };

/** @returns {string|null} the From header to use, or null when none may be used (production without a real sender). */
const senderFor = (provider, env = process.env) => {
  const configured = String(env.EMAIL_FROM || '').trim() || (provider === 'resend' ? String(env.RESEND_FROM_EMAIL || '').trim() : '');
  if (provider === 'smtp') return configured || `LearnIQ <${env.EMAIL_USER}>`;
  if (configured) return domainOf(configured) === 'resend.dev' && env.NODE_ENV === 'production' ? null : configured;
  return env.NODE_ENV === 'production' ? null : SANDBOX_SENDER;
};

let smtp = null; let smtpKey = '';
const smtpTransporter = (env = process.env) => {
  const key = `${env.EMAIL_HOST}|${env.EMAIL_PORT}|${env.EMAIL_USER}`;
  if (!smtp || smtpKey !== key) {
    smtpKey = key;
    smtp = nodemailer.createTransport({
      host: env.EMAIL_HOST || 'smtp.gmail.com', port: Number(env.EMAIL_PORT) || 587, secure: false,
      auth: { user: env.EMAIL_USER, pass: env.EMAIL_PASS },
    });
  }
  return smtp;
};

let resendClient = null; let resendKey = '';
const resendFor = (env = process.env) => {
  if (!resendClient || resendKey !== env.RESEND_API_KEY) { resendKey = env.RESEND_API_KEY; resendClient = new Resend(env.RESEND_API_KEY); }
  return resendClient;
};

const sendMail = async ({ to, subject, html }) => {
  const env = process.env;
  const provider = providerFor(env);
  if (!provider) return false;
  const from = senderFor(provider, env);
  if (!from) {
    console.error('[mail] no usable sender: set EMAIL_FROM to an address on your verified sending domain (the Resend sandbox sender is not allowed in production). Nothing was sent.');
    return false;
  }
  if (provider === 'smtp') {
    try { await smtpTransporter(env).sendMail({ from, to, subject, html }); } catch (e) { throw new MailDeliveryError('smtp', e && e.code); }
    return true;
  }
  let result;
  try { result = await resendFor(env).emails.send({ from, to, subject, html }); } catch (e) { throw new MailDeliveryError('resend', e && (e.name || e.code)); }
  // the Resend SDK RESOLVES with { data, error } for API errors (bad sender, unverified domain, quota ...): that is a failure, not a success
  if (result && result.error) throw new MailDeliveryError('resend', `${result.error.name || 'error'}${result.error.statusCode ? ` ${result.error.statusCode}` : ''}`);
  return true;
};

module.exports = { sendMail, providerFor, senderFor, addressOf, domainOf, MailDeliveryError };

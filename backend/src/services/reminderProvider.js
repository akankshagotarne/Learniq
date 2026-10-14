/**
 * Message provider for interview reminders. Nothing is hard-coded: credentials come from the backend environment, and when none are
 * configured `getProvider()` returns null - the reminder worker then sends NOTHING and never marks a reminder as sent.
 *
 *   Twilio (WhatsApp and/or SMS)  - TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, plus
 *                                   TWILIO_WHATSAPP_FROM (e.g. "whatsapp:+14155238886" or "+14155238886")   for channel "whatsapp"
 *                                   TWILIO_SMS_FROM      (a Twilio number or messaging service sender)       for channel "sms"
 *
 * Plain fetch (no extra dependency). A WhatsApp message outside a 24-hour user session must use a WhatsApp-approved template; with a
 * free-text body Twilio rejects it and we record the reminder as FAILED - we never pretend it went out.
 */
const TIMEOUT_MS = 10000;

const clean = (s) => String(s || '').replace(/(AC[a-f0-9]{32})/gi, 'AC****').slice(0, 200);

const twilio = (channel, env) => {
  const sid = env.TWILIO_ACCOUNT_SID; const token = env.TWILIO_AUTH_TOKEN;
  const from = channel === 'whatsapp' ? env.TWILIO_WHATSAPP_FROM : env.TWILIO_SMS_FROM;
  if (!sid || !token || !from) return null;
  const sender = channel === 'whatsapp' ? (from.startsWith('whatsapp:') ? from : `whatsapp:${from}`) : from;
  return {
    name: `twilio-${channel}`,
    /** @returns {Promise<{ ref: string }>} rejects with an Error (message = short reason) when the provider did not accept the message */
    async send({ to, body }) {
      const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      try {
        const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
          method: 'POST',
          headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`, 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ To: channel === 'whatsapp' ? `whatsapp:${to}` : to, From: sender, Body: body }).toString(),
          signal: ctrl.signal,
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(`provider rejected the message (${res.status}${json && json.code ? `, code ${json.code}` : ''})`);
        return { ref: String(json.sid || '') };
      } catch (e) {
        throw new Error(e && e.name === 'AbortError' ? 'provider timed out' : clean(e && e.message));
      } finally { clearTimeout(t); }
    },
  };
};

let override; // tests inject a fake provider here
const setProviderForTests = (p) => { override = p; };

/** @returns {{ name: string, send: Function } | null} */
const getProvider = (channel, env = process.env) => {
  if (override !== undefined) return override;
  return twilio(channel, env);
};

const status = (env = process.env) => ({
  configured: { whatsapp: !!twilio('whatsapp', env), sms: !!twilio('sms', env) },
  channel: (env.INTERVIEW_REMINDER_CHANNEL || 'whatsapp').toLowerCase() === 'sms' ? 'sms' : 'whatsapp',
});

module.exports = { getProvider, setProviderForTests, status, clean };

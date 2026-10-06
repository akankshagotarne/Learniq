/**
 * HeyGen LiveAvatar provider (the successor of the retired Interactive/Streaming Avatar API).
 *
 * Server side it only mints a SESSION TOKEN (one request, our API key stays here). The browser then connects to the avatar
 * with `@heygen/liveavatar-web-sdk` using that token. We use FULL mode in PUSH_TO_TALK and the browser starts the SDK with its
 * voice chat MUTED (`voiceChat: { defaultMuted: true }`), so no microphone audio reaches LiveAvatar and its own LLM is never invoked:
 * the avatar is purely the face + voice for text that OUR AI decided to say (`repeat(text)` = `avatar.speak_text`, no LLM).
 */
const { ProviderError } = require('../aiInterview/errors');

const SANDBOX_AVATAR_ID = 'dd73ea75-1218-4ef3-92ce-606d5f7fbc0a'; // the only avatar LiveAvatar allows in sandbox mode
const SANDBOX_MAX_SESSION_SECONDS = 60; // LiveAvatar rejects a longer sandbox session (HTTP 400 "exceeds the maximum allowed (60s)")
const SESSION_GRACE_SECONDS = 90;       // provider-side cap sits this far above the interview's own (server-clock) limit

/**
 * Provider-side session cap: the interview's own limit + a grace period, reduced to the sandbox cap (60 s) in sandbox mode and to the
 * configured plan cap (LIVEAVATAR_MAX_SESSION_SECONDS, when set) so LiveAvatar never rejects it with "exceeds the maximum allowed".
 */
const sessionSeconds = (a, maxDurationSeconds) => {
  let seconds = Math.ceil(maxDurationSeconds) + SESSION_GRACE_SECONDS;
  if (a.sandbox) seconds = Math.min(seconds, SANDBOX_MAX_SESSION_SECONDS);
  if (a.maxSessionSeconds > 0) seconds = Math.min(seconds, a.maxSessionSeconds);
  return seconds;
};

/**
 * The FULL-mode token request body. LiveAvatar's API requires EXACTLY ONE of `avatar_persona` / `voice_agent`
 * (otherwise: 422 "Provide exactly one of avatar_persona or voice_agent"). For now we use the inline `avatar_persona`;
 * voice, context and language belong INSIDE it - they are not valid top-level fields.
 *
 * Architecture guard: OpenAI is the interviewer. LiveAvatar is only the face + voice for text WE send (`avatar.speak_text` via the
 * SDK's `repeat()`), so we deliberately send no `llm_settings`, `llm_configuration_id` or `dynamic_variables`, and use
 * PUSH_TO_TALK (the avatar never answers on its own).
 */
const buildSessionTokenBody = (cfg, { maxDurationSeconds }) => {
  const a = cfg.avatar;
  const avatarId = a.avatarId || (a.sandbox ? SANDBOX_AVATAR_ID : '');
  const persona = {};
  if (cfg.openai.transcribeLanguage) persona.language = cfg.openai.transcribeLanguage;
  if (a.voiceId) persona.voice_id = a.voiceId;       // only when configured (empty = the avatar's default voice)
  if (a.contextId) persona.context_id = a.contextId; // only when configured
  return {
    mode: 'FULL',
    avatar_id: avatarId,
    interactivity_type: 'PUSH_TO_TALK', // the avatar never answers on its own
    is_sandbox: a.sandbox,
    // provider-side hard cap = cost control even if the browser never disconnects. Sandbox sessions are limited by LiveAvatar to 60s:
    // only the AVATAR session is capped there; the interview itself (AI_INTERVIEW_MAX_DURATION_SECONDS, server clock) is unchanged.
    max_session_duration: sessionSeconds(a, maxDurationSeconds),
    video_settings: { quality: 'medium', encoding: 'H264' },
    avatar_persona: persona,
  };
};

const createSessionToken = async (cfg, { maxDurationSeconds }) => {
  const a = cfg.avatar;
  const avatarId = a.avatarId || (a.sandbox ? SANDBOX_AVATAR_ID : '');
  if (!a.apiKey || !avatarId) throw new ProviderError('avatar', 'The avatar service is not configured.', { code: 'NOT_CONFIGURED' });
  const body = buildSessionTokenBody(cfg, { maxDurationSeconds });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), a.requestTimeoutMs);
  let res;
  try {
    res = await fetch(`${a.baseUrl}/v1/sessions/token`, {
      method: 'POST',
      headers: { 'X-API-KEY': a.apiKey, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new ProviderError('avatar', 'The avatar service could not be reached.', { code: err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK' });
  } finally {
    clearTimeout(timer);
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON */ }
  if (!res.ok) {
    throw new ProviderError('avatar', 'The avatar service returned an error.', {
      status: res.status, code: 'HTTP_ERROR', detail: String((json && (json.message || json.detail)) || '').slice(0, 300),
    });
  }
  const data = (json && json.data) || json || {};
  if (!data.session_token) throw new ProviderError('avatar', 'The avatar service did not issue a session.', { code: 'NO_TOKEN' });
  return { sessionToken: data.session_token, sessionId: data.session_id || null };
};

module.exports = { createSessionToken, buildSessionTokenBody, SANDBOX_AVATAR_ID, SANDBOX_MAX_SESSION_SECONDS };

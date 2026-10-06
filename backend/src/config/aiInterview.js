/**
 * AI Interview configuration — the single place that reads the environment.
 *
 * AI_INTERVIEW_PROVIDER picks the interviewer brain: "openai" (default / production) or "ollama" (local development only).
 * AI_INTERVIEW_STT_PROVIDER picks speech-to-text: "openai" (Realtime, default / production) or "local" (faster-whisper, development only).
 * Secrets (OPENAI_API_KEY, LIVEAVATAR_API_KEY) are only ever read on the server and are never part of anything
 * returned to a browser. `problems()` lists MISSING SETTING NAMES only, never values.
 */
const truthy = (v) => ['1', 'true', 'yes', 'on'].includes(String(v).trim().toLowerCase());
const falsy = (v) => ['0', 'false', 'no', 'off'].includes(String(v).trim().toLowerCase());

const flag = (raw, fallback) => {
  if (raw === undefined || String(raw).trim() === '') return fallback;
  if (truthy(raw)) return true;
  if (falsy(raw)) return false;
  return fallback;
};

/** Whole number from the environment, clamped to a sane range (bad / missing values fall back to the default). */
const int = (raw, fallback, min, max) => {
  const n = Number(String(raw ?? '').trim());
  if (!Number.isFinite(n) || String(raw ?? '').trim() === '') return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
};

const str = (raw, fallback = '') => {
  const s = String(raw ?? '').trim();
  return s || fallback;
};

/** Only the exact value "ollama" selects the local model; anything else (including unset) is OpenAI, so production is unchanged. */
const providerFrom = (raw) => (str(raw).toLowerCase() === 'ollama' ? 'ollama' : 'openai');

/** Only the exact value "local" selects the local faster-whisper service; anything else (including unset) is OpenAI Realtime. */
const sttProviderFrom = (raw) => (str(raw).toLowerCase() === 'local' ? 'local' : 'openai');

const getConfig = (env = process.env) => {
  const maxQuestions = int(env.AI_INTERVIEW_MAX_QUESTIONS, 8, 3, 12);
  return {
    enabled: flag(env.AI_INTERVIEW_ENABLED, true),

    // ── which model is the interviewer's "brain" (question writing, answer evaluation, closing feedback) ──
    // "openai" (default, production) or "ollama" (local development only). This does NOT affect the avatar or speech-to-text.
    provider: providerFrom(env.AI_INTERVIEW_PROVIDER),
    production: str(env.NODE_ENV).toLowerCase() === 'production',

    // ── which service turns the student's speech into text ──
    // "openai" (default, production: OpenAI Realtime) or "local" (faster-whisper on THIS computer, development only, English only).
    sttProvider: sttProviderFrom(env.AI_INTERVIEW_STT_PROVIDER),

    // ── interview limits (cost control) ──
    maxQuestions,
    maxDurationSeconds: int(env.AI_INTERVIEW_MAX_DURATION_SECONDS, 420, 120, 1800),
    passPercentage: int(env.AI_INTERVIEW_PASS_PERCENTAGE, 60, 1, 100),
    maxAnswerChars: 600,
    maxSilencePrompts: 2,          // per question, then the interview moves on
    maxRepeatsPerQuestion: 2,
    maxRealtimeSessions: 4,        // token mints per interview (first connection + reconnects)
    // ONE interview per purchase. The ONLY re-start is after a purely TECHNICAL failure (provider / server / browser) before any
    // real answer; this cap just bounds provider cost if a technical fault keeps repeating (it is not an extra attempt).
    maxTechnicalRetries: int(env.AI_INTERVIEW_MAX_TECHNICAL_RETRIES, 5, 0, 10),
    maxAiCalls: maxQuestions + 6,  // hard ceiling of model calls per interview (1 per answered question + feedback + retries)
    silenceTimeoutMs: int(env.AI_INTERVIEW_SILENCE_TIMEOUT_MS, 15000, 5000, 60000),

    // ── OpenAI ──
    openai: {
      apiKey: str(env.OPENAI_API_KEY),
      baseUrl: str(env.OPENAI_BASE_URL, 'https://api.openai.com/v1').replace(/\/+$/, ''),
      model: str(env.AI_INTERVIEW_MODEL, 'gpt-4.1-mini'),
      requestTimeoutMs: int(env.AI_INTERVIEW_AI_TIMEOUT_MS, 20000, 3000, 60000),
      transcribeModel: str(env.AI_INTERVIEW_TRANSCRIBE_MODEL, 'gpt-4o-mini-transcribe'),
      transcribeLanguage: str(env.AI_INTERVIEW_LANGUAGE, 'en').toLowerCase().slice(0, 8),
      clientSecretTtlSeconds: int(env.AI_INTERVIEW_CLIENT_SECRET_TTL_SECONDS, 600, 60, 1800),
      // server-side end-of-answer detection: how long a pause (ms) ends the student's answer
      silenceDurationMs: int(env.AI_INTERVIEW_END_OF_ANSWER_SILENCE_MS, 1400, 500, 4000),
    },

    // ── Ollama (local development only; selected with AI_INTERVIEW_PROVIDER=ollama) ──
    ollama: {
      baseUrl: str(env.OLLAMA_BASE_URL, 'http://localhost:11434').replace(/\/+$/, ''),
      model: str(env.OLLAMA_MODEL, 'gemma3:4b'),
      // local models on a laptop CPU are slow: much more generous than the hosted-API timeout
      requestTimeoutMs: int(env.OLLAMA_REQUEST_TIMEOUT_MS, 60000, 3000, 300000),
    },

    // ── Local speech-to-text (development only; selected with AI_INTERVIEW_STT_PROVIDER=local, see local-stt/README.md) ──
    localStt: {
      url: str(env.LOCAL_STT_URL, 'ws://127.0.0.1:8765'),
      model: str(env.LOCAL_STT_MODEL, 'base.en'), // informational for the browser; the service itself loads the model it was started with
    },

    // ── Avatar provider (HeyGen LiveAvatar) ──
    avatar: {
      provider: 'heygen-liveavatar',
      apiKey: str(env.LIVEAVATAR_API_KEY, str(env.HEYGEN_API_KEY)),
      baseUrl: str(env.LIVEAVATAR_API_URL, 'https://api.liveavatar.com').replace(/\/+$/, ''),
      avatarId: str(env.HEYGEN_AVATAR_ID),
      voiceId: str(env.HEYGEN_VOICE_ID),
      contextId: str(env.HEYGEN_CONTEXT_ID),
      sandbox: flag(env.LIVEAVATAR_SANDBOX, false), // free test mode: one avatar, ~1-minute sessions
      // Optional cap (seconds) on ONE avatar session, to match the LiveAvatar plan (Free = 120, Starter = 300, Essential = 1200).
      // 0 / unset = no cap (the session is the interview limit + a grace period). When set, the avatar session never asks for more.
      maxSessionSeconds: int(env.LIVEAVATAR_MAX_SESSION_SECONDS, 0, 0, 7200),
      requestTimeoutMs: int(env.AI_INTERVIEW_AVATAR_TIMEOUT_MS, 15000, 3000, 60000),
    },
  };
};

const validHttpUrl = (value) => {
  try { const u = new URL(value); return u.protocol === 'http:' || u.protocol === 'https:'; } catch { return false; }
};

/** Why Ollama may not be used right now (empty = fine). Ollama is a local-development tool and is refused in production. */
const ollamaBlockedReason = (cfg) => (
  cfg.provider === 'ollama' && cfg.production
    ? 'AI_INTERVIEW_PROVIDER=ollama is local-development only and is not allowed when NODE_ENV=production'
    : ''
);

/**
 * The student's microphone audio is streamed to this URL, so it must be a WebSocket address on THIS computer
 * (127.0.0.1 / localhost / [::1]): never a remote host, never one with embedded credentials.
 */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const validLocalSttUrl = (value) => {
  try {
    const u = new URL(String(value));
    return (u.protocol === 'ws:' || u.protocol === 'wss:') && LOOPBACK_HOSTS.has(u.hostname) && !u.username && !u.password;
  } catch { return false; }
};

/** Why local speech-to-text may not be used right now (empty = fine). It is a local-development tool and is refused in production. */
const localSttBlockedReason = (cfg) => (
  cfg.sttProvider === 'local' && cfg.production
    ? 'AI_INTERVIEW_STT_PROVIDER=local is local-development only and is not allowed when NODE_ENV=production'
    : ''
);

/**
 * Names of missing / invalid required settings (never values). Empty array = the feature is fully configured.
 * The AI-brain requirements follow the selected provider; the avatar requirements never change.
 */
const problems = (cfg = getConfig()) => {
  const out = [];
  if (cfg.provider === 'ollama') {
    const blocked = ollamaBlockedReason(cfg);
    if (blocked) out.push(blocked);
    if (!validHttpUrl(cfg.ollama.baseUrl)) out.push('OLLAMA_BASE_URL');
    if (!cfg.ollama.model) out.push('OLLAMA_MODEL');
  }
  // OpenAI is used for the brain (default) AND for speech-to-text (default): only "Ollama brain + local STT" runs without a key.
  // (Ollama brain + OpenAI Realtime STT - the usual local-development mix - still needs OPENAI_API_KEY, with credit, for the microphone.)
  if ((cfg.provider !== 'ollama' || cfg.sttProvider !== 'local') && !cfg.openai.apiKey) out.push('OPENAI_API_KEY');
  if (cfg.sttProvider === 'local') {
    const blocked = localSttBlockedReason(cfg);
    if (blocked) out.push(blocked);
    if (!validLocalSttUrl(cfg.localStt.url)) out.push('LOCAL_STT_URL (must be a ws:// address on this computer, e.g. ws://127.0.0.1:8765)');
    // the first implementation only understands English (the language also drives the interview prompts and the avatar)
    if (cfg.openai.transcribeLanguage !== 'en') out.push('AI_INTERVIEW_LANGUAGE (local speech-to-text is English-only: set it to en)');
  }
  if (!cfg.avatar.apiKey) out.push('LIVEAVATAR_API_KEY');
  if (!cfg.avatar.avatarId) out.push('HEYGEN_AVATAR_ID');
  return out;
};

/** The only configuration a browser may see: limits and labels, never a key, id or secret. */
const publicView = (cfg = getConfig()) => ({
  maxQuestions: cfg.maxQuestions,
  maxDurationSeconds: cfg.maxDurationSeconds,
  silenceTimeoutMs: cfg.silenceTimeoutMs,
  language: cfg.openai.transcribeLanguage,
});

module.exports = { getConfig, problems, publicView, ollamaBlockedReason, localSttBlockedReason, validLocalSttUrl };

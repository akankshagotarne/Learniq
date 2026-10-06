/**
 * Local speech-to-text (faster-whisper) — LOCAL DEVELOPMENT ONLY (AI_INTERVIEW_STT_PROVIDER=local).
 *
 * Unlike OpenAI Realtime there is nothing to mint: the browser opens a WebSocket straight to the service in /local-stt that runs on
 * the same computer and streams the microphone to it. This file only describes where that service is. No audio ever reaches this
 * backend, and it is never stored. Refused in production (see config/aiInterview.js -> localSttBlockedReason).
 */
const { ProviderError } = require('./errors');
const { localSttBlockedReason, validLocalSttUrl } = require('../../config/aiInterview');

/** What the browser needs to connect (never a secret: the service listens on 127.0.0.1 only). */
const describeLocalStt = (cfg) => {
  const blocked = localSttBlockedReason(cfg);
  if (blocked) throw new ProviderError('stt', 'Local speech-to-text is for local development only.', { code: 'NOT_CONFIGURED', detail: blocked });
  if (!validLocalSttUrl(cfg.localStt.url)) throw new ProviderError('stt', 'Local speech-to-text is not configured.', { code: 'NOT_CONFIGURED', detail: 'LOCAL_STT_URL' });
  return {
    provider: 'local',
    url: cfg.localStt.url,
    model: cfg.localStt.model,
    language: 'en', // English only for now
    silenceDurationMs: cfg.openai.silenceDurationMs, // the same "how long a pause ends an answer" setting the OpenAI path uses
  };
};

module.exports = { describeLocalStt };

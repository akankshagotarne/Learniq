/**
 * Chooses the interviewer-brain client from configuration (cfg.provider, set by AI_INTERVIEW_PROVIDER).
 *   - "ollama" (explicit opt-in, local development only; refused in production) -> ollamaClient
 *   - anything else / unset                                                     -> openaiClient (the default)
 * Both expose the same `structuredCompletion(cfg, args)` contract. Avatar (LiveAvatar) and speech-to-text are NOT chosen here.
 */
const openaiClient = require('./openaiClient');
const ollamaClient = require('./ollamaClient');
const { ProviderError } = require('./errors');
const { ollamaBlockedReason } = require('../../config/aiInterview');

const selectLlm = (cfg) => {
  if (cfg && cfg.provider === 'ollama') {
    const blocked = ollamaBlockedReason(cfg);
    if (blocked) throw new ProviderError('ollama', 'Ollama is for local development only.', { code: 'NOT_CONFIGURED', detail: blocked });
    return ollamaClient;
  }
  return openaiClient;
};

module.exports = { selectLlm };

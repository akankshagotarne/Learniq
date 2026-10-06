/**
 * Ollama access — the interviewer "brain" for LOCAL DEVELOPMENT ONLY (AI_INTERVIEW_PROVIDER=ollama). It implements the same
 * `structuredCompletion(cfg, args)` contract as openaiClient.js, so AIInterviewService (prompts, schemas, validators, scoring)
 * is identical for both providers. Plain `fetch` (Node 20+), explicit timeout, no SDK dependency.
 *
 * Ollama runs on this computer (default http://localhost:11434): no API key, no cost. It is never used in production (see
 * config/aiInterview.js -> ollamaBlockedReason) and it only replaces the LLM; speech-to-text and the avatar are unrelated.
 * Error objects carry no student text; `detail` is for server logs only.
 */
const { ProviderError } = require('./errors');
const { ollamaBlockedReason } = require('../../config/aiInterview');

const PROVIDER = 'ollama';

/** A model's reply as a plain JSON object, or null. Tolerates ```json fences / stray words around ONE object; never an array or scalar. */
const parseJsonObject = (text) => {
  if (typeof text !== 'string') return null;
  const attempts = [text.trim()];
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) attempts.push(text.slice(first, last + 1));
  for (const candidate of attempts) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    } catch { /* try the next candidate */ }
  }
  return null;
};

const assertUsable = (cfg) => {
  const o = cfg && cfg.ollama;
  if (!o || !o.baseUrl || !o.model) throw new ProviderError(PROVIDER, 'Ollama is not configured.', { code: 'NOT_CONFIGURED' });
  const blocked = ollamaBlockedReason(cfg);
  if (blocked) throw new ProviderError(PROVIDER, 'Ollama is for local development only.', { code: 'NOT_CONFIGURED', detail: blocked });
  return o;
};

/**
 * @returns {{ data: object, usage: { promptTokens: number, completionTokens: number } }}
 * `data` is the parsed JSON object (the caller validates it — never trust it blindly).
 */
const structuredCompletion = async (cfg, { schema, system, user, maxTokens = 350, temperature = 0.4 }) => {
  const o = assertUsable(cfg);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), o.requestTimeoutMs);
  let res;
  let json = null;
  try {
    res = await fetch(`${o.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: o.model,
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        stream: false,
        format: schema, // structured output: the reply must match the same JSON schema OpenAI gets
        options: { temperature, num_predict: maxTokens },
      }),
      signal: controller.signal,
    });
    try { json = await res.json(); } catch (err) {
      if (err && err.name === 'AbortError') throw err;
      /* non-JSON body */
    }
  } catch (err) {
    if (err instanceof ProviderError) throw err;
    throw new ProviderError(PROVIDER, 'The local AI service could not be reached.', {
      code: err && err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK',
      detail: err && err.cause && err.cause.code ? String(err.cause.code) : null, // e.g. ECONNREFUSED = Ollama is not running
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const message = String((json && json.error) || '').slice(0, 300);
    throw new ProviderError(PROVIDER, 'The local AI service returned an error.', {
      status: res.status, code: res.status === 404 ? 'MODEL_NOT_FOUND' : 'HTTP_ERROR', detail: message,
    });
  }

  const content = json && json.message && json.message.content;
  if (typeof content !== 'string' || !content.trim()) throw new ProviderError(PROVIDER, 'The local AI service sent an empty reply.', { code: 'EMPTY' });
  const data = parseJsonObject(content);
  if (!data) throw new ProviderError(PROVIDER, 'The local AI service sent an unreadable reply.', { code: 'BAD_JSON', detail: json.done_reason || null });

  return { data, usage: { promptTokens: Number(json.prompt_eval_count) || 0, completionTokens: Number(json.eval_count) || 0 } };
};

module.exports = { structuredCompletion, parseJsonObject };

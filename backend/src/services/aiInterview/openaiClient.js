/**
 * OpenAI access — the ONLY file that talks to OpenAI. Plain `fetch` (Node 20+), explicit timeouts, no SDK dependency.
 *  - structuredCompletion(): model call whose output must match a JSON schema (Chat Completions, strict json_schema)
 *  - mintTranscriptionClientSecret(): short-lived Realtime client secret so the BROWSER can stream the microphone to
 *    OpenAI for live transcription without ever seeing our API key.
 * Error objects never contain the API key; `detail` holds the provider's own error type/code for server logs only.
 */
const { ProviderError } = require('./errors');

const isReasoningModel = (model) => /^(o\d|gpt-5)/i.test(model);

const request = async (cfg, method, path, body) => {
  if (!cfg.openai.apiKey) throw new ProviderError('openai', 'OpenAI is not configured.', { code: 'NOT_CONFIGURED' });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg.openai.requestTimeoutMs);
  let res;
  try {
    res = await fetch(`${cfg.openai.baseUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${cfg.openai.apiKey}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new ProviderError('openai', 'The AI service could not be reached.', { code: err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK' });
  } finally {
    clearTimeout(timer);
  }
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON body */ }
  if (!res.ok) {
    const e = (json && json.error) || {};
    throw new ProviderError('openai', 'The AI service returned an error.', {
      status: res.status, code: e.code || e.type || 'HTTP_ERROR', detail: String(e.message || '').slice(0, 300),
    });
  }
  return json;
};

/**
 * @returns {{ data: object, usage: { promptTokens: number, completionTokens: number } }}
 * `data` is the parsed JSON object (the caller validates it — never trust it blindly).
 */
const structuredCompletion = async (cfg, { schemaName, schema, system, user, maxTokens = 350, temperature = 0.4 }) => {
  const body = {
    model: cfg.openai.model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    response_format: { type: 'json_schema', json_schema: { name: schemaName, strict: true, schema } },
    max_completion_tokens: maxTokens,
  };
  if (!isReasoningModel(cfg.openai.model)) body.temperature = temperature;

  const json = await request(cfg, 'POST', '/chat/completions', body);
  const choice = json && json.choices && json.choices[0];
  if (!choice || !choice.message) throw new ProviderError('openai', 'The AI service sent an empty reply.', { code: 'EMPTY' });
  if (choice.message.refusal) throw new ProviderError('openai', 'The AI service declined the request.', { code: 'REFUSAL' });
  let data;
  try { data = JSON.parse(choice.message.content); } catch {
    throw new ProviderError('openai', 'The AI service sent an unreadable reply.', { code: 'BAD_JSON' });
  }
  const u = json.usage || {};
  return { data, usage: { promptTokens: u.prompt_tokens || 0, completionTokens: u.completion_tokens || 0 } };
};

/** @returns {{ value: string, expiresAt: number, model: string }} — `value` is a short-lived, browser-safe secret. */
const mintTranscriptionClientSecret = async (cfg) => {
  const o = cfg.openai;
  const json = await request(cfg, 'POST', '/realtime/client_secrets', {
    expires_after: { anchor: 'created_at', seconds: o.clientSecretTtlSeconds },
    session: {
      type: 'transcription',
      audio: {
        input: {
          noise_reduction: { type: 'near_field' },
          transcription: { model: o.transcribeModel, language: o.transcribeLanguage },
          turn_detection: { type: 'server_vad', threshold: 0.5, prefix_padding_ms: 300, silence_duration_ms: o.silenceDurationMs },
        },
      },
    },
  });
  if (!json || typeof json.value !== 'string' || !json.value) {
    throw new ProviderError('openai', 'The AI service did not issue a voice session.', { code: 'NO_SECRET' });
  }
  return { value: json.value, expiresAt: Number(json.expires_at) || null, model: o.transcribeModel };
};

module.exports = { structuredCompletion, mintTranscriptionClientSecret, isReasoningModel };

/** Error that carries an HTTP status + a stable machine code. Only `message` is ever shown to a student. */
class ApiError extends Error {
  constructor(status, message, code, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** A failure talking to OpenAI / the avatar provider. `detail` is for server logs only (never includes a key). */
class ProviderError extends Error {
  constructor(provider, message, { status = null, code = null, detail = null } = {}) {
    super(message);
    this.provider = provider;
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

module.exports = { ApiError, ProviderError };

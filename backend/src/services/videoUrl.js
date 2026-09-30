// Lecture videos come from exactly two places:
//   1. the controlled upload endpoint (multer stores the file; the SERVER builds /uploads/videos/<generated-name>), or
//   2. an external http(s) video link (the demo/seed lectures use these).
// A teacher can never type a local path: this validator only accepts absolute external URLs.
const MAX_LENGTH = 2048;

const safeDecode = (s) => { try { return decodeURIComponent(s); } catch { return null; } };

/** Returns the normalised external URL, or null when the value must be rejected. */
const parseExternalVideoUrl = (input) => {
  if (typeof input !== 'string') return null;
  const raw = input.trim();
  if (!raw || raw.length > MAX_LENGTH) return null;
  if (/[\u0000-\u001f\u007f\\]/.test(raw)) return null; // control chars and backslashes (Windows / UNC paths)

  // traversal, however it is written (plain, %2e%2e, double-encoded)
  let text = raw;
  for (let i = 0; i < 3; i += 1) {
    if (/(^|[/?#=;])\.\.([/?#;]|$)/.test(text)) return null;
    const next = safeDecode(text);
    if (next === null) return null;
    if (next === text) break;
    text = next;
  }

  let url;
  try { url = new URL(raw); } catch { return null; } // "/uploads/...", "../x", "C:\..." (no scheme/host) all fail here
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null; // file:, javascript:, data:, c: ...
  if (url.username || url.password || !url.hostname) return null;

  // never anything that looks like this platform's own upload folder (normalised, so /a/%2e%2e/uploads/.. is caught too)
  const pathname = safeDecode(url.pathname);
  if (pathname === null || /^\/+uploads(\/|$)/i.test(pathname)) return null;

  return url.href;
};

module.exports = { parseExternalVideoUrl, MAX_LENGTH };

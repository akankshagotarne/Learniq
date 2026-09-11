/**
 * Resolves a backend-relative path (e.g. "/uploads/support/abc.jpg", as
 * returned by any of our multer upload routes) into an absolute URL that
 * works regardless of where the frontend is hosted relative to the API.
 *
 * VITE_API_URL points at ".../api" while uploaded files are served from
 * the API server's root (see backend/src/server.js), so the "/api" suffix
 * is stripped before the relative path is appended.
 */
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const API_ORIGIN = API_BASE.replace(/\/api\/?$/, '');

export function resolveFileUrl(path?: string | null): string {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path; // already absolute
  return `${API_ORIGIN}${path.startsWith('/') ? '' : '/'}${path}`;
}

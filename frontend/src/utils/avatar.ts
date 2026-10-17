/**
 * Profile pictures.
 * A photo uploaded through LearnIQ is stored by the API and referenced as a RELATIVE url ("/api/profile-photos/<id>?v=…").
 * The browser must load it from the API origin (VITE_API_URL, e.g. https://…onrender.com/api), not from the web app's origin,
 * so the origin is added here. Any other value (an old absolute URL) is used as it is; no photo => a generated initials avatar.
 */
const API_BASE: string = (import.meta.env.VITE_API_URL as string | undefined) || 'http://localhost:5000/api';

export const apiOrigin = (): string => API_BASE.replace(/\/api\/?$/, '');

export const avatarSrc = (name: string | undefined | null, avatar?: string | null, size = 96): string => {
  if (avatar && avatar.startsWith('/api/profile-photos/')) return `${apiOrigin()}${avatar}`;
  if (avatar) return avatar;
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name || 'U')}&background=6C63F2&color=fff&size=${size}`;
};

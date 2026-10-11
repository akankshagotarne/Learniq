import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

const api = axios.create({
  baseURL: API_BASE,
  timeout: 30000,
  headers: { 'Content-Type': 'application/json' },
});

// Request interceptor - add auth token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('learniq_token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
    return config;
  },
  (error) => Promise.reject(error)
);

/** One-line reason shown on the login page after the server ended this session (e.g. signed in on another device). */
export const AUTH_NOTICE_KEY = 'learniq_auth_notice';
const SESSION_END_CODES = new Set(['SESSION_REVOKED', 'SESSION_PASSWORD_RESET', 'SESSION_EXPIRED', 'SESSION_ENDED', 'SESSION_REQUIRED']);
// a 401 from these is a normal answer (wrong password, expired takeover request) - not "your session ended"
const SIGN_IN_REQUEST = /\/auth\/(login|register|forgot-password|reset-password|session\/takeover)/;

// Response interceptor - handle auth errors
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !SIGN_IN_REQUEST.test(error.config?.url || '')) {
      const { code, message } = error.response.data || {};
      localStorage.removeItem('learniq_token');
      localStorage.removeItem('learniq_user');
      if (!window.location.pathname.includes('/login')) {
        // tell the login page WHY (shown once there)
        if (code && SESSION_END_CODES.has(code) && message) {
          try { sessionStorage.setItem(AUTH_NOTICE_KEY, String(message).slice(0, 200)); } catch { /* storage blocked */ }
        }
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  }
);

export default api;

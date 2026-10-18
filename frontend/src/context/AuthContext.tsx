import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import api from '../services/api';
import { User } from '../types';
import { disconnectSocket } from '../services/socket';

/** 409 SESSION_CONFLICT from POST /auth/login (password verified, another device has the active session). */
export interface SessionConflict {
  message: string;
  activeSession: { device: string; mobile: boolean; lastActiveAt: string; signedInAt: string };
  /** one-time, ~2-minute server token for "Log out other device & continue" - kept in memory only, never stored */
  takeoverToken: string;
  takeoverExpiresAt: string;
}
export type LoginResult = { status: 'ok'; user: User } | { status: 'conflict'; conflict: SessionConflict };

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  /** `identifier` = e-mail address OR phone number */
  login: (identifier: string, password: string) => Promise<LoginResult>;
  /** "Log out other device & continue" */
  takeoverSession: (takeoverToken: string) => Promise<User>;
  /** "Cancel": the other device stays signed in; the takeover token is voided on the server */
  cancelTakeover: (takeoverToken: string) => void;
  /** Students are signed in at once; a teacher is only a pending request (no session) until an administrator approves it. */
  register: (data: RegisterData) => Promise<RegisterResult>;
  logout: () => void;
  updateUser: (user: User) => void;
  updateStandard: (standard: number) => Promise<void>;
}

export type RegisterResult = { pendingApproval: false; user: User } | { pendingApproval: true; message: string };

interface RegisterData {
  name: string;
  email?: string;
  password: string;
  role: string;
  phone?: string;
}

const AuthContext = createContext<AuthContextType | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('learniq_token'));
  const [isLoading, setIsLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    try {
      const res = await api.get('/auth/me');
      setUser(res.data.user);
    } catch {
      localStorage.removeItem('learniq_token');
      localStorage.removeItem('learniq_user');
      setToken(null);
      setUser(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const onRequired = () => setUser((u) => (u && !u.mustChangePassword ? { ...u, mustChangePassword: true } : u));
    window.addEventListener('learniq:password-change-required', onRequired);
    return () => window.removeEventListener('learniq:password-change-required', onRequired);
  }, []);

  useEffect(() => {
    if (token) {
      fetchMe();
    } else {
      setIsLoading(false);
    }
  }, [token, fetchMe]);

  // the token lives where it always did (localStorage 'learniq_token'); it is tied to a server-side session
  const completeSignIn = (newToken: string, newUser: User) => {
    localStorage.setItem('learniq_token', newToken);
    setToken(newToken);
    setUser(newUser);
  };

  const login = async (identifier: string, password: string): Promise<LoginResult> => {
    try {
      const res = await api.post('/auth/login', { identifier, password });
      completeSignIn(res.data.token, res.data.user);
      return { status: 'ok', user: res.data.user };
    } catch (err: any) {
      const data = err?.response?.data;
      if (err?.response?.status === 409 && data?.code === 'SESSION_CONFLICT' && typeof data.takeoverToken === 'string') {
        return { status: 'conflict', conflict: { message: data.message, activeSession: data.activeSession, takeoverToken: data.takeoverToken, takeoverExpiresAt: data.takeoverExpiresAt } };
      }
      throw err;
    }
  };

  const takeoverSession = async (takeoverToken: string): Promise<User> => {
    const res = await api.post('/auth/session/takeover', { takeoverToken });
    completeSignIn(res.data.token, res.data.user);
    return res.data.user;
  };

  const cancelTakeover = (takeoverToken: string) => {
    void api.post('/auth/session/takeover/cancel', { takeoverToken }).catch(() => { /* it expires on its own in ~2 minutes */ });
  };

  const register = async (data: RegisterData): Promise<RegisterResult> => {
    // never leave a previous account's token / user behind
    localStorage.removeItem('learniq_token');
    const res = await api.post('/auth/register', data);
    if (res.data.pendingApproval || !res.data.token) return { pendingApproval: true, message: res.data.message };
    completeSignIn(res.data.token, res.data.user);
    return { pendingApproval: false, user: res.data.user };
  };

  const logout = async () => {
    // end THIS session on the server (other accounts / sessions are untouched); never blocks signing out locally
    if (localStorage.getItem('learniq_token')) {
      try { await api.post('/auth/logout', {}, { timeout: 4000 }); } catch { /* already ended or offline */ }
    }
    localStorage.removeItem('learniq_token');
    localStorage.removeItem('learniq_user');
    setToken(null);
    setUser(null);
    disconnectSocket();
    window.location.href = '/login';
  };

  // If this session is ended elsewhere ("Log out other device & continue" on another device), notice it soon even on an
  // idle page: a cheap check when the tab becomes visible / regains focus and every 2 minutes while visible.
  // A 401 is handled by the api interceptor (clears the token and returns to /login with the reason).
  useEffect(() => {
    if (!user) return;
    let last = 0;
    const check = () => {
      if (document.visibilityState !== 'visible' || Date.now() - last < 15_000) return;
      last = Date.now();
      api.get('/auth/session').catch(() => { /* 401 -> interceptor; network errors are ignored */ });
    };
    const id = window.setInterval(() => { last = 0; check(); }, 120_000);
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', check);
    return () => { window.clearInterval(id); window.removeEventListener('focus', check); document.removeEventListener('visibilitychange', check); };
  }, [user]);

  const updateUser = (updatedUser: User) => {
    setUser(updatedUser);
  };

  const updateStandard = async (standard: number) => {
    const res = await api.put('/auth/standard', { standard });
    setUser(res.data.user);
  };

  return (
    <AuthContext.Provider value={{ user, token, isLoading, login, takeoverSession, cancelTakeover, register, logout, updateUser, updateStandard }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};

export default AuthContext;

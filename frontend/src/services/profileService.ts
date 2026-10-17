import api from './api';
import { User } from '../types';

export interface ApiFail { message: string; field?: string; code?: string }
/** Turns an axios error into the server's message (never a raw stack or status text). */
export const apiError = (e: any, fallback = 'Something went wrong. Please try again.'): ApiFail => {
  const d = e?.response?.data;
  return { message: d?.message || fallback, field: d?.field, code: d?.code };
};

export type SelfProfileInput = { name?: string; phone?: string; bio?: string; experience?: string; qualification?: string; subjects?: string[]; standards?: number[]; currentPassword?: string };
export type AdminProfileInput = SelfProfileInput & { email?: string; currentStandard?: number | string };

export const updateOwnProfile = (body: SelfProfileInput) => api.patch<{ user: User; changed: string[]; message: string }>('/auth/profile', body).then((r) => r.data);
export const requestEmailChange = (body: { newEmail: string; currentPassword: string }) => api.post<{ message: string; pendingEmail: string }>('/auth/profile/email-change', body).then((r) => r.data);
export const verifyEmailChange = (token: string) => api.post<{ message: string }>('/auth/verify-email-change', { token }).then((r) => r.data);
export const changePassword = (body: { currentPassword: string; newPassword: string }) => api.post<{ message: string }>('/auth/change-password', body).then((r) => r.data);

const photoForm = (blob: Blob) => { const f = new FormData(); f.append('photo', blob, 'photo.jpg'); return f; };
export const uploadOwnPhoto = (blob: Blob, onProgress?: (pct: number) => void) =>
  api.post<{ user: User }>('/auth/profile/photo', photoForm(blob), { headers: { 'Content-Type': 'multipart/form-data' }, onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)) }).then((r) => r.data);
export const removeOwnPhoto = () => api.delete<{ user: User }>('/auth/profile/photo').then((r) => r.data);

export const adminEditUser = (role: 'student' | 'teacher', id: string, body: AdminProfileInput) =>
  api.patch<{ user: User; changed: string[]; message: string }>(`/admin/${role}s/${id}`, body).then((r) => r.data);
export const adminUploadPhoto = (id: string, blob: Blob, onProgress?: (pct: number) => void) =>
  api.post<{ user: User }>(`/admin/users/${id}/photo`, photoForm(blob), { headers: { 'Content-Type': 'multipart/form-data' }, onUploadProgress: (e) => e.total && onProgress?.(Math.round((e.loaded / e.total) * 100)) }).then((r) => r.data);
export const adminRemovePhoto = (id: string) => api.delete<{ user: User }>(`/admin/users/${id}/photo`).then((r) => r.data);

export const removePayment = (source: string, id: string, reason: string) => api.delete(`/admin/payments/${source}/${id}`, { data: { reason } }).then((r) => r.data);
export const restorePayment = (source: string, id: string) => api.post(`/admin/payments/${source}/${id}/restore`).then((r) => r.data);

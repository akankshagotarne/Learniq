import api from './api';
import { AdminStudentProfile, AdminTeacherProfile } from '../types/adminProfile';

/**
 * Admin profile API. The server has no endpoint that returns a stored credential, so nothing here can ask for one.
 * "Send password reset" only asks the server to email the user the normal reset link — the response never contains the link.
 */
export const adminProfilesApi = {
  student: async (id: string): Promise<AdminStudentProfile> => (await api.get(`/admin/students/${encodeURIComponent(id)}`)).data.profile,
  teacher: async (id: string): Promise<AdminTeacherProfile> => (await api.get(`/admin/teachers/${encodeURIComponent(id)}`)).data.profile,
  sendPasswordReset: async (id: string): Promise<{ message: string; sentTo: string }> =>
    (await api.post(`/admin/users/${encodeURIComponent(id)}/send-password-reset`)).data,
  // existing endpoint used by the list pages
  update: async (id: string, patch: { isActive?: boolean; isApproved?: boolean }): Promise<void> => {
    await api.put(`/admin/users/${encodeURIComponent(id)}`, patch);
  },
  /** Sets a TEMPORARY password for a STUDENT; the student must replace it at the next sign-in. The password is never returned. */
  setStudentPassword: async (id: string, password: string): Promise<{ message: string }> =>
    (await api.post(`/admin/students/${encodeURIComponent(id)}/set-password`, { password })).data,
  /** Permanently deletes a STUDENT account. Payment records are kept on the server for accounting. */
  deleteStudent: async (id: string): Promise<{ message: string; paymentsKept: number }> =>
    (await api.delete(`/admin/users/${encodeURIComponent(id)}`)).data,
  /** Permanently deletes a TEACHER account. The server refuses (409) while the teacher still owns courses, content or interview records. */
  deleteTeacher: async (id: string): Promise<{ message: string }> =>
    (await api.delete(`/admin/teachers/${encodeURIComponent(id)}`)).data,
};

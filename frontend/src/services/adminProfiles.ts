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
};

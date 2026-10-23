import api from './api';

/** Mentor referral TRACKING. Analytics only: nothing here describes, grants or displays a reward. */
export interface MentorStats { totalReferrals: number; successful: number; pending: number }
export interface MentorOverview { code: string; link: string; stats: MentorStats }
export interface MentorRow { no: number; name: string; userType: 'Student' | 'Teacher'; standard: number | null; registeredAt: string; status: 'Successful' | 'Pending' | 'Pending Approval'; statusCode: 'SUCCESSFUL' | 'PENDING'; successfulAt: string | null }
export interface PageOf<T> { page: number; limit: number; total: number; referrals: T[] }
export interface MentorQuery { page?: number; limit?: number; q?: string; status?: string; type?: string }

export interface AdminMentorRow {
  id: string; mentorId: string; mentorName: string; mentorCode: string; referredId: string; referredName: string; referredRole: 'student' | 'teacher';
  standard: number | null; registeredAt: string; status: 'PENDING' | 'SUCCESSFUL'; successfulAt: string | null; accountStatus: string; source: string;
}
export interface AdminMentorOverview {
  metrics: { totalReferrals: number; successful: number; pending: number; participatingMentors: number; referredStudents: number; referredTeachers: number; teachersAwaitingApproval: number };
  topMentors: { mentorId: string; name: string; referrals: number; successful: number }[];
}
export interface Person { id: string | null; name: string; email: string | null; phone: string | null; deleted: boolean }
export interface AdminMentorDetail extends AdminMentorRow {
  mentor: Person; referred: Person; approvalStatus: string | null; reward: string;
  timeline: { at: string; event: string; byName: string | null; reason: string | null }[];
}
export interface AdminMentorQuery extends MentorQuery { mentorId?: string; standard?: string; from?: string; to?: string; approval?: string }

const clean = (o: object) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== '' && v !== undefined && v !== null));

export const mentorReferralApi = {
  validate: async (code: string): Promise<boolean> => (await api.get('/mentor-referrals/validate', { params: { code } })).data.valid === true,
  me: async (): Promise<MentorOverview> => (await api.get('/mentor-referrals/me')).data,
  list: async (q: MentorQuery): Promise<PageOf<MentorRow>> => (await api.get('/mentor-referrals/me/referrals', { params: clean(q) })).data,
};
export const adminMentorApi = {
  overview: async (): Promise<AdminMentorOverview> => (await api.get('/mentor-referrals/admin/overview')).data,
  list: async (q: AdminMentorQuery): Promise<PageOf<AdminMentorRow>> => (await api.get('/mentor-referrals/admin/referrals', { params: clean(q) })).data,
  detail: async (id: string): Promise<AdminMentorDetail> => (await api.get(`/mentor-referrals/admin/referrals/${id}`)).data.referral,
};

import api from './api';

/** Refer & Earn + Exam Credits. The server owns every rule; this file only describes the shapes and calls the endpoints. */

export interface ReferralStats {
  totalReferrals: number; successful: number; pending: number; underReview: number; rejected: number;
  creditsEarned: number; creditsFromAdmin: number; creditsUsed: number; adjustments: number; available: number;
}
export interface MyReferralOverview { code: string; link: string; enabled: boolean; creditsPerReferral: number; stats: ReferralStats }
export interface MyReferralRow { no: number; name: string; registeredAt: string; status: 'Successful' | 'Pending' | 'Under review' | 'Rejected'; credits: number; rewardedAt: string | null }
export interface CreditTx { id: string; at: string; type: string; label: string; delta: number; description: string; examTitle: string | null; component?: 'EXAM' | 'INTERVIEW' | null }
export interface Page { page: number; limit: number; total: number }

export interface AdminOverview {
  days: number;
  metrics: {
    totalReferrals: number; successfulReferrals: number; pendingReferrals: number; underReview: number; rejected: number;
    referralCreditsAwarded: number; adminGrantedCredits: number; adjustmentsNet: number; creditsRedeemed: number; availableCredits: number; successRate: number;
  };
  referralsByDate: { date: string; count: number }[];
  creditsIssuedByDate: { date: string; count: number }[];
  creditsRedeemedByDate: { date: string; count: number }[];
  topReferrers: { studentId: string; name: string; referrals: number; credits: number }[];
}
export type ReferralStatus = 'SUCCESSFUL' | 'UNDER_REVIEW' | 'REJECTED';
export type RewardStatus = 'REWARDED' | 'PENDING' | 'WITHHELD' | 'REVERSED' | 'NOT_REWARDED';
export interface AdminReferralRow {
  id: string; referrerId: string; referrerName: string; referredId: string; referredName: string; code: string; standard: number | null;
  registeredAt: string; status: ReferralStatus; rewardStatus: RewardStatus; credits: number; rewardedAt: string | null; risk: string[];
}
export interface Person { id: string | null; name: string; email: string | null; phone: string | null; standard: number | null; deleted: boolean }
export interface AdminReferralDetail extends AdminReferralRow {
  referrer: Person; referred: Person; reviewReason: string | null; reviewedAt: string | null;
  timeline: { at: string; event: string; byName: string | null; reason: string | null }[];
  transactions: { id: string; type: string; delta: number; at: string; reason: string | null }[];
}
export interface AdminTx {
  id: string; at: string; studentId: string; studentName: string | null; type: string; delta: number; source: string; status: string;
  reason: string | null; examTitle: string | null; examId: string | null; referralId: string | null; batchId: string | null; performedBy: string;
}
export interface GrantStudent { id: string; name: string; email: string | null; phone: string | null; standard: number | null; credits: number; status: string }
export interface GrantOutcome { studentId: string | null; studentName: string | null; status: 'GRANTED' | 'ALREADY_GRANTED' | 'SKIPPED' | 'FAILED'; message: string | null }
export interface GrantBatch {
  id: string; batchId: string; kind: 'SINGLE' | 'BULK' | 'ADJUSTMENT'; admin: string | null; creditsPerStudent: number; reason: string; note: string | null;
  requested: number; granted: number; skipped: number; failed: number; totalCredits: number; status: 'PROCESSING' | 'COMPLETED' | 'PARTIAL' | 'FAILED';
  createdAt: string; completedAt: string | null; results: GrantOutcome[];
}
export interface ReferralSettings {
  enabled: boolean; creditsPerReferral: number; maxBulkSize: number; maxCreditsPerStudent: number; rewardUnderReview: boolean; flagAfterPerHour: number;
  expiration: 'NONE'; updatedAt: string | null; updatedByName: string | null;
}
export interface ComponentCreditInfo { canUse: boolean; blockedReason: string | null; message: string | null }
export interface ExamCreditInfo extends ComponentCreditInfo { balance: number; creditsPerExam: number; creditsPerComponent?: number; enabled: boolean; components?: { EXAM: ComponentCreditInfo; INTERVIEW: ComponentCreditInfo }; prices?: { EXAM: number; INTERVIEW: number; currency: string } }

export type Filters = Record<string, string | number | undefined>;
const clean = (f?: Filters) => Object.fromEntries(Object.entries(f || {}).filter(([, v]) => v !== undefined && v !== '' && v !== 'all'));

/** A client-generated id so a retried / double-clicked grant is applied once (the server treats the same id as the same operation). */
export const newRequestId = (): string => {
  const c = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && 'randomUUID' in c) return (c as Crypto).randomUUID();
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
};

const download = async (url: string, params: Filters | undefined, fallbackName: string) => {
  const res = await api.get(url, { params: clean(params), responseType: 'blob' });
  const cd = String(res.headers?.['content-disposition'] || '');
  const name = /filename="?([^";]+)"?/i.exec(cd)?.[1] || fallbackName;
  const href = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a'); a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
};

export const referralApi = {
  validate: async (code: string): Promise<{ valid: boolean; message?: string; reason?: string }> => (await api.get('/referrals/validate', { params: { code } })).data,
  me: async (): Promise<MyReferralOverview> => (await api.get('/referrals/me')).data,
  myReferrals: async (page = 1, limit = 10): Promise<Page & { referrals: MyReferralRow[] }> => (await api.get('/referrals/me/referrals', { params: { page, limit } })).data,
  myCredits: async (page = 1, limit = 10): Promise<Page & { balance: number; transactions: CreditTx[] }> => (await api.get('/referrals/me/credits', { params: { page, limit } })).data,
  balance: async (): Promise<number> => (await api.get('/referrals/me/balance')).data.balance,
  examCredit: async (examId: string): Promise<ExamCreditInfo> => (await api.get(`/olympiad/exams/${encodeURIComponent(examId)}/credit`)).data,
  /** Spend ONE credit on ONE component (exam or interview). Never both; the server refuses to charge an already-unlocked component. */
  redeem: async (examId: string, component: 'EXAM' | 'INTERVIEW' = 'EXAM'): Promise<{ message: string; balance: number; charged: boolean; alreadyUnlocked: boolean; component: 'EXAM' | 'INTERVIEW' }> =>
    (await api.post(`/olympiad/exams/${encodeURIComponent(examId)}/credit/redeem`, { component })).data,
};

export const adminReferralApi = {
  overview: async (days = 30): Promise<AdminOverview> => (await api.get('/referrals/admin/overview', { params: { days } })).data,
  referrals: async (f: Filters): Promise<Page & { referrals: AdminReferralRow[] }> => (await api.get('/referrals/admin/referrals', { params: clean(f) })).data,
  referral: async (id: string): Promise<AdminReferralDetail> => (await api.get(`/referrals/admin/referrals/${id}`)).data.referral,
  review: async (id: string, body: { action: 'under_review' | 'reject' | 'approve' | 'retry_reward'; reason?: string; reverseReward?: boolean }): Promise<AdminReferralDetail> =>
    (await api.post(`/referrals/admin/referrals/${id}/review`, body)).data.referral,
  transactions: async (f: Filters): Promise<Page & { transactions: AdminTx[] }> => (await api.get('/referrals/admin/transactions', { params: clean(f) })).data,
  students: async (f: Filters): Promise<Page & { maxBulkSize: number; students: GrantStudent[] }> => (await api.get('/referrals/admin/students', { params: clean(f) })).data,
  allStudentIds: async (f: Filters): Promise<{ ids: string[]; total: number; cap: number; truncated: boolean }> => (await api.get('/referrals/admin/students', { params: { ...clean(f), idsOnly: 1 } })).data,
  grant: async (body: { studentIds: string[]; credits: number; reason: string; note?: string; requestId: string }): Promise<{ batch: GrantBatch; alreadyProcessed: boolean }> =>
    (await api.post('/referrals/admin/grants', body)).data,
  batches: async (page = 1): Promise<Page & { batches: GrantBatch[] }> => (await api.get('/referrals/admin/grants', { params: { page, limit: 10 } })).data,
  batch: async (batchId: string): Promise<GrantBatch> => (await api.get(`/referrals/admin/grants/${encodeURIComponent(batchId)}`)).data.batch,
  settings: async (): Promise<ReferralSettings> => (await api.get('/referrals/admin/settings')).data.settings,
  saveSettings: async (patch: Partial<ReferralSettings>): Promise<ReferralSettings> => (await api.put('/referrals/admin/settings', patch)).data.settings,
  reconcile: async (repair: boolean): Promise<{ checked: number; drift: { studentId: string; balance: number; ledgerTotal: number }[]; repaired: number }> => (await api.post('/referrals/admin/reconcile', { repair })).data,
  exportReferrals: (f: Filters) => download('/referrals/admin/referrals/export', f, 'referrals.csv'),
  exportTransactions: (f: Filters) => download('/referrals/admin/transactions/export', f, 'credit-transactions.csv'),
  exportBatch: (batchId: string) => download(`/referrals/admin/grants/${encodeURIComponent(batchId)}/export`, undefined, 'credit-grant.csv'),
};

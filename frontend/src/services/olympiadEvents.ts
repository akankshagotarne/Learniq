import api from './api';

export type EventStatus = 'draft' | 'upcoming' | 'registration_open' | 'registration_closed' | 'live' | 'completed' | 'cancelled';
export interface OlympiadEventRow {
  _id: string; name: string; slug: string; reference: string; description: string;
  examDate: string; examDateIST: string; standards: number[]; state: 'draft' | 'published' | 'cancelled'; status: EventStatus;
  registration: 'not_open' | 'open' | 'closed'; startDate: string | null; endDate: string | null; startDateIST: string; endDateIST: string;
  registrationOpensAt: string | null; registrationClosesAt: string | null; registrationOpensAtIST: string; registrationClosesAtIST: string;
  examCount: number; isLegacy: boolean; cancelReason: string; updatedAt: string | null;
  students?: number; registrations?: number; submissions?: number; needsReview?: number; [k: string]: unknown;
}
export interface EventOption { _id: string; name: string; examDate: string; examDateIST: string; status: EventStatus; state: string; standards: number[]; isLegacy: boolean }
export interface CreateEventPayload {
  name: string; standards: number[]; description?: string;
  schedule: { startDate: string; endDate: string; durationMinutes: number; fee: number };
  registrationOpensAt?: string; registrationClosesAt?: string;
  copyFromEventId?: string; copyQuestions?: boolean; publish?: boolean;
}

export const STATUS_LABEL: Record<EventStatus, string> = {
  draft: 'Draft', upcoming: 'Upcoming', registration_open: 'Registration open', registration_closed: 'Registration closed',
  live: 'Live', completed: 'Completed', cancelled: 'Cancelled',
};
export const STATUS_CLS: Record<EventStatus, string> = {
  draft: 'bg-gray-100 text-gray-700', upcoming: 'bg-blue-50 text-blue-700', registration_open: 'bg-indigo-50 text-indigo-700',
  registration_closed: 'bg-amber-50 text-amber-800', live: 'bg-emerald-50 text-emerald-700', completed: 'bg-slate-100 text-slate-700', cancelled: 'bg-red-50 text-red-700',
};

export const eventsApi = {
  list: async (params: Record<string, string | undefined>, signal?: AbortSignal): Promise<{ events: OlympiadEventRow[]; serverNow: string }> => {
    const q = Object.fromEntries(Object.entries(params).filter(([, v]) => v && v !== 'all'));
    return (await api.get('/olympiad/admin/events', { params: q, signal })).data;
  },
  options: async (): Promise<{ options: EventOption[]; defaultEventId: string | null }> => (await api.get('/olympiad/admin/events/options')).data,
  detail: async (id: string): Promise<{ event: OlympiadEventRow; exams: unknown[] }> => (await api.get(`/olympiad/admin/events/${id}`)).data,
  create: async (body: CreateEventPayload): Promise<{ event: OlympiadEventRow }> => (await api.post('/olympiad/admin/events', body)).data,
  update: async (id: string, body: Record<string, unknown>): Promise<{ event: OlympiadEventRow; changed: string[] }> => (await api.patch(`/olympiad/admin/events/${id}`, body)).data,
  publish: async (id: string) => (await api.post(`/olympiad/admin/events/${id}/publish`)).data,
  unpublish: async (id: string) => (await api.post(`/olympiad/admin/events/${id}/unpublish`)).data,
  cancel: async (id: string, reason: string) => (await api.post(`/olympiad/admin/events/${id}/cancel`, { reason })).data,
  remove: async (id: string) => (await api.delete(`/olympiad/admin/events/${id}`)).data,
};

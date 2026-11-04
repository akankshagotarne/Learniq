import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { subscriptionsApi, SubscriptionSummary } from '../services/subscriptions';

/**
 * ONE shared, read-only copy of the student's subscription summary (GET /subscriptions/me). Everything shown (days left, dates, auto-renew)
 * comes from the server; the browser never calculates validity. The page, header chip, dashboard and exam cards read the same store.
 */
export type SubState = { data: SubscriptionSummary | null; status: 'idle' | 'loading' | 'ready' | 'error'; error: string | null };

let state: SubState = { data: null, status: 'idle', error: null };
let inflight: Promise<void> | null = null;
let lastFetchAt = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (next: SubState) => { state = next; emit(); };
const STALE_MS = 30_000;

export const refreshSubscriptions = (force = false): Promise<void> => {
  if (inflight) return inflight;
  if (!force && state.status === 'ready' && Date.now() - lastFetchAt < STALE_MS) return Promise.resolve();
  if (state.status !== 'ready') set({ data: state.data, status: 'loading', error: null });
  inflight = subscriptionsApi.me()
    .then((d) => { lastFetchAt = Date.now(); set({ data: d, status: 'ready', error: null }); })
    .catch((e: any) => { set({ data: state.data, status: state.data ? 'ready' : 'error', error: e?.message || 'Could not load your subscription.' }); })
    .finally(() => { inflight = null; });
  return inflight;
};
/** Use a summary the server has just returned (verify / auto-renew) so every screen updates at once. */
export const setSubscriptionsFromServer = (d: SubscriptionSummary | null | undefined) => {
  if (!d || !Array.isArray(d.subscriptions)) return;
  lastFetchAt = Date.now(); set({ data: d, status: 'ready', error: null });
};
export const resetSubscriptions = () => { lastFetchAt = 0; set({ data: null, status: 'idle', error: null }); };

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => state;

export const useSubscriptions = (active = true, routeKey?: string) => {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => { if (active) void refreshSubscriptions(); }, [active, routeKey]);
  const refresh = useCallback(() => refreshSubscriptions(true), []);
  return { ...snap, refresh };
};

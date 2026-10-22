import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { referralApi } from '../services/referrals';

/**
 * ONE shared, read-only copy of the student's available exam-credit balance. The number always comes from the server (GET /referrals/me/balance,
 * or the balance the server returns with a redemption / the Refer & Earn overview); it is never calculated, edited or stored in the browser.
 * The header button and the Refer & Earn page read the same store, so they cannot disagree. There is no real-time push channel for credits, so
 * the value is refreshed when the dashboard mounts, the route changes, the tab becomes visible again, and after a confirmed redemption.
 */
export type CreditBalanceState = { balance: number | null; status: 'idle' | 'loading' | 'ready' | 'error' };

let state: CreditBalanceState = { balance: null, status: 'idle' };
let inflight: Promise<void> | null = null;
let lastFetchAt = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (next: CreditBalanceState) => { state = next; emit(); };
const STALE_MS = 20_000;

export const refreshCreditBalance = (force = false): Promise<void> => {
  if (inflight) return inflight;
  if (!force && state.status === 'ready' && Date.now() - lastFetchAt < STALE_MS) return Promise.resolve();
  if (state.status !== 'ready') set({ balance: state.balance, status: 'loading' });   // keep showing the last known server value while refreshing
  inflight = referralApi.balance()
    .then((n) => { lastFetchAt = Date.now(); set({ balance: n, status: 'ready' }); })
    .catch(() => { set({ balance: state.balance, status: state.balance === null ? 'error' : 'ready' }); })
    .finally(() => { inflight = null; });
  return inflight;
};

/** Use a balance the server has just returned (redemption response, Refer & Earn overview) so every screen updates at once. */
export const setCreditBalanceFromServer = (n: number | null | undefined) => {
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0) return;
  lastFetchAt = Date.now(); set({ balance: Math.floor(n), status: 'ready' });
};
export const resetCreditBalance = () => { lastFetchAt = 0; set({ balance: null, status: 'idle' }); };

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
const getSnapshot = () => state;

/** `active` = the signed-in user is a student (nothing is fetched for teachers / admins). */
export const useCreditBalance = (active: boolean, routeKey?: string) => {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  useEffect(() => { if (active) void refreshCreditBalance(); }, [active, routeKey]);
  useEffect(() => {
    if (!active) return undefined;
    const onVisible = () => { if (document.visibilityState === 'visible') void refreshCreditBalance(); };
    document.addEventListener('visibilitychange', onVisible); window.addEventListener('focus', onVisible);
    return () => { document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [active]);
  const refresh = useCallback(() => refreshCreditBalance(true), []);
  return { ...snap, refresh };
};

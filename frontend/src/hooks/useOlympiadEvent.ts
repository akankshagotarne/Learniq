import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { EventOption, eventsApi } from '../services/olympiadEvents';

const KEY = 'learniq.admin.olympiadEvent';
const read = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const write = (v: string) => { try { localStorage.setItem(KEY, v); } catch { /* storage may be blocked */ } };

/**
 * The event every Olympiad admin page works inside. Priority: ?event= in the URL, then the last choice, then the server's default
 * (live > upcoming > most recent). There is deliberately no "all events" value: records of different events are never mixed.
 */
export const useOlympiadEvent = () => {
  const [params, setParams] = useSearchParams();
  const [options, setOptions] = useState<EventOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [defaultId, setDefaultId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try { const r = await eventsApi.options(); setOptions(r.options); setDefaultId(r.defaultEventId); setError(''); }
    catch { setError('Could not load the Olympiad events.'); } finally { setLoading(false); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const known = (id: string) => !!id && options.some(o => o._id === id);
  const fromUrl = params.get('event') || '';
  const eventId = known(fromUrl) ? fromUrl : known(read()) ? read() : (defaultId || '');

  const setEvent = useCallback((id: string) => {
    write(id);
    setParams(prev => { const n = new URLSearchParams(prev); n.set('event', id); n.delete('page'); return n; }, { replace: true });
  }, [setParams]);

  return { eventId, setEvent, options, current: options.find(o => o._id === eventId) || null, loading, error, refresh };
};

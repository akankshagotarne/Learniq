import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Clock, Copy, Link2, Loader2, Radio, RefreshCw, Search, Shield, Users, Video } from 'lucide-react';
import toast from 'react-hot-toast';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';

type Filter = 'active' | 'live' | 'scheduled' | 'ended' | 'all';
interface Row {
  id: string; sessionCode: string; title: string; subject?: string; standard?: number; standardLabel: string; status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  scheduledAt?: string; startedAt?: string; endedAt?: string; host: { id: string; name: string }; course: { id: string; title: string } | null;
  visibilityMode: string; connectedStudents: number; waiting: number; hostPresent: boolean; activeMcq: { state: string; submitted: number } | null; consoles: number; stale: boolean;
  adminsInMeeting?: number; audience?: { students: string; teachers: string; access: string };
}
const MODE_LABEL: Record<string, string> = { everyone: 'Everyone visible', host_only: 'Host only', host_and_selected: 'Host + selected', presentation: 'Presentation', spotlight: 'Spotlight' };

/** Live Class Management: every class with its live numbers, and the way into the moderation console. */
const AdminLiveSessions: React.FC = () => {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState<Filter>('active');
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [closing, setClosing] = useState<string | null>(null);
  const [joining, setJoining] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => { const t = window.setTimeout(() => setDebounced(q.trim()), 300); return () => window.clearTimeout(t); }, [q]);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const r = await api.get('/admin/live-classes', { params: { status: filter, q: debounced || undefined, limit: 100 } });
      setRows(r.data.classes || []); setError('');
    } catch { setError('The live classes could not be loaded. Please try again.'); }
    finally { setLoading(false); }
  }, [filter, debounced]);

  useEffect(() => { load(); }, [load]);
  // live classes change quickly: refresh the numbers while the page is open and visible
  useEffect(() => {
    const id = window.setInterval(() => { if (document.visibilityState === 'visible') load(true); }, 10000);
    return () => window.clearInterval(id);
  }, [load]);

  const liveNow = rows.filter((r) => r.status === 'live' && !r.stale).length;
  const stale = rows.filter((r) => r.stale).length;
  const students = rows.reduce((n, r) => n + r.connectedStudents, 0);

  const joinMeeting = (r: Row) => { if (joining) return; setJoining(r.sessionCode); navigate(`/admin/live/${encodeURIComponent(r.sessionCode)}/meeting`); };
  const copy = (code: string) => { navigator.clipboard?.writeText(`${window.location.origin}/live/${code}`); toast.success('Student link copied.'); };
  const markEnded = async (r: Row) => {
    setClosing(r.sessionCode);
    try { await api.post(`/admin/live-classes/${encodeURIComponent(r.sessionCode)}/mark-ended`); toast.success('Class closed.'); await load(true); }
    catch (e: any) { toast.error(e.response?.data?.message || 'The class could not be closed.'); }
    finally { setClosing(null); }
  };

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 transition-all duration-300">
        <div className="p-3 sm:p-6 lg:p-8 max-w-7xl mx-auto" data-testid="admin-live-dashboard">
          <div className="mb-5">
            <p className="text-brand-primary text-xs font-semibold tracking-wide uppercase mb-1">Admin</p>
            <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">Live Class Management</h1>
            <p className="text-text-secondary text-sm mt-1">See every class that is running. Open the moderation console to manage it without joining, or join the live meeting itself as a moderator.</p>
          </div>

          <div className="grid grid-cols-3 gap-3 mb-5">
            {[{ label: 'Live now', value: liveNow, icon: Radio, tone: 'bg-[#FFE4EC] text-[#E1447A]' }, { label: 'Students connected', value: students, icon: Users, tone: 'bg-[#EDE9FE] text-[#6C63F2]' }, { label: 'Need attention', value: stale, icon: AlertTriangle, tone: 'bg-[#FEF3C7] text-[#D97706]' }].map(({ label, value, icon: Icon, tone }) => (
              <div key={label} className="card-soft p-3 sm:p-4"><div className={`w-8 h-8 rounded-xl flex items-center justify-center mb-2 ${tone}`}><Icon className="w-4 h-4" /></div>
                <p className="text-xl font-bold font-heading text-text-primary">{loading ? '…' : value}</p><p className="text-text-secondary text-xs font-medium">{label}</p></div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row gap-2 mb-4">
            <div className="relative flex-1"><Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title, subject or code" aria-label="Search live classes" className="input-field pl-9 w-full min-h-[44px]" /></div>
            <div className="flex gap-1.5 overflow-x-auto" role="group" aria-label="Filter by status">
              {(['active', 'live', 'scheduled', 'ended', 'all'] as Filter[]).map((m) => (
                <button key={m} onClick={() => setFilter(m)} aria-pressed={filter === m} className={`flex-shrink-0 min-h-[44px] px-3 rounded-xl text-xs font-medium border capitalize ${filter === m ? 'bg-brand-primary text-white border-brand-primary' : 'bg-surface text-text-secondary border-border-subtle'}`}>{m === 'active' ? 'Live + scheduled' : m}</button>
              ))}
              <button onClick={() => load()} aria-label="Refresh" className="flex-shrink-0 min-h-[44px] w-11 rounded-xl border border-border-subtle bg-surface inline-flex items-center justify-center text-text-secondary"><RefreshCw className="w-4 h-4" /></button>
            </div>
          </div>

          {error && <p role="alert" className="text-sm text-rose-600 bg-rose-50 border border-rose-200 rounded-xl px-3 py-2 mb-3">{error}</p>}

          {loading ? (
            <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="skeleton h-28 rounded-card" />)}</div>
          ) : rows.length === 0 ? (
            <div className="card-soft p-12 text-center"><Radio className="w-12 h-12 text-text-muted mx-auto mb-3" /><p className="text-text-secondary">No live classes match this view.</p></div>
          ) : (
            <ul className="space-y-3">
              {rows.map((r) => (
                <li key={r.id} className="card-soft p-4" data-testid={`live-row-${r.sessionCode}`}>
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <h3 className="font-heading font-semibold text-text-primary break-words min-w-0">{r.title}</h3>
                        {r.status === 'live' && !r.stale && <span className="badge-live">LIVE</span>}
                        {r.stale && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800" data-testid="stale-badge">Not running</span>}
                        {r.status === 'scheduled' && <span className="badge-subject-live text-xs">Scheduled</span>}
                        {(r.status === 'ended' || r.status === 'cancelled') && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-surface-alt text-text-muted capitalize">{r.status}</span>}
                        {r.activeMcq && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-brand-primary/10 text-brand-primary">Question {r.activeMcq.state === 'open' ? 'open' : 'closing'} · {r.activeMcq.submitted} answered</span>}
                      </div>
                      <p className="text-sm text-text-secondary">Host: <span className="font-medium text-text-primary">{r.host.name || 'Unknown'}</span>{r.course ? <> · {r.course.title}</> : null}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted mt-1.5">
                        <span className="font-medium text-text-secondary">{[r.subject, r.standardLabel].filter(Boolean).join(' • ')}</span>
                        {r.scheduledAt && <span><Clock className="w-3.5 h-3.5 inline mr-1" />{new Date(r.scheduledAt).toLocaleString('en-IN')}</span>}
                        {r.status === 'live' && !r.stale && <span><Users className="w-3.5 h-3.5 inline mr-1" />{r.connectedStudents} connected{r.waiting ? ` · ${r.waiting} waiting` : ''}</span>}
                        <span>{MODE_LABEL[r.visibilityMode] || r.visibilityMode}</span>
                        {r.status === 'live' && !r.stale && <span>{r.hostPresent ? 'Teacher present' : 'Teacher away'}</span>}
                        {r.audience && <span data-testid="audience-label">For: {r.audience.students}{r.audience.teachers && r.audience.teachers !== 'No teachers' ? ` + ${r.audience.teachers}` : ''}</span>}
                        {r.adminsInMeeting ? <span className="text-sky-700 font-medium">{r.adminsInMeeting} admin{r.adminsInMeeting === 1 ? '' : 's'} in the meeting</span> : null}
                      </div>
                      <div className="mt-2 flex items-center gap-2 p-2 bg-surface-alt border border-border-subtle rounded-xl max-w-md">
                        <Link2 className="w-4 h-4 text-brand-primary flex-shrink-0" /><span className="text-brand-primary text-xs font-mono truncate">{window.location.origin}/live/{r.sessionCode}</span>
                        <button onClick={() => copy(r.sessionCode)} aria-label="Copy student link" className="w-9 h-9 flex-shrink-0 inline-flex items-center justify-center text-text-muted"><Copy className="w-4 h-4" /></button>
                      </div>
                    </div>
                    <div className="flex flex-wrap md:flex-col gap-2 md:flex-shrink-0">
                      {r.status === 'live' && (
                        <Link to={`/admin/live/${encodeURIComponent(r.sessionCode)}`} className="btn-outline text-sm min-h-[44px] px-4 inline-flex items-center justify-center gap-1.5" data-testid={`open-console-${r.sessionCode}`}><Shield className="w-4 h-4" />Open console</Link>
                      )}
                      {r.status === 'live' && (r.stale
                        ? <button type="button" disabled title="Nobody is running this class right now, so there is nothing to join." className="btn-primary text-sm min-h-[44px] px-4 inline-flex items-center justify-center gap-1.5 opacity-50 cursor-not-allowed" data-testid={`join-meeting-${r.sessionCode}`}><Video className="w-4 h-4" />Join Live Meeting</button>
                        : <button type="button" onClick={() => joinMeeting(r)} disabled={joining === r.sessionCode} aria-busy={joining === r.sessionCode} className="btn-primary text-sm min-h-[44px] px-4 inline-flex items-center justify-center gap-1.5 disabled:opacity-70" data-testid={`join-meeting-${r.sessionCode}`}>{joining === r.sessionCode ? <><Loader2 className="w-4 h-4 animate-spin" />Joining…</> : <><Video className="w-4 h-4" />Join Live Meeting</>}</button>)}
                      {r.stale && <button onClick={() => markEnded(r)} disabled={closing === r.sessionCode} className="min-h-[44px] px-4 rounded-xl border border-border-subtle bg-surface text-sm font-medium text-text-secondary" data-testid={`mark-ended-${r.sessionCode}`}>{closing === r.sessionCode ? 'Closing…' : 'Mark as ended'}</button>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminLiveSessions;

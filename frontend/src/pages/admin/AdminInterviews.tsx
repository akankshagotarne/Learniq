import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Download, Loader2, Power, RefreshCw, Search, Wrench } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import { fmtDateTime, fmtDuration, staffStatusLabel, statusTone } from '../../components/interview/interviewLabels';
import { AdminRow, AdminStats, AdminTeacher, interviewApi, interviewErrorMessage } from '../../services/interview';
import { useInterviewLive } from '../../hooks/useInterviewLive';

type Detail = Awaited<ReturnType<typeof interviewApi.adminDetail>>;
const ASSIGNABLE = ['REQUESTED', 'ASSIGNED', 'WAITING_FOR_APPROVAL'];
const CANCELLABLE = ['REQUESTED', 'ASSIGNED', 'WAITING_FOR_APPROVAL', 'APPROVED', 'CONNECTING', 'IN_PROGRESS'];

/** Admin "Interview Management": real counts, filters, assign / reassign waiting interviews, presence-only monitoring, history, CSV. */
const AdminInterviews: React.FC = () => {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [teachers, setTeachers] = useState<AdminTeacher[]>([]);
  const [rows, setRows] = useState<AdminRow[]>([]);
  const [q, setQ] = useState(''); const [status, setStatus] = useState(''); const [standard, setStandard] = useState(''); const [teacher, setTeacher] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);

  const filters = { q: q.trim() || undefined, status: status || undefined, standard: standard || undefined, teacher: teacher || undefined };
  const load = useCallback(async () => {
    try {
      const [s, list] = await Promise.all([interviewApi.adminStats(), interviewApi.adminList(filters)]);
      setStats(s.stats); setTeachers(s.teachers); setRows(list); setError(null);
    } catch (e) { setError(interviewErrorMessage(e, 'Could not load interviews.')); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, status, standard, teacher]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useInterviewLive(load, { pollMs: 10000 });

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try { await fn(); if (ok) toast.success(ok); await load(); } catch (e) { toast.error(interviewErrorMessage(e)); } finally { setBusy(null); }
  };

  const exportCsv = () => run('csv', async () => {
    const blob = await interviewApi.adminExport(filters);
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = 'learniq-interviews.csv'; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  });

  const cards: [string, number | undefined][] = stats ? [
    ['Eligible students', stats.eligibleStudents], ['Not requested', stats.notRequested], ['Waiting', stats.pending], ['Assigned', stats.assigned],
    ['Awaiting approval', stats.waitingApproval], ['Live now', stats.active], ['Completed', stats.completed], ['Cancelled', stats.cancelled],
    ['Stale', stats.stale], ['Teachers free', stats.teachersAvailable],
  ] : [];

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
            <div>
              <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">Interview Management</h1>
              <p className="text-text-secondary text-sm mt-1">Teacher–student interviews for submitted Olympiad exams. Only presence is shown; calls are never recorded.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {stats && (
                <button type="button" disabled={busy === 'toggle'} onClick={() => run('toggle', () => interviewApi.adminSetRequestsEnabled(!stats.settings.requestsEnabled), stats.settings.requestsEnabled ? 'New interview requests paused.' : 'New interview requests enabled.')}
                  className={`min-h-[44px] px-4 rounded-xl text-sm font-semibold inline-flex items-center gap-2 border ${stats.settings.requestsEnabled ? 'bg-surface-alt border-border-subtle text-text-primary' : 'bg-[#FFE4EC] border-[#E1447A]/40 text-[#E1447A]'}`} data-testid="toggle-requests">
                  <Power className="w-4 h-4" /> {stats.settings.requestsEnabled ? 'Pause new requests' : 'Requests paused — enable'}
                </button>
              )}
              <button type="button" disabled={busy === 'recover'} onClick={() => run('recover', async () => { const r = await interviewApi.adminRecoverStale(); toast.success(`${r.recovered} stale interview(s) recovered.`); })} className="min-h-[44px] px-4 rounded-xl bg-surface-alt border border-border-subtle text-sm font-semibold inline-flex items-center gap-2"><Wrench className="w-4 h-4" /> Recover stale</button>
              <button type="button" disabled={busy === 'csv'} onClick={exportCsv} className="min-h-[44px] px-4 rounded-xl bg-surface-alt border border-border-subtle text-sm font-semibold inline-flex items-center gap-2" data-testid="export-csv"><Download className="w-4 h-4" /> Export CSV</button>
              <button type="button" onClick={load} aria-label="Refresh" className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-surface-alt border border-border-subtle inline-flex items-center justify-center"><RefreshCw className="w-4 h-4" /></button>
            </div>
          </div>

          {error && <div className="card-soft p-4 rounded-xl text-sm text-text-secondary mb-4" role="alert">{error}</div>}
          {!stats && !error && <div className="flex items-center gap-2 text-text-secondary text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>}

          {stats && !stats.settings.requestsEnabled && <div className="mb-4 p-3 rounded-xl bg-[#FFC24B]/15 text-sm text-text-primary" role="status">New interview requests are paused. Interviews already in progress are not affected.</div>}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-6" data-testid="interview-stats">
            {cards.map(([label, value]) => <div key={label} className="card-soft p-3 rounded-xl border border-border-subtle"><p className="text-[11px] text-text-muted">{label}</p><p className="font-heading font-bold text-xl text-text-primary">{value}</p></div>)}
          </div>

          <div className="flex flex-col lg:flex-row gap-3 mb-5">
            <div className="relative flex-1 max-w-md"><Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" aria-hidden="true" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search student name, email or phone" aria-label="Search" className="input-field pl-9" /></div>
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" className="input-field lg:w-48"><option value="">All statuses</option>{['REQUESTED', 'ASSIGNED', 'WAITING_FOR_APPROVAL', 'APPROVED', 'CONNECTING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'FAILED'].map((s) => <option key={s} value={s}>{staffStatusLabel(s as any)}</option>)}</select>
            <select value={standard} onChange={(e) => setStandard(e.target.value)} aria-label="Standard" className="input-field lg:w-40"><option value="">All standards</option>{Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>Std {n}</option>)}</select>
            <select value={teacher} onChange={(e) => setTeacher(e.target.value)} aria-label="Teacher" className="input-field lg:w-48"><option value="">All teachers</option>{teachers.map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}</select>
          </div>

          {stats && rows.length === 0 && <div className="card-soft p-8 rounded-2xl text-center text-sm text-text-secondary">No interviews match these filters.</div>}
          {rows.length > 0 && (
            <div className="card-soft rounded-2xl border border-border-subtle overflow-x-auto">
              <table className="w-full text-sm min-w-[1040px]" data-testid="admin-interview-table">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-text-muted border-b border-border-subtle">{['Student', 'Std', 'Exam', 'Status', 'Teacher', 'Requested', 'Presence', 'Duration', 'Actions'].map((h) => <th key={h} className="px-3 py-3 font-semibold">{h}</th>)}</tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r._id} className="border-b border-border-subtle last:border-0 align-middle" data-testid="admin-interview-row">
                      <td className="px-3 py-3"><button type="button" className="font-medium text-text-primary hover:text-brand-primary text-left" onClick={async () => { try { setDetail(await interviewApi.adminDetail(r._id)); } catch (e) { toast.error(interviewErrorMessage(e)); } }}>{r.student?.name || 'Unknown'}</button><p className="text-[11px] text-text-muted">{r.student?.email || 'No email'} · {r.student?.phone || 'No phone'}</p></td>
                      <td className="px-3 py-3 text-text-secondary">{r.standard ?? '—'}</td>
                      <td className="px-3 py-3 text-text-secondary max-w-[180px] truncate" title={r.exam?.title}>{r.exam?.title || '—'}</td>
                      <td className="px-3 py-3"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${statusTone(r.status)}`}>{staffStatusLabel(r.status)}</span>{r.stale && <span className="ml-1 text-[10px] text-[#E1447A] font-semibold">STALE</span>}</td>
                      <td className="px-3 py-3 text-text-secondary">{r.teacher?.name || '—'}</td>
                      <td className="px-3 py-3 text-text-secondary whitespace-nowrap">{fmtDateTime(r.requestedAt)}</td>
                      <td className="px-3 py-3 text-xs text-text-secondary">T: {r.teacherPresent ? 'in' : 'out'} · S: {r.studentPresent ? 'in' : 'out'}</td>
                      <td className="px-3 py-3 text-text-secondary">{fmtDuration(r.durationSeconds)}</td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-2 items-center">
                          {ASSIGNABLE.includes(r.status) && (
                            <select aria-label={`Assign ${r.student?.name || 'student'} to a teacher`} defaultValue="" disabled={busy === r._id}
                              onChange={(e) => { const id = e.target.value; e.target.value = ''; if (id) run(r._id, () => interviewApi.adminAssign(r._id, id), 'Interview assigned.'); }}
                              className="input-field text-xs min-h-[36px] w-36"><option value="">{r.teacher ? 'Reassign…' : 'Assign…'}</option>{teachers.filter((t) => t.available || t._id === r.teacher?._id).map((t) => <option key={t._id} value={t._id}>{t.name}</option>)}</select>
                          )}
                          {CANCELLABLE.includes(r.status) && (
                            <button type="button" disabled={busy === r._id} onClick={() => { if (window.confirm(r.status === 'IN_PROGRESS' ? 'This interview is live. End it now?' : 'Cancel this interview?')) run(r._id, () => interviewApi.cancel(r._id, 'Cancelled by admin'), 'Interview cancelled.'); }} className="text-xs font-semibold text-[#E1447A] min-h-[36px] px-2">Cancel</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {detail && (
            <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Interview history" onClick={() => setDetail(null)}>
              <div className="bg-surface rounded-2xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-3"><h2 className="font-heading font-bold text-lg text-text-primary">Interview history</h2><button type="button" onClick={() => setDetail(null)} className="min-h-[44px] px-3 text-sm text-text-secondary">Close</button></div>
                <p className="text-sm text-text-secondary mb-3">Status: {staffStatusLabel(detail.status)}{detail.remarks ? ` · Remarks: ${detail.remarks}` : ''}</p>
                <ol className="space-y-2">{(detail.audit || []).map((a, i) => <li key={i} className="text-xs text-text-secondary border-l-2 border-brand-primary/40 pl-3"><span className="font-semibold text-text-primary">{a.action}</span> · {a.role} · {fmtDateTime(a.at)}{a.note ? ` · ${a.note}` : ''}</li>)}</ol>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminInterviews;

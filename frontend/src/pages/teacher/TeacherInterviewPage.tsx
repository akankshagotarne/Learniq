import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Loader2, Mail, Phone, Search, Video } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import { fmtDateTime, staffStatusLabel, statusTone } from '../../components/interview/interviewLabels';
import { DirectoryRow, InterviewView, interviewApi, interviewErrorMessage } from '../../services/interview';
import { useInterviewLive } from '../../hooks/useInterviewLive';
import { standardLabel } from '../../constants/standards';

type Directory = Awaited<ReturnType<typeof interviewApi.directory>>;

/** Teacher "Interview" section: ONE shared, backend-sourced directory of every student who paid and submitted the exam. */
const TeacherInterviewPage: React.FC = () => {
  const navigate = useNavigate();
  const [dir, setDir] = useState<Directory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [standard, setStandard] = useState('');
  const [status, setStatus] = useState('');
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setDir(await interviewApi.directory({ q: q.trim() || undefined, standard: standard || undefined, status: status || undefined })); setError(null); }
    catch (e) { setError(interviewErrorMessage(e, 'Could not load students.')); }
  }, [q, standard, status]);
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t); }, [load]);
  useInterviewLive(load, { pollMs: 10000 });

  const start = async (row: DirectoryRow) => {
    setBusyKey(row.student._id + row.exam._id);
    try {
      const iv: InterviewView = await interviewApi.start({ studentId: row.student._id, examId: row.exam._id, interviewId: row.interview?._id });
      navigate(`/teacher/interview/${iv._id}`);
    } catch (e) { toast.error(interviewErrorMessage(e)); load(); }
    finally { setBusyKey(null); }
  };

  const action = (row: DirectoryRow) => {
    const s = row.interviewStatus;
    if (row.assignedToMe && ['ASSIGNED', 'WAITING_FOR_APPROVAL', 'APPROVED', 'CONNECTING', 'IN_PROGRESS'].includes(s)) {
      return <button type="button" onClick={() => navigate(`/teacher/interview/${row.interview!._id}`)} className="btn-primary min-h-[44px] px-4 rounded-xl text-xs font-bold" data-testid="interview-open">Open Interview</button>;
    }
    if (s === 'NONE' || s === 'REQUESTED' || s === 'CANCELLED' || s === 'FAILED' || s === 'COMPLETED') {
      const redo = s === 'COMPLETED';
      const busy = busyKey === row.student._id + row.exam._id;
      return (
        <button type="button" disabled={busy || !!dir?.myActive} title={dir?.myActive ? 'Finish your current interview first.' : undefined} onClick={() => start(row)}
          className={`${redo ? 'bg-surface-alt border border-border-subtle text-text-primary' : 'btn-primary'} min-h-[44px] px-4 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-60`} data-testid="interview-start-row">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Video className="w-3.5 h-3.5" />} {redo ? 'Interview again' : 'Start Interview'}
        </button>
      );
    }
    return <span className="text-xs text-text-muted">With {row.assignedTeacher?.name || 'another teacher'}</span>;
  };

  const rows = dir?.rows || [];
  const counts = dir?.counts;
  const stats = useMemo(() => [
    { label: 'Waiting', value: counts?.pending ?? 0 }, { label: 'Awaiting approval', value: counts?.waitingApproval ?? 0 },
    { label: 'Live now', value: counts?.active ?? 0 }, { label: 'Completed', value: counts?.completed ?? 0 },
  ], [counts]);

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="mb-6">
            <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">Interview</h1>
            <p className="text-text-secondary text-sm mt-1">Students who paid and submitted their Olympiad exam. You can interview one student at a time.</p>
          </div>

          {dir?.myActive && (
            <div className="mb-5 p-4 rounded-2xl border border-brand-primary/40 bg-brand-primary/5 flex flex-wrap items-center justify-between gap-3" data-testid="my-active">
              <span className="text-sm text-text-primary font-medium">You have an interview in progress ({staffStatusLabel(dir.myActive.status)}).</span>
              <button type="button" onClick={() => navigate(`/teacher/interview/${dir.myActive!._id}`)} className="btn-primary min-h-[44px] px-4 rounded-xl text-xs font-bold">Open it</button>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
            {stats.map((s) => <div key={s.label} className="card-soft p-3 rounded-xl border border-border-subtle"><p className="text-[11px] text-text-muted">{s.label}</p><p className="font-heading font-bold text-xl text-text-primary">{s.value}</p></div>)}
          </div>

          <div className="flex flex-col sm:flex-row gap-3 mb-5">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" aria-hidden="true" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or phone" aria-label="Search students" className="input-field pl-9" data-testid="interview-search" />
            </div>
            <select value={standard} onChange={(e) => setStandard(e.target.value)} aria-label="Filter by standard" className="input-field sm:w-40">
              <option value="">All standards</option>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{standardLabel(n)}</option>)}
            </select>
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by interview status" className="input-field sm:w-48">
              <option value="">All statuses</option>
              {['NONE', 'REQUESTED', 'ASSIGNED', 'WAITING_FOR_APPROVAL', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map((s) => <option key={s} value={s}>{staffStatusLabel(s as any)}</option>)}
            </select>
          </div>

          {error && <div className="card-soft p-4 rounded-xl text-sm text-text-secondary mb-4" role="alert">{error} <button type="button" className="underline ml-2" onClick={load}>Retry</button></div>}
          {!dir && !error && <div className="flex items-center gap-2 text-text-secondary text-sm"><Loader2 className="w-4 h-4 animate-spin" /> Loading students…</div>}
          {dir && rows.length === 0 && <div className="card-soft p-8 rounded-2xl text-center text-sm text-text-secondary" data-testid="interview-empty">No students match yet. Students appear here once they have paid and submitted their exam.</div>}

          {rows.length > 0 && (
            <div className="card-soft rounded-2xl border border-border-subtle overflow-x-auto">
              <table className="w-full text-sm min-w-[980px]" data-testid="interview-table">
                <thead><tr className="text-left text-[11px] uppercase tracking-wide text-text-muted border-b border-border-subtle">
                  {['Student', 'Std', 'Email', 'Phone', 'Examination', 'Submitted', 'Request', 'Teacher', 'Interview', 'Action'].map((h) => <th key={h} className="px-3 py-3 font-semibold">{h}</th>)}
                </tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.student._id + r.exam._id} className="border-b border-border-subtle last:border-0 align-middle" data-testid="interview-row">
                      <td className="px-3 py-3 font-medium text-text-primary">{r.student.name}</td>
                      <td className="px-3 py-3 text-text-secondary">{r.standard}</td>
                      <td className="px-3 py-3 text-text-secondary"><span className="inline-flex items-center gap-1"><Mail className="w-3 h-3" aria-hidden="true" />{r.student.email || 'Not provided'}</span></td>
                      <td className="px-3 py-3 text-text-secondary"><span className="inline-flex items-center gap-1"><Phone className="w-3 h-3" aria-hidden="true" />{r.student.phone || 'Not provided'}</span></td>
                      <td className="px-3 py-3 text-text-secondary max-w-[200px] truncate" title={r.exam.title}>{r.exam.title}</td>
                      <td className="px-3 py-3 text-text-secondary whitespace-nowrap">Submitted · {fmtDateTime(r.submission.submittedAt)}</td>
                      <td className="px-3 py-3"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${statusTone(r.interviewStatus)}`}>{staffStatusLabel(r.interviewStatus)}</span></td>
                      <td className="px-3 py-3 text-text-secondary">{r.assignedTeacher ? (r.assignedToMe ? 'You' : r.assignedTeacher.name) : '—'}</td>
                      <td className="px-3 py-3 text-text-secondary">{r.interview?.status === 'IN_PROGRESS' ? 'Live' : r.interview?.status === 'COMPLETED' ? 'Done' : '—'}</td>
                      <td className="px-3 py-3">{action(r)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default TeacherInterviewPage;

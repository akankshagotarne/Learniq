import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  GraduationCap, Users, CheckCircle2, XCircle, Clock, Download, RefreshCw, Search, ShieldAlert, Settings, BarChart2, ListChecks, Loader2, AlertTriangle,
} from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import { Modal, Pager, Spinner, Stat, fmtDuration, fromISTInput, toISTInput } from '../../components/engineering/ui';
import {
  engineeringApi, engineeringErrorCode, engineeringErrorMessage, EngineeringActivity, EngineeringAdminExam, EngineeringAttemptDetail,
  EngineeringRequestRecord, EngineeringResultList, EngineeringResultRow, EngineeringSummary, ResultStatus,
} from '../../services/engineering';
import { formatISTDateTime } from '../../utils/olympiadFormat';

type Tab = 'overview' | 'requests' | 'results' | 'settings';
const TABS: { id: Tab; label: string; icon: React.FC<any> }[] = [
  { id: 'overview', label: 'Overview', icon: BarChart2 },
  { id: 'requests', label: 'Requests', icon: Users },
  { id: 'results', label: 'Results', icon: ListChecks },
  { id: 'settings', label: 'Exam settings', icon: Settings },
];

const statusChip: Record<string, string> = {
  PENDING: 'bg-[#FEF3C7] text-[#D97706]', APPROVED: 'bg-[#DCFCE7] text-[#16A34A]', REJECTED: 'bg-[#FFE4EC] text-[#E1447A]',
  COMPLETED: 'bg-[#DCFCE7] text-[#16A34A]', AUTO_SUBMITTED: 'bg-[#FEF3C7] text-[#D97706]', IN_PROGRESS: 'bg-[#E0E7FF] text-[#4F46E5]', NOT_ATTEMPTED: 'bg-surface-alt text-text-secondary',
};
const statusText: Record<string, string> = { COMPLETED: 'Submitted', AUTO_SUBMITTED: 'Auto-submitted', IN_PROGRESS: 'In progress', NOT_ATTEMPTED: 'Not attempted', PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' };
const Chip: React.FC<{ s: string }> = ({ s }) => <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${statusChip[s] || 'bg-surface-alt text-text-secondary'}`}>{statusText[s] || s}</span>;

const eventLabel: Record<string, string> = {
  FACE_MISSING: 'Face not visible', MULTIPLE_FACES: 'Multiple faces', MOBILE_PHONE_DETECTED: 'Suspected phone', FULLSCREEN_EXIT: 'Full-screen exit', TAB_SWITCH: 'Tab switch',
  WINDOW_BLUR: 'Window focus lost', COPY_PASTE: 'Copy / paste', CAMERA_DENIED: 'Camera denied', CAMERA_LOST: 'Camera lost', CAMERA_RESTORED: 'Camera restored',
};
const evLabel = (t: string) => eventLabel[t] || t.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());
const actionLabel = (a: string) => a.replace(/_/g, ' ').toLowerCase().replace(/^./, c => c.toUpperCase());

const useDebounced = <T,>(v: T, ms = 350): T => {
  const [d, setD] = useState(v);
  useEffect(() => { const t = setTimeout(() => setD(v), ms); return () => clearTimeout(t); }, [v, ms]);
  return d;
};

// ───────────────────────── Overview ─────────────────────────
const Overview: React.FC<{ goto: (t: Tab) => void; reloadKey: number }> = ({ goto, reloadKey }) => {
  const [data, setData] = useState<{ summary: EngineeringSummary; exam: any; recentActivity: EngineeringActivity[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    engineeringApi.overview().then(d => live && setData(d)).catch(e => live && setErr(engineeringErrorMessage(e, 'Unable to load the overview.')));
    return () => { live = false; };
  }, [reloadKey]);
  if (err) return <p className="text-sm text-[#E1447A]" role="alert">{err}</p>;
  if (!data) return <Spinner />;
  const { summary: s, exam } = data;
  return (
    <div className="space-y-6">
      <div className="card-soft p-4 rounded-2xl flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="font-heading font-bold text-text-primary break-words">{exam.title}</p>
          <p className="text-xs text-text-secondary mt-0.5">Closes <b>{exam.endDateIST}</b> · {exam.durationMinutes} min · {exam.isPublished ? 'Published' : 'Not published'} · {exam.accessEnabled ? 'Access open' : 'Access paused'}</p>
        </div>
        <button type="button" onClick={() => goto('settings')} className="text-xs font-semibold text-brand-primary hover:underline">Change deadline</button>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Requests" value={s.totalRequests} sub={`${s.pending} pending`} />
        <Stat label="Approved" value={s.approved} sub={`${s.rejected} rejected`} tone="text-[#16A34A]" />
        <Stat label="Started" value={s.started} sub={`${s.inProgress} in progress`} />
        <Stat label="Completed" value={s.completed} sub={`${s.autoSubmitted} auto-submitted`} />
        <Stat label="Not attempted" value={s.notAttempted} sub="approved, never started" />
        <Stat label="Average score" value={s.averageScore == null ? '—' : `${s.averageScore}/40`} />
        <Stat label="Median time" value={fmtDuration(s.medianTimeSeconds)} />
        <Stat label="Flagged attempts" value={s.flaggedAttempts} tone={s.flaggedAttempts ? 'text-[#E1447A]' : undefined} />
      </div>
      <div className="card-soft p-4 rounded-2xl">
        <h3 className="font-heading font-bold text-sm text-text-primary mb-3">Recent activity</h3>
        {data.recentActivity.length === 0 ? <p className="text-xs text-text-muted">Nothing yet.</p> : (
          <ul className="divide-y divide-border-subtle">
            {data.recentActivity.map((a, i) => (
              <li key={i} className="py-2 text-xs flex flex-wrap gap-x-3 gap-y-0.5 justify-between">
                <span className="text-text-primary font-medium">{actionLabel(a.action)}{a.affected != null ? ` · ${a.affected} student${a.affected === 1 ? '' : 's'}` : ''}</span>
                <span className="text-text-muted">{a.by} · {formatISTDateTime(a.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
};

// ───────────────────────── Requests ─────────────────────────
const Requests: React.FC<{ onChanged: () => void; reloadKey: number }> = ({ onChanged, reloadKey }) => {
  const [status, setStatus] = useState<'ALL' | 'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [sort, setSort] = useState('requestedAt');
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Awaited<ReturnType<typeof engineeringApi.requests>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState<string[] | null>(null);
  const [reason, setReason] = useState('');
  const [confirmAll, setConfirmAll] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => { setPage(1); }, [status, q, sort, dir]);
  useEffect(() => {
    let live = true;
    setErr(null);
    engineeringApi.requests({ status: status === 'ALL' ? undefined : status, search: q || undefined, sort, dir, page, limit: 25 })
      .then(d => { if (live) { setData(d); setSelected(new Set()); } })
      .catch(e => live && setErr(engineeringErrorMessage(e, 'Unable to load requests.')));
    return () => { live = false; };
  }, [status, q, sort, dir, page, tick, reloadKey]);

  const refresh = () => { setTick(t => t + 1); onChanged(); };
  const rows = data?.requests || [];
  const pendingIds = rows.filter(r => r.status === 'PENDING').map(r => r.studentId ? r._id : r._id);
  const allSelected = pendingIds.length > 0 && pendingIds.every(id => selected.has(id));

  const run = async (fn: () => Promise<any>, ok: string) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); toast.success(ok); refresh(); }
    catch (e: any) { toast.error(engineeringErrorMessage(e)); refresh(); }
    finally { setBusy(false); }
  };
  const approveOne = (id: string) => run(() => engineeringApi.approve(id), 'Request approved.');
  const approveSelected = () => run(async () => { const r = await engineeringApi.bulk('approve', [...selected]); if (r.skipped.length) toast(`${r.skipped.length} skipped (already decided).`); }, 'Selected requests approved.');
  const doReject = async () => {
    if (!rejecting) return;
    const ids = rejecting;
    setRejecting(null);
    const why = reason.trim();
    setReason('');
    await run(async () => { if (ids.length === 1) await engineeringApi.reject(ids[0], why); else await engineeringApi.bulk('reject', ids, why); }, ids.length === 1 ? 'Request rejected.' : 'Selected requests rejected.');
  };
  const approveAll = async () => {
    const expected = data?.counts.PENDING ?? 0;
    setConfirmAll(false);
    await run(async () => {
      try { const r = await engineeringApi.approveAll(expected); toast.success(`${r.approved} request${r.approved === 1 ? '' : 's'} approved.`); }
      catch (e: any) { if (engineeringErrorCode(e) === 'COUNT_CHANGED') throw new Error('The number of pending requests changed. Review the list and try again.'); throw e; }
    }, 'Done.');
  };

  const th = (key: string, label: string) => (
    <button type="button" className="inline-flex items-center gap-1 font-semibold hover:text-text-primary" onClick={() => { if (sort === key) setDir(d => (d === 'asc' ? 'desc' : 'asc')); else { setSort(key); setDir('asc'); } }}>
      {label}{sort === key ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2 items-center">
        {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map(s => (
          <button key={s} type="button" onClick={() => setStatus(s)} aria-pressed={status === s}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold border min-h-[36px] ${status === s ? 'bg-brand-primary text-white border-transparent' : 'bg-surface-alt border-border-subtle text-text-secondary'}`}>
            {s === 'ALL' ? 'All' : statusText[s]}{data ? ` (${s === 'ALL' ? data.counts.total : data.counts[s]})` : ''}
          </button>
        ))}
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, college, branch…" aria-label="Search requests" className="input-field w-full pl-9" />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" disabled={busy || !data?.counts.PENDING} onClick={() => setConfirmAll(true)} data-testid="approve-all"
          className="btn-primary text-xs py-2 px-4 rounded-xl min-h-[40px] disabled:opacity-50">Approve all pending{data ? ` (${data.counts.PENDING})` : ''}</button>
        <button type="button" disabled={busy || selected.size === 0} onClick={approveSelected}
          className="text-xs font-semibold py-2 px-4 rounded-xl min-h-[40px] border border-[#16A34A]/40 text-[#16A34A] disabled:opacity-40">Approve selected ({selected.size})</button>
        <button type="button" disabled={busy || selected.size === 0} onClick={() => setRejecting([...selected])}
          className="text-xs font-semibold py-2 px-4 rounded-xl min-h-[40px] border border-[#E1447A]/40 text-[#E1447A] disabled:opacity-40">Reject selected ({selected.size})</button>
      </div>

      {err ? <p className="text-sm text-[#E1447A]" role="alert">{err}</p> : !data ? <Spinner /> : rows.length === 0 ? (
        <div className="card-soft p-8 text-center text-sm text-text-secondary">No requests match.</div>
      ) : (
        <div className="card-soft rounded-2xl overflow-x-auto">
          <table className="w-full text-xs min-w-[56rem]">
            <thead>
              <tr className="text-left text-text-muted border-b border-border-subtle">
                <th className="p-3 w-8"><input type="checkbox" aria-label="Select all pending on this page" checked={allSelected} disabled={pendingIds.length === 0}
                  onChange={e => setSelected(e.target.checked ? new Set(pendingIds) : new Set())} /></th>
                <th className="p-3">{th('name', 'Student')}</th><th className="p-3">Email</th><th className="p-3">{th('college', 'College')}</th>
                <th className="p-3">{th('branch', 'Branch')}</th><th className="p-3">Year</th><th className="p-3">{th('requestedAt', 'Requested')}</th>
                <th className="p-3">{th('status', 'Status')}</th><th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: EngineeringRequestRecord) => (
                <tr key={r._id} className="border-b border-border-subtle last:border-0 align-top">
                  <td className="p-3">{r.status === 'PENDING' && <input type="checkbox" aria-label={`Select ${r.fullName}`} checked={selected.has(r._id)}
                    onChange={e => setSelected(prev => { const n = new Set(prev); if (e.target.checked) n.add(r._id); else n.delete(r._id); return n; })} />}</td>
                  <td className="p-3 font-semibold text-text-primary break-words max-w-[10rem]"><button type="button" className="text-left hover:underline" onClick={() => setDetail(r._id)}>{r.fullName}</button></td>
                  <td className="p-3 text-text-secondary break-all max-w-[12rem]">{r.email}</td>
                  <td className="p-3 text-text-secondary break-words max-w-[10rem]">{r.college}</td>
                  <td className="p-3 text-text-secondary break-words max-w-[8rem]">{r.branch}</td>
                  <td className="p-3 text-text-secondary whitespace-nowrap">{r.degree} · {r.year}</td>
                  <td className="p-3 text-text-secondary whitespace-nowrap">{formatISTDateTime(r.requestedAt)}</td>
                  <td className="p-3"><Chip s={r.status} />{r.status === 'REJECTED' && r.rejectionReason && <p className="text-[10px] text-text-muted mt-1 max-w-[9rem] break-words">{r.rejectionReason}</p>}</td>
                  <td className="p-3 text-right whitespace-nowrap">
                    {r.status !== 'APPROVED' && <button type="button" disabled={busy} onClick={() => approveOne(r._id)} className="px-2.5 py-1.5 rounded-lg text-[#16A34A] border border-[#16A34A]/40 font-semibold mr-1 min-h-[34px]">Approve</button>}
                    {r.status === 'PENDING' && <button type="button" disabled={busy} onClick={() => setRejecting([r._id])} className="px-2.5 py-1.5 rounded-lg text-[#E1447A] border border-[#E1447A]/40 font-semibold min-h-[34px]">Reject</button>}
                    {r.status === 'REJECTED' && !r.canResubmit && <button type="button" disabled={busy} onClick={() => run(() => engineeringApi.allowResubmit(r._id), 'The student can send a new request.')} className="px-2.5 py-1.5 rounded-lg border border-border-subtle text-text-secondary font-semibold min-h-[34px]">Allow resubmit</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}

      {confirmAll && (
        <Modal title="Approve all pending requests?" onClose={() => setConfirmAll(false)}>
          <p className="text-sm text-text-secondary">This approves <b>{data?.counts.PENDING ?? 0}</b> pending request{(data?.counts.PENDING ?? 0) === 1 ? '' : 's'}. Rejected and already-approved requests are not changed. The action is recorded in the audit log.</p>
          <div className="flex justify-end gap-2 mt-5">
            <button type="button" onClick={() => setConfirmAll(false)} className="px-4 py-2 rounded-xl border border-border-subtle text-xs font-semibold min-h-[40px]">Cancel</button>
            <button type="button" onClick={approveAll} data-testid="approve-all-confirm" className="btn-primary px-4 py-2 rounded-xl text-xs min-h-[40px]">Approve {data?.counts.PENDING ?? 0}</button>
          </div>
        </Modal>
      )}
      {rejecting && (
        <Modal title={`Reject ${rejecting.length} request${rejecting.length === 1 ? '' : 's'}`} onClose={() => setRejecting(null)}>
          <label htmlFor="reject-reason" className="block text-xs font-semibold text-text-secondary mb-1">Reason (shown to the student)</label>
          <textarea id="reject-reason" value={reason} onChange={e => setReason(e.target.value)} maxLength={300} rows={3} className="input-field w-full" placeholder="Optional" />
          <div className="flex justify-end gap-2 mt-5">
            <button type="button" onClick={() => setRejecting(null)} className="px-4 py-2 rounded-xl border border-border-subtle text-xs font-semibold min-h-[40px]">Cancel</button>
            <button type="button" onClick={doReject} className="px-4 py-2 rounded-xl bg-[#E1447A] text-white text-xs font-bold min-h-[40px]">Reject</button>
          </div>
        </Modal>
      )}
      {detail && <RequestDetail id={detail} onClose={() => setDetail(null)} />}
    </div>
  );
};

const RequestDetail: React.FC<{ id: string; onClose: () => void }> = ({ id, onClose }) => {
  const [d, setD] = useState<Awaited<ReturnType<typeof engineeringApi.requestDetail>> | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { engineeringApi.requestDetail(id).then(setD).catch(e => setErr(engineeringErrorMessage(e))); }, [id]);
  return (
    <Modal title="Request details" onClose={onClose}>
      {err ? <p className="text-sm text-[#E1447A]">{err}</p> : !d ? <Spinner /> : (
        <div className="space-y-4 text-xs">
          <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5">
            {([['Name', d.request.fullName], ['Email', d.request.email], ['Phone', d.student?.phone || '—'], ['College', d.request.college], ['Branch', d.request.branch], ['Degree', d.request.degree], ['Year', d.request.year], ['Roll number', d.request.rollNumber || '—'], ['Status', statusText[d.request.status]], ['Test attempt', d.attempt ? statusText[d.attempt.status] || d.attempt.status : 'Not started']] as [string, string][]).map(([k, v]) => (
              <React.Fragment key={k}><dt className="text-text-muted">{k}</dt><dd className="text-text-primary break-words">{v}</dd></React.Fragment>
            ))}
          </dl>
          <div>
            <h3 className="font-semibold text-text-primary mb-1">History</h3>
            <ul className="space-y-1">{d.history.map((h, i) => <li key={i} className="text-text-secondary">{actionLabel(h.action)} · {formatISTDateTime(h.at)}{h.by ? ` · ${h.by}` : ''}{h.reason ? ` — ${h.reason}` : ''}</li>)}</ul>
          </div>
        </div>
      )}
    </Modal>
  );
};

// ───────────────────────── Results ─────────────────────────
const FILTERS = [
  ['all', 'All'], ['completed', 'Completed'], ['in_progress', 'In progress'], ['not_attempted', 'Not attempted'], ['auto_submitted', 'Auto-submitted'], ['flagged', 'Flagged'], ['disqualified', 'Terminated'],
] as const;

const Results: React.FC<{ reloadKey: number }> = ({ reloadKey }) => {
  const [status, setStatus] = useState<string>('all');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [sort, setSort] = useState('rank');
  const [dir, setDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<EngineeringResultList | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [tick, setTick] = useState(0);

  useEffect(() => { setPage(1); }, [status, q, sort, dir]);
  useEffect(() => {
    let live = true;
    setErr(null);
    engineeringApi.results({ status, search: q || undefined, sort, dir, page, limit: 25 })
      .then(d => live && setData(d)).catch(e => live && setErr(engineeringErrorMessage(e, 'Unable to load results.')));
    return () => { live = false; };
  }, [status, q, sort, dir, page, tick, reloadKey]);

  const download = async () => {
    setPdfBusy(true);
    try { await engineeringApi.downloadReport(); toast.success('Report downloaded.'); }
    catch (e: any) { toast.error(engineeringErrorMessage(e, 'Unable to create the report.')); }
    finally { setPdfBusy(false); }
  };
  const th = (key: string, label: string) => (
    <button type="button" className="inline-flex items-center gap-1 font-semibold hover:text-text-primary" onClick={() => { if (sort === key) setDir(d => (d === 'asc' ? 'desc' : 'asc')); else { setSort(key); setDir(key === 'name' ? 'asc' : key === 'rank' || key === 'time' || key === 'submitted' ? 'asc' : 'desc'); } }}>
      {label}{sort === key ? (dir === 'asc' ? ' ↑' : ' ↓') : ''}
    </button>
  );
  const s = data?.summary;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map(([id, label]) => (
            <button key={id} type="button" aria-pressed={status === id} onClick={() => setStatus(id)}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold border min-h-[36px] ${status === id ? 'bg-brand-primary text-white border-transparent' : 'bg-surface-alt border-border-subtle text-text-secondary'}`}>{label}</button>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={() => setTick(t => t + 1)} className="p-2 rounded-xl border border-border-subtle bg-surface-alt min-h-[40px]" aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>
          <button type="button" onClick={download} disabled={pdfBusy} data-testid="download-report" className="btn-primary text-xs py-2 px-4 rounded-xl min-h-[40px] flex items-center gap-2 disabled:opacity-70">
            {pdfBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Download PDF report
          </button>
        </div>
      </div>
      {s && (
        <p className="text-xs text-text-secondary">
          {s.completed} completed · {s.inProgress} in progress · {s.notAttempted} not attempted · average {s.averageScore == null ? '—' : `${s.averageScore}/40`} · median time {fmtDuration(s.medianTimeSeconds)} · {s.flaggedAttempts} flagged
        </p>
      )}
      <div className="relative max-w-md">
        <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, email, college, branch…" aria-label="Search results" className="input-field w-full pl-9" />
      </div>

      {err ? <p className="text-sm text-[#E1447A]" role="alert">{err}</p> : !data ? <Spinner /> : data.rows.length === 0 ? (
        <div className="card-soft p-8 text-center text-sm text-text-secondary">No students match.</div>
      ) : (
        <div className="card-soft rounded-2xl overflow-x-auto">
          <table className="w-full text-xs min-w-[60rem]">
            <thead>
              <tr className="text-left text-text-muted border-b border-border-subtle">
                <th className="p-3">{th('rank', 'Rank')}</th><th className="p-3">{th('name', 'Student')}</th><th className="p-3">College / branch</th>
                <th className="p-3">{th('score', 'Score')}</th><th className="p-3">%</th><th className="p-3">Percentile</th><th className="p-3">{th('time', 'Time')}</th>
                <th className="p-3">Status</th><th className="p-3">{th('flags', 'Flags')}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r: EngineeringResultRow) => (
                <tr key={r.studentId} className="border-b border-border-subtle last:border-0 align-top">
                  <td className="p-3 font-heading font-bold text-text-primary">{r.rank ?? '—'}</td>
                  <td className="p-3 max-w-[14rem]">
                    {r.attemptId ? <button type="button" onClick={() => setOpen(r.attemptId!)} className="font-semibold text-text-primary hover:underline text-left break-words">{r.name}</button> : <span className="font-semibold text-text-primary break-words">{r.name}</span>}
                    <p className="text-text-muted break-all">{r.email}</p>
                  </td>
                  <td className="p-3 text-text-secondary break-words max-w-[12rem]">{r.college}<br />{r.branch}</td>
                  <td className="p-3 whitespace-nowrap font-semibold text-text-primary">{r.score == null ? '—' : `${r.score}/${r.maxMarks}`}</td>
                  <td className="p-3 whitespace-nowrap text-text-secondary">{r.percentage == null ? '—' : `${r.percentage}%`}</td>
                  <td className="p-3 whitespace-nowrap text-text-secondary">{r.percentile == null ? '—' : r.percentile}</td>
                  <td className="p-3 whitespace-nowrap text-text-secondary">{fmtDuration(r.timeTakenSeconds)}</td>
                  <td className="p-3"><Chip s={r.status} />{r.terminated && <p className="text-[10px] text-[#E1447A] mt-1">Terminated by proctoring</p>}</td>
                  <td className={`p-3 whitespace-nowrap ${r.flagCount ? 'text-[#E1447A] font-semibold' : 'text-text-muted'}`}>{r.attemptId ? r.flagCount : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && <Pager page={data.page} pages={data.pages} total={data.total} onPage={setPage} />}
      {open && <AttemptModal attemptId={open} onClose={() => setOpen(null)} />}
    </div>
  );
};

const AttemptModal: React.FC<{ attemptId: string; onClose: () => void }> = ({ attemptId, onClose }) => {
  const [d, setD] = useState<EngineeringAttemptDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { engineeringApi.attempt(attemptId).then(setD).catch(e => setErr(engineeringErrorMessage(e))); }, [attemptId]);
  const pdf = async () => { setBusy(true); try { await engineeringApi.downloadAttemptReport(attemptId); } catch (e: any) { toast.error(engineeringErrorMessage(e)); } finally { setBusy(false); } };
  const sections = useMemo(() => {
    const m = new Map<string, { correct: number; total: number }>();
    d?.questions.forEach(q => { const x = m.get(q.subject) || { correct: 0, total: 0 }; x.total += 1; if (q.status === 'CORRECT') x.correct += 1; m.set(q.subject, x); });
    return [...m.entries()];
  }, [d]);
  return (
    <Modal title={d ? `${d.student.name || 'Student'} — result` : 'Result'} onClose={onClose} wide>
      {err ? <p className="text-sm text-[#E1447A]">{err}</p> : !d ? <Spinner /> : (
        <div className="space-y-5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-text-secondary break-words">{d.student.email} · {d.student.college} · {d.student.branch} · {d.student.degree} {d.student.year}</p>
              <p className="text-text-muted mt-1">Started {d.startedAt ? formatISTDateTime(d.startedAt) : '—'} · Submitted {d.submittedAt ? formatISTDateTime(d.submittedAt) : '—'}{d.submissionType && d.submissionType !== 'MANUAL' ? ` (automatic: ${d.submissionType.toLowerCase()})` : ''}</p>
            </div>
            <button type="button" disabled={busy} onClick={pdf} className="btn-primary text-xs py-2 px-4 rounded-xl min-h-[40px] flex items-center gap-2 disabled:opacity-70">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} PDF</button>
          </div>
          {d.result ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat label="Score" value={`${d.result.score}/${d.result.maxMarks}`} sub={`${d.result.percentage}%`} />
              <Stat label="Rank" value={d.rank ? `${d.rank} / ${d.rankOf}` : '—'} sub={d.percentile != null ? `Percentile ${d.percentile}` : undefined} />
              <Stat label="Correct / wrong" value={`${d.result.correct} / ${d.result.incorrect}`} sub={`${d.result.unanswered} unanswered`} />
              <Stat label="Time taken" value={fmtDuration(d.result.timeTakenSeconds)} />
            </div>
          ) : <p className="text-text-secondary">This attempt is still running — marks are shown only after it is submitted.</p>}

          {d.result && sections.length > 0 && (
            <div className="card-soft rounded-2xl p-3">
              <h3 className="font-semibold text-text-primary mb-2">Section-wise</h3>
              <ul className="grid sm:grid-cols-2 gap-x-6 gap-y-1">{sections.map(([n, v]) => <li key={n} className="flex justify-between gap-3"><span className="text-text-secondary break-words">{n}</span><b className="text-text-primary whitespace-nowrap">{v.correct}/{v.total}</b></li>)}</ul>
            </div>
          )}

          <div>
            <h3 className="font-semibold text-text-primary mb-2 flex items-center gap-1.5"><ShieldAlert className="w-4 h-4 text-[#E1447A]" /> Proctoring</h3>
            {!d.proctoring ? <p className="text-text-muted">No proctoring session was recorded.</p> : (
              <>
                <p className="text-text-secondary mb-2">{d.proctoring.flagCount} flag{d.proctoring.flagCount === 1 ? '' : 's'}{d.proctoring.terminationReason ? ` · ended by proctoring: ${d.proctoring.terminationReason.replace(/_/g, ' ').toLowerCase()}` : ''}</p>
                {d.proctoring.events.length === 0 ? <p className="text-text-muted">No events were recorded.</p> : (
                  <div className="overflow-x-auto"><table className="w-full min-w-[28rem]"><thead><tr className="text-left text-text-muted border-b border-border-subtle"><th className="py-1.5 pr-3">Time (IST)</th><th className="py-1.5 pr-3">Event</th><th className="py-1.5 pr-3">Counted</th><th className="py-1.5">Confidence</th></tr></thead>
                    <tbody>{d.proctoring.events.map((e, i) => <tr key={i} className="border-b border-border-subtle last:border-0"><td className="py-1.5 pr-3 whitespace-nowrap">{formatISTDateTime(e.occurredAt)}</td><td className="py-1.5 pr-3">{evLabel(e.type)}</td><td className="py-1.5 pr-3">{e.counted ? (e.warningNumber ? `Warning ${e.warningNumber}` : 'Yes') : 'No'}</td><td className="py-1.5">{e.confidence == null ? '—' : `${Math.round(e.confidence * 100)}%`}</td></tr>)}</tbody></table></div>
                )}
              </>
            )}
          </div>

          <div>
            <h3 className="font-semibold text-text-primary mb-2">Question-wise marks</h3>
            <div className="overflow-x-auto max-h-80 overflow-y-auto border border-border-subtle rounded-xl">
              <table className="w-full min-w-[34rem]"><thead className="sticky top-0 bg-surface"><tr className="text-left text-text-muted border-b border-border-subtle"><th className="p-2">#</th><th className="p-2">Section</th><th className="p-2">Chosen</th><th className="p-2">Correct</th><th className="p-2">Result</th><th className="p-2">Marks</th></tr></thead>
                <tbody>{d.questions.map(q => (
                  <tr key={q.questionNumber} className="border-b border-border-subtle last:border-0">
                    <td className="p-2">{q.questionNumber}</td><td className="p-2 text-text-secondary">{q.subject}</td>
                    <td className="p-2">{q.selectedOption == null ? '—' : 'ABCD'[q.selectedOption]}</td><td className="p-2">{q.correctOption == null ? '—' : 'ABCD'[q.correctOption]}</td>
                    <td className={`p-2 font-semibold ${q.status === 'CORRECT' ? 'text-[#16A34A]' : q.status === 'INCORRECT' ? 'text-[#E1447A]' : 'text-text-muted'}`}>{q.status === 'UNANSWERED' ? 'Unanswered' : q.status === 'ANSWERED' ? 'Answered' : q.status === 'CORRECT' ? 'Correct' : 'Incorrect'}</td>
                    <td className="p-2">{q.marksAwarded == null ? '—' : q.marksAwarded}</td>
                  </tr>))}</tbody></table>
            </div>
          </div>
          {d.history.length > 0 && (
            <div><h3 className="font-semibold text-text-primary mb-1">History</h3><ul className="space-y-0.5 text-text-secondary">{d.history.map((h, i) => <li key={i}>{actionLabel(h.action)} · {formatISTDateTime(h.at)}{h.reason ? ` — ${h.reason}` : ''}</li>)}</ul></div>
          )}
        </div>
      )}
    </Modal>
  );
};

// ───────────────────────── Exam settings ─────────────────────────
const Settings_: React.FC<{ onChanged: () => void; reloadKey: number }> = ({ onChanged, reloadKey }) => {
  const [exam, setExam] = useState<EngineeringAdminExam | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [deadline, setDeadline] = useState('');
  const [duration, setDuration] = useState('45');
  const [busy, setBusy] = useState(false);
  const [confirmPast, setConfirmPast] = useState(false);

  const load = useCallback(async () => {
    try {
      const e = await engineeringApi.adminExam();
      setExam(e); setDeadline(toISTInput(e.endDate)); setDuration(String(e.durationMinutes)); setErr(null);
    } catch (x: any) { setErr(engineeringErrorMessage(x, 'Unable to load the exam settings.')); }
  }, []);
  useEffect(() => { load(); }, [load, reloadKey]);

  const save = async (body: Parameters<typeof engineeringApi.updateExam>[0], ok: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await engineeringApi.updateExam(body);
      setExam(r.exam); setDeadline(toISTInput(r.exam.endDate)); setDuration(String(r.exam.durationMinutes));
      toast.success(r.runningAttemptsAdjusted ? `${ok} ${r.runningAttemptsAdjusted} running attempt(s) were adjusted.` : ok);
      onChanged();
    } catch (x: any) {
      toast.error(engineeringErrorMessage(x));
      if (x?.response?.data?.problems?.length) toast.error(x.response.data.problems.join(' '));
    } finally { setBusy(false); setConfirmPast(false); }
  };

  if (err) return <p className="text-sm text-[#E1447A]" role="alert">{err}</p>;
  if (!exam) return <Spinner />;
  const deadlineIso = deadline ? fromISTInput(deadline) : '';
  const isPast = !!deadlineIso && new Date(deadlineIso).getTime() < Date.now();
  const changedDeadline = deadline !== toISTInput(exam.endDate);

  return (
    <div className="space-y-5 max-w-3xl">
      {!exam.ready && (
        <div className="card-soft p-4 rounded-2xl border border-[#E1447A]/40 bg-[#E1447A]/5 text-xs" role="alert">
          <p className="font-semibold text-[#E1447A] flex items-center gap-1.5"><AlertTriangle className="w-4 h-4" /> The exam is not ready to publish</p>
          <ul className="list-disc pl-5 mt-1 text-text-secondary">{exam.problems.map(p => <li key={p}>{p}</li>)}</ul>
        </div>
      )}
      <div className="card-soft p-5 rounded-2xl space-y-4">
        <h3 className="font-heading font-bold text-sm text-text-primary">Closing time</h3>
        <p className="text-xs text-text-secondary">Currently closes <b>{exam.endDateIST}</b>. After this time nobody can start, and any attempt still running is submitted automatically. The server enforces this — a student's device clock does not matter.</p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="deadline" className="block text-xs font-semibold text-text-secondary mb-1">New deadline (IST)</label>
            <input id="deadline" type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} className="input-field" />
          </div>
          <button type="button" disabled={busy || !deadline || !changedDeadline} onClick={() => (isPast ? setConfirmPast(true) : save({ endDate: deadlineIso }, 'Deadline updated.'))} data-testid="save-deadline"
            className="btn-primary text-xs py-2 px-4 rounded-xl min-h-[40px] disabled:opacity-50">Save deadline</button>
        </div>
        {isPast && changedDeadline && <p className="text-xs text-[#D97706]">That time has already passed — saving closes the exam immediately.</p>}
      </div>

      <div className="card-soft p-5 rounded-2xl space-y-3">
        <h3 className="font-heading font-bold text-sm text-text-primary">Duration</h3>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="duration" className="block text-xs font-semibold text-text-secondary mb-1">Minutes (1–180)</label>
            <input id="duration" type="number" min={1} max={180} value={duration} onChange={e => setDuration(e.target.value)} className="input-field w-28" />
          </div>
          <button type="button" disabled={busy || Number(duration) === exam.durationMinutes} onClick={() => save({ durationMinutes: Number(duration) }, 'Duration updated.')}
            className="btn-primary text-xs py-2 px-4 rounded-xl min-h-[40px] disabled:opacity-50">Save duration</button>
        </div>
        <p className="text-[11px] text-text-muted">Applies to attempts that start after the change. {exam.totalQuestions} questions · {exam.totalMarks} marks · {exam.marksPerCorrect} mark per correct answer · no negative marking · free.</p>
      </div>

      <div className="card-soft p-5 rounded-2xl space-y-3">
        <h3 className="font-heading font-bold text-sm text-text-primary">Availability</h3>
        <div className="flex flex-wrap gap-3">
          <button type="button" disabled={busy} onClick={() => save({ isPublished: !exam.isPublished }, exam.isPublished ? 'Exam hidden from students.' : 'Exam published.')}
            className="text-xs font-semibold py-2 px-4 rounded-xl min-h-[40px] border border-border-subtle bg-surface-alt">{exam.isPublished ? 'Unpublish exam' : 'Publish exam'}</button>
          <button type="button" disabled={busy} onClick={() => save({ accessEnabled: !exam.accessEnabled }, exam.accessEnabled ? 'New requests and starts are paused.' : 'Access re-opened.')}
            className="text-xs font-semibold py-2 px-4 rounded-xl min-h-[40px] border border-border-subtle bg-surface-alt">{exam.accessEnabled ? 'Pause access' : 'Re-open access'}</button>
        </div>
        <p className="text-[11px] text-text-muted">Pausing stops new requests and new starts; students who are already writing finish normally. Questions in the paper: {exam.questionCount}.</p>
      </div>

      {confirmPast && (
        <Modal title="Close the exam now?" onClose={() => setConfirmPast(false)}>
          <p className="text-sm text-text-secondary">The deadline you chose is in the past. Every running attempt will be submitted automatically and nobody else can start.</p>
          <div className="flex justify-end gap-2 mt-5">
            <button type="button" onClick={() => setConfirmPast(false)} className="px-4 py-2 rounded-xl border border-border-subtle text-xs font-semibold min-h-[40px]">Cancel</button>
            <button type="button" onClick={() => save({ endDate: deadlineIso, confirmPast: true }, 'Exam closed.')} className="px-4 py-2 rounded-xl bg-[#E1447A] text-white text-xs font-bold min-h-[40px]">Close exam</button>
          </div>
        </Modal>
      )}
    </div>
  );
};

// ───────────────────────── Page ─────────────────────────
const AdminEngineering: React.FC = () => {
  const [tab, setTab] = useState<Tab>('overview');
  const [reloadKey, setReloadKey] = useState(0);
  const bump = () => setReloadKey(k => k + 1);
  return (
    <div className="flex min-h-screen bg-page transition-colors">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="flex items-center gap-3 mb-5">
            <span className="p-2.5 rounded-xl bg-[#6C63F2]/10 text-[#6C63F2]"><GraduationCap className="w-6 h-6" /></span>
            <div className="min-w-0">
              <h1 className="font-heading font-bold text-xl sm:text-2xl text-text-primary">Engineering</h1>
              <p className="text-xs text-text-secondary">BE Engineering mock test — access requests, exam settings and results</p>
            </div>
          </div>
          <div role="tablist" className="flex gap-1 overflow-x-auto border-b border-border-subtle mb-6">
            {TABS.map(t => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} type="button" onClick={() => setTab(t.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 -mb-px min-h-[44px] ${tab === t.id ? 'border-brand-primary text-brand-primary' : 'border-transparent text-text-secondary hover:text-text-primary'}`}>
                <t.icon className="w-4 h-4" /> {t.label}
              </button>
            ))}
          </div>
          {tab === 'overview' && <Overview goto={setTab} reloadKey={reloadKey} />}
          {tab === 'requests' && <Requests onChanged={bump} reloadKey={reloadKey} />}
          {tab === 'results' && <Results reloadKey={reloadKey} />}
          {tab === 'settings' && <Settings_ onChanged={bump} reloadKey={reloadKey} />}
        </div>
      </main>
    </div>
  );
};

export default AdminEngineering;

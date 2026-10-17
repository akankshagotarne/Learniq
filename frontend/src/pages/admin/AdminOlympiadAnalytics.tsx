import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  AlertTriangle, ArrowDown, ArrowUp, BarChart2, CheckCircle2, ChevronLeft, ChevronRight, Clock, Download, IndianRupee, Loader2, PlayCircle, RefreshCw,
  Search, ShieldAlert, Target, UserCheck, Users, UserX,
} from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import StudentDrawer from '../../components/olympiad/analytics/StudentDrawer';
import { ExamBadge, FlagBadge, PaymentBadge, ResultBadge } from '../../components/olympiad/analytics/labels';
import { olympiadAnalyticsApi } from '../../services/olympiadAnalytics';
import { olympiadErrorMessage } from '../../services/olympiad';
import { AnalyticsQuery, AnalyticsResponse, AnalyticsRow, AnalyticsSort, AnalyticsView } from '../../types/olympiadAnalytics';
import { formatISTDate, formatISTDateTime, formatRupees } from '../../utils/olympiadFormat';

const DEFAULT_QUERY: AnalyticsQuery = {
  exam: 'all', standard: 'all', payment: 'all', participation: 'all', view: 'all', search: '',
  sort: 'registered', order: 'desc', page: 1, limit: 25,
  registeredFrom: '', registeredTo: '', attemptFrom: '', attemptTo: '', submittedFrom: '', submittedTo: '',
};

const TABS: { view: AnalyticsView; label: string }[] = [
  { view: 'all', label: 'All Students' },
  { view: 'registered', label: 'Registered' },
  { view: 'paid', label: 'Successfully Paid' },
  { view: 'payment_pending', label: 'Payment Pending' },
  { view: 'payment_failed', label: 'Payment Failed' },
  { view: 'not_started', label: 'Not Started' },
  { view: 'in_progress', label: 'In Progress' },
  { view: 'submitted', label: 'Submitted' },
  { view: 'results_pending', label: 'Results Pending' },
  { view: 'results_available', label: 'Results Available' },
  { view: 'review', label: 'Needs Review' },
];

const selectCls = 'w-full text-sm rounded-xl border border-border-subtle bg-surface px-3 py-2 text-text-primary';
const labelCls = 'block text-[11px] font-semibold text-text-muted mb-1';

const FilterField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block min-w-0"><span className={labelCls}>{label}</span>{children}</label>
);

interface CardProps { label: string; value: React.ReactNode; hint?: React.ReactNode; icon: React.FC<any>; tone: string; onClick?: () => void; active?: boolean; testId: string }
const Card: React.FC<CardProps> = ({ label, value, hint, icon: Icon, tone, onClick, active, testId }) => {
  const inner = (
    <>
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-2 ${tone}`}><Icon className="w-4.5 h-4.5" aria-hidden /></div>
      <p className="text-2xl font-heading font-bold text-text-primary leading-none" data-testid={`${testId}-value`}>{value}</p>
      <p className="text-xs font-semibold text-text-primary mt-1.5">{label}</p>
      {hint && <p className="text-[11px] text-text-muted mt-0.5">{hint}</p>}
    </>
  );
  const cls = `card-soft p-4 rounded-card border text-left w-full ${active ? 'border-brand-primary ring-1 ring-brand-primary' : 'border-border-subtle'}`;
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} hover:border-brand-primary transition-colors`} data-testid={testId} aria-pressed={active}>{inner}</button>
    : <div className={cls} data-testid={testId}>{inner}</div>;
};

const SkeletonCards: React.FC = () => (
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6" data-testid="cards-loading" aria-busy="true">
    {Array.from({ length: 8 }).map((_, i) => <div key={i} className="card-soft rounded-card border border-border-subtle h-[112px] animate-pulse bg-surface-alt" />)}
  </div>
);

const SortHeader: React.FC<{ label: string; field?: AnalyticsSort; q: AnalyticsQuery; onSort: (f: AnalyticsSort) => void }> = ({ label, field, q, onSort }) => {
  if (!field) return <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-text-muted whitespace-nowrap">{label}</th>;
  const active = q.sort === field;
  return (
    <th className="px-3 py-2.5 text-left text-[11px] font-semibold text-text-muted whitespace-nowrap" aria-sort={active ? (q.order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(field)} className="inline-flex items-center gap-1 hover:text-text-primary">
        {label}{active && (q.order === 'asc' ? <ArrowUp className="w-3 h-3" aria-hidden /> : <ArrowDown className="w-3 h-3" aria-hidden />)}
      </button>
    </th>
  );
};

const AdminOlympiadAnalytics: React.FC = () => {
  const [query, setQuery] = useState<AnalyticsQuery>(DEFAULT_QUERY);
  const [searchInput, setSearchInput] = useState('');
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; denied: boolean } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [openStudent, setOpenStudent] = useState<{ id: string; examId: string } | null>(null);
  const seq = useRef(0);

  // search is debounced so typing does not fire a request per keystroke
  useEffect(() => {
    const t = setTimeout(() => setQuery(q => (q.search === searchInput.trim() ? q : { ...q, search: searchInput.trim(), page: 1 })), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  useEffect(() => {
    const mine = ++seq.current;
    const ctrl = new AbortController();
    setLoading(true); setError(null);
    olympiadAnalyticsApi.get(query, ctrl.signal)
      .then(res => { if (mine === seq.current) { setData(res); setLoading(false); } })
      .catch(err => {
        if (mine !== seq.current || err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
        const status = err?.response?.status;
        setError({ denied: status === 401 || status === 403, message: status === 403 ? 'You do not have permission to view Olympiad student analytics.' : olympiadErrorMessage(err, 'Could not load the analytics.') });
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [query, reloadKey]);

  const update = useCallback((patch: Partial<AnalyticsQuery>) => setQuery(q => ({ ...q, page: 1, ...patch })), []);
  const onSort = (field: AnalyticsSort) => setQuery(q => ({ ...q, page: 1, sort: field, order: q.sort === field && q.order === 'desc' ? 'asc' : 'desc' }));
  const reset = () => { setSearchInput(''); setQuery(DEFAULT_QUERY); };
  const filtersDirty = useMemo(() => JSON.stringify({ ...query, page: 1, limit: 25, sort: 'registered', order: 'desc' }) !== JSON.stringify({ ...DEFAULT_QUERY }), [query]);

  const doExport = async () => {
    setExporting(true);
    try {
      const { blob, count } = await olympiadAnalyticsApi.exportCsv(query);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `learniq-olympiad-students-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      toast.success(`Exported ${count} record${count === 1 ? '' : 's'}`);
    } catch (err) { toast.error(olympiadErrorMessage(err, 'Export failed. Please try again.')); } finally { setExporting(false); }
  };

  const c = data?.cards;
  const hasEvents = (data?.events.length ?? 0) > 0;
  const showView = (view: AnalyticsView) => update({ view });

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-[90rem] mx-auto">
          <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <p className="text-brand-primary text-xs font-semibold tracking-wide uppercase mb-1">Admin · Olympiad</p>
              <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary flex items-center gap-2" data-testid="page-title">
                <BarChart2 className="w-6 h-6 text-brand-primary" aria-hidden /> Olympiad Student Analytics &amp; Participation Management
              </h1>
              <p className="text-text-secondary text-sm mt-1">Monitor student registrations, successful payments, examination participation, and individual student records from one place.</p>
            </div>
            <div className="flex gap-2 self-start sm:self-auto">
              <button onClick={() => setReloadKey(k => k + 1)} disabled={loading} className="flex items-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-xl border border-border-subtle bg-surface-alt text-text-primary disabled:opacity-60" data-testid="refresh">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Refresh
              </button>
              <button onClick={() => void doExport()} disabled={exporting || !data || data.pagination.total === 0} className="flex items-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-xl bg-brand-primary text-white disabled:opacity-50" data-testid="export">
                {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Download className="w-3.5 h-3.5" aria-hidden />} Export CSV
              </button>
            </div>
          </div>

          {/* Filters */}
          <div className="card-soft rounded-card border border-border-subtle p-4 mb-5" data-testid="filters">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <FilterField label="Olympiad exam">
                <select className={selectCls} value={query.exam} onChange={e => update({ exam: e.target.value })} aria-label="Olympiad exam">
                  <option value="all">All Olympiad exams</option>
                  {(data?.events || []).map(ev => <option key={ev._id} value={ev._id}>{ev.title} (Std {ev.standard})</option>)}
                </select>
              </FilterField>
              <FilterField label="Standard">
                <select className={selectCls} value={query.standard} onChange={e => update({ standard: e.target.value })} aria-label="Standard">
                  <option value="all">All standards</option>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(n => <option key={n} value={String(n)}>Std {n}</option>)}
                </select>
              </FilterField>
              <FilterField label="Payment status">
                <select className={selectCls} value={query.payment} onChange={e => update({ payment: e.target.value })} aria-label="Payment status">
                  <option value="all">All</option><option value="SUCCESS">Successful</option><option value="PENDING">Pending</option><option value="FAILED">Failed</option><option value="REFUNDED">Refunded</option><option value="NOT_PAID">Not paid (no payment)</option>
                </select>
              </FilterField>
              <FilterField label="Exam participation">
                <select className={selectCls} value={query.participation} onChange={e => update({ participation: e.target.value })} aria-label="Exam participation">
                  <option value="all">All</option><option value="NOT_STARTED">Not started</option><option value="IN_PROGRESS">In progress</option><option value="SUBMITTED">Submitted</option><option value="NOT_ELIGIBLE">Not eligible</option>
                </select>
              </FilterField>
              {([['Registered from', 'registeredFrom'], ['Registered to', 'registeredTo'], ['Attempt started from', 'attemptFrom'], ['Attempt started to', 'attemptTo'], ['Submitted from', 'submittedFrom'], ['Submitted to', 'submittedTo']] as const).map(([label, key]) => (
                <FilterField key={key} label={label}>
                  <input type="date" className={selectCls} value={query[key]} onChange={e => update({ [key]: e.target.value } as Partial<AnalyticsQuery>)} aria-label={label} />
                </FilterField>
              ))}
              <div className="flex items-end">
                <button onClick={reset} disabled={!filtersDirty && !searchInput} className="text-xs font-semibold py-2 px-3 rounded-xl border border-border-subtle bg-surface-alt text-text-primary disabled:opacity-50 w-full sm:w-auto" data-testid="reset-filters">Reset filters</button>
              </div>
            </div>
            {data && <p className="text-xs text-text-muted mt-3" data-testid="scope">Showing: <span className="font-semibold text-text-secondary">{data.scope.label}</span>{query.exam === 'all' && query.standard === 'all' ? ` — ${data.scope.defaultScope}` : ''}</p>}
          </div>

          {error && (
            <div className="rounded-xl border border-[#F9A8C0] bg-[#FFE4EC] p-4 mb-5 text-sm text-[#9D174D]" role="alert" data-testid="error">
              <p className="flex items-center gap-2 font-semibold">{error.denied ? <ShieldAlert className="w-4 h-4" aria-hidden /> : <AlertTriangle className="w-4 h-4" aria-hidden />} {error.message}</p>
              {!error.denied && <button onClick={() => setReloadKey(k => k + 1)} className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-border-subtle text-text-primary" data-testid="retry"><RefreshCw className="w-3.5 h-3.5" aria-hidden /> Retry</button>}
            </div>
          )}

          {!error && !data && loading && <SkeletonCards />}

          {!error && data && !hasEvents && (
            <div className="card-soft p-10 text-center text-sm text-text-secondary rounded-card border border-border-subtle" data-testid="no-events">No Olympiad exams exist yet. Once an exam is created and students register, their records will appear here.</div>
          )}

          {!error && data && hasEvents && c && (
            <>
              {(c.needsReview > 0 || data.meta.truncated) && (
                <div className="rounded-xl border border-[#FDBA74] bg-[#FFF7ED] p-3 mb-4 text-xs text-[#9A3412] flex items-start gap-2" data-testid="review-banner">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden />
                  <span>
                    {c.needsReview > 0 && <>{c.needsReview} registration{c.needsReview === 1 ? '' : 's'} need review (data does not line up). Nothing was changed automatically. <button className="underline font-semibold" onClick={() => showView('review')}>Show them</button>. </>}
                    {data.meta.truncated && 'The report is capped at 50,000 registrations; narrow the filters for a complete view.'}
                  </span>
                </div>
              )}
              <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6 transition-opacity ${loading ? 'opacity-60' : ''}`} data-testid="cards">
                <Card testId="card-registered" label="Total Registered Students" value={c.registered} hint={`${c.registrations} registration${c.registrations === 1 ? '' : 's'} · ${data.scope.label}`} icon={Users} tone="bg-[#EDE9FE] text-[#6C63F2]" onClick={() => showView('registered')} active={query.view === 'registered'} />
                <Card testId="card-paid" label="Successfully Paid" value={c.paid} hint={<>Revenue {formatRupees(c.revenue)}{c.adminAccess > 0 ? ` · +${c.adminAccess} via admin access` : ''}</>} icon={IndianRupee} tone="bg-[#DCFCE7] text-[#16A34A]" onClick={() => showView('paid')} active={query.view === 'paid'} />
                <Card testId="card-notpaid" label="Not Paid / Payment Pending" value={c.notPaid.total} hint={`${c.notPaid.pending} pending · ${c.notPaid.failed} failed · ${c.notPaid.noPayment + c.notPaid.refunded} no payment / refunded`} icon={Clock} tone="bg-[#FEF3C7] text-[#D97706]" onClick={() => showView('payment_pending')} active={query.view === 'payment_pending'} />
                <Card testId="card-submitted" label="Students Attempted Exam" value={c.submitted} hint="Unique eligible students who submitted" icon={CheckCircle2} tone="bg-[#E0F2FE] text-[#0284C7]" onClick={() => showView('submitted')} active={query.view === 'submitted'} />
                <Card testId="card-notstarted" label="Students Not Attempted" value={c.notStarted} hint={`Paid / granted, never started (of ${c.eligible} eligible)`} icon={UserX} tone="bg-[#FFE4EC] text-[#E1447A]" onClick={() => showView('not_started')} active={query.view === 'not_started'} />
                <Card testId="card-inprogress" label="Exam In Progress" value={c.inProgress} hint="Started, not yet submitted" icon={PlayCircle} tone="bg-[#E0E7FF] text-[#4F46E5]" onClick={() => showView('in_progress')} active={query.view === 'in_progress'} />
                <Card testId="card-completed" label="Exam Completed / Results Available" value={`${c.submittedAttempts} / ${c.resultsAvailable}`} hint={`${c.submittedAttempts} submitted attempts · ${c.resultsAvailable} students with results available · ${c.resultsPending} pending`} icon={UserCheck} tone="bg-[#F3E8FF] text-[#9333EA]" onClick={() => showView('results_available')} active={query.view === 'results_available'} />
                <Card testId="card-rate" label="Participation Rate" value={`${c.participationRate}%`} hint={`${c.submitted} of ${c.eligible} eligible students submitted`} icon={Target} tone="bg-[#CCFBF1] text-[#0D9488]" />
              </div>

              {/* Quick filters */}
              <div className="flex gap-2 overflow-x-auto pb-2 mb-3" role="tablist" aria-label="Quick filters" data-testid="tabs">
                {TABS.map(t => (
                  <button key={t.view} role="tab" aria-selected={query.view === t.view} onClick={() => showView(t.view)}
                    className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${query.view === t.view ? 'bg-brand-primary text-white border-brand-primary' : 'bg-surface-alt text-text-secondary border-border-subtle hover:text-text-primary'}`}
                    data-testid={`tab-${t.view}`}>
                    {t.label} <span className="opacity-80" data-testid={`tab-count-${t.view}`}>({data.counts[t.view] ?? 0})</span>
                  </button>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-3 mb-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
                  <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search name, email, mobile, student ID, exam, order / payment ID"
                    className={`${selectCls} pl-9`} aria-label="Search students" data-testid="search" />
                </div>
                <select className={`${selectCls} sm:w-32`} value={query.limit} onChange={e => update({ limit: Number(e.target.value) })} aria-label="Rows per page">
                  {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
                </select>
              </div>

              <div className={`card-soft rounded-card border border-border-subtle overflow-hidden relative ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
                {loading && <div className="absolute top-2 right-3 z-10 text-xs text-text-secondary flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Updating…</div>}
                <div className="overflow-x-auto">
                  <table className="min-w-[1280px] w-full text-sm" data-testid="students-table">
                    <thead className="bg-surface-alt border-b border-border-subtle">
                      <tr>
                        <SortHeader label="Student" field="name" q={query} onSort={onSort} />
                        <SortHeader label="Standard" q={query} onSort={onSort} />
                        <SortHeader label="Exam" q={query} onSort={onSort} />
                        <SortHeader label="Registered" field="registered" q={query} onSort={onSort} />
                        <SortHeader label="Payment status" field="payment" q={query} onSort={onSort} />
                        <SortHeader label="Amount" q={query} onSort={onSort} />
                        <SortHeader label="Transaction ref." q={query} onSort={onSort} />
                        <SortHeader label="Exam status" field="examStatus" q={query} onSort={onSort} />
                        <SortHeader label="Attempt date" field="attemptDate" q={query} onSort={onSort} />
                        <SortHeader label="Submission date" field="submissionDate" q={query} onSort={onSort} />
                        <SortHeader label="Marks" field="score" q={query} onSort={onSort} />
                        <SortHeader label="Result" q={query} onSort={onSort} />
                        <SortHeader label="Action" q={query} onSort={onSort} />
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((r: AnalyticsRow) => (
                        <tr key={r.key} className="border-b border-border-subtle last:border-0 align-top" data-testid="student-row">
                          <td className="px-3 py-2.5 min-w-[11rem]">
                            <button type="button" onClick={() => setOpenStudent({ id: r.studentId, examId: r.examId })} className="font-semibold text-brand-primary hover:underline text-left" data-testid="student-link">{r.name}</button>
                            <div className="mt-1"><FlagBadge flags={r.flags} /></div>
                          </td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{r.standard ? `Std ${r.standard}` : '—'}</td>
                          <td className="px-3 py-2.5 min-w-[10rem]">{r.examTitle}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{r.registeredAt ? formatISTDate(r.registeredAt) : '—'}</td>
                          <td className="px-3 py-2.5"><PaymentBadge status={r.paymentStatus} />{r.accessType === 'ADMIN_ACCESS' && <div className="text-[11px] text-text-muted mt-0.5">Admin access</div>}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{r.amount != null ? formatRupees(r.amount) : '—'}</td>
                          <td className="px-3 py-2.5 font-mono text-[11px] break-all max-w-[11rem]">{r.paymentId || r.orderId || '—'}</td>
                          <td className="px-3 py-2.5"><ExamBadge status={r.examStatus} /></td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-xs">{r.startedAt ? formatISTDateTime(r.startedAt) : '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-xs">{r.submittedAt ? formatISTDateTime(r.submittedAt) : '—'}</td>
                          <td className="px-3 py-2.5 whitespace-nowrap">{r.score != null ? `${r.score}/${r.totalMarks ?? '—'}` : '—'}</td>
                          <td className="px-3 py-2.5"><ResultBadge status={r.resultStatus} /></td>
                          <td className="px-3 py-2.5"><button type="button" onClick={() => setOpenStudent({ id: r.studentId, examId: r.examId })} className="text-xs font-semibold text-brand-primary hover:underline whitespace-nowrap">View profile</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.rows.length === 0 && (
                  <div className="p-10 text-center text-sm text-text-secondary" data-testid="empty">
                    No students match the selected filters.
                    {filtersDirty || query.search ? <> <button onClick={reset} className="underline font-semibold">Reset filters</button></> : null}
                  </div>
                )}
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-3 text-xs text-text-secondary" data-testid="pagination">
                <span data-testid="total">{data.pagination.total} matching record{data.pagination.total === 1 ? '' : 's'} · page {data.pagination.page} of {data.pagination.pages}</span>
                <div className="flex gap-2">
                  <button onClick={() => setQuery(q => ({ ...q, page: Math.max(1, data.pagination.page - 1) }))} disabled={data.pagination.page <= 1 || loading} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border-subtle bg-surface-alt disabled:opacity-40" data-testid="prev"><ChevronLeft className="w-3.5 h-3.5" aria-hidden /> Previous</button>
                  <button onClick={() => setQuery(q => ({ ...q, page: Math.min(data.pagination.pages, data.pagination.page + 1) }))} disabled={data.pagination.page >= data.pagination.pages || loading} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border-subtle bg-surface-alt disabled:opacity-40" data-testid="next">Next <ChevronRight className="w-3.5 h-3.5" aria-hidden /></button>
                </div>
              </div>
              <p className="text-[11px] text-text-muted mt-3">
                Student counts are unique students (a student in several exams counts once); table rows are registrations (one student × one exam).
                {data.meta.hiddenPayments > 0 ? ` ${data.meta.hiddenPayments} unconfirmed / archived payment record${data.meta.hiddenPayments === 1 ? ' is' : 's are'} kept out of these figures.` : ''}
                {' '}Generated {formatISTDateTime(data.meta.generatedAt)}. Marks are visible to admins even before results are published; “Result available” means published to students.
              </p>
            </>
          )}
        </div>
      </main>
      {openStudent && <StudentDrawer studentId={openStudent.id} examId={openStudent.examId} onClose={() => setOpenStudent(null)} />}
    </div>
  );
};

export default AdminOlympiadAnalytics;

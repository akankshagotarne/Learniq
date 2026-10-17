import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import {
  AlertTriangle, ArrowDown, ArrowUp, BarChart2, CheckCircle2, ChevronLeft, ChevronRight, Download, Loader2, RefreshCw,
  Search, ShieldAlert, Target, Users, UserX,
} from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import StudentDrawer from '../../components/olympiad/analytics/StudentDrawer';
import { ExamBadge, FlagBadge } from '../../components/olympiad/analytics/labels';
import { olympiadAnalyticsApi } from '../../services/olympiadAnalytics';
import { olympiadErrorMessage } from '../../services/olympiad';
import { AnalyticsQuery, AnalyticsResponse, AnalyticsRow, AnalyticsSort, AnalyticsView } from '../../types/olympiadAnalytics';
import { formatISTDate, formatISTDateTime } from '../../utils/olympiadFormat';

const DEFAULT_QUERY: AnalyticsQuery = {
  exam: 'all', standard: 'all', participation: 'all', view: 'all', search: '',
  sort: 'registered', order: 'desc', page: 1, limit: 25, registeredFrom: '', registeredTo: '',
};

const TABS: { view: AnalyticsView; label: string }[] = [
  { view: 'all', label: 'All Students' },
  { view: 'registered', label: 'Registered' },
  { view: 'submitted', label: 'Submitted' },
  { view: 'not_submitted', label: 'Not Submitted' },
];

const selectCls = 'w-full text-sm rounded-xl border border-border-subtle bg-surface px-3 py-2 text-text-primary';
const labelCls = 'block text-[11px] font-semibold text-text-muted mb-1';

const FilterField: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block min-w-0"><span className={labelCls}>{label}</span>{children}</label>
);

/** Phones get a stacked card per record instead of a table (one layout is rendered at a time). */
const useIsNarrow = (maxWidth = 767) => {
  const query = `(max-width: ${maxWidth}px)`;
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query);
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on); on();
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return narrow;
};

interface CardProps { label: string; value: React.ReactNode; hint?: React.ReactNode; icon: React.FC<any>; tone: string; onClick?: () => void; active?: boolean; testId: string }
const Card: React.FC<CardProps> = ({ label, value, hint, icon: Icon, tone, onClick, active, testId }) => {
  const inner = (
    <div className="flex items-start gap-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${tone}`}><Icon className="w-4 h-4" aria-hidden /></div>
      <div className="min-w-0">
        <p className="text-2xl font-heading font-bold text-text-primary leading-none" data-testid={`${testId}-value`}>{value}</p>
        <p className="text-xs font-semibold text-text-primary mt-1">{label}</p>
        {hint && <p className="text-[11px] text-text-muted mt-0.5">{hint}</p>}
      </div>
    </div>
  );
  const cls = `card-soft p-3.5 rounded-card border text-left w-full ${active ? 'border-brand-primary ring-1 ring-brand-primary' : 'border-border-subtle'}`;
  return onClick
    ? <button type="button" onClick={onClick} className={`${cls} hover:border-brand-primary transition-colors`} data-testid={testId} aria-pressed={active}>{inner}</button>
    : <div className={cls} data-testid={testId}>{inner}</div>;
};

const SkeletonCards: React.FC = () => (
  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5" data-testid="cards-loading" aria-busy="true">
    {Array.from({ length: 4 }).map((_, i) => <div key={i} className="card-soft rounded-card border border-border-subtle h-[84px] animate-pulse bg-surface-alt" />)}
  </div>
);

const SortHeader: React.FC<{ label: string; field?: AnalyticsSort; q: AnalyticsQuery; onSort: (f: AnalyticsSort) => void }> = ({ label, field, q, onSort }) => {
  const cls = 'px-3 py-2.5 text-left text-[11px] font-semibold text-text-muted whitespace-nowrap';
  if (!field) return <th className={cls}>{label}</th>;
  const active = q.sort === field;
  return (
    <th className={cls} aria-sort={active ? (q.order === 'asc' ? 'ascending' : 'descending') : 'none'}>
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
  const narrow = useIsNarrow();

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
  const filtersDirty = useMemo(
    () => JSON.stringify({ ...query, page: 1, limit: 25, sort: 'registered', order: 'desc' }) !== JSON.stringify(DEFAULT_QUERY),
    [query],
  );

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
  const open = (r: AnalyticsRow) => setOpenStudent({ id: r.studentId, examId: r.examId });
  const multi = c ? c.registrations !== c.registered : false;

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-[80rem] mx-auto">
          <div className="mb-5 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <p className="text-brand-primary text-xs font-semibold tracking-wide uppercase mb-1">Admin · Olympiad</p>
              <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary flex items-center gap-2" data-testid="page-title">
                <BarChart2 className="w-6 h-6 text-brand-primary" aria-hidden /> Olympiad Student Analytics &amp; Participation Management
              </h1>
              <p className="text-text-secondary text-sm mt-1">See which students registered for the Olympiad and whether they have submitted their exam.</p>
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
          <div className="card-soft rounded-card border border-border-subtle p-3.5 mb-4" data-testid="filters">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <FilterField label="Olympiad exam">
                <select className={selectCls} value={query.exam} onChange={e => update({ exam: e.target.value })} aria-label="Olympiad exam">
                  <option value="all">All Exams</option>
                  {(data?.events || []).map(ev => <option key={ev._id} value={ev._id}>{ev.title} (Std {ev.standard})</option>)}
                </select>
              </FilterField>
              <FilterField label="Standard">
                <select className={selectCls} value={query.standard} onChange={e => update({ standard: e.target.value })} aria-label="Standard">
                  <option value="all">All Standards</option>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(n => <option key={n} value={String(n)}>Std {n}</option>)}
                </select>
              </FilterField>
              <FilterField label="Exam participation">
                <select className={selectCls} value={query.participation} onChange={e => update({ participation: e.target.value })} aria-label="Exam participation">
                  <option value="all">All</option><option value="SUBMITTED">Submitted</option><option value="NOT_SUBMITTED">Not Submitted</option>
                </select>
              </FilterField>
              <div className="min-w-0">
                <span className={labelCls}>Registration date (optional)</span>
                <div className="flex items-center gap-1.5">
                  <input type="date" className={selectCls} value={query.registeredFrom} max={query.registeredTo || undefined} onChange={e => update({ registeredFrom: e.target.value })} aria-label="Registered from" />
                  <span className="text-text-muted text-xs" aria-hidden>–</span>
                  <input type="date" className={selectCls} value={query.registeredTo} min={query.registeredFrom || undefined} onChange={e => update({ registeredTo: e.target.value })} aria-label="Registered to" />
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
              {data ? <p className="text-xs text-text-muted" data-testid="scope">Showing: <span className="font-semibold text-text-secondary">{data.scope.label}</span>{query.exam === 'all' && query.standard === 'all' ? ` — ${data.scope.defaultScope}` : ''}</p> : <span />}
              <button onClick={reset} disabled={!filtersDirty && !searchInput} className="text-xs font-semibold py-1.5 px-3 rounded-xl border border-border-subtle bg-surface-alt text-text-primary disabled:opacity-50" data-testid="reset-filters">Reset filters</button>
            </div>
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
                    {c.needsReview > 0 && <>{c.needsReview} record{c.needsReview === 1 ? '' : 's'} marked “Needs review” (the data does not line up). Nothing was changed automatically; such records are not counted in the cards. </>}
                    {data.meta.truncated && 'The report is capped at 50,000 registrations; narrow the filters for a complete view.'}
                  </span>
                </div>
              )}
              <div className={`grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5 transition-opacity ${loading ? 'opacity-60' : ''}`} data-testid="cards">
                <Card testId="card-registered" label="Total Registered Students" value={c.registered} hint={multi ? `${c.registrations} registrations across exams` : 'Students with a confirmed registration'} icon={Users} tone="bg-[#EDE9FE] text-[#6C63F2]" onClick={() => showView('registered')} active={query.view === 'registered'} />
                <Card testId="card-submitted" label="Submitted" value={c.submitted} hint="Registered students who submitted" icon={CheckCircle2} tone="bg-[#DCFCE7] text-[#16A34A]" onClick={() => showView('submitted')} active={query.view === 'submitted'} />
                <Card testId="card-notsubmitted" label="Not Submitted" value={c.notSubmitted} hint="Registered students yet to submit" icon={UserX} tone="bg-[#FEF3C7] text-[#D97706]" onClick={() => showView('not_submitted')} active={query.view === 'not_submitted'} />
                <Card testId="card-rate" label="Submission Rate" value={`${c.submissionRate}%`} hint={`${c.submitted} of ${c.registered} registered students`} icon={Target} tone="bg-[#CCFBF1] text-[#0D9488]" />
              </div>

              {/* Tabs */}
              <div className="flex gap-2 overflow-x-auto pb-2 mb-3" role="tablist" aria-label="Student groups" data-testid="tabs">
                {TABS.map(t => (
                  <button key={t.view} role="tab" aria-selected={query.view === t.view} onClick={() => showView(t.view)}
                    className={`flex-shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${query.view === t.view ? 'bg-brand-primary text-white border-brand-primary underline underline-offset-4' : 'bg-surface-alt text-text-secondary border-border-subtle hover:text-text-primary'}`}
                    data-testid={`tab-${t.view}`}>
                    {t.label} <span className="opacity-80" data-testid={`tab-count-${t.view}`}>({data.counts[t.view] ?? 0})</span>
                  </button>
                ))}
              </div>

              <div className="flex flex-col sm:flex-row gap-3 mb-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
                  <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search by name, email, mobile, student ID or exam"
                    className={`${selectCls} pl-9`} aria-label="Search students" data-testid="search" />
                </div>
                <select className={`${selectCls} sm:w-32`} value={query.limit} onChange={e => update({ limit: Number(e.target.value) })} aria-label="Rows per page">
                  {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
                </select>
              </div>

              <div className={`card-soft rounded-card border border-border-subtle overflow-hidden relative ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
                {loading && <div className="absolute top-2 right-3 z-10 text-xs text-text-secondary flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Updating…</div>}
                {data.rows.length > 0 && (narrow ? (
                  <ul data-testid="students-list" className="divide-y divide-border-subtle">
                    {data.rows.map((r: AnalyticsRow) => (
                      <li key={r.key} className="p-3" data-testid="student-row">
                        <div className="flex items-start justify-between gap-2">
                          <button type="button" onClick={() => open(r)} className="font-semibold text-brand-primary hover:underline text-left" data-testid="student-link">{r.name}</button>
                          <ExamBadge status={r.examStatus} />
                        </div>
                        <p className="text-xs text-text-secondary mt-0.5">{r.standard ? `Std ${r.standard}` : '—'} · {r.examTitle}</p>
                        <p className="text-xs text-text-muted mt-1">Registered {r.registeredAt ? formatISTDate(r.registeredAt) : '—'} · Submitted {r.submittedAt ? formatISTDateTime(r.submittedAt) : '—'}</p>
                        <div className="mt-1.5 flex items-center justify-between"><FlagBadge flags={r.flags} /><button type="button" onClick={() => open(r)} className="text-xs font-semibold text-brand-primary hover:underline ml-auto">View Profile</button></div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-[760px] w-full text-sm" data-testid="students-table">
                      <thead className="bg-surface-alt border-b border-border-subtle">
                        <tr>
                          <SortHeader label="Student" field="name" q={query} onSort={onSort} />
                          <SortHeader label="Standard" field="standard" q={query} onSort={onSort} />
                          <SortHeader label="Exam" q={query} onSort={onSort} />
                          <SortHeader label="Registration date" field="registered" q={query} onSort={onSort} />
                          <SortHeader label="Exam status" q={query} onSort={onSort} />
                          <SortHeader label="Submission date" field="submissionDate" q={query} onSort={onSort} />
                          <SortHeader label="Action" q={query} onSort={onSort} />
                        </tr>
                      </thead>
                      <tbody>
                        {data.rows.map((r: AnalyticsRow) => (
                          <tr key={r.key} className="border-b border-border-subtle last:border-0 align-top" data-testid="student-row">
                            <td className="px-3 py-2.5 min-w-[10rem]">
                              <button type="button" onClick={() => open(r)} className="font-semibold text-brand-primary hover:underline text-left" data-testid="student-link">{r.name}</button>
                              {r.flags.length > 0 && <div className="mt-1"><FlagBadge flags={r.flags} /></div>}
                            </td>
                            <td className="px-3 py-2.5 whitespace-nowrap">{r.standard ? `Std ${r.standard}` : '—'}</td>
                            <td className="px-3 py-2.5 min-w-[9rem]">{r.examTitle}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap">{r.registeredAt ? formatISTDate(r.registeredAt) : '—'}</td>
                            <td className="px-3 py-2.5"><ExamBadge status={r.examStatus} /></td>
                            <td className="px-3 py-2.5 whitespace-nowrap text-xs">{r.submittedAt ? formatISTDateTime(r.submittedAt) : '—'}</td>
                            <td className="px-3 py-2.5"><button type="button" onClick={() => open(r)} className="text-xs font-semibold text-brand-primary hover:underline whitespace-nowrap">View Profile</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
                {data.rows.length === 0 && (
                  <div className="p-10 text-center text-sm text-text-secondary" data-testid="empty">
                    No students match the selected filters.
                    {filtersDirty || query.search ? <> <button onClick={reset} className="underline font-semibold">Reset filters</button></> : null}
                  </div>
                )}
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-3 text-xs text-text-secondary" data-testid="pagination">
                <span data-testid="total">{data.pagination.total} record{data.pagination.total === 1 ? '' : 's'} · page {data.pagination.page} of {data.pagination.pages}</span>
                <div className="flex gap-2">
                  <button onClick={() => setQuery(q => ({ ...q, page: Math.max(1, data.pagination.page - 1) }))} disabled={data.pagination.page <= 1 || loading} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border-subtle bg-surface-alt disabled:opacity-40" data-testid="prev"><ChevronLeft className="w-3.5 h-3.5" aria-hidden /> Previous</button>
                  <button onClick={() => setQuery(q => ({ ...q, page: Math.min(data.pagination.pages, data.pagination.page + 1) }))} disabled={data.pagination.page >= data.pagination.pages || loading} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border-subtle bg-surface-alt disabled:opacity-40" data-testid="next">Next <ChevronRight className="w-3.5 h-3.5" aria-hidden /></button>
                </div>
              </div>
              <p className="text-[11px] text-text-muted mt-3" data-testid="footnote">
                Cards count unique students; table rows and tab counts are registrations (one student × one exam), so they differ only when several exams are selected.
                “Submitted” means the exam was successfully submitted; a student who started but did not submit is “Not Submitted”. Generated {formatISTDateTime(data.meta.generatedAt)}.
              </p>
            </>
          )}
        </div>
      </main>
      {openStudent && <StudentDrawer key={`${openStudent.id}:${openStudent.examId}`} studentId={openStudent.id} examId={openStudent.examId} onClose={() => setOpenStudent(null)} onChanged={() => setReloadKey(k => k + 1)} />}
    </div>
  );
};

export default AdminOlympiadAnalytics;

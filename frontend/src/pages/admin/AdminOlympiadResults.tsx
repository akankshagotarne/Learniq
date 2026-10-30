import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle, ArrowDown, ArrowUp, Award, CheckCircle2, ChevronLeft, ChevronRight, ClipboardCheck, Crown, Hourglass, Loader2, Percent, RefreshCw, Search, ShieldAlert, Trophy, Users,
} from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import EventSelector from '../../components/olympiad/EventSelector';
import ExportToolbar from '../../components/admin/ExportToolbar';
import ResultDrawer from '../../components/olympiad/results/ResultDrawer';
import { useOlympiadEvent } from '../../hooks/useOlympiadEvent';
import { olympiadErrorMessage } from '../../services/olympiad';
import {
  INTERVIEW_LABEL, RESULT_CLS, RESULT_LABEL, ResultRow, ResultSort, ResultsQuery, ResultsResponse, resultsApi, toResultParams,
} from '../../services/olympiadResults';

const DEFAULT_QUERY: Omit<ResultsQuery, 'event'> = {
  standard: 'all', search: '', interviewStatus: 'all', resultStatus: 'all', minOverall: '', maxOverall: '', minExam: '', finalizedOnly: false,
  sort: 'rank', order: 'asc', rankScope: 'event', page: 1, limit: 25,
};
const selectCls = 'w-full text-sm rounded-xl border border-border-subtle bg-surface px-3 py-2 text-text-primary';
const labelCls = 'block text-[11px] font-semibold text-text-muted mb-1';
const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => <label className="block min-w-0"><span className={labelCls}>{label}</span>{children}</label>;

const useIsNarrow = (maxWidth = 767) => {
  const query = `(max-width: ${maxWidth}px)`;
  const get = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false);
  const [narrow, setNarrow] = useState(get);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const mq = window.matchMedia(query); const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on); on(); return () => mq.removeEventListener('change', on);
  }, [query]);
  return narrow;
};

const marks = (got: number | null, max: number | null) => (got === null || max === null ? null : `${got} / ${max}`);
const pct = (v: number | null) => (v === null ? null : `${v.toFixed(2)}%`);
const Pending: React.FC<{ text?: string }> = ({ text = 'Pending' }) => <span className="text-text-muted text-xs">{text}</span>;

const RankBadge: React.FC<{ row: ResultRow; scope: 'event' | 'standard' }> = ({ row, scope }) => {
  const r = scope === 'standard' ? row.standardRank : row.eventRank;
  if (r === null) return <span className="text-text-muted" title="Needs a scored exam and a submitted interview evaluation">—</span>;
  const tone = r === 1 ? 'bg-[#FEF3C7] text-[#92400E]' : r === 2 ? 'bg-[#E5E7EB] text-[#374151]' : r === 3 ? 'bg-[#FFEDD5] text-[#9A3412]' : 'bg-surface-alt text-text-primary';
  const other = scope === 'standard' ? row.eventRank : row.standardRank;
  return (
    <div className="inline-flex flex-col items-start leading-tight">
      <span className={`inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-bold ${tone}`} data-testid="rank" title={row.tied ? 'Shared rank (tie)' : undefined}>{row.tied && scope === 'event' ? '=' : ''}{r}</span>
      {other !== null && <span className="text-[10px] text-text-muted mt-0.5">{scope === 'standard' ? `Event #${other}` : `Std #${other}`}</span>}
    </div>
  );
};

const StatusChip: React.FC<{ status: ResultRow['resultStatus'] }> = ({ status }) => <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold whitespace-nowrap ${RESULT_CLS[status]}`} data-testid="result-status">{RESULT_LABEL[status]}</span>;

const InterviewCell: React.FC<{ row: ResultRow }> = ({ row }) => (row.interviewMarks === null
  ? <Pending text={INTERVIEW_LABEL[row.interviewStatus]} />
  : <span>{marks(row.interviewMarks, row.interviewMax)} <span className="text-text-muted text-xs">({pct(row.interviewPct)})</span></span>);

const Card: React.FC<{ label: string; value: React.ReactNode; hint?: string; icon: React.FC<any>; tone: string; testId: string }> = ({ label, value, hint, icon: Icon, tone, testId }) => (
  <div className="card-soft p-3.5 rounded-card border border-border-subtle" data-testid={testId}>
    <div className="flex items-start gap-3">
      <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${tone}`}><Icon className="w-4 h-4" aria-hidden /></div>
      <div className="min-w-0">
        <p className="text-2xl font-heading font-bold text-text-primary leading-none" data-testid={`${testId}-value`}>{value}</p>
        <p className="text-xs font-semibold text-text-primary mt-1">{label}</p>
        {hint && <p className="text-[11px] text-text-muted mt-0.5">{hint}</p>}
      </div>
    </div>
  </div>
);

const SortHeader: React.FC<{ label: string; field?: ResultSort; q: ResultsQuery; onSort: (f: ResultSort) => void; className?: string }> = ({ label, field, q, onSort, className = '' }) => {
  const cls = `px-3 py-2.5 text-left text-[11px] font-semibold text-text-muted whitespace-nowrap ${className}`;
  if (!field) return <th className={cls}>{label}</th>;
  const active = q.sort === field;
  return (
    <th className={cls} aria-sort={active ? (q.order === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" onClick={() => onSort(field)} className="inline-flex items-center gap-1 hover:text-text-primary min-h-[32px]">
        {label}{active && (q.order === 'asc' ? <ArrowUp className="w-3 h-3" aria-hidden /> : <ArrowDown className="w-3 h-3" aria-hidden />)}
      </button>
    </th>
  );
};

const PODIUM = ['border-[#F59E0B] bg-[#FFFBEB]', 'border-[#9CA3AF] bg-[#F9FAFB]', 'border-[#EA8A4B] bg-[#FFF7ED]'];

const AdminOlympiadResults: React.FC = () => {
  const ev = useOlympiadEvent();
  const [base, setBase] = useState<Omit<ResultsQuery, 'event'>>(DEFAULT_QUERY);
  const query = useMemo<ResultsQuery>(() => ({ ...base, event: ev.eventId }), [base, ev.eventId]);
  const [searchInput, setSearchInput] = useState('');
  const [data, setData] = useState<ResultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; denied: boolean } | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [open, setOpen] = useState<{ id: string; examId: string } | null>(null);
  const seq = useRef(0);
  const narrow = useIsNarrow();

  useEffect(() => {
    const t = setTimeout(() => setBase(q => (q.search === searchInput.trim() ? q : { ...q, search: searchInput.trim(), page: 1 })), 350);
    return () => clearTimeout(t);
  }, [searchInput]);

  // switching the event returns to page 1; the standard list is the same Std 1-10 for every event, so it is kept
  useEffect(() => { setBase(q => (q.page === 1 ? q : { ...q, page: 1 })); }, [ev.eventId]);

  useEffect(() => {
    if (ev.loading || !ev.eventId) { if (!ev.loading) setLoading(false); return undefined; }
    const mine = ++seq.current; const ctrl = new AbortController();
    setLoading(true); setError(null);
    resultsApi.get(query, ctrl.signal)
      .then(res => { if (mine === seq.current) { setData(res); setLoading(false); } })
      .catch(err => {
        if (mine !== seq.current || err?.code === 'ERR_CANCELED' || err?.name === 'CanceledError') return;
        const status = err?.response?.status;
        setError({ denied: status === 401 || status === 403, message: status === 403 ? 'You do not have permission to view Olympiad results.' : olympiadErrorMessage(err, 'Could not load the results.') });
        setLoading(false);
      });
    return () => ctrl.abort();
  }, [query, reloadKey, ev.loading]);

  const update = useCallback((patch: Partial<Omit<ResultsQuery, 'event'>>) => setBase(q => ({ ...q, page: 1, ...patch })), []);
  const onSort = (field: ResultSort) => setBase(q => ({ ...q, page: 1, sort: field, order: q.sort === field ? (q.order === 'asc' ? 'desc' : 'asc') : (field === 'name' || field === 'standard' || field === 'rank' ? 'asc' : 'desc') }));
  const reset = () => { setSearchInput(''); setBase(DEFAULT_QUERY); };
  const dirty = useMemo(() => JSON.stringify({ ...base, page: 1 }) !== JSON.stringify({ ...DEFAULT_QUERY, page: 1 }), [base]);
  const activeFilters = useMemo(() => {
    const a: string[] = [];
    if (base.standard !== 'all') a.push(`Standard ${base.standard}`);
    if (base.search) a.push(`Search “${base.search}”`);
    if (base.interviewStatus !== 'all') a.push(`Interview: ${INTERVIEW_LABEL[base.interviewStatus as keyof typeof INTERVIEW_LABEL]}`);
    if (base.resultStatus !== 'all') a.push(`Result: ${RESULT_LABEL[base.resultStatus as keyof typeof RESULT_LABEL]}`);
    if (base.finalizedOnly) a.push('Finalized only');
    if (base.minOverall) a.push(`Overall ≥ ${base.minOverall}%`);
    if (base.maxOverall) a.push(`Overall ≤ ${base.maxOverall}%`);
    if (base.minExam) a.push(`Exam ≥ ${base.minExam}%`);
    return a;
  }, [base]);

  const c = data?.cards;
  const ivOn = data ? data.event.interviewIncluded !== false : true; // Exam Only event: no interview columns, filters or cards
  const scopeKind = data?.scope.rankScope ?? base.rankScope;
  const exportParams = useMemo(() => toResultParams(query, false), [query]); // every matching record, in the on-screen order - never just the page
  const pubText = { published: 'Results published to students', partial: 'Results partly published', unpublished: 'Results not published yet', none: 'No exams' } as const;

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-[80rem] mx-auto">
          <div className="mb-5 flex flex-col lg:flex-row lg:items-end justify-between gap-3">
            <div className="min-w-0">
              <p className="text-brand-primary text-xs font-semibold tracking-wide uppercase mb-1">Admin · Olympiad</p>
              <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary flex items-center gap-2" data-testid="page-title"><Trophy className="w-6 h-6 text-brand-primary flex-shrink-0" aria-hidden /> Olympiad Results &amp; Rankings</h1>
              <p className="text-text-secondary text-sm mt-1">View exam performance, interview evaluations, student rankings, and final results.</p>
            </div>
            <div className="flex flex-wrap gap-2 self-start lg:self-auto">
              <ExportToolbar section="olympiad-rankings" params={exportParams} disabled={loading || !data || data.pagination.total === 0 || !ev.eventId} scopeLabel={data ? `${data.pagination.total} students · ${data.scope.label} · rank order` : undefined} />
              <button onClick={() => setReloadKey(k => k + 1)} disabled={loading} className="inline-flex items-center gap-1.5 text-xs font-semibold min-h-[40px] px-3.5 rounded-xl border border-border-subtle bg-surface-alt text-text-primary disabled:opacity-50" data-testid="refresh">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden /> Refresh
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4 items-end">
            <EventSelector value={ev.eventId} options={ev.options} onChange={ev.setEvent} loading={ev.loading} error={ev.error} />
            {data && (
              <p className="text-xs text-text-secondary leading-relaxed" data-testid="event-info">
                <span className="font-semibold text-text-primary">Exam:</span> {data.event.examDateIST || '—'} · {ivOn && <><span className="font-semibold text-text-primary">Interview:</span> {data.event.interviewDate || 'not scheduled'} · </>}{pubText[data.event.publication]}
              </p>
            )}
          </div>

          <div className="card-soft rounded-card border border-border-subtle p-3.5 mb-4" data-testid="filters">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <Field label="Standard">
                <select className={selectCls} value={base.standard} onChange={e => update({ standard: e.target.value })} aria-label="Standard" data-testid="filter-standard">
                  <option value="all">All Standards</option>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map(n => <option key={n} value={String(n)}>Standard {n}</option>)}
                </select>
              </Field>
              <Field label="Ranking scope">
                <select className={selectCls} value={base.rankScope} onChange={e => update({ rankScope: e.target.value as ResultsQuery['rankScope'] })} aria-label="Ranking scope" data-testid="filter-scope">
                  <option value="event">Overall event rank</option><option value="standard">Rank within standard</option>
                </select>
              </Field>
              {ivOn && <Field label="Interview status">
                <select className={selectCls} value={base.interviewStatus} onChange={e => update({ interviewStatus: e.target.value })} aria-label="Interview status" data-testid="filter-interview">
                  <option value="all">All</option>
                  {Object.entries(INTERVIEW_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>}
              <Field label="Result status">
                <select className={selectCls} value={base.resultStatus} onChange={e => update({ resultStatus: e.target.value })} aria-label="Result status" data-testid="filter-result">
                  <option value="all">All</option>
                  {Object.entries(RESULT_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </Field>
              <Field label="Min overall %"><input type="number" min={0} max={100} className={selectCls} value={base.minOverall} onChange={e => update({ minOverall: e.target.value })} aria-label="Minimum overall percentage" data-testid="filter-min" /></Field>
              <Field label="Max overall %"><input type="number" min={0} max={100} className={selectCls} value={base.maxOverall} onChange={e => update({ maxOverall: e.target.value })} aria-label="Maximum overall percentage" data-testid="filter-max" /></Field>
              <Field label="Min exam %"><input type="number" min={0} max={100} className={selectCls} value={base.minExam} onChange={e => update({ minExam: e.target.value })} aria-label="Minimum exam percentage" data-testid="filter-minexam" /></Field>
              <label className="flex items-center gap-2 text-sm text-text-primary self-end min-h-[40px]"><input type="checkbox" checked={base.finalizedOnly} onChange={e => update({ finalizedOnly: e.target.checked })} className="w-4 h-4" data-testid="filter-finalized" /> Finalized results only</label>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 mt-3">
              <p className="text-xs text-text-muted min-w-0" data-testid="active-filters">
                Showing: <span className="font-semibold text-text-secondary">{data ? data.scope.label : '…'}</span> · <span className="font-semibold text-text-secondary">{data ? data.scope.rankScopeLabel : ''}</span>
                {activeFilters.length > 0 && <> · Filters: {activeFilters.join(' · ')}</>}
              </p>
              <button onClick={reset} disabled={!dirty && !searchInput} className="text-xs font-semibold min-h-[36px] px-3 rounded-xl border border-border-subtle bg-surface-alt text-text-primary disabled:opacity-50" data-testid="reset-filters">Reset filters</button>
            </div>
          </div>

          {error && (
            <div className="rounded-xl border border-[#F9A8C0] bg-[#FFE4EC] p-4 mb-5 text-sm text-[#9D174D]" role="alert" data-testid="error">
              <p className="flex items-center gap-2 font-semibold">{error.denied ? <ShieldAlert className="w-4 h-4" aria-hidden /> : <AlertTriangle className="w-4 h-4" aria-hidden />} {error.message}</p>
              {!error.denied && <button onClick={() => setReloadKey(k => k + 1)} className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-border-subtle text-text-primary">Try again</button>}
            </div>
          )}

          {!error && !ev.loading && ev.options.length === 0 && <div className="card-soft p-10 text-center text-sm text-text-secondary rounded-card border border-border-subtle" data-testid="no-events">No Olympiad events exist yet.</div>}
          {!error && !data && loading && <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5" data-testid="cards-loading" aria-busy="true">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="card-soft rounded-card border border-border-subtle h-[84px] animate-pulse bg-surface-alt" />)}</div>}

          {!error && data && c && (
            <>
              {data.notices.pendingResults > 0 && (
                <div className="rounded-xl border border-[#FDBA74] bg-[#FFF7ED] p-3 mb-4 text-xs text-[#9A3412] flex items-start gap-2" data-testid="pending-banner">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" aria-hidden />
                  <span>Some student results are still pending ({data.notices.pendingResults}). Final rankings may change after all required evaluations are completed.{data.notices.needsReview > 0 && ` ${data.notices.needsReview} record(s) need review (the data does not line up); nothing was changed automatically.`}</span>
                </div>
              )}

              <div className={`grid grid-cols-2 lg:grid-cols-3 gap-3 mb-5 transition-opacity ${loading ? 'opacity-60' : ''}`} data-testid="cards">
                <Card testId="card-registered" label="Total Registered Students" value={c.registered} icon={Users} tone="bg-[#EDE9FE] text-[#6C63F2]" hint="Confirmed registrations" />
                <Card testId="card-submitted" label="Exams Submitted" value={c.examsSubmitted} icon={ClipboardCheck} tone="bg-[#DCFCE7] text-[#16A34A]" hint="Students who submitted" />
                {ivOn && <Card testId="card-interviews" label="Interviews Completed" value={c.interviewsCompleted} icon={CheckCircle2} tone="bg-[#CCFBF1] text-[#0D9488]" hint="Evaluation submitted" />}
                <Card testId="card-finalized" label="Results Finalized" value={c.resultsFinalized} icon={Award} tone="bg-[#FEF3C7] text-[#D97706]" hint={ivOn ? 'Exam + interview complete' : 'Exam scored'} />
                {ivOn && <Card testId="card-pending" label="Interviews Pending" value={c.interviewsPending} icon={Hourglass} tone="bg-[#FFE4EC] text-[#E1447A]" hint="Submitted, interview not done" />}
                <Card testId="card-average" label="Average Overall Percentage" value={c.averageOverallPct === null ? '—' : `${c.averageOverallPct}%`} icon={Percent} tone="bg-[#E0F2FE] text-[#0284C7]" hint={c.highestOverallPct === null ? 'No finalized results yet' : `Highest ${c.highestOverallPct}%`} />
              </div>

              <section className="mb-5" data-testid="top-rankers" aria-label="Top rankers">
                <h2 className="font-heading font-bold text-lg text-text-primary flex items-center gap-2 mb-2"><Crown className="w-5 h-5 text-[#D97706]" aria-hidden /> Top Rankers <span className="text-xs font-semibold text-text-muted">· {data.topRankers.label}</span></h2>
                {data.topRankers.rows.length === 0
                  ? <div className="card-soft rounded-card border border-border-subtle p-5 text-sm text-text-secondary" data-testid="top-empty">No finalized results yet for this selection. Rankers appear once a student’s exam is scored and their interview evaluation is submitted.</div>
                  : (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {data.topRankers.rows.map(r => {
                        const rank = data.topRankers.scope === 'event' ? r.eventRank : r.standardRank;
                        return (
                          <button key={r.key} type="button" onClick={() => setOpen({ id: r.studentId, examId: r.examId })} className={`text-left rounded-card border-2 p-3.5 ${PODIUM[(rank || 1) - 1] || 'border-border-subtle bg-surface'}`} data-testid="top-card">
                            <div className="flex items-center justify-between gap-2"><span className="text-xs font-bold text-text-primary">Rank {rank}</span><span className="text-[11px] text-text-muted">{r.standardLabel}</span></div>
                            <p className="font-heading font-bold text-text-primary mt-1 break-words">{r.name}</p>
                            <p className="text-2xl font-heading font-bold text-brand-primary mt-1">{pct(r.overallPct)}</p>
                            <p className="text-[11px] text-text-secondary mt-1">Exam {marks(r.examMarks, r.examMax)} {ivOn && <>· Interview {marks(r.interviewMarks, r.interviewMax)}</>}</p>
                          </button>
                        );
                      })}
                    </div>
                  )}
              </section>

              <div className="flex flex-col sm:flex-row gap-3 mb-3">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" aria-hidden />
                  <input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder="Search by student name" className={`${selectCls} pl-9`} aria-label="Search students" data-testid="search" />
                </div>
                <select className={`${selectCls} sm:w-32`} value={base.limit} onChange={e => update({ limit: Number(e.target.value) })} aria-label="Rows per page" data-testid="page-size">
                  {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n} / page</option>)}
                </select>
              </div>

              <div className={`card-soft rounded-card border border-border-subtle overflow-hidden relative ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
                {loading && <div className="absolute top-2 right-3 z-10 text-xs text-text-secondary flex items-center gap-1"><Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> Updating…</div>}
                {data.rows.length > 0 && (narrow ? (
                  <ul className="divide-y divide-border-subtle" data-testid="results-list">
                    {data.rows.map(r => (
                      <li key={r.key} className="p-3" data-testid="result-row">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0"><button type="button" onClick={() => setOpen({ id: r.studentId, examId: r.examId })} className="font-semibold text-brand-primary text-left break-words" data-testid="student-link">{r.name}</button><p className="text-xs text-text-secondary">{r.standardLabel}</p></div>
                          <RankBadge row={r} scope={scopeKind} />
                        </div>
                        <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs mt-2">
                          <dt className="text-text-muted">Exam</dt><dd>{marks(r.examMarks, r.examMax) ? <>{marks(r.examMarks, r.examMax)} <span className="text-text-muted">({pct(r.examPct)})</span></> : <Pending text={r.examSubmitted ? 'Awaiting evaluation' : 'Not submitted'} />}</dd>
                          {ivOn && <><dt className="text-text-muted">Interview</dt><dd><InterviewCell row={r} /></dd></>}
                          <dt className="text-text-muted">Overall</dt><dd className="font-semibold">{marks(r.overallMarks, r.overallMax) ? <>{marks(r.overallMarks, r.overallMax)} ({pct(r.overallPct)})</> : <Pending />}</dd>
                          <dt className="text-text-muted">Result</dt><dd><StatusChip status={r.resultStatus} /></dd>
                        </dl>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="min-w-[1080px] w-full text-sm" data-testid="results-table">
                      <thead className="bg-surface-alt border-b border-border-subtle">
                        <tr>
                          <SortHeader label={scopeKind === 'standard' ? 'Std rank' : 'Rank'} field="rank" q={query} onSort={onSort} />
                          <SortHeader label="Student" field="name" q={query} onSort={onSort} />
                          <SortHeader label="Std" field="standard" q={query} onSort={onSort} />
                          <SortHeader label="Exam marks" q={query} onSort={onSort} />
                          <SortHeader label="Exam %" field="exam" q={query} onSort={onSort} />
                          {ivOn && <SortHeader label="Interview marks" q={query} onSort={onSort} />}
                          {ivOn && <SortHeader label="Interview %" field="interview" q={query} onSort={onSort} />}
                          <SortHeader label="Overall marks" q={query} onSort={onSort} />
                          <SortHeader label="Overall %" field="overall" q={query} onSort={onSort} />
                          {ivOn && <SortHeader label="Interview status" q={query} onSort={onSort} />}
                          <SortHeader label="Result" q={query} onSort={onSort} />
                          <SortHeader label="Actions" q={query} onSort={onSort} />
                        </tr>
                      </thead>
                      <tbody>
                        {data.rows.map(r => (
                          <tr key={r.key} className="border-b border-border-subtle last:border-0 align-top" data-testid="result-row">
                            <td className="px-3 py-2.5"><RankBadge row={r} scope={scopeKind} /></td>
                            <td className="px-3 py-2.5 min-w-[9rem]"><button type="button" onClick={() => setOpen({ id: r.studentId, examId: r.examId })} className="font-semibold text-brand-primary hover:underline text-left" data-testid="student-link">{r.name}</button></td>
                            <td className="px-3 py-2.5 whitespace-nowrap">{r.standard}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap">{marks(r.examMarks, r.examMax) || <Pending text={r.examSubmitted ? 'Awaiting evaluation' : 'Not submitted'} />}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap">{pct(r.examPct) || '—'}</td>
                            {ivOn && <td className="px-3 py-2.5 whitespace-nowrap">{marks(r.interviewMarks, r.interviewMax) || <Pending />}</td>}
                            {ivOn && <td className="px-3 py-2.5 whitespace-nowrap">{pct(r.interviewPct) || '—'}</td>}
                            <td className="px-3 py-2.5 whitespace-nowrap font-semibold">{marks(r.overallMarks, r.overallMax) || <Pending />}</td>
                            <td className="px-3 py-2.5 whitespace-nowrap font-semibold">{pct(r.overallPct) || '—'}</td>
                            {ivOn && <td className="px-3 py-2.5 whitespace-nowrap text-xs">{INTERVIEW_LABEL[r.interviewStatus]}</td>}
                            <td className="px-3 py-2.5"><StatusChip status={r.resultStatus} /></td>
                            <td className="px-3 py-2.5"><button type="button" onClick={() => setOpen({ id: r.studentId, examId: r.examId })} className="text-xs font-semibold text-brand-primary hover:underline whitespace-nowrap">View details</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ))}
                {data.rows.length === 0 && (
                  <div className="p-10 text-center text-sm text-text-secondary" data-testid="empty">
                    {data.cards.registered === 0 ? 'No students have registered for this event yet, so there are no results to show.' : 'No students match the selected filters.'}
                    {dirty || searchInput ? <> <button onClick={reset} className="underline font-semibold">Reset filters</button></> : null}
                  </div>
                )}
              </div>

              <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-3 text-xs text-text-secondary" data-testid="pagination">
                <span data-testid="total">{data.pagination.total} record{data.pagination.total === 1 ? '' : 's'} · page {data.pagination.page} of {data.pagination.pages}</span>
                <div className="flex gap-2">
                  <button onClick={() => setBase(q => ({ ...q, page: Math.max(1, data.pagination.page - 1) }))} disabled={data.pagination.page <= 1 || loading} className="inline-flex items-center gap-1 px-3 min-h-[40px] rounded-lg border border-border-subtle bg-surface disabled:opacity-40"><ChevronLeft className="w-4 h-4" aria-hidden /> Previous</button>
                  <button onClick={() => setBase(q => ({ ...q, page: Math.min(data.pagination.pages, data.pagination.page + 1) }))} disabled={data.pagination.page >= data.pagination.pages || loading} className="inline-flex items-center gap-1 px-3 min-h-[40px] rounded-lg border border-border-subtle bg-surface disabled:opacity-40">Next <ChevronRight className="w-4 h-4" aria-hidden /></button>
                </div>
              </div>
              <p className="text-[11px] text-text-muted mt-3" data-testid="ranking-note">{data.notices.ranking} Downloads contain every matching student in this order, not only the current page.</p>
            </>
          )}
        </div>
      </main>
      {open && <ResultDrawer studentId={open.id} examId={open.examId} eventId={ev.eventId} onClose={() => setOpen(null)} />}
    </div>
  );
};

export default AdminOlympiadResults;

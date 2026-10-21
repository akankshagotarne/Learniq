import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Crown, RefreshCw, Search, Trophy, AlertCircle, Loader2 } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import { avatarSrc } from '../../utils/avatar';
import {
  studentLeaderboardApi, LeaderboardExam, LeaderboardPerson, LeaderboardResponse,
} from '../../services/studentLeaderboard';

const PAGE = 20;
const fmt = (n: number | null | undefined, digits = 2) => (n === null || n === undefined ? '—' : `${Number(n.toFixed(digits))}`);
const pct = (n: number | null | undefined) => (n === null || n === undefined ? '—' : `${fmt(n)}%`);
const marks = (m: number | null, max: number | null) => (m === null || max === null ? '—' : `${fmt(m, 2)} / ${fmt(max, 2)}`);
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';
const errMessage = (e: any, fallback: string) => e?.response?.data?.message || fallback;

const MEDAL: Record<number, { label: string; ring: string; chip: string; height: string }> = {
  1: { label: 'Gold', ring: 'ring-[#F5B301]', chip: 'bg-[#F5B301] text-[#4a3400]', height: 'h-36 sm:h-44' },
  2: { label: 'Silver', ring: 'ring-[#B8BECC]', chip: 'bg-[#B8BECC] text-[#2b3040]', height: 'h-28 sm:h-32' },
  3: { label: 'Bronze', ring: 'ring-[#CD7F32]', chip: 'bg-[#CD7F32] text-white', height: 'h-24 sm:h-28' },
};
const medalOf = (rank: number) => MEDAL[rank] || MEDAL[3];

const Avatar: React.FC<{ p: LeaderboardPerson; size: number; className?: string }> = ({ p, size, className = '' }) => {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  if (!p.avatar || broken) {
    return (
      <span aria-hidden="true" style={style} className={`inline-flex items-center justify-center rounded-full bg-primary/15 text-primary font-bold shrink-0 ${className}`}>
        <span style={{ fontSize: size * 0.38 }}>{initials(p.name)}</span>
      </span>
    );
  }
  return <img src={avatarSrc(p.name, p.avatar, size * 2)} alt="" style={style} className={`rounded-full object-cover shrink-0 ${className}`} onError={() => setBroken(true)} />;
};

const PodiumCard: React.FC<{ p: LeaderboardPerson; first?: boolean }> = ({ p, first }) => {
  const m = medalOf(p.rank);
  return (
    <li data-testid={`podium-${p.rank}`} className="flex flex-col items-center min-w-0 flex-1" aria-label={`Rank ${p.rank}, ${p.name}, ${pct(p.overallPct)} overall`}>
      <div className="relative mb-2">
        {first && <Crown className="absolute -top-6 left-1/2 -translate-x-1/2 w-7 h-7 text-[#F5B301] fill-[#F5B301]" aria-hidden="true" data-testid="podium-crown" />}
        <Avatar p={p} size={first ? 84 : 64} className={`ring-4 ${m.ring}`} />
        <span className={`absolute -bottom-2 left-1/2 -translate-x-1/2 text-xs font-bold rounded-full px-2 py-0.5 ${m.chip}`}>{p.rank}</span>
      </div>
      <p className="mt-2 text-sm font-semibold text-text-primary text-center max-w-full truncate px-1" title={p.name}>
        {p.name}{p.isYou && <span className="ml-1 text-primary">(You)</span>}
      </p>
      <p className="text-xs text-text-secondary">{pct(p.overallPct)} overall</p>
      <p className="text-[11px] text-text-muted">{marks(p.examMarks, p.examMax)}</p>
      <div className={`mt-2 w-full rounded-t-2xl bg-gradient-to-b from-[#6C63F2] to-[#4B43C8] text-white flex items-start justify-center pt-2 text-2xl font-heading font-bold ${m.height}`} aria-hidden="true">{p.rank}</div>
    </li>
  );
};

const Stat: React.FC<{ label: string; value: React.ReactNode; testid?: string }> = ({ label, value, testid }) => (
  <div className="rounded-2xl bg-surface-alt p-3 sm:p-4 min-w-0">
    <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold">{label}</p>
    <p data-testid={testid} className="mt-1 text-lg sm:text-xl font-heading font-bold text-text-primary truncate">{value}</p>
  </div>
);

const StudentLeaderboardPage: React.FC = () => {
  const [exams, setExams] = useState<LeaderboardExam[] | null>(null);
  const [standardLabel, setStandardLabel] = useState('');
  const [examId, setExamId] = useState('');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loadingList, setLoadingList] = useState(true);
  const [loadingBoard, setLoadingBoard] = useState(false);
  const [listError, setListError] = useState('');
  const [boardError, setBoardError] = useState<{ code?: string; message: string } | null>(null);
  const seq = useRef(0);

  const loadExams = useCallback(async () => {
    setLoadingList(true); setListError('');
    try {
      const r = await studentLeaderboardApi.exams();
      setExams(r.exams); setStandardLabel(r.standardLabel);
      setExamId((cur) => (r.exams.some((e) => e.id === cur) ? cur : (r.exams[0]?.id || '')));
    } catch (e: any) {
      setListError(errMessage(e, 'Could not load the leaderboard. Check your connection and try again.'));
    } finally { setLoadingList(false); }
  }, []);
  useEffect(() => { loadExams(); }, [loadExams]);

  // debounce the in-standard name search
  useEffect(() => { const t = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 300); return () => clearTimeout(t); }, [search]);

  const loadBoard = useCallback(async () => {
    if (!examId) { setData(null); return; }
    const mine = ++seq.current;
    setLoadingBoard(true); setBoardError(null);
    try {
      const r = await studentLeaderboardApi.board({ exam: examId, page, limit: PAGE, search: query });
      if (mine === seq.current) setData(r);
    } catch (e: any) {
      if (mine !== seq.current) return;
      setData(null);
      setBoardError({ code: e?.response?.data?.code, message: errMessage(e, 'Could not load the rankings. Please try again.') });
    } finally { if (mine === seq.current) setLoadingBoard(false); }
  }, [examId, page, query]);
  useEffect(() => { loadBoard(); }, [loadBoard]);

  const changeExam = (id: string) => { setExamId(id); setPage(1); setData(null); setSearch(''); setQuery(''); };
  const perf = data?.performance;
  const showInterview = !!data?.rows.some((r) => r.interviewMarks !== null) || !!data?.podium.some((r) => r.interviewMarks !== null);
  const podium = data?.podium.slice(0, 3) || [];
  const podiumOrder = podium.length >= 3 ? [podium[1], podium[0], podium[2]] : podium.length === 2 ? [podium[1], podium[0]] : podium;
  const notAnnounced = boardError?.code === 'RESULTS_NOT_PUBLISHED';

  return (
    <div className="flex min-h-screen bg-page transition-colors">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto" data-testid="leaderboard-page">
          <header className="mb-6">
            <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">🏆 LearnIQ Leaderboard</h1>
            <p className="text-text-secondary text-sm mt-1">Celebrate the achievements of top-performing students in your standard.</p>
            {standardLabel && <p data-testid="your-standard" className="mt-2 inline-block rounded-full bg-primary/10 text-primary text-xs font-semibold px-3 py-1">Your Standard: {standardLabel}</p>}
          </header>

          {loadingList ? (
            <div data-testid="leaderboard-loading" className="card-soft p-10 flex items-center justify-center text-text-secondary text-sm"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading leaderboard…</div>
          ) : listError ? (
            <div role="alert" data-testid="leaderboard-error" className="card-soft p-8 text-center">
              <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-2" />
              <p className="text-text-primary text-sm font-medium mb-3">{listError}</p>
              <button type="button" onClick={loadExams} className="btn-primary px-4 py-2 rounded-xl text-sm" data-testid="leaderboard-retry">Retry</button>
            </div>
          ) : !exams || exams.length === 0 ? (
            <div data-testid="leaderboard-empty" className="card-soft p-10 text-center">
              <Trophy className="w-12 h-12 text-text-muted mx-auto mb-3" />
              <p className="text-text-primary font-medium">No leaderboard results are available for this examination yet.</p>
              <p className="text-text-secondary text-sm mt-1">Rankings appear here once your standard's results are announced.</p>
            </div>
          ) : (
            <>
              <section className="card-soft p-4 sm:p-5 mb-6 flex flex-col sm:flex-row sm:items-end gap-3">
                <div className="flex-1 min-w-0">
                  <label htmlFor="lb-exam" className="block text-xs font-semibold text-text-muted mb-1">Select Examination</label>
                  <select id="lb-exam" data-testid="leaderboard-exam" value={examId} onChange={(e) => changeExam(e.target.value)}
                    className="w-full rounded-xl border border-border bg-surface text-text-primary text-sm px-3 py-2.5">
                    {exams.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <button type="button" onClick={() => { loadExams(); loadBoard(); }} disabled={loadingBoard} data-testid="leaderboard-refresh"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm text-text-primary hover:bg-surface-alt disabled:opacity-60">
                  <RefreshCw className={`w-4 h-4 ${loadingBoard ? 'animate-spin' : ''}`} />Refresh
                </button>
              </section>

              {boardError ? (
                <div role="alert" data-testid={notAnnounced ? 'leaderboard-not-announced' : 'leaderboard-board-error'} className="card-soft p-8 text-center">
                  {notAnnounced ? <Trophy className="w-10 h-10 text-text-muted mx-auto mb-2" /> : <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-2" />}
                  <p className="text-text-primary text-sm font-medium mb-3">{boardError.message}</p>
                  {!notAnnounced && <button type="button" onClick={loadBoard} className="btn-primary px-4 py-2 rounded-xl text-sm" data-testid="leaderboard-retry">Retry</button>}
                </div>
              ) : !data ? (
                <div data-testid="leaderboard-loading" className="card-soft p-10 flex items-center justify-center text-text-secondary text-sm"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading rankings…</div>
              ) : data.participants === 0 ? (
                <div data-testid="leaderboard-empty" className="card-soft p-10 text-center">
                  <Trophy className="w-12 h-12 text-text-muted mx-auto mb-3" />
                  <p className="text-text-primary font-medium">No leaderboard results are available for this examination yet.</p>
                </div>
              ) : (
                <div className={loadingBoard ? 'opacity-60 transition-opacity' : ''} aria-busy={loadingBoard}>
                  <section className="card-soft p-4 sm:p-5 mb-6" aria-labelledby="lb-perf" data-testid="your-performance">
                    <h2 id="lb-perf" className="font-heading font-semibold text-lg text-text-primary mb-3">Your Performance</h2>
                    {perf?.status === 'RANKED' ? (
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                        <Stat label="Your Rank" value={`${perf.rank} of ${perf.participants}`} testid="perf-rank" />
                        <Stat label="Exam Marks" value={marks(perf.examMarks, perf.examMax)} testid="perf-exam-marks" />
                        <Stat label="Exam %" value={pct(perf.examPct)} />
                        <Stat label="Overall %" value={pct(perf.overallPct)} testid="perf-overall" />
                        <Stat label="Participants" value={perf.participants} />
                        <Stat label="Students Ahead" value={perf.ahead} testid="perf-ahead" />
                      </div>
                    ) : (
                      <p data-testid="perf-not-ranked" className="text-sm text-text-secondary">You are not on this leaderboard — a rank needs a completed exam and a completed, published interview.</p>
                    )}
                  </section>

                  <section className="card-soft p-4 sm:p-5 mb-6" aria-labelledby="lb-top">
                    <h2 id="lb-top" className="font-heading font-semibold text-lg text-text-primary mb-6">Top Three Champions</h2>
                    <ol data-testid="podium" className="flex items-end justify-center gap-2 sm:gap-6 pt-6">
                      {podiumOrder.map((p, i) => <PodiumCard key={`${p.rank}-${p.name}-${i}`} p={p} first={p === podium[0]} />)}
                    </ol>
                  </section>

                  <section className="card-soft p-4 sm:p-5" aria-labelledby="lb-rank">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
                      <div>
                        <h2 id="lb-rank" className="font-heading font-semibold text-lg text-text-primary">Leaderboard Rankings</h2>
                        <p className="text-text-secondary text-sm">See how students are performing in your standard.</p>
                      </div>
                      <div className="relative sm:w-64">
                        <Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                        <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name" aria-label="Search students in your standard" data-testid="leaderboard-search"
                          className="w-full rounded-xl border border-border bg-surface text-text-primary text-sm pl-9 pr-3 py-2" />
                      </div>
                    </div>

                    {data.rows.length === 0 ? (
                      <p data-testid="leaderboard-no-match" className="text-sm text-text-secondary py-6 text-center">No students match “{data.search}”.</p>
                    ) : (
                      <>
                        {/* desktop / tablet table */}
                        <div className="hidden md:block overflow-x-auto">
                          <table className="w-full text-sm" data-testid="leaderboard-table">
                            <thead>
                              <tr className="text-left text-xs uppercase tracking-wide text-text-muted border-b border-border">
                                <th scope="col" className="py-2 pr-3">Rank</th><th scope="col" className="py-2 pr-3">Student</th>
                                <th scope="col" className="py-2 pr-3">Exam Marks</th><th scope="col" className="py-2 pr-3">Exam %</th>
                                {showInterview && <th scope="col" className="py-2 pr-3">Interview Marks</th>}
                                <th scope="col" className="py-2">Overall %</th>
                              </tr>
                            </thead>
                            <tbody>
                              {data.rows.map((r, i) => (
                                <tr key={`${r.rank}-${i}`} data-testid="leaderboard-row" aria-current={r.isYou ? 'true' : undefined}
                                  className={`border-b border-border/60 ${r.isYou ? 'bg-primary/10' : ''}`}>
                                  <td className="py-3 pr-3 font-bold text-text-primary">#{r.rank}</td>
                                  <td className="py-3 pr-3"><span className="flex items-center gap-2 min-w-0"><Avatar p={r} size={32} /><span className="truncate text-text-primary">{r.name}</span>
                                    {r.isYou && <span className="rounded-full bg-primary text-white text-[10px] font-bold px-2 py-0.5">You</span>}</span></td>
                                  <td className="py-3 pr-3 text-text-primary">{marks(r.examMarks, r.examMax)}</td>
                                  <td className="py-3 pr-3 text-text-primary">{pct(r.examPct)}</td>
                                  {showInterview && <td className="py-3 pr-3 text-text-primary">{marks(r.interviewMarks, r.interviewMax)}</td>}
                                  <td className="py-3 font-semibold text-text-primary">{pct(r.overallPct)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        {/* mobile cards */}
                        <ul className="md:hidden space-y-3" data-testid="leaderboard-cards">
                          {data.rows.map((r, i) => (
                            <li key={`${r.rank}-${i}`} data-testid="leaderboard-card" className={`rounded-2xl border border-border p-3 ${r.isYou ? 'bg-primary/10 border-primary/40' : 'bg-surface'}`}>
                              <div className="flex items-center gap-3 min-w-0">
                                <span className="text-lg font-bold text-text-primary w-10 shrink-0">#{r.rank}</span>
                                <Avatar p={r} size={36} />
                                <span className="font-medium text-text-primary truncate min-w-0 flex-1">{r.name}</span>
                                {r.isYou && <span className="rounded-full bg-primary text-white text-[10px] font-bold px-2 py-0.5">You</span>}
                              </div>
                              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                                <div><dt className="text-text-muted">Exam Marks</dt><dd className="text-text-primary font-medium">{marks(r.examMarks, r.examMax)}</dd></div>
                                <div><dt className="text-text-muted">Exam %</dt><dd className="text-text-primary font-medium">{pct(r.examPct)}</dd></div>
                                {showInterview && <div><dt className="text-text-muted">Interview Marks</dt><dd className="text-text-primary font-medium">{marks(r.interviewMarks, r.interviewMax)}</dd></div>}
                                <div><dt className="text-text-muted">Overall %</dt><dd className="text-text-primary font-bold">{pct(r.overallPct)}</dd></div>
                              </dl>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}

                    {data.pagination.pages > 1 && (
                      <nav className="flex items-center justify-between gap-3 mt-4" aria-label="Leaderboard pages">
                        <button type="button" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={data.pagination.page <= 1 || loadingBoard} data-testid="leaderboard-prev"
                          className="rounded-xl border border-border px-4 py-2 text-sm text-text-primary disabled:opacity-50">Previous</button>
                        <span className="text-xs text-text-secondary" data-testid="leaderboard-page-info">Page {data.pagination.page} of {data.pagination.pages}</span>
                        <button type="button" onClick={() => setPage((p) => Math.min(data.pagination.pages, p + 1))} disabled={data.pagination.page >= data.pagination.pages || loadingBoard} data-testid="leaderboard-next"
                          className="rounded-xl border border-border px-4 py-2 text-sm text-text-primary disabled:opacity-50">Next</button>
                      </nav>
                    )}
                  </section>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default StudentLeaderboardPage;

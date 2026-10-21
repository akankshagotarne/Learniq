import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ClipboardList, Clock, HelpCircle, CheckCircle2, AlertCircle,
  Calendar, Award, ChevronRight, Filter, Search, RotateCcw,
  Sparkles, CheckCircle, Flame, BookOpen, Lock
} from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { Exam } from '../../types';
import { useAuth } from '../../context/AuthContext';
import { olympiadApi } from '../../services/olympiad';
import { interviewApi, interviewErrorMessage, StudentExamInterview } from '../../services/interview';
import { useInterviewLive } from '../../hooks/useInterviewLive';
import toast from 'react-hot-toast';
import { olympiadTab, regularTabs, hasValidStandard, type ExamTab } from '../../utils/examTabs';
import { OlympiadExam, isResultReleased } from '../../types/olympiad';
import OlympiadExamCard from '../../components/olympiad/OlympiadExamCard';
import OlympiadInterviewCard from '../../components/olympiad/OlympiadInterviewCard';
import { referralApi } from '../../services/referrals';
import { useExamCheckout } from '../../components/olympiad/useExamCheckout';
import { standardLabel } from '../../constants/standards';

const getSubjectBadgeClass = (subject: string) => {
  const s = subject.toLowerCase();
  if (s.includes('math')) return 'badge-subject-math';
  if (s.includes('science') || s.includes('evs')) return 'badge-subject-science';
  if (s.includes('marathi') || s.includes('english') || s.includes('language')) return 'badge-subject-languages';
  return 'badge-primary';
};

const StudentExamsPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [exams, setExams] = useState<Exam[]>([]);
  const [olympiadExams, setOlympiadExams] = useState<OlympiadExam[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<ExamTab>('available');
  const [selectedSubject, setSelectedSubject] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');
  const [interviews, setInterviews] = useState<Record<string, StudentExamInterview>>({});
  const [interviewBusyId, setInterviewBusyId] = useState<string | null>(null);

  const [creditBalance, setCreditBalance] = useState(0);
  const loadBalance = async () => { try { setCreditBalance(await referralApi.balance()); } catch { /* credits are optional: buttons fall back to paying */ } };
  useEffect(() => { loadBalance(); }, [user]);

  const loadInterviews = async () => {
    try { setInterviews((await interviewApi.mine()).byExam || {}); } catch { /* the card simply shows no interview offer */ }
  };
  useEffect(() => { loadInterviews(); }, [user]);
  useInterviewLive(loadInterviews, { pollMs: 20000 });

  const startInterview = async (exam: OlympiadExam) => {
    setInterviewBusyId(exam._id);
    try {
      const iv = await interviewApi.request(exam._id);
      navigate(`/student/interview/${iv._id}`);
    } catch (err) {
      toast.error(interviewErrorMessage(err));
      loadInterviews();
    } finally { setInterviewBusyId(null); }
  };

  useEffect(() => {
    fetchExams();
  }, [user]);

  const fetchOlympiad = async () => {
    try {
      const list = await olympiadApi.listExams();
      setOlympiadExams(list);
      // A payment that was taken but not yet confirmed (closed tab / network drop) is reconciled silently.
      const pending = list.filter(o => o.paymentStatus === 'PENDING');
      if (pending.length > 0) {
        const results = await Promise.all(pending.map(o => olympiadApi.paymentStatus(o._id).catch(() => null)));
        if (results.some(r => r?.unlocked)) setOlympiadExams(await olympiadApi.listExams());
      }
    } catch (err) {
      console.error('Failed to fetch Olympiad exams', err);
      setOlympiadExams([]);
    }
  };

  // Time-aware refresh: when the next opening / closing / registration instant arrives, and whenever the tab becomes visible again,
  // re-ask the server (it stays authoritative). No reload and no re-registration is needed for "Start" to appear.
  useEffect(() => {
    const now = Date.now();
    const instants = olympiadExams.flatMap(o => [o.startDate, o.endDate, o.registrationOpensAt, o.registrationClosesAt])
      .map(v => (v ? new Date(v).getTime() : NaN)).filter(t => Number.isFinite(t) && t > now);
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (instants.length) timer = setTimeout(() => { fetchOlympiad(); }, Math.min(Math.min(...instants) - now + 1500, 2_000_000_000));
    const onVisible = () => { if (document.visibilityState === 'visible') fetchOlympiad(); };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => { if (timer) clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible); };
  }, [olympiadExams]);

  const fetchExams = async () => {
    setLoading(true);
    try {
      const [res] = await Promise.all([
        // the backend scopes this list to the signed-in student's own saved standard (nothing is sent from the browser)
        api.get('/exams').catch(err => {
          console.error('Failed to fetch exams', err);
          return { data: { exams: [] } };
        }),
        fetchOlympiad(),
      ]);
      setExams(res.data.exams || []);
    } finally {
      setLoading(false);
    }
  };

  // Each component is unlocked on its own. The server returns the authoritative state; we only refresh it.
  const { unlockWithCredit, unlockWithPayment, busyId: payingId, dialog: checkoutDialog } = useExamCheckout(async (examId, component) => {
    if (component === 'EXAM') { navigate(`/student/olympiad/${examId}`); return; }
    await Promise.all([fetchOlympiad(), loadInterviews(), loadBalance()]);
  });

  const hasOlympiad = olympiadExams.length > 0;
  // The tab comes from the backend's exam AND interview status: a submitted exam whose interview is not finished stays Available
  const olympiadAvailable = olympiadExams.filter(o => olympiadTab(o, interviews[o._id]) === 'available');
  const olympiadUpcoming = olympiadExams.filter(o => olympiadTab(o, interviews[o._id]) === 'upcoming');
  const olympiadCompleted = olympiadExams.filter(o => olympiadTab(o, interviews[o._id]) === 'completed');
  const olympiadExpired = olympiadExams.filter(o => olympiadTab(o, interviews[o._id]) === 'expired');
  const standardMissing = !hasValidStandard(user?.currentStandard);

  // Unique subjects
  const subjects = ['All', ...(hasOlympiad ? ['Olympiad'] : []), ...Array.from(new Set(exams.map(e => e.subject)))];

  // Filtering
  const filteredExams = exams.filter(e => {
    const matchesSubject = selectedSubject === 'All' || e.subject === selectedSubject;
    const matchesSearch = e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.chapter && e.chapter.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSubject || !matchesSearch) return false;

    return regularTabs(e).includes(activeTab); // same rules as the backend (an attempted exam is never Expired)
  });

  // Olympiad cards follow the same tab / subject / search controls
  const tabOlympiad = activeTab === 'available' ? olympiadAvailable : activeTab === 'upcoming' ? olympiadUpcoming : activeTab === 'expired' ? olympiadExpired : olympiadCompleted;
  const q = searchQuery.trim().toLowerCase();
  const filteredOlympiad = tabOlympiad.filter(o =>
    (selectedSubject === 'All' || selectedSubject === 'Olympiad') &&
    (!q || o.title.toLowerCase().includes(q) || 'olympiad'.includes(q))
  );
  const visibleRegular = selectedSubject === 'Olympiad' ? [] : filteredExams;

  // Overview stats (regular exams + Olympiad)
  const regularCompleted = exams.filter(e => (e.myAttemptCount || 0) > 0).length;
  const completedCount = regularCompleted + olympiadCompleted.length;
  const percentageSum =
    exams.filter(e => e.myBestAttempt).reduce((sum, e) => sum + (e.myBestAttempt?.percentage || 0), 0) +
    olympiadCompleted.reduce((sum, o) => sum + (isResultReleased(o.result) ? o.result.percentage : 0), 0);
  const avgScore = completedCount > 0 ? Math.round(percentageSum / completedCount) : 0;
  // counts are the real number of cards in each tab (before search / subject filters), from the same rules the lists use
  const regularIn = (tab: ExamTab) => exams.filter(e => regularTabs(e).includes(tab)).length;
  const availableCount = regularIn('available') + olympiadAvailable.length;
  const upcomingCount = regularIn('upcoming') + olympiadUpcoming.length;
  const expiredCount = regularIn('expired') + olympiadExpired.length;

  return (
    <div className="flex min-h-screen bg-page transition-colors">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6 sm:mb-8">
            <div className="min-w-0">
              <div className="flex items-center gap-2 mb-1">
                <span className="p-2 rounded-xl bg-[#6C63F2]/10 text-[#6C63F2] dark:bg-[#6C63F2]/20">
                  <ClipboardList className="w-5 h-5" />
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-[#6C63F2]">
                  Assessments
                </span>
              </div>
              <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">
                Exams & Assessments
              </h1>
              <p className="text-text-secondary text-sm mt-1">
                Take scheduled tests, practice with MCQ exams, and get instant detailed analysis
              </p>
            </div>

            {user?.currentStandard && (
              <div className="self-start md:self-auto px-4 py-2 bg-surface-alt rounded-xl border border-border-subtle flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[#6C63F2]" />
                <span className="text-xs font-bold text-text-primary">{standardLabel(user.currentStandard)}</span>
              </div>
            )}
          </div>

          {/* Stats Bar — 2 × 2 on phones (icon above the number), 4 in a row on large screens */}
          <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 sm:gap-4 mb-6 sm:mb-8">
            <div className="card-soft p-3 sm:p-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="w-10 h-10 shrink-0 rounded-xl bg-[#6C63F2]/10 text-[#6C63F2] flex items-center justify-center font-bold">
                <ClipboardList className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-text-secondary leading-tight">Available Exams</p>
                <p className="text-xl font-heading font-bold text-text-primary">
                  {availableCount}
                </p>
              </div>
            </div>

            <div className="card-soft p-3 sm:p-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="w-10 h-10 shrink-0 rounded-xl bg-[#4ADE9A]/15 text-[#4ADE9A] flex items-center justify-center font-bold">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-text-secondary leading-tight">Completed</p>
                <p className="text-xl font-heading font-bold text-text-primary">{completedCount}</p>
              </div>
            </div>

            <div className="card-soft p-3 sm:p-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="w-10 h-10 shrink-0 rounded-xl bg-[#FFC24B]/15 text-[#FFC24B] flex items-center justify-center font-bold">
                <Award className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-text-secondary leading-tight">Average Score</p>
                <p className="text-xl font-heading font-bold text-text-primary">{avgScore}%</p>
              </div>
            </div>

            <div className="card-soft p-3 sm:p-4 flex flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
              <div className="w-10 h-10 shrink-0 rounded-xl bg-[#5AC8FA]/15 text-[#5AC8FA] flex items-center justify-center font-bold">
                <Clock className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-text-secondary leading-tight">Upcoming</p>
                <p className="text-xl font-heading font-bold text-text-primary">
                  {upcomingCount}
                </p>
              </div>
            </div>
          </div>

          {standardMissing && (
            <div className="mb-4 p-4 rounded-2xl border border-[#FFC24B]/40 bg-[#FFC24B]/10 flex items-start gap-3" role="status" data-testid="standard-missing">
              <AlertCircle className="w-4 h-4 mt-0.5 text-[#B7791F] flex-shrink-0" aria-hidden="true" />
              <p className="text-xs text-text-secondary min-w-0">
                Your standard is not set on your profile, so we cannot show the exams meant for you. Please complete your profile in <Link to="/student/profile" className="font-semibold text-brand-primary underline">My Profile</Link> or contact the administrator.
              </p>
            </div>
          )}

          {/* Controls: status tabs, search and subject filter */}
          <div className="space-y-3 sm:space-y-4 mb-6">
            <div className="flex flex-col lg:flex-row gap-3 items-stretch lg:items-center justify-between">
              {/* Status tabs: four equal segments on phones (the count drops under the label if space runs out) */}
              <div role="tablist" aria-label="Exam status" className="grid grid-cols-4 sm:inline-flex w-full sm:w-auto sm:self-start bg-surface-alt p-1 rounded-xl border border-border-subtle gap-1">
                {([
                  ['available', 'Available', availableCount],
                  ['upcoming', 'Upcoming', upcomingCount],
                  ['completed', 'Completed', completedCount],
                  ['expired', 'Expired', expiredCount],
                ] as const).map(([key, label, count]) => {
                  const active = activeTab === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => setActiveTab(key)}
                      className={`min-w-0 min-h-[44px] px-1 sm:px-4 py-1.5 rounded-lg text-xs font-semibold leading-tight transition-all flex flex-wrap items-center justify-center gap-x-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
                        active ? 'bg-brand-primary text-white shadow-sm' : 'text-text-secondary hover:text-text-primary hover:bg-surface'
                      }`}
                    >
                      <span>{label}</span>
                      <span className={active ? 'text-white/90' : 'text-text-muted'}>({count})</span>
                    </button>
                  );
                })}
              </div>

              {/* Search */}
              <div className="relative w-full lg:w-64 lg:flex-shrink-0">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" aria-hidden="true" />
                <input
                  type="search"
                  inputMode="search"
                  aria-label="Search exams by title or chapter"
                  placeholder="Search exam or chapter..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full min-h-[44px] pl-9 pr-4 py-2 bg-surface border border-border-subtle rounded-xl text-sm sm:text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary focus:ring-2 focus:ring-brand-primary/20 transition-all"
                />
              </div>
            </div>

            {/* Subject filter: one row that scrolls sideways on its own when the chips do not fit */}
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-xs font-semibold text-text-muted flex items-center gap-1 flex-shrink-0">
                <Filter className="w-3.5 h-3.5" aria-hidden="true" /> Subject:
              </span>
              <div role="group" aria-label="Filter exams by subject" className="scroll-row scroll-row-fade gap-2 min-w-0 flex-1 py-0.5">
                {subjects.map(subj => (
                  <button
                    key={subj}
                    type="button"
                    aria-pressed={selectedSubject === subj}
                    onClick={() => setSelectedSubject(subj)}
                    className={`flex-shrink-0 min-h-[36px] px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
                      selectedSubject === subj
                        ? 'bg-brand-primary/15 text-brand-primary font-semibold border border-brand-primary/30'
                        : 'bg-surface border border-border-subtle text-text-secondary hover:bg-surface-alt'
                    }`}
                  >
                    {subj}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Exams List */}
          {loading ? (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-4 sm:gap-5">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="card-soft h-56 rounded-2xl animate-pulse bg-surface-alt" />
              ))}
            </div>
          ) : visibleRegular.length === 0 && filteredOlympiad.length === 0 ? (
            <div className="card-soft p-8 sm:p-12 text-center max-w-md mx-auto my-6 sm:my-8">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-[#6C63F2]/10 text-[#6C63F2] flex items-center justify-center mb-4">
                <ClipboardList className="w-7 h-7" />
              </div>
              <h3 className="font-heading font-bold text-lg text-text-primary mb-1">
                No exams found
              </h3>
              <p className="text-xs text-text-secondary mb-4">
                {searchQuery.trim() || selectedSubject !== 'All'
                  ? 'No exams match your search or subject filter.'
                  : activeTab === 'available'
                  ? 'There are no active exams available for your standard right now. Check back soon!'
                  : activeTab === 'upcoming'
                  ? 'No scheduled exams found. Teachers will post upcoming dates here.'
                  : activeTab === 'expired'
                  ? 'Nothing has expired. Exams you did not attempt before their deadline will appear here.'
                  : 'You have not completed any exams yet. Start by taking an available exam above!'}
              </p>
              {searchQuery.trim() || selectedSubject !== 'All' ? (
                <button
                  type="button"
                  onClick={() => { setSearchQuery(''); setSelectedSubject('All'); }}
                  className="btn-secondary text-xs py-2 px-4 inline-flex items-center gap-2 min-h-[44px]"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Clear search and filters
                </button>
              ) : activeTab !== 'available' && (
                <button
                  onClick={() => setActiveTab('available')}
                  className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-2"
                >
                  <Sparkles className="w-3.5 h-3.5" /> View Available Exams
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))] gap-4 sm:gap-5">
              {filteredOlympiad.map(o => (
                <div key={o._id} className="min-w-0 flex flex-col gap-3" data-testid="olympiad-pair">
                  <OlympiadExamCard
                    exam={o}
                    paying={payingId === `${o._id}:EXAM`}
                    onPay={(e) => unlockWithPayment(e, 'EXAM')}
                    onUseCredit={(e) => unlockWithCredit(e, 'EXAM')}
                    creditBalance={creditBalance}
                    creditBusy={payingId === `${o._id}:EXAM`}
                    interview={interviews[o._id]}
                  />
                  {o.accessMode !== 'approval' && (
                    <OlympiadInterviewCard
                      exam={o}
                      interview={interviews[o._id]}
                      creditBalance={creditBalance}
                      unlocking={payingId === `${o._id}:INTERVIEW`}
                      onUseCredit={(e) => { unlockWithCredit(e, 'INTERVIEW').then(() => loadBalance()); }}
                      onPay={(e) => unlockWithPayment(e, 'INTERVIEW')}
                      interviewBusy={interviewBusyId === o._id}
                      onStartInterview={startInterview}
                    />
                  )}
                </div>
              ))}
              {visibleRegular.map(exam => {
                const isUpcoming = exam.availability === 'upcoming';
                const isCompleted = (exam.myAttemptCount || 0) > 0;
                const isExpired = exam.availability === 'expired' && !isCompleted;
                const bestAttempt = exam.myBestAttempt;
                const teacherObj = typeof exam.teacher === 'object' ? exam.teacher : null;

                return (
                  <div
                    key={exam._id}
                    className="card-soft min-w-0 p-4 sm:p-5 flex flex-col justify-between hover:shadow-lg transition-all border border-border-subtle rounded-2xl relative group bg-surface"
                  >
                    <div>
                      {/* Top Badges */}
                      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                        <span className={`${getSubjectBadgeClass(exam.subject)} text-[11px] font-semibold px-2.5 py-0.5 rounded-full`}>
                          {exam.subject}
                        </span>

                        {isUpcoming ? (
                          <span className="badge-warning text-[10px] py-0.5 px-2 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Upcoming
                          </span>
                        ) : isExpired ? (
                          <span className="bg-surface-alt border border-border-subtle text-text-muted text-[10px] font-semibold py-0.5 px-2 rounded-full flex items-center gap-1" data-testid="expired-badge">
                            <Lock className="w-3 h-3" /> Expired
                          </span>
                        ) : isCompleted ? (
                          <span className="badge-success text-[10px] py-0.5 px-2 flex items-center gap-1">
                            <CheckCircle className="w-3 h-3" /> Score: {bestAttempt?.score}/{exam.totalMarks} ({bestAttempt?.percentage}%)
                          </span>
                        ) : (
                          <span className="badge-primary text-[10px] py-0.5 px-2 flex items-center gap-1">
                            <Sparkles className="w-3 h-3" /> Ready
                          </span>
                        )}
                      </div>

                      {/* Title & Chapter */}
                      <h3 className="font-heading font-bold text-base leading-snug text-text-primary group-hover:text-brand-primary transition-colors break-words">
                        {exam.title}
                      </h3>

                      {exam.chapter && (
                        <p className="text-xs text-text-muted mt-1 flex items-start gap-1">
                          <BookOpen className="w-3 h-3 mt-0.5 flex-shrink-0" /> <span className="min-w-0">Chapter: {exam.chapter}</span>
                        </p>
                      )}

                      {exam.description && (
                        <p className="text-xs text-text-secondary mt-2 line-clamp-2">
                          {exam.description}
                        </p>
                      )}

                      {/* Details & Specs */}
                      <div className="grid grid-cols-2 gap-x-3 gap-y-2 my-4 p-3 bg-surface-alt rounded-xl border border-border-subtle text-xs">
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <Clock className="w-3.5 h-3.5 text-brand-primary flex-shrink-0" />
                          <span className="min-w-0">{exam.durationMinutes} mins</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <HelpCircle className="w-3.5 h-3.5 text-[#5AC8FA] flex-shrink-0" />
                          <span className="min-w-0">{exam.questionCount || exam.questions?.length || 0} Questions</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <Award className="w-3.5 h-3.5 text-[#FFC24B] flex-shrink-0" />
                          <span className="min-w-0">{exam.totalMarks} Marks</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <AlertCircle className={`w-3.5 h-3.5 ${exam.negativeMarking ? 'text-[#E1447A]' : 'text-text-muted'} flex-shrink-0`} />
                          <span className="min-w-0">
                            {exam.negativeMarking ? `-${exam.negativeMarkValue} wrong` : 'No negative'}
                          </span>
                        </div>
                      </div>

                      {/* Schedule info if set */}
                      {exam.scheduledStart && (
                        <div className="text-[11px] text-text-muted mb-3 flex items-start gap-1.5">
                          <Calendar className="w-3 h-3 mt-0.5 text-brand-primary flex-shrink-0" />
                          <span className="min-w-0">
                            {isExpired && exam.scheduledEnd ? 'Closed' : 'Starts'}: {new Date(isExpired && exam.scheduledEnd ? exam.scheduledEnd : exam.scheduledStart).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Bottom teacher & Action Button */}
                    <div className="pt-3 border-t border-border-subtle">
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <img
                            src={
                              teacherObj?.avatar ||
                              `https://ui-avatars.com/api/?name=${encodeURIComponent(teacherObj?.name || 'Teacher')}&background=6C63F2&color=fff&size=32`
                            }
                            alt={teacherObj?.name || 'Teacher'}
                            className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                          />
                          <span className="text-[11px] font-medium text-text-secondary truncate">
                            {teacherObj?.name || 'Teacher'}
                          </span>
                        </div>

                        {exam.attemptLimit > 0 && (
                          <span className="text-[10px] text-text-muted font-medium flex-shrink-0">
                            {exam.myAttemptCount || 0}/{exam.attemptLimit} attempt
                          </span>
                        )}
                      </div>

                      {isExpired ? (
                        <>
                          <p className="text-[11px] text-text-secondary mb-3" data-testid="expired-message">
                            This examination has expired and is no longer available. You did not attempt this examination before its deadline.
                          </p>
                          <button disabled className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-surface-alt border border-border-subtle text-text-muted text-sm sm:text-xs font-semibold cursor-not-allowed text-center">
                            Exam Expired
                          </button>
                        </>
                      ) : isUpcoming ? (
                        <button
                          disabled
                          className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-surface-alt border border-border-subtle text-text-muted text-sm sm:text-xs font-semibold cursor-not-allowed text-center"
                        >
                          Exam Not Started Yet
                        </button>
                      ) : exam.canAttempt ? (
                        <Link
                          to={`/student/exams/${exam._id}`}
                          className="btn-primary w-full min-h-[44px] py-2.5 px-4 rounded-xl text-sm sm:text-xs font-bold text-center flex items-center justify-center gap-2 shadow-sm"
                        >
                          {isCompleted ? (
                            <>
                              <RotateCcw className="w-3.5 h-3.5" /> Retake Exam
                            </>
                          ) : (
                            <>
                              <Sparkles className="w-3.5 h-3.5" /> Start Exam
                            </>
                          )}
                          <ChevronRight className="w-3.5 h-3.5" />
                        </Link>
                      ) : (
                        <Link
                          to={`/student/exams/${exam._id}`}
                          className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-surface-alt hover:bg-surface border border-border-subtle text-text-primary text-sm sm:text-xs font-bold text-center flex items-center justify-center gap-2 transition-all"
                        >
                          <CheckCircle className="w-3.5 h-3.5 text-[#4ADE9A]" /> View Review & Scores
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
      {checkoutDialog}
    </div>
  );
};

export default StudentExamsPage;

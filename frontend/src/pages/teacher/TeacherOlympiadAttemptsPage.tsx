import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  Trophy, ArrowLeft, Users, CheckCircle2, Clock,
  AlertTriangle, Search, Filter, ShieldCheck,
  Award, Eye, RefreshCw, BarChart2, Radio
} from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import { ProctoringBadges, ProctoringReviewDialog } from '../../proctoring/ProctoringReview';
import { olympiadApi, olympiadErrorMessage } from '../../services/olympiad';
import { formatDuration, formatISTDateTime } from '../../utils/olympiadFormat';
import toast from 'react-hot-toast';

interface StudentAttempt {
  _id: string;
  student: { _id?: string; name: string; email: string; standard?: number } | null;
  status: 'IN_PROGRESS' | 'COMPLETED';
  submissionType?: string;
  startedAt: string;
  submittedAt?: string;
  score: number;
  totalMarks: number;
  percentage: number;
  grade?: string | null;
  correctCount: number;
  wrongCount: number;
  unansweredCount: number;
  timeTakenSeconds: number;
  lastActivityAt?: string | null;
  inactivitySeconds: number;
  isInactive: boolean;
  proctoring: any | null;
}

interface ExamInfo {
  _id: string;
  title: string;
  standard: number;
  durationMinutes: number;
  totalMarks: number;
  proctoring?: any;
}

const TeacherOlympiadAttemptsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [exam, setExam] = useState<ExamInfo | null>(null);
  const [attempts, setAttempts] = useState<StudentAttempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'COMPLETED' | 'IN_PROGRESS' | 'FLAGGED'>('ALL');
  const [reviewSession, setReviewSession] = useState<string | null>(null);

  const fetchData = async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const data = await olympiadApi.teacherAttempts(id);
      setExam(data.exam);
      setAttempts(data.attempts || []);
    } catch (err: any) {
      const msg = olympiadErrorMessage(err, 'Failed to load exam attempts.');
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  const filteredAttempts = attempts.filter((a) => {
    const studentName = a.student?.name || '';
    const studentEmail = a.student?.email || '';
    const q = searchQuery.toLowerCase();
    const matchesSearch = studentName.toLowerCase().includes(q) || studentEmail.toLowerCase().includes(q);

    if (!matchesSearch) return false;
    if (statusFilter === 'COMPLETED') return a.status === 'COMPLETED';
    if (statusFilter === 'IN_PROGRESS') return a.status === 'IN_PROGRESS';
    if (statusFilter === 'FLAGGED') return a.proctoring?.reviewRequired;
    return true;
  });

  const totalAttempts = attempts.length;
  const completedAttempts = attempts.filter((a) => a.status === 'COMPLETED').length;
  const inProgressAttempts = attempts.filter((a) => a.status === 'IN_PROGRESS').length;
  const flaggedCount = attempts.filter((a) => a.proctoring?.reviewRequired).length;

  const getGradeBadge = (grade?: string | null) => {
    if (!grade) return <span className="text-text-muted">—</span>;
    const styles: Record<string, string> = {
      'A+': 'bg-[#DCFCE7] text-[#16A34A] border-[#4ADE9A]/30',
      'A': 'bg-[#E0F2FE] text-[#0284C7] border-[#38BDF8]/30',
      'B+': 'bg-[#FEF3C7] text-[#D97706] border-[#FBBF24]/30',
      'B': 'bg-[#EDE9FE] text-[#6C63F2] border-[#818CF8]/30',
    };
    return (
      <span className={`px-2 py-0.5 rounded-md text-xs font-bold border ${styles[grade] || 'bg-surface-alt text-text-secondary'}`}>
        {grade}
      </span>
    );
  };

  return (
    <div className="flex min-h-screen bg-page transition-colors">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
          {/* Back link */}
          <Link
            to="/teacher/exams"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-brand-primary transition-colors mb-4"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Exams
          </Link>

          {/* Exam Header */}
          <div className="card-soft p-6 rounded-2xl mb-6 bg-surface">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <span className="badge-primary text-[10px] py-0.5 px-2 flex items-center gap-1 font-bold">
                    <Trophy className="w-3 h-3 text-[#FFC24B]" /> Olympiad Examination
                  </span>
                  {exam && (
                    <span className="badge-subject-math text-[10px] py-0.5 px-2 font-bold">
                      Standard {exam.standard}
                    </span>
                  )}
                  {exam?.proctoring?.enabled && (
                    <span className="badge-secondary text-[10px] py-0.5 px-2 flex items-center gap-1 font-bold text-[#4ADE9A]">
                      <ShieldCheck className="w-3 h-3" /> Proctored
                    </span>
                  )}
                </div>
                <h1 className="font-heading font-bold text-xl sm:text-2xl text-text-primary">
                  {exam?.title || 'Olympiad Examination Attempts'}
                </h1>
                <p className="text-text-secondary text-xs sm:text-sm mt-1">
                  Student submissions, scoring analysis, inactivity monitoring, and live proctoring integrity records.
                </p>
              </div>

              <button
                onClick={fetchData}
                disabled={loading}
                className="self-start sm:self-auto btn-secondary text-xs py-2 px-3 rounded-xl flex items-center gap-1.5 font-bold"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
            </div>
          </div>

          {/* Summary Metric Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            <div className="card-soft p-4 flex items-center gap-3 bg-surface">
              <div className="w-10 h-10 rounded-xl bg-[#6C63F2]/10 text-brand-primary flex items-center justify-center font-bold">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">Total Attempts</p>
                <p className="text-xl font-heading font-bold text-text-primary">{totalAttempts}</p>
              </div>
            </div>

            <div className="card-soft p-4 flex items-center gap-3 bg-surface">
              <div className="w-10 h-10 rounded-xl bg-[#4ADE9A]/15 text-[#4ADE9A] flex items-center justify-center font-bold">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">Submitted</p>
                <p className="text-xl font-heading font-bold text-text-primary">{completedAttempts}</p>
              </div>
            </div>

            <div className="card-soft p-4 flex items-center gap-3 bg-surface">
              <div className="w-10 h-10 rounded-xl bg-[#FFC24B]/15 text-[#FFC24B] flex items-center justify-center font-bold">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">In Progress</p>
                <p className="text-xl font-heading font-bold text-text-primary">{inProgressAttempts}</p>
              </div>
            </div>

            <div className="card-soft p-4 flex items-center gap-3 bg-surface">
              <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold ${
                flaggedCount > 0 ? 'bg-[#FFE4EC] text-[#E1447A]' : 'bg-surface-alt text-text-muted'
              }`}>
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">Flagged for Review</p>
                <p className={`text-xl font-heading font-bold ${flaggedCount > 0 ? 'text-[#E1447A]' : 'text-text-primary'}`}>
                  {flaggedCount}
                </p>
              </div>
            </div>
          </div>

          {/* Search & Filter Bar */}
          <div className="card-soft p-4 rounded-2xl mb-6 bg-surface flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-text-muted absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search by student name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="input-field pl-10 text-xs py-2 w-full rounded-xl bg-surface-alt border-border-subtle"
              />
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-xs text-text-muted font-semibold flex items-center gap-1 mr-1">
                <Filter className="w-3.5 h-3.5" /> Filter:
              </span>
              {(['ALL', 'COMPLETED', 'IN_PROGRESS', 'FLAGGED'] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setStatusFilter(filter)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                    statusFilter === filter
                      ? 'bg-brand-primary text-white'
                      : 'bg-surface-alt text-text-secondary hover:text-text-primary'
                  }`}
                >
                  {filter === 'ALL' && 'All'}
                  {filter === 'COMPLETED' && 'Submitted'}
                  {filter === 'IN_PROGRESS' && 'In Progress'}
                  {filter === 'FLAGGED' && `Flagged (${flaggedCount})`}
                </button>
              ))}
            </div>
          </div>

          {/* Attempts Table */}
          <div className="card-soft rounded-2xl overflow-hidden bg-surface border border-border-subtle shadow-sm">
            {loading ? (
              <div className="p-12 text-center">
                <div className="w-10 h-10 border-3 border-brand-primary/30 border-t-brand-primary rounded-full animate-spin mx-auto mb-3" />
                <p className="text-text-muted text-xs">Loading student attempts and proctoring events...</p>
              </div>
            ) : error ? (
              <div className="p-12 text-center">
                <AlertTriangle className="w-8 h-8 text-[#E1447A] mx-auto mb-2" />
                <p className="text-text-primary text-sm font-semibold mb-2">{error}</p>
                <button onClick={fetchData} className="btn-secondary text-xs py-1.5 px-4 rounded-xl">
                  Try Again
                </button>
              </div>
            ) : filteredAttempts.length === 0 ? (
              <div className="p-12 text-center text-text-muted text-xs">
                {searchQuery || statusFilter !== 'ALL'
                  ? 'No attempts match your search or filter criteria.'
                  : 'No student attempts recorded for this Olympiad examination yet.'}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left min-w-[850px]">
                  <thead className="bg-surface-alt text-text-muted uppercase text-[10px] tracking-wider font-semibold">
                    <tr>
                      <th className="p-3.5">#</th>
                      <th className="p-3.5">Student</th>
                      <th className="p-3.5">Status</th>
                      <th className="p-3.5">Score / Marks</th>
                      <th className="p-3.5">Grade</th>
                      <th className="p-3.5">Duration</th>
                      <th className="p-3.5">Activity / Inactivity</th>
                      <th className="p-3.5">Proctoring Flags</th>
                      <th className="p-3.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {filteredAttempts.map((attempt, idx) => {
                      const isDone = attempt.status === 'COMPLETED';
                      const idleMins = Math.floor(attempt.inactivitySeconds / 60);

                      return (
                        <tr key={attempt._id} className="hover:bg-surface-alt/50 transition-colors">
                          <td className="p-3.5 text-text-muted">{idx + 1}</td>
                          <td className="p-3.5">
                            <p className="font-semibold text-text-primary text-xs">{attempt.student?.name || 'Unknown Student'}</p>
                            <p className="text-[11px] text-text-muted">{attempt.student?.email || '—'}</p>
                          </td>
                          <td className="p-3.5">
                            <span
                              className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                                isDone ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#FEF3C7] text-[#D97706]'
                              }`}
                            >
                              {isDone ? 'Completed' : 'In progress'}
                            </span>
                          </td>
                          <td className="p-3.5">
                            {isDone ? (
                              <div>
                                <span className="font-bold text-text-primary text-xs">
                                  {attempt.score}/{attempt.totalMarks}
                                </span>
                                <span className="text-text-muted text-[11px] ml-1.5">
                                  ({attempt.percentage}%)
                                </span>
                              </div>
                            ) : (
                              <span className="text-text-muted">—</span>
                            )}
                          </td>
                          <td className="p-3.5">{getGradeBadge(attempt.grade)}</td>
                          <td className="p-3.5 text-text-secondary">
                            {isDone ? formatDuration(attempt.timeTakenSeconds) : 'In progress'}
                          </td>
                          <td className="p-3.5">
                            {isDone ? (
                              <div className="text-[11px] text-text-secondary">
                                <span>Submitted</span>
                                <p className="text-text-muted text-[10px]">
                                  {attempt.submittedAt ? formatISTDateTime(attempt.submittedAt) : '—'}
                                </p>
                              </div>
                            ) : attempt.isInactive ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#FEF3C7] text-[#D97706] border border-[#FBBF24]/30">
                                <Clock className="w-3 h-3" /> Inactive ({idleMins}m idle)
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-[#DCFCE7] text-[#16A34A] border border-[#4ADE9A]/30">
                                <Radio className="w-3 h-3 text-[#16A34A] animate-pulse" /> Active now
                              </span>
                            )}
                          </td>
                          <td className="p-3.5 min-w-[160px]">
                            <ProctoringBadges summary={attempt.proctoring} />
                          </td>
                          <td className="p-3.5 text-right">
                            {attempt.proctoring?.sessionId ? (
                              <button
                                type="button"
                                onClick={() => setReviewSession(attempt.proctoring.sessionId)}
                                className="btn-secondary text-[11px] py-1 px-2.5 rounded-lg font-bold inline-flex items-center gap-1 hover:text-brand-primary"
                              >
                                <Eye className="w-3 h-3 text-brand-primary" />
                                {attempt.proctoring.reviewRequired ? 'Review' : 'View'}
                              </button>
                            ) : (
                              <span className="text-text-muted text-[11px]">No proctoring</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Proctoring Event Review Dialog */}
          <ProctoringReviewDialog
            sessionId={reviewSession}
            onClose={() => setReviewSession(null)}
          />
        </div>
      </main>
    </div>
  );
};

export default TeacherOlympiadAttemptsPage;

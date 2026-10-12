import React, { useCallback, useEffect, useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import {
  GraduationCap,
  Users,
  CheckCircle2,
  XCircle,
  Clock,
  BarChart3,
  Search,
  Filter,
  Download,
  Check,
  X,
  AlertTriangle,
  Loader2,
  Eye,
  RefreshCw,
  Trophy,
  Award,
  ChevronRight,
  BookOpen,
  Calendar,
  Layers,
  FileText,
  Sliders,
  CheckCheck,
} from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import {
  engineeringApi,
  EngineeringAdminStats,
  EngineeringRequestRecord,
  EngineeringExamInfo,
} from '../../services/engineering';

type Tab = 'overview' | 'requests' | 'students' | 'exam' | 'results';

export const AdminEngineering: React.FC = () => {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [loading, setLoading] = useState(true);

  // Overview stats
  const [stats, setStats] = useState<EngineeringAdminStats | null>(null);

  // Requests tab state
  const [requests, setRequests] = useState<EngineeringRequestRecord[]>([]);
  const [reqFilter, setReqFilter] = useState<string>('ALL');
  const [reqSearch, setReqSearch] = useState<string>('');
  const [reqPage, setReqPage] = useState<number>(1);
  const [reqTotalPages, setReqTotalPages] = useState<number>(1);
  const [selectedRequest, setSelectedRequest] = useState<EngineeringRequestRecord | null>(null);
  const [rejectionModalRequest, setRejectionModalRequest] = useState<EngineeringRequestRecord | null>(null);
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [showBulkApproveModal, setShowBulkApproveModal] = useState(false);
  const [processingAction, setProcessingAction] = useState(false);

  // Approved students tab state
  const [students, setStudents] = useState<any[]>([]);
  const [studSearch, setStudSearch] = useState<string>('');
  const [studBranch, setStudBranch] = useState<string>('ALL');
  const [studStatus, setStudStatus] = useState<string>('ALL');

  // Exam tab state
  const [exam, setExam] = useState<EngineeringExamInfo | null>(null);
  const [questions, setQuestions] = useState<any[]>([]);
  const [examEditing, setExamEditing] = useState(false);
  const [examDeadline, setExamDeadline] = useState('');

  // Results tab state
  const [results, setResults] = useState<any[]>([]);
  const [resSearch, setResSearch] = useState('');
  const [resBranch, setResBranch] = useState('ALL');
  const [inspectAttempt, setInspectAttempt] = useState<any | null>(null);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  // 1. Data Loaders
  const loadOverview = useCallback(async () => {
    try {
      const data = await engineeringApi.adminOverview();
      setStats(data.stats);
    } catch (err) {
      console.error('Failed to load overview:', err);
    }
  }, []);

  const loadRequests = useCallback(async () => {
    try {
      const data = await engineeringApi.adminGetRequests({
        status: reqFilter === 'ALL' ? undefined : reqFilter,
        search: reqSearch || undefined,
        page: reqPage,
        limit: 15,
      });
      setRequests(data.requests || []);
      setReqTotalPages(data.totalPages || 1);
    } catch (err) {
      console.error('Failed to load requests:', err);
    }
  }, [reqFilter, reqSearch, reqPage]);

  const loadStudents = useCallback(async () => {
    try {
      const data = await engineeringApi.adminGetStudents({
        search: studSearch || undefined,
        branch: studBranch === 'ALL' ? undefined : studBranch,
        attemptStatus: studStatus === 'ALL' ? undefined : studStatus,
      });
      setStudents(data.students || []);
    } catch (err) {
      console.error('Failed to load students:', err);
    }
  }, [studSearch, studBranch, studStatus]);

  const loadExamAndQuestions = useCallback(async () => {
    try {
      const data = await engineeringApi.adminGetExam();
      setExam(data.exam);
      setQuestions(data.questions || []);
      if (data.exam?.endDate) {
        setExamDeadline(new Date(data.exam.endDate).toISOString().slice(0, 16));
      }
    } catch (err) {
      console.error('Failed to load exam details:', err);
    }
  }, []);

  const loadResults = useCallback(async () => {
    try {
      const data = await engineeringApi.adminGetResults({
        search: resSearch || undefined,
        branch: resBranch === 'ALL' ? undefined : resBranch,
      });
      setResults(data.results || []);
    } catch (err) {
      console.error('Failed to load results:', err);
    }
  }, [resSearch, resBranch]);

  // Master refresh
  const refreshAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([
      loadOverview(),
      loadRequests(),
      loadStudents(),
      loadExamAndQuestions(),
      loadResults(),
    ]);
    setLoading(false);
  }, [loadOverview, loadRequests, loadStudents, loadExamAndQuestions, loadResults]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  // Tab switch effect to load sub-data
  useEffect(() => {
    if (activeTab === 'requests') void loadRequests();
    if (activeTab === 'students') void loadStudents();
    if (activeTab === 'exam') void loadExamAndQuestions();
    if (activeTab === 'results') void loadResults();
  }, [activeTab, loadRequests, loadStudents, loadExamAndQuestions, loadResults]);

  // 2. Actions: Approve Single Request
  const handleApprove = async (id: string) => {
    try {
      setProcessingAction(true);
      await engineeringApi.adminApproveRequest(id);
      toast.success('Student request approved! Examination access granted.');
      await Promise.all([loadRequests(), loadOverview()]);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to approve request.');
    } finally {
      setProcessingAction(false);
    }
  };

  // Reject Single Request
  const handleConfirmReject = async () => {
    if (!rejectionModalRequest) return;
    try {
      setProcessingAction(true);
      await engineeringApi.adminRejectRequest(rejectionModalRequest._id, rejectionReason);
      toast.success('Request rejected.');
      setRejectionModalRequest(null);
      setRejectionReason('');
      await Promise.all([loadRequests(), loadOverview()]);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to reject request.');
    } finally {
      setProcessingAction(false);
    }
  };

  // Bulk Approve All Pending Requests
  const handleConfirmBulkApprove = async () => {
    try {
      setProcessingAction(true);
      const res = await engineeringApi.adminApproveAllPending();
      toast.success(res.message || `Approved ${res.approvedCount || 0} pending requests!`);
      setShowBulkApproveModal(false);
      await Promise.all([loadRequests(), loadOverview(), loadStudents()]);
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to bulk-approve requests.');
    } finally {
      setProcessingAction(false);
    }
  };

  // PDF Report Download
  const handleDownloadPdf = async () => {
    try {
      setDownloadingPdf(true);
      toast('Generating official LearnIQ examination report PDF...', { icon: '📄' });
      await engineeringApi.adminDownloadReportPdf();
      toast.success('Exam Report PDF downloaded successfully!');
    } catch (err: any) {
      console.error('PDF Download failed:', err);
      toast.error('Failed to generate or download report PDF.');
    } finally {
      setDownloadingPdf(false);
    }
  };

  // Format Helpers
  const formatSec = (sec: number = 0) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    if (m === 0) return `${s}s`;
    return `${m}m ${s}s`;
  };

  return (
    <div className="flex min-h-screen bg-page transition-colors">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="badge-primary text-[11px] font-bold">ENGINEERING HUB</span>
                {stats?.isClosed ? (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-500 border border-rose-500/30">
                    Exam Closed
                  </span>
                ) : (
                  <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
                    Active & Published
                  </span>
                )}
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold font-heading text-text-primary">
                Engineering Administration
              </h1>
              <p className="text-xs sm:text-sm text-text-secondary mt-0.5">
                Manage BE Engineering candidates, join approvals, exam configuration, and results reports.
              </p>
            </div>

            <div className="flex items-center gap-3 self-start sm:self-auto">
              <button
                type="button"
                onClick={refreshAll}
                disabled={loading}
                className="btn-secondary text-xs py-2 px-3.5 inline-flex items-center gap-1.5"
                title="Refresh All Data"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
              </button>
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={downloadingPdf}
                className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-1.5 shadow-md shadow-brand-primary/20"
              >
                {downloadingPdf ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating PDF...
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" /> DOWNLOAD EXAM REPORT PDF
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-2 border-b border-border-subtle overflow-x-auto pb-px text-sm">
            {[
              { id: 'overview', label: 'Overview', icon: BarChart3 },
              { id: 'requests', label: `Join Requests (${stats?.pendingRequests || 0} Pending)`, icon: Users },
              { id: 'students', label: `Approved Students (${stats?.approvedRequests || 0})`, icon: GraduationCap },
              { id: 'exam', label: 'Exam Management', icon: Sliders },
              { id: 'results', label: 'Results & Reports', icon: Trophy },
            ].map((t) => {
              const Icon = t.icon;
              const isActive = activeTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id as Tab)}
                  className={`flex items-center gap-2 py-3 px-4 font-semibold text-xs sm:text-sm border-b-2 transition-all whitespace-nowrap ${
                    isActive
                      ? 'border-brand-primary text-brand-primary bg-brand-primary/5 rounded-t-xl'
                      : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border-subtle'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {t.label}
                </button>
              );
            })}
          </div>

          {/* ============================================================== */}
          {/* TAB 1: OVERVIEW */}
          {/* ============================================================== */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Top KPI Cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div
                  onClick={() => setActiveTab('requests')}
                  className="card-soft p-4 sm:p-5 cursor-pointer hover:border-brand-primary transition-all group"
                >
                  <div className="flex items-center justify-between text-text-muted text-xs font-semibold mb-2">
                    <span>Total Requests</span>
                    <Users className="w-4 h-4 text-brand-primary" />
                  </div>
                  <span className="text-2xl sm:text-3xl font-black text-text-primary">
                    {stats?.totalRequests || 0}
                  </span>
                  <div className="text-[11px] text-text-muted mt-2 flex items-center justify-between">
                    <span className="text-amber-500 font-semibold">{stats?.pendingRequests || 0} pending</span>
                    <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>

                <div
                  onClick={() => setActiveTab('students')}
                  className="card-soft p-4 sm:p-5 cursor-pointer hover:border-brand-primary transition-all group"
                >
                  <div className="flex items-center justify-between text-text-muted text-xs font-semibold mb-2">
                    <span>Approved Students</span>
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  </div>
                  <span className="text-2xl sm:text-3xl font-black text-text-primary">
                    {stats?.approvedRequests || 0}
                  </span>
                  <div className="text-[11px] text-text-muted mt-2 flex items-center justify-between">
                    <span className="text-emerald-500 font-semibold">{stats?.eligibleStudents || 0} eligible</span>
                    <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>

                <div
                  onClick={() => setActiveTab('results')}
                  className="card-soft p-4 sm:p-5 cursor-pointer hover:border-brand-primary transition-all group"
                >
                  <div className="flex items-center justify-between text-text-muted text-xs font-semibold mb-2">
                    <span>Submitted Exams</span>
                    <Trophy className="w-4 h-4 text-indigo-500" />
                  </div>
                  <span className="text-2xl sm:text-3xl font-black text-text-primary">
                    {stats?.submittedExams || 0}
                  </span>
                  <div className="text-[11px] text-text-muted mt-2 flex items-center justify-between">
                    <span>{stats?.submissionPercentage || 0}% turnout</span>
                    <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
                  </div>
                </div>

                <div className="card-soft p-4 sm:p-5">
                  <div className="flex items-center justify-between text-text-muted text-xs font-semibold mb-2">
                    <span>Average Score</span>
                    <Award className="w-4 h-4 text-amber-500" />
                  </div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-2xl sm:text-3xl font-black text-text-primary">
                      {stats?.averageScore || 0}
                    </span>
                    <span className="text-xs text-text-muted">/ 40</span>
                  </div>
                  <div className="text-[11px] text-text-muted mt-2">
                    Highest: <strong className="text-emerald-500">{stats?.highestScore || 0}</strong> • Avg:{' '}
                    <strong>{stats?.averagePercentage || 0}%</strong>
                  </div>
                </div>
              </div>

              {/* Secondary stats row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <div className="card-soft p-4">
                  <span className="text-xs text-text-muted block">In-Progress Tests</span>
                  <span className="text-xl font-bold text-text-primary mt-1 block">
                    {stats?.inProgressAttempts || 0}
                  </span>
                </div>
                <div className="card-soft p-4">
                  <span className="text-xs text-text-muted block">Not Attempted</span>
                  <span className="text-xl font-bold text-text-primary mt-1 block">
                    {stats?.notAttemptedCount || 0}
                  </span>
                </div>
                <div className="card-soft p-4">
                  <span className="text-xs text-text-muted block">Median Duration</span>
                  <span className="text-xl font-bold text-text-primary mt-1 block">
                    {formatSec(stats?.medianTimeSeconds || 0)}
                  </span>
                </div>
                <div className="card-soft p-4">
                  <span className="text-xs text-text-muted block">Authoritative Deadline</span>
                  <span className="text-xs font-bold text-text-primary mt-1 block">
                    13 Oct 2026, 6:00 PM IST
                  </span>
                </div>
              </div>

              {/* Top Performers Table */}
              <div className="card-soft p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-brand-primary" /> Top Ranked Students
                  </h3>
                  <button
                    type="button"
                    onClick={() => setActiveTab('results')}
                    className="text-xs font-semibold text-brand-primary hover:underline"
                  >
                    View All Rankings →
                  </button>
                </div>

                {stats?.topRanked && stats.topRanked.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-border-subtle text-text-muted">
                          <th className="py-2.5 px-3">Rank</th>
                          <th className="py-2.5 px-3">Student</th>
                          <th className="py-2.5 px-3">Email</th>
                          <th className="py-2.5 px-3">Score</th>
                          <th className="py-2.5 px-3">Percentage</th>
                          <th className="py-2.5 px-3">Duration</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-subtle">
                        {stats.topRanked.map((t) => (
                          <tr key={t.rank} className="hover:bg-surface-alt transition-colors">
                            <td className="py-2.5 px-3 font-bold text-brand-primary">#{t.rank}</td>
                            <td className="py-2.5 px-3 font-semibold text-text-primary">{t.studentName}</td>
                            <td className="py-2.5 px-3 text-text-muted">{t.studentEmail}</td>
                            <td className="py-2.5 px-3 font-bold text-text-primary">{t.score} / 40</td>
                            <td className="py-2.5 px-3 font-semibold text-emerald-500">{t.percentage}%</td>
                            <td className="py-2.5 px-3 text-text-secondary">{formatSec(t.timeTakenSeconds)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-text-muted py-6 text-center">
                    No examination submissions recorded yet. Once approved students take the test, live rankings will appear here.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 2: JOIN REQUESTS */}
          {/* ============================================================== */}
          {activeTab === 'requests' && (
            <div className="space-y-4">
              {/* Controls bar with APPROVE ALL PENDING */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-1 max-w-md">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-text-muted absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Search requests by name, email, college..."
                      value={reqSearch}
                      onChange={(e) => {
                        setReqSearch(e.target.value);
                        setReqPage(1);
                      }}
                      className="input-base pl-9 text-xs py-2 w-full"
                    />
                  </div>
                  <select
                    value={reqFilter}
                    onChange={(e) => {
                      setReqFilter(e.target.value);
                      setReqPage(1);
                    }}
                    className="input-base text-xs py-2 pr-8"
                  >
                    <option value="ALL">All Status</option>
                    <option value="PENDING">Pending</option>
                    <option value="APPROVED">Approved</option>
                    <option value="REJECTED">Rejected</option>
                  </select>
                </div>

                {/* MANDATORY ACTION: APPROVE ALL PENDING */}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setShowBulkApproveModal(true)}
                    disabled={(stats?.pendingRequests || 0) === 0 || processingAction}
                    className={`btn-primary text-xs py-2 px-4 inline-flex items-center gap-2 shadow-md ${
                      (stats?.pendingRequests || 0) === 0
                        ? 'opacity-50 cursor-not-allowed'
                        : 'bg-emerald-600 hover:bg-emerald-700 text-white'
                    }`}
                  >
                    <CheckCheck className="w-4 h-4" />
                    APPROVE ALL PENDING ({stats?.pendingRequests || 0})
                  </button>
                </div>
              </div>

              {/* Requests Table */}
              <div className="card-soft overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-surface-alt/70 border-b border-border-subtle text-text-muted uppercase font-semibold text-[11px]">
                        <th className="py-3 px-4">Student</th>
                        <th className="py-3 px-4">Branch & Year</th>
                        <th className="py-3 px-4">College & University</th>
                        <th className="py-3 px-4">Requested At</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {requests.map((r) => (
                        <tr key={r._id} className="hover:bg-surface-alt/50 transition-colors">
                          <td className="py-3 px-4">
                            <span className="font-semibold text-text-primary block">{r.fullName}</span>
                            <span className="text-text-muted text-[11px] block">{r.email}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-medium text-text-primary block">{r.branch}</span>
                            <span className="text-text-muted text-[11px] block">{r.degree} • {r.year}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="text-text-primary block truncate max-w-xs">{r.college}</span>
                            <span className="text-text-muted text-[11px] block truncate max-w-xs">{r.university}</span>
                          </td>
                          <td className="py-3 px-4 text-text-secondary">
                            {r.requestedAt ? new Date(r.requestedAt).toLocaleDateString('en-IN') : '—'}
                          </td>
                          <td className="py-3 px-4">
                            {r.status === 'PENDING' && (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                                Pending
                              </span>
                            )}
                            {r.status === 'APPROVED' && (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                                Approved
                              </span>
                            )}
                            {r.status === 'REJECTED' && (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/30">
                                Rejected
                              </span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => setSelectedRequest(r)}
                                className="p-1.5 text-text-muted hover:text-brand-primary rounded-lg hover:bg-surface-alt"
                                title="View Details"
                              >
                                <Eye className="w-4 h-4" />
                              </button>

                              {r.status === 'PENDING' && (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleApprove(r._id)}
                                    disabled={processingAction}
                                    className="px-2.5 py-1 rounded-lg bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-600 dark:text-emerald-400 font-semibold border border-emerald-500/30 text-[11px] transition-colors"
                                  >
                                    Approve
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setRejectionModalRequest(r)}
                                    disabled={processingAction}
                                    className="px-2.5 py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 text-rose-600 dark:text-rose-400 font-semibold border border-rose-500/30 text-[11px] transition-colors"
                                  >
                                    Reject
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}

                      {requests.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-text-muted">
                            No student engineering requests found.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 3: APPROVED STUDENTS */}
          {/* ============================================================== */}
          {activeTab === 'students' && (
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-1 max-w-md">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-text-muted absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Search approved students..."
                      value={studSearch}
                      onChange={(e) => setStudSearch(e.target.value)}
                      className="input-base pl-9 text-xs py-2 w-full"
                    />
                  </div>
                  <select
                    value={studStatus}
                    onChange={(e) => setStudStatus(e.target.value)}
                    className="input-base text-xs py-2 pr-8"
                  >
                    <option value="ALL">All Attempt Status</option>
                    <option value="NOT_STARTED">Not Started</option>
                    <option value="IN_PROGRESS">In Progress</option>
                    <option value="SUBMITTED">Submitted</option>
                    <option value="AUTO_SUBMITTED">Auto Submitted</option>
                  </select>
                </div>

                <span className="text-xs text-text-muted">
                  Showing {students.length} approved candidate{students.length === 1 ? '' : 's'}
                </span>
              </div>

              <div className="card-soft overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-surface-alt/70 border-b border-border-subtle text-text-muted uppercase font-semibold text-[11px]">
                        <th className="py-3 px-4">Student</th>
                        <th className="py-3 px-4">Branch & College</th>
                        <th className="py-3 px-4">Approved On</th>
                        <th className="py-3 px-4">Exam Status</th>
                        <th className="py-3 px-4">Score</th>
                        <th className="py-3 px-4">Rank</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {students.map((s) => (
                        <tr key={s._id} className="hover:bg-surface-alt/50 transition-colors">
                          <td className="py-3 px-4">
                            <span className="font-semibold text-text-primary block">{s.fullName}</span>
                            <span className="text-text-muted text-[11px] block">{s.email}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-medium text-text-primary block">{s.branch}</span>
                            <span className="text-text-muted text-[11px] block truncate max-w-xs">{s.college}</span>
                          </td>
                          <td className="py-3 px-4 text-text-secondary">
                            {s.reviewedAt ? new Date(s.reviewedAt).toLocaleDateString('en-IN') : '—'}
                          </td>
                          <td className="py-3 px-4">
                            {s.attemptStatus === 'SUBMITTED' || s.attemptStatus === 'COMPLETED' ? (
                              <span className="badge-success text-[11px] font-bold">Submitted</span>
                            ) : s.attemptStatus === 'AUTO_SUBMITTED' ? (
                              <span className="badge-warning text-[11px] font-bold">Auto Submitted</span>
                            ) : s.attemptStatus === 'IN_PROGRESS' ? (
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-indigo-500/15 text-indigo-500 border border-indigo-500/30">
                                In Progress
                              </span>
                            ) : (
                              <span className="badge-neutral text-[11px]">Not Started</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {s.score != null ? (
                              <div>
                                <span className="font-bold text-text-primary">{s.score} / 40</span>
                                <span className="text-text-muted text-[11px] block">({s.percentage}%)</span>
                              </div>
                            ) : (
                              <span className="text-text-muted">—</span>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            {s.rank ? (
                              <span className="font-bold text-brand-primary">#{s.rank}</span>
                            ) : (
                              <span className="text-text-muted">—</span>
                            )}
                          </td>
                        </tr>
                      ))}

                      {students.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-12 text-center text-text-muted">
                            No approved students found matching the selected criteria.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 4: EXAM MANAGEMENT */}
          {/* ============================================================== */}
          {activeTab === 'exam' && (
            <div className="space-y-6">
              {/* Exam Info Card */}
              <div className="card-soft p-6 sm:p-8 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border-subtle pb-5">
                  <div>
                    <span className="badge-primary text-[11px] font-bold">EXAMINATION CONFIGURATION</span>
                    <h2 className="text-xl font-bold font-heading text-text-primary mt-1">{exam?.title}</h2>
                    <p className="text-xs text-text-secondary mt-0.5">{exam?.subtitle}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await engineeringApi.adminUpdateExam({ releaseAnswers: !exam?.releaseAnswers });
                          toast.success(`Answer key is now ${!exam?.releaseAnswers ? 'Released to Students' : 'Locked'}`);
                          await loadExamAndQuestions();
                        } catch (err) {
                          toast.error('Failed to update answer release status.');
                        }
                      }}
                      className={`btn-secondary text-xs py-2 px-3.5 inline-flex items-center gap-1.5 ${
                        exam?.releaseAnswers ? 'text-purple-500 font-bold border-purple-500/40 bg-purple-500/10' : 'text-text-muted'
                      }`}
                      title="Controls whether students can review question solutions before 13 Oct 2026, 6:00 PM IST"
                    >
                      {exam?.releaseAnswers ? 'Solutions: Released' : 'Solutions: Locked (Default)'}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        try {
                          await engineeringApi.adminUpdateExam({ isPublished: !exam?.isPublished });
                          toast.success(`Exam is now ${!exam?.isPublished ? 'Published' : 'Hidden'}`);
                          await loadExamAndQuestions();
                        } catch (err) {
                          toast.error('Failed to update publication status.');
                        }
                      }}
                      className={`btn-secondary text-xs py-2 px-3.5 inline-flex items-center gap-1.5 ${
                        exam?.isPublished ? 'text-emerald-500' : 'text-amber-500'
                      }`}
                    >
                      {exam?.isPublished ? 'Published (Enabled)' : 'Unpublished (Draft)'}
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  <div className="bg-surface-alt p-3.5 rounded-xl border border-border-subtle">
                    <span className="text-[11px] text-text-muted uppercase font-bold block">Questions</span>
                    <span className="text-lg font-bold text-text-primary mt-0.5 block">{exam?.totalQuestions} Questions</span>
                  </div>
                  <div className="bg-surface-alt p-3.5 rounded-xl border border-border-subtle">
                    <span className="text-[11px] text-text-muted uppercase font-bold block">Max Marks</span>
                    <span className="text-lg font-bold text-text-primary mt-0.5 block">{exam?.totalMarks} Marks</span>
                  </div>
                  <div className="bg-surface-alt p-3.5 rounded-xl border border-border-subtle">
                    <span className="text-[11px] text-text-muted uppercase font-bold block">Duration</span>
                    <span className="text-lg font-bold text-text-primary mt-0.5 block">{exam?.durationMinutes} Minutes</span>
                  </div>
                  <div className="bg-surface-alt p-3.5 rounded-xl border border-border-subtle">
                    <span className="text-[11px] text-text-muted uppercase font-bold block">Examination Fee</span>
                    <span className="text-lg font-bold text-emerald-500 mt-0.5 block">₹0 — FREE</span>
                  </div>
                </div>

                {/* Deadline Info */}
                <div className="bg-surface-alt p-4 rounded-xl border border-border-subtle flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <span className="text-xs font-bold text-text-primary flex items-center gap-2">
                      <Clock className="w-4 h-4 text-brand-primary" /> Authoritative Closure Deadline
                    </span>
                    <p className="text-xs text-text-muted mt-1">
                      13 October 2026, 6:00 PM IST (Asia/Kolkata timezone enforced). Attempts automatically stop upon deadline arrival.
                    </p>
                  </div>
                  <div className="text-xs font-mono font-bold bg-surface px-3 py-1.5 rounded-lg border border-border-subtle text-text-primary">
                    2026-10-13T18:00:00+05:30
                  </div>
                </div>
              </div>

              {/* Sections Breakdown & Canonical Questions */}
              <div className="card-soft p-6 space-y-4">
                <h3 className="text-sm font-bold text-text-primary flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-brand-primary" /> Question Distribution ({questions.length} Canonical Questions)
                </h3>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {[
                    { code: 'A', name: 'Java, Python, C++', count: 10 },
                    { code: 'B', name: 'Operating Systems', count: 5 },
                    { code: 'C', name: 'DBMS', count: 5 },
                    { code: 'D', name: 'Logical Reasoning', count: 5 },
                    { code: 'E', name: 'OOP', count: 5 },
                    { code: 'F', name: 'DSA Theory', count: 10 },
                  ].map((s) => (
                    <div key={s.code} className="bg-surface-alt p-3 rounded-xl border border-border-subtle text-center">
                      <span className="badge-primary text-[10px] font-bold">Sec {s.code}</span>
                      <span className="block text-xs font-bold text-text-primary mt-1">{s.count} Qs</span>
                      <span className="block text-[10px] text-text-muted truncate mt-0.5">{s.name}</span>
                    </div>
                  ))}
                </div>

                {/* Expandable canonical question bank */}
                <div className="pt-4 border-t border-border-subtle">
                  <span className="text-xs font-semibold text-text-muted block mb-3">
                    Authoritative Questions from LearnIQ BE Students MCQ Test Paper (1).pdf:
                  </span>
                  <div className="space-y-2 max-h-96 overflow-y-auto pr-2">
                    {questions.map((q) => (
                      <div key={q.questionNumber} className="bg-surface-alt p-3 rounded-xl border border-border-subtle text-xs">
                        <div className="flex items-center justify-between gap-2 mb-1">
                          <span className="font-bold text-text-primary">Q{q.questionNumber}. [{q.sectionName}]</span>
                          <span className="badge-success text-[10px] font-bold">Correct: Opt {q.correctAnswer + 1}</span>
                        </div>
                        <p className="text-text-secondary line-clamp-2">{q.questionText}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* TAB 5: RESULTS & REPORTS */}
          {/* ============================================================== */}
          {activeTab === 'results' && (
            <div className="space-y-4">
              {/* Header and Download Button */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2 flex-1 max-w-md">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-text-muted absolute left-3 top-2.5" />
                    <input
                      type="text"
                      placeholder="Search results by name, email, branch..."
                      value={resSearch}
                      onChange={(e) => setResSearch(e.target.value)}
                      className="input-base pl-9 text-xs py-2 w-full"
                    />
                  </div>
                  <select
                    value={resBranch}
                    onChange={(e) => setResBranch(e.target.value)}
                    className="input-base text-xs py-2 pr-8"
                  >
                    <option value="ALL">All Branches</option>
                    <option value="Computer Engineering">Computer Engineering</option>
                    <option value="Information Technology">Information Technology</option>
                    <option value="Electronics & Telecommunication">ENTC</option>
                    <option value="Electrical">Electrical</option>
                    <option value="Mechanical">Mechanical</option>
                    <option value="Civil">Civil</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={handleDownloadPdf}
                  disabled={downloadingPdf}
                  className="btn-primary text-xs py-2.5 px-5 inline-flex items-center gap-2 shadow-lg shadow-brand-primary/20"
                >
                  {downloadingPdf ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Generating Report...
                    </>
                  ) : (
                    <>
                      <Download className="w-4 h-4" /> DOWNLOAD EXAM REPORT PDF
                    </>
                  )}
                </button>
              </div>

              {/* Canonical Ranked Results Table */}
              <div className="card-soft overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="bg-surface-alt/70 border-b border-border-subtle text-text-muted uppercase font-semibold text-[11px]">
                        <th className="py-3 px-4">Rank</th>
                        <th className="py-3 px-4">Student</th>
                        <th className="py-3 px-4">Branch & College</th>
                        <th className="py-3 px-4">Score</th>
                        <th className="py-3 px-4">Percentage</th>
                        <th className="py-3 px-4">Time Taken</th>
                        <th className="py-3 px-4">Submission</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {results.map((r) => (
                        <tr key={r._id} className="hover:bg-surface-alt/50 transition-colors">
                          <td className="py-3 px-4 font-bold text-brand-primary text-sm">
                            #{r.rank}
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-semibold text-text-primary block">{r.studentName}</span>
                            <span className="text-text-muted text-[11px] block">{r.studentEmail}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-medium text-text-primary block">{r.branch}</span>
                            <span className="text-text-muted text-[11px] block truncate max-w-xs">{r.college}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-bold text-text-primary">{r.score} / 40</span>
                            <span className="text-text-muted text-[11px] block">
                              ({r.correctCount}C / {r.wrongCount}W / {r.unansweredCount}U)
                            </span>
                          </td>
                          <td className="py-3 px-4 font-bold text-emerald-500">
                            {r.percentage}%
                          </td>
                          <td className="py-3 px-4 text-text-secondary font-mono">
                            {formatSec(r.timeTakenSeconds)}
                          </td>
                          <td className="py-3 px-4">
                            {r.submissionType === 'TIMER' ? (
                              <span className="badge-warning text-[10px]">Timer Auto</span>
                            ) : (
                              <span className="badge-success text-[10px]">Manual</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={async () => {
                                try {
                                  const detail = await engineeringApi.adminGetAttemptDetail(r._id);
                                  setInspectAttempt(detail);
                                } catch (err) {
                                  toast.error('Failed to load attempt details.');
                                }
                              }}
                              className="px-2.5 py-1 rounded-lg bg-surface-alt hover:bg-surface border border-border-subtle text-text-primary text-[11px] font-medium transition-colors"
                            >
                              Inspect
                            </button>
                          </td>
                        </tr>
                      ))}

                      {results.length === 0 && (
                        <tr>
                          <td colSpan={8} className="py-12 text-center text-text-muted">
                            No student examination results submitted yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ============================================================== */}
          {/* MODALS */}
          {/* ============================================================== */}

          {/* 1. BULK APPROVE CONFIRMATION MODAL */}
          {showBulkApproveModal && (
            <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-surface border border-border-subtle rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
                <div className="text-center">
                  <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto mb-3">
                    <CheckCheck className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-text-primary">Approve All Pending Requests?</h3>
                  <p className="text-xs text-text-secondary mt-1">
                    Approve all <strong>{stats?.pendingRequests || 0} pending engineering requests</strong>? These students will immediately become eligible to take the LearnIQ BE Engineering Mock Test.
                  </p>
                </div>

                <div className="bg-surface-alt p-3 rounded-xl border border-border-subtle text-xs text-text-secondary space-y-1">
                  <p>• Only requests currently in <strong>PENDING</strong> state will be approved.</p>
                  <p>• Previously rejected requests will <strong>not</strong> be altered.</p>
                  <p>• The action will be logged with your administrator timestamp.</p>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowBulkApproveModal(false)}
                    disabled={processingAction}
                    className="flex-1 py-2 rounded-xl border border-border-subtle text-text-secondary hover:text-text-primary text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmBulkApprove}
                    disabled={processingAction}
                    className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-900/20 flex items-center justify-center gap-1.5"
                  >
                    {processingAction ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Approving...
                      </>
                    ) : (
                      'Yes, Approve All'
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 2. REJECT REQUEST MODAL */}
          {rejectionModalRequest && (
            <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-surface border border-border-subtle rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95">
                <div>
                  <h3 className="text-base font-bold text-text-primary">
                    Reject Engineering Request
                  </h3>
                  <p className="text-xs text-text-secondary mt-0.5">
                    Student: <strong>{rejectionModalRequest.fullName}</strong> ({rejectionModalRequest.email})
                  </p>
                </div>

                <div>
                  <label className="text-xs font-medium text-text-secondary block mb-1">
                    Rejection Reason (Optional):
                  </label>
                  <textarea
                    rows={3}
                    value={rejectionReason}
                    onChange={(e) => setRejectionReason(e.target.value)}
                    placeholder="e.g. Please provide valid BE branch details or institute roll number..."
                    className="input-base text-xs w-full resize-none p-3"
                  />
                </div>

                <div className="flex items-center gap-3 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setRejectionModalRequest(null);
                      setRejectionReason('');
                    }}
                    disabled={processingAction}
                    className="flex-1 py-2 rounded-xl border border-border-subtle text-text-secondary hover:text-text-primary text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmReject}
                    disabled={processingAction}
                    className="flex-1 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-900/20 flex items-center justify-center gap-1.5"
                  >
                    {processingAction ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Rejecting...
                      </>
                    ) : (
                      'Reject Request'
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 3. REQUEST DETAILS MODAL */}
          {selectedRequest && (
            <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-surface border border-border-subtle rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between border-b border-border-subtle pb-3">
                  <h3 className="text-base font-bold text-text-primary">Candidate Request Details</h3>
                  <button
                    type="button"
                    onClick={() => setSelectedRequest(null)}
                    className="p-1 text-text-muted hover:text-text-primary"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div>
                    <span className="text-text-muted block">Full Name</span>
                    <span className="font-semibold text-text-primary">{selectedRequest.fullName}</span>
                  </div>
                  <div>
                    <span className="text-text-muted block">Registered Email</span>
                    <span className="font-semibold text-text-primary">{selectedRequest.email}</span>
                  </div>
                  <div>
                    <span className="text-text-muted block">Degree & Year</span>
                    <span className="font-semibold text-text-primary">{selectedRequest.degree} ({selectedRequest.year})</span>
                  </div>
                  <div>
                    <span className="text-text-muted block">Branch</span>
                    <span className="font-semibold text-text-primary">{selectedRequest.branch}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-text-muted block">College / Institute</span>
                    <span className="font-semibold text-text-primary">{selectedRequest.college}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-text-muted block">University</span>
                    <span className="font-semibold text-text-primary">{selectedRequest.university}</span>
                  </div>
                  {selectedRequest.rollNumber && (
                    <div>
                      <span className="text-text-muted block">Roll Number</span>
                      <span className="font-semibold text-text-primary">{selectedRequest.rollNumber}</span>
                    </div>
                  )}
                  {selectedRequest.graduationYear && (
                    <div>
                      <span className="text-text-muted block">Graduation Year</span>
                      <span className="font-semibold text-text-primary">{selectedRequest.graduationYear}</span>
                    </div>
                  )}
                  <div>
                    <span className="text-text-muted block">Request Timestamp</span>
                    <span className="font-semibold text-text-primary">
                      {selectedRequest.requestedAt ? new Date(selectedRequest.requestedAt).toLocaleString('en-IN') : '—'}
                    </span>
                  </div>
                  <div>
                    <span className="text-text-muted block">Current Status</span>
                    <span className="font-bold text-text-primary">{selectedRequest.status}</span>
                  </div>
                </div>

                {selectedRequest.reviewHistory && selectedRequest.reviewHistory.length > 0 && (
                  <div className="pt-3 border-t border-border-subtle">
                    <span className="text-xs font-bold text-text-muted uppercase block mb-2">Review History</span>
                    <div className="space-y-2">
                      {selectedRequest.reviewHistory.map((h, i) => (
                        <div key={i} className="bg-surface-alt p-2.5 rounded-xl border border-border-subtle text-[11px]">
                          <div className="flex items-center justify-between text-text-primary font-semibold">
                            <span>{h.action}</span>
                            <span className="text-text-muted font-normal">
                              {h.reviewedAt ? new Date(h.reviewedAt).toLocaleString('en-IN') : ''}
                            </span>
                          </div>
                          {h.reason && <p className="text-text-secondary mt-0.5">{h.reason}</p>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-2 text-right">
                  <button
                    type="button"
                    onClick={() => setSelectedRequest(null)}
                    className="btn-secondary text-xs py-2 px-4"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 4. ATTEMPT INSPECT MODAL */}
          {inspectAttempt && (
            <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
              <div className="bg-surface border border-border-subtle rounded-2xl max-w-2xl w-full p-6 shadow-2xl space-y-4 animate-in fade-in zoom-in-95 max-h-[90vh] overflow-y-auto">
                <div className="flex items-center justify-between border-b border-border-subtle pb-3">
                  <div>
                    <h3 className="text-base font-bold text-text-primary">Attempt Details</h3>
                    <p className="text-xs text-text-muted">
                      Candidate: <strong>{inspectAttempt.student?.name}</strong> • Score:{' '}
                      <strong className="text-emerald-500">{inspectAttempt.attempt?.score} / 40</strong> ({inspectAttempt.attempt?.percentage}%)
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setInspectAttempt(null)}
                    className="p-1 text-text-muted hover:text-text-primary"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-2 bg-surface-alt p-3 rounded-xl border border-border-subtle text-center text-xs">
                  <div>
                    <span className="text-text-muted block">Duration</span>
                    <span className="font-bold text-text-primary">{formatSec(inspectAttempt.attempt?.timeTakenSeconds)}</span>
                  </div>
                  <div>
                    <span className="text-text-muted block">Correct / Wrong</span>
                    <span className="font-bold text-emerald-500">{inspectAttempt.attempt?.correctCount}</span> /{' '}
                    <span className="font-bold text-rose-500">{inspectAttempt.attempt?.wrongCount}</span>
                  </div>
                  <div>
                    <span className="text-text-muted block">Submission Mode</span>
                    <span className="font-bold text-text-primary">{inspectAttempt.attempt?.submissionType}</span>
                  </div>
                </div>

                {/* Question items */}
                <div className="space-y-2">
                  <span className="text-xs font-bold text-text-muted uppercase block">Responses & Grading</span>
                  {inspectAttempt.questions?.map((q: any) => (
                    <div key={q.questionNumber} className="bg-surface-alt p-3 rounded-xl border border-border-subtle text-xs">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-text-primary">
                          Q{q.questionNumber}. [{q.sectionName}]
                        </span>
                        {q.isCorrect ? (
                          <span className="badge-success text-[10px] font-bold">+1 Mark</span>
                        ) : q.selectedOption != null ? (
                          <span className="badge-error text-[10px] font-bold">0 Marks (Incorrect)</span>
                        ) : (
                          <span className="badge-neutral text-[10px]">Unanswered</span>
                        )}
                      </div>
                      <p className="text-text-secondary text-[11px] mb-1.5">{q.questionText}</p>
                      <div className="text-[11px] text-text-muted">
                        Selected: <strong className="text-text-primary">{q.selectedOption != null ? `Option ${q.selectedOption + 1}` : 'None'}</strong> •
                        Correct: <strong className="text-emerald-500">Option {q.correctAnswer + 1}</strong>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-2 text-right">
                  <button
                    type="button"
                    onClick={() => setInspectAttempt(null)}
                    className="btn-secondary text-xs py-2 px-4"
                  >
                    Close
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminEngineering;

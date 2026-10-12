import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Cpu, Clock, Award, Calendar, CheckCircle2, AlertCircle, PlayCircle,
  HelpCircle, ArrowLeft, ArrowRight, ShieldAlert, Sparkles, Building2,
  GraduationCap, RefreshCw, FileText
} from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import { useAuth } from '../../context/AuthContext';
import {
  engineeringApi,
  StudentEngineeringStatus,
  EngineeringRequestRecord,
} from '../../services/engineering';

const BRANCH_OPTIONS = [
  'Computer Engineering',
  'Information Technology',
  'Electronics and Telecommunication (ENTC)',
  'Electrical Engineering',
  'Mechanical Engineering',
  'Civil Engineering',
  'AI & Data Science',
  'AI & Machine Learning',
  'Other',
];

const YEAR_OPTIONS = [
  '1st Year (FE)',
  '2nd Year (SE)',
  '3rd Year (TE)',
  '4th Year / Final Year (BE)',
];

const EngineeringPage: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [statusData, setStatusData] = useState<StudentEngineeringStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [isEditingRejected, setIsEditingRejected] = useState(false);

  // Form states
  const [fullName, setFullName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [degree, setDegree] = useState('B.E.');
  const [branch, setBranch] = useState('Computer Engineering');
  const [customBranch, setCustomBranch] = useState('');
  const [year, setYear] = useState('4th Year / Final Year (BE)');
  const [college, setCollege] = useState('');
  const [university, setUniversity] = useState('');
  const [rollNumber, setRollNumber] = useState('');
  const [graduationYear, setGraduationYear] = useState('2026');

  const loadStatus = useCallback(async () => {
    try {
      setLoading(true);
      const data = await engineeringApi.getStatus();
      setStatusData(data);
      if (data.request) {
        setFullName(data.request.fullName || user?.name || '');
        setEmail(data.request.email || user?.email || '');
        setDegree(data.request.degree || 'B.E.');
        if (BRANCH_OPTIONS.includes(data.request.branch)) {
          setBranch(data.request.branch);
        } else {
          setBranch('Other');
          setCustomBranch(data.request.branch);
        }
        setYear(data.request.year || '4th Year / Final Year (BE)');
        setCollege(data.request.college || '');
        setUniversity(data.request.university || '');
        setRollNumber(data.request.rollNumber || '');
        setGraduationYear(String(data.request.graduationYear || '2026'));
      }
    } catch (err: any) {
      toast.error('Failed to load engineering status.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!college.trim() || !university.trim()) {
      toast.error('Please enter your college and university name.');
      return;
    }

    const effectiveBranch = branch === 'Other' ? (customBranch.trim() || 'Other') : branch;

    setSubmitting(true);
    try {
      await engineeringApi.submitRequest({
        fullName: fullName.trim(),
        email: email.trim(),
        degree: degree.trim(),
        branch: effectiveBranch,
        year: year.trim(),
        college: college.trim(),
        university: university.trim(),
        rollNumber: rollNumber.trim() || undefined,
        graduationYear: graduationYear ? Number(graduationYear) : undefined,
      });

      toast.success('Your request to join the Engineering Exam has been submitted!');
      setIsEditingRejected(false);
      await loadStatus();
    } catch (err: any) {
      const msg = err.response?.data?.message || 'Failed to submit request.';
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartExam = () => {
    navigate('/student/engineering/take');
  };

  if (loading) {
    return (
      <div className="flex min-h-screen bg-page transition-colors">
        <Sidebar />
        <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="skeleton h-32 rounded-2xl" />
            <div className="skeleton h-96 rounded-2xl" />
          </div>
        </main>
      </div>
    );
  }

  const enrollmentStatus = statusData?.enrollmentStatus || 'NOT_REQUESTED';
  const attemptStatus = statusData?.attemptStatus || 'NOT_STARTED';
  const exam = statusData?.exam;
  const isClosed = exam?.isClosed || false;

  return (
    <div className="flex min-h-screen bg-page transition-colors">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between gap-4 mb-6">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-primary/10 text-brand-primary text-xs font-semibold mb-2">
                <Cpu className="w-3.5 h-3.5" /> BE Engineering Assessment
              </div>
              <h1 className="font-heading font-black text-2xl sm:text-3xl text-text-primary">
                LearnIQ BE Engineering <span className="text-gradient">Mock Test 2026</span>
              </h1>
              <p className="text-text-secondary text-sm mt-1">
                Official assessment for Bachelor of Engineering students (Others Category).
              </p>
            </div>
          </div>

          {/* STATE 1 & REJECTED RESUBMIT: Request Form */}
          {(enrollmentStatus === 'NOT_REQUESTED' || (enrollmentStatus === 'REJECTED' && isEditingRejected)) && (
            <div className="bg-surface border border-border-subtle rounded-3xl p-6 sm:p-8 shadow-soft">
              <div className="flex items-start gap-4 mb-6 pb-6 border-b border-border-subtle">
                <div className="w-12 h-12 rounded-2xl bg-brand-primary/10 text-brand-primary flex items-center justify-center flex-shrink-0">
                  <GraduationCap className="w-6 h-6" />
                </div>
                <div>
                  <h2 className="font-heading font-bold text-lg sm:text-xl text-text-primary">
                    Request to Join Engineering Examination
                  </h2>
                  <p className="text-text-secondary text-xs sm:text-sm mt-1">
                    This free mock examination is specifically configured for BE students. Complete the details below to request access.
                  </p>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-text-primary mb-1.5">Student Full Name *</label>
                    <input
                      type="text"
                      required
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-border-subtle bg-surface text-text-primary text-sm focus:border-brand-primary focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-primary mb-1.5">Registered Email *</label>
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-border-subtle bg-surface text-text-primary text-sm focus:border-brand-primary focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-text-primary mb-1.5">Degree *</label>
                    <input
                      type="text"
                      required
                      value={degree}
                      onChange={(e) => setDegree(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-border-subtle bg-surface text-text-primary text-sm focus:border-brand-primary focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-primary mb-1.5">Engineering Branch *</label>
                    <select
                      value={branch}
                      onChange={(e) => setBranch(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-border-subtle bg-surface text-text-primary text-sm focus:border-brand-primary focus:outline-none"
                    >
                      {BRANCH_OPTIONS.map((b) => (
                        <option key={b} value={b}>{b}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-primary mb-1.5">Current Year *</label>
                    <select
                      value={year}
                      onChange={(e) => setYear(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-border-subtle bg-surface text-text-primary text-sm focus:border-brand-primary focus:outline-none"
                    >
                      {YEAR_OPTIONS.map((y) => (
                        <option key={y} value={y}>{y}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {branch === 'Other' && (
                  <div>
                    <label className="block text-xs font-semibold text-text-primary mb-1.5">Specify Other Branch *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Aeronautical Engineering"
                      value={customBranch}
                      onChange={(e) => setCustomBranch(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-border-subtle bg-surface text-text-primary text-sm focus:border-brand-primary focus:outline-none"
                    />
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-text-primary mb-1.5">College / Institute Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Pune Institute of Computer Technology"
                      value={college}
                      onChange={(e) => setCollege(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-border-subtle bg-surface text-text-primary text-sm focus:border-brand-primary focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-primary mb-1.5">University Name *</label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Savitribai Phule Pune University"
                      value={university}
                      onChange={(e) => setUniversity(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-border-subtle bg-surface text-text-primary text-sm focus:border-brand-primary focus:outline-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-text-primary mb-1.5">Roll Number / PRN (Optional)</label>
                    <input
                      type="text"
                      placeholder="e.g. 72149832K"
                      value={rollNumber}
                      onChange={(e) => setRollNumber(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-border-subtle bg-surface text-text-primary text-sm focus:border-brand-primary focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-text-primary mb-1.5">Expected Graduation Year</label>
                    <input
                      type="number"
                      value={graduationYear}
                      onChange={(e) => setGraduationYear(e.target.value)}
                      className="w-full px-4 py-2.5 rounded-xl border border-border-subtle bg-surface text-text-primary text-sm focus:border-brand-primary focus:outline-none"
                    />
                  </div>
                </div>

                <div className="pt-4 flex items-center justify-between gap-4">
                  {isEditingRejected && (
                    <button
                      type="button"
                      onClick={() => setIsEditingRejected(false)}
                      className="btn-secondary text-xs py-2.5 px-4"
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={submitting}
                    className="btn-primary text-sm py-3 px-6 ml-auto flex items-center gap-2 shadow-md hover:shadow-lg transition-all"
                  >
                    {submitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" /> Submitting Request...
                      </>
                    ) : (
                      <>
                        <span>REQUEST TO JOIN ENGINEERING EXAM</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* STATE 2: Pending Approval */}
          {enrollmentStatus === 'PENDING' && (
            <div className="bg-surface border border-amber-200 dark:border-amber-900/50 rounded-3xl p-6 sm:p-8 shadow-soft">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-amber-100 dark:bg-amber-950/60 text-amber-600 flex items-center justify-center flex-shrink-0">
                  <Clock className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2.5 py-0.5 rounded-md bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 text-xs font-bold uppercase tracking-wider">
                      PENDING APPROVAL
                    </span>
                    <span className="text-xs text-text-muted">
                      Requested on {new Date(statusData?.request?.requestedAt || '').toLocaleDateString('en-IN')}
                    </span>
                  </div>
                  <h2 className="font-heading font-bold text-lg sm:text-xl text-text-primary">
                    Your Engineering Request Is Awaiting Review
                  </h2>
                  <p className="text-text-secondary text-sm mt-2 leading-relaxed">
                    Thank you for applying for the <strong>LearnIQ BE Engineering Mock Test 2026</strong>. An administrator must verify and approve your request before you can start the examination.
                  </p>

                  <div className="mt-6 p-4 rounded-2xl bg-surface-alt border border-border-subtle grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                    <div>
                      <p className="text-text-muted">Degree / Year</p>
                      <p className="font-semibold text-text-primary mt-0.5">{statusData?.request?.degree} · {statusData?.request?.year}</p>
                    </div>
                    <div>
                      <p className="text-text-muted">Branch</p>
                      <p className="font-semibold text-text-primary mt-0.5">{statusData?.request?.branch}</p>
                    </div>
                    <div>
                      <p className="text-text-muted">College</p>
                      <p className="font-semibold text-text-primary mt-0.5 truncate">{statusData?.request?.college}</p>
                    </div>
                    <div>
                      <p className="text-text-muted">University</p>
                      <p className="font-semibold text-text-primary mt-0.5 truncate">{statusData?.request?.university}</p>
                    </div>
                  </div>

                  <div className="mt-6 flex items-center gap-3">
                    <button
                      onClick={loadStatus}
                      className="btn-secondary text-xs py-2 px-4 inline-flex items-center gap-1.5"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Check Approval Status
                    </button>
                    <Link to="/student" className="text-xs text-text-muted hover:text-text-primary">
                      Back to Dashboard
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STATE 3: Approved -> Official Mock Test Card */}
          {enrollmentStatus === 'APPROVED' && (
            <div className="space-y-6">
              <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-[#6C63F2]/10 via-[#0284C7]/5 to-[#4ADE9A]/10 border border-brand-primary/20 p-6 sm:p-8 shadow-soft">
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-6">
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <span className="px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs font-bold inline-flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" /> APPROVED STUDENT
                      </span>
                      <span className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 text-xs font-bold">
                        FREE — ₹0
                      </span>
                      {isClosed && (
                        <span className="px-3 py-1 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 text-xs font-bold">
                          EXAMINATION CLOSED
                        </span>
                      )}
                    </div>

                    <h2 className="font-heading font-black text-2xl sm:text-3xl text-text-primary tracking-tight">
                      {exam?.title || 'LearnIQ BE Engineering Mock Test 2026'}
                    </h2>
                    <p className="text-text-secondary text-sm mt-1 font-medium">
                      {exam?.subtitle || 'BE Engineering Students Assessment — LearnIQ'}
                    </p>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6">
                      <div className="bg-surface/80 backdrop-blur-sm border border-border-subtle rounded-2xl p-3 text-center">
                        <p className="text-text-muted text-[11px] font-medium">Total Questions</p>
                        <p className="font-heading font-black text-lg text-text-primary mt-0.5">40</p>
                      </div>
                      <div className="bg-surface/80 backdrop-blur-sm border border-border-subtle rounded-2xl p-3 text-center">
                        <p className="text-text-muted text-[11px] font-medium">Maximum Marks</p>
                        <p className="font-heading font-black text-lg text-text-primary mt-0.5">40</p>
                      </div>
                      <div className="bg-surface/80 backdrop-blur-sm border border-border-subtle rounded-2xl p-3 text-center">
                        <p className="text-text-muted text-[11px] font-medium">Duration</p>
                        <p className="font-heading font-black text-lg text-text-primary mt-0.5">45 Mins</p>
                      </div>
                      <div className="bg-surface/80 backdrop-blur-sm border border-border-subtle rounded-2xl p-3 text-center">
                        <p className="text-text-muted text-[11px] font-medium">Negative Marking</p>
                        <p className="font-heading font-black text-lg text-emerald-600 dark:text-emerald-400 mt-0.5">None</p>
                      </div>
                    </div>

                    <div className="mt-5 flex items-center gap-2 text-xs text-text-secondary">
                      <Calendar className="w-4 h-4 text-brand-primary" />
                      <span>Authoritative Deadline: <strong>13 October 2026 at 6:00 PM IST</strong></span>
                    </div>
                  </div>
                </div>

                <div className="mt-8 pt-6 border-t border-border-subtle/80 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="text-xs text-text-muted text-center sm:text-left">
                    Single attempt allowed per student · Answers saved automatically
                  </div>

                  <div>
                    {attemptStatus === 'NOT_STARTED' && (
                      <button
                        onClick={handleStartExam}
                        disabled={isClosed}
                        className={`btn-primary text-sm py-3 px-8 flex items-center gap-2 shadow-md hover:shadow-lg transition-all ${
                          isClosed ? 'opacity-50 cursor-not-allowed' : ''
                        }`}
                      >
                        <PlayCircle className="w-5 h-5" />
                        <span>{isClosed ? 'Examination Closed' : 'START EXAM'}</span>
                      </button>
                    )}

                    {attemptStatus === 'IN_PROGRESS' && (
                      <button
                        onClick={handleStartExam}
                        className="btn-primary text-sm py-3 px-8 flex items-center gap-2 shadow-md bg-amber-600 hover:bg-amber-700 transition-all"
                      >
                        <PlayCircle className="w-5 h-5" />
                        <span>RESUME EXAM IN PROGRESS</span>
                      </button>
                    )}

                    {(attemptStatus === 'COMPLETED' || attemptStatus === 'AUTO_SUBMITTED' || attemptStatus === 'EXPIRED') && (
                      <button
                        onClick={() => navigate('/student/engineering/result')}
                        className="btn-primary text-sm py-3 px-8 flex items-center gap-2 shadow-md hover:shadow-lg transition-all"
                      >
                        <Award className="w-5 h-5" />
                        <span>VIEW YOUR RESULT & REVIEW</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Syllabus & Section Details */}
              <div className="bg-surface border border-border-subtle rounded-3xl p-6 shadow-soft">
                <h3 className="font-heading font-bold text-base text-text-primary mb-4 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-brand-primary" /> Section Distribution (40 Questions)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  <div className="p-3.5 rounded-2xl bg-surface-alt border border-border-subtle">
                    <p className="text-xs font-semibold text-text-primary">Sec A. Programming Languages</p>
                    <p className="text-[11px] text-text-muted mt-0.5">Java, Python, C++ · 10 Questions (10 Marks)</p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-surface-alt border border-border-subtle">
                    <p className="text-xs font-semibold text-text-primary">Sec B. Operating Systems</p>
                    <p className="text-[11px] text-text-muted mt-0.5">Processes, Deadlocks, Memory · 5 Questions (5 Marks)</p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-surface-alt border border-border-subtle">
                    <p className="text-xs font-semibold text-text-primary">Sec C. DBMS</p>
                    <p className="text-[11px] text-text-muted mt-0.5">ACID, 3NF, SQL, Indexing · 5 Questions (5 Marks)</p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-surface-alt border border-border-subtle">
                    <p className="text-xs font-semibold text-text-primary">Sec D. Logical Reasoning & Aptitude</p>
                    <p className="text-[11px] text-text-muted mt-0.5">Time & Work, Sequences, Logic · 5 Questions (5 Marks)</p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-surface-alt border border-border-subtle">
                    <p className="text-xs font-semibold text-text-primary">Sec E. OOP Principles</p>
                    <p className="text-[11px] text-text-muted mt-0.5">Encapsulation, Polymorphism, LSP · 5 Questions (5 Marks)</p>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-surface-alt border border-border-subtle">
                    <p className="text-xs font-semibold text-text-primary">Sec F. DSA Theory</p>
                    <p className="text-[11px] text-text-muted mt-0.5">Trees, Graphs, Sorting, Stacks · 10 Questions (10 Marks)</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STATE 4: Rejected */}
          {enrollmentStatus === 'REJECTED' && !isEditingRejected && (
            <div className="bg-surface border border-rose-200 dark:border-rose-900/50 rounded-3xl p-6 sm:p-8 shadow-soft">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-2xl bg-rose-100 dark:bg-rose-950/60 text-rose-600 flex items-center justify-center flex-shrink-0">
                  <ShieldAlert className="w-6 h-6" />
                </div>
                <div className="flex-1 min-w-0">
                  <span className="px-2.5 py-0.5 rounded-md bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-400 text-xs font-bold uppercase tracking-wider">
                    REQUEST NOT APPROVED
                  </span>
                  <h2 className="font-heading font-bold text-lg sm:text-xl text-text-primary mt-1">
                    Your Engineering Request Was Rejected
                  </h2>
                  <div className="mt-3 p-4 rounded-2xl bg-rose-50/50 dark:bg-rose-950/20 border border-rose-200/50 text-xs text-rose-800 dark:text-rose-300">
                    <p className="font-semibold mb-1">Reason provided by administrator:</p>
                    <p>{statusData?.request?.rejectionReason || 'Details provided did not meet BE engineering assessment criteria.'}</p>
                  </div>
                  <p className="text-text-secondary text-xs sm:text-sm mt-3">
                    If this was due to incorrect information, you may update your details and submit a new request.
                  </p>
                  <div className="mt-6 flex items-center gap-3">
                    <button
                      onClick={() => setIsEditingRejected(true)}
                      className="btn-primary text-xs py-2.5 px-5"
                    >
                      Correct Details & Resubmit
                    </button>
                    <Link to="/student" className="btn-secondary text-xs py-2.5 px-4">
                      Return to Dashboard
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default EngineeringPage;

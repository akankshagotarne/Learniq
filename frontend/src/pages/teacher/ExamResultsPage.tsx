import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  BarChart2, Users, Award, Clock, ChevronLeft, Search,
  CheckCircle, XCircle, AlertTriangle, ShieldAlert, Sparkles,
  HelpCircle, TrendingUp, Check
} from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { Exam, ExamAttempt } from '../../types';
import toast from 'react-hot-toast';

interface QuestionAnalytic {
  questionId: string;
  question: string;
  correctAnswer: number;
  totalAnswered: number;
  correctCount: number;
  correctRate: number;
  optionCounts: number[];
}

const ExamResultsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [exam, setExam] = useState<Exam | null>(null);
  const [attempts, setAttempts] = useState<ExamAttempt[]>([]);
  const [questionAnalytics, setQuestionAnalytics] = useState<QuestionAnalytic[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'students' | 'questions'>('students');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchResults();
  }, [id]);

  const fetchResults = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/teacher/exams/${id}/attempts`);
      setExam(res.data.exam);
      setAttempts(res.data.attempts || []);
      setQuestionAnalytics(res.data.questionAnalytics || []);
    } catch (err: any) {
      toast.error('Failed to load exam results.');
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const filteredAttempts = attempts.filter(a => {
    const student = typeof a.student === 'object' ? a.student : null;
    const name = student?.name || '';
    const email = student?.email || '';
    return name.toLowerCase().includes(searchQuery.toLowerCase()) || email.toLowerCase().includes(searchQuery.toLowerCase());
  });

  // Analytics aggregates
  const totalSubmissions = attempts.length;
  const avgPercentage = totalSubmissions > 0
    ? Math.round(attempts.reduce((sum, a) => sum + (a.percentage || 0), 0) / totalSubmissions)
    : 0;
  const highestScore = totalSubmissions > 0
    ? Math.max(...attempts.map(a => a.score))
    : 0;
  const passingMarks = exam?.passingMarks || 0;
  const passCount = attempts.filter(a => a.score >= passingMarks).length;
  const passRate = totalSubmissions > 0 ? Math.round((passCount / totalSubmissions) * 100) : 0;

  if (loading) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-3 border-brand-primary/30 border-t-brand-primary rounded-full animate-spin mx-auto mb-3" />
          <p className="text-text-muted text-sm">Aggregating class performance data...</p>
        </div>
      </div>
    );
  }

  if (!exam) {
    return (
      <div className="flex min-h-screen bg-page">
        <Sidebar />
        <main className="flex-1 ml-0 md:ml-64 pt-14 md:pt-0 p-8 text-center">
          <p className="text-text-muted text-sm">Exam not found.</p>
          <Link to="/teacher/exams" className="btn-primary mt-4 inline-block text-xs">
            Back to Exams
          </Link>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen bg-page transition-colors">
      <Sidebar />
      <main className="flex-1 ml-0 md:ml-64 pt-14 md:pt-0 transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border-subtle pb-4">
            <div>
              <Link
                to="/teacher/exams"
                className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary mb-2 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" /> Back to Exams
              </Link>
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="badge-primary text-[10px] py-0 px-2 font-bold">
                  Std {exam.standard} • {exam.subject}
                </span>
                {exam.chapter && (
                  <span className="text-xs text-text-muted font-medium">
                    Chapter: {exam.chapter}
                  </span>
                )}
              </div>
              <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">
                {exam.title} — Analytics & Results
              </h1>
            </div>

            <div className="flex items-center gap-3">
              <Link
                to={`/teacher/exams/${exam._id}/edit`}
                className="btn-secondary text-xs py-2 px-4 rounded-xl font-bold"
              >
                Edit Exam
              </Link>
            </div>
          </div>

          {/* Overview Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="card-soft p-4 rounded-2xl border border-border-subtle bg-surface flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#6C63F2]/10 text-brand-primary flex items-center justify-center font-bold">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">Total Submissions</p>
                <p className="text-xl font-heading font-bold text-text-primary">{totalSubmissions}</p>
              </div>
            </div>

            <div className="card-soft p-4 rounded-2xl border border-border-subtle bg-surface flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#4ADE9A]/15 text-[#4ADE9A] flex items-center justify-center font-bold">
                <TrendingUp className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">Class Average</p>
                <p className="text-xl font-heading font-bold text-text-primary">{avgPercentage}%</p>
              </div>
            </div>

            <div className="card-soft p-4 rounded-2xl border border-border-subtle bg-surface flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FFC24B]/15 text-[#FFC24B] flex items-center justify-center font-bold">
                <Award className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">Highest Score</p>
                <p className="text-xl font-heading font-bold text-text-primary">
                  {highestScore} <span className="text-xs text-text-muted">/ {exam.totalMarks}</span>
                </p>
              </div>
            </div>

            <div className="card-soft p-4 rounded-2xl border border-border-subtle bg-surface flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#5AC8FA]/15 text-[#5AC8FA] flex items-center justify-center font-bold">
                <CheckCircle className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">Passing Rate</p>
                <p className="text-xl font-heading font-bold text-text-primary">{passRate}%</p>
              </div>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex bg-surface-alt p-1 rounded-xl border border-border-subtle self-start max-w-md">
            <button
              onClick={() => setActiveTab('students')}
              className={`flex-1 py-2 px-4 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'students'
                  ? 'bg-brand-primary text-white shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Student Submissions ({totalSubmissions})
            </button>
            <button
              onClick={() => setActiveTab('questions')}
              className={`flex-1 py-2 px-4 rounded-lg text-xs font-semibold transition-all ${
                activeTab === 'questions'
                  ? 'bg-brand-primary text-white shadow-sm'
                  : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              Question Analytics ({questionAnalytics.length})
            </button>
          </div>

          {/* TAB 1: Student Submissions */}
          {activeTab === 'students' && (
            <div className="card-soft rounded-2xl border border-border-subtle bg-surface overflow-hidden shadow-sm">
              <div className="p-4 border-b border-border-subtle flex items-center justify-between gap-3">
                <div className="relative flex-1 max-w-sm">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                  <input
                    type="text"
                    placeholder="Search student by name or email..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-4 py-2 bg-surface-alt border border-border-subtle rounded-xl text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary"
                  />
                </div>
              </div>

              {filteredAttempts.length === 0 ? (
                <div className="p-12 text-center text-xs text-text-secondary">
                  No student submissions found matching your search.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-surface-alt border-b border-border-subtle text-text-muted uppercase text-[10px] font-bold">
                      <tr>
                        <th className="py-3 px-4">Rank</th>
                        <th className="py-3 px-4">Student</th>
                        <th className="py-3 px-4">Score</th>
                        <th className="py-3 px-4">Percentage</th>
                        <th className="py-3 px-4">Time Taken</th>
                        <th className="py-3 px-4">Integrity / Proctoring</th>
                        <th className="py-3 px-4">Submitted At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-subtle">
                      {filteredAttempts.map((att, idx) => {
                        const studentObj = typeof att.student === 'object' ? att.student : null;
                        const eventCount = att.integrityEvents?.length || 0;

                        return (
                          <tr key={att._id} className="hover:bg-surface-alt/60 transition-colors">
                            <td className="py-3.5 px-4 font-bold text-text-primary">
                              {idx === 0 ? (
                                <span className="w-6 h-6 rounded-full bg-[#FFC24B]/20 text-[#FFC24B] flex items-center justify-center font-black text-xs">
                                  1
                                </span>
                              ) : idx === 1 ? (
                                <span className="w-6 h-6 rounded-full bg-[#A0A3C0]/20 text-[#A0A3C0] flex items-center justify-center font-black text-xs">
                                  2
                                </span>
                              ) : idx === 2 ? (
                                <span className="w-6 h-6 rounded-full bg-[#D97706]/20 text-[#D97706] flex items-center justify-center font-black text-xs">
                                  3
                                </span>
                              ) : (
                                `#${idx + 1}`
                              )}
                            </td>

                            <td className="py-3.5 px-4">
                              <div className="flex items-center gap-2.5">
                                <img
                                  src={
                                    studentObj?.avatar ||
                                    `https://ui-avatars.com/api/?name=${encodeURIComponent(studentObj?.name || 'Student')}&background=6C63F2&color=fff&size=32`
                                  }
                                  alt={studentObj?.name || 'Student'}
                                  className="w-7 h-7 rounded-full object-cover"
                                />
                                <div>
                                  <p className="font-semibold text-text-primary">
                                    {studentObj?.name || 'Unknown Student'}
                                  </p>
                                  <p className="text-[10px] text-text-muted">{studentObj?.email}</p>
                                </div>
                              </div>
                            </td>

                            <td className="py-3.5 px-4 font-bold text-text-primary">
                              {att.score} / {att.totalMarks}
                            </td>

                            <td className="py-3.5 px-4">
                              <span
                                className={`font-bold px-2 py-0.5 rounded-md ${
                                  att.percentage >= 75
                                    ? 'bg-[#4ADE9A]/15 text-[#16A34A] dark:text-[#4ADE9A]'
                                    : att.percentage >= 50
                                    ? 'bg-[#FFC24B]/15 text-[#D97706]'
                                    : 'bg-[#E1447A]/15 text-[#E1447A]'
                                }`}
                              >
                                {att.percentage}%
                              </span>
                            </td>

                            <td className="py-3.5 px-4 text-text-secondary">
                              <div className="flex items-center gap-1">
                                <Clock className="w-3.5 h-3.5 text-text-muted" />
                                <span>{formatTime(att.timeTaken)}</span>
                              </div>
                            </td>

                            <td className="py-3.5 px-4">
                              {eventCount > 0 ? (
                                <span className="badge-error text-[10px] py-0.5 px-2 flex items-center gap-1 font-semibold">
                                  <AlertTriangle className="w-3 h-3" /> {eventCount} incidents
                                </span>
                              ) : (
                                <span className="badge-success text-[10px] py-0.5 px-2 flex items-center gap-1 font-semibold">
                                  <CheckCircle className="w-3 h-3" /> Clean attempt
                                </span>
                              )}
                            </td>

                            <td className="py-3.5 px-4 text-text-muted text-[11px]">
                              {att.submittedAt ? new Date(att.submittedAt).toLocaleString() : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Per-Question Analytics */}
          {activeTab === 'questions' && (
            <div className="space-y-4">
              {questionAnalytics.map((qa, index) => {
                const isTricky = qa.correctRate < 50;

                return (
                  <div
                    key={qa.questionId || index}
                    className="card-soft p-5 rounded-2xl border border-border-subtle bg-surface space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-xl bg-brand-primary/10 text-brand-primary font-bold text-xs flex items-center justify-center">
                          Q{index + 1}
                        </span>
                        <span className="font-heading font-bold text-sm text-text-primary">
                          {qa.question}
                        </span>
                      </div>

                      <span
                        className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                          isTricky
                            ? 'bg-[#E1447A]/15 text-[#E1447A]'
                            : 'bg-[#4ADE9A]/15 text-[#16A34A] dark:text-[#4ADE9A]'
                        }`}
                      >
                        {qa.correctRate}% Correct ({qa.correctCount}/{qa.totalAnswered})
                      </span>
                    </div>

                    {/* Options Breakdown Bars */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-2">
                      {qa.optionCounts.map((count, optIdx) => {
                        const isCorrectOption = qa.correctAnswer === optIdx;
                        const percentage = qa.totalAnswered > 0 ? Math.round((count / qa.totalAnswered) * 100) : 0;

                        return (
                          <div
                            key={optIdx}
                            className={`p-3 rounded-xl border flex flex-col justify-between transition-all ${
                              isCorrectOption
                                ? 'border-[#4ADE9A] bg-[#4ADE9A]/10 text-text-primary'
                                : 'border-border-subtle bg-surface-alt text-text-secondary'
                            }`}
                          >
                            <div className="flex items-center justify-between mb-2">
                              <span className="font-bold flex items-center gap-1">
                                Option {String.fromCharCode(65 + optIdx)}
                                {isCorrectOption && (
                                  <span className="text-[10px] text-[#16A34A] dark:text-[#4ADE9A] font-extrabold flex items-center">
                                    <Check className="w-3 h-3" />
                                  </span>
                                )}
                              </span>
                              <span className="font-mono text-xs">{percentage}%</span>
                            </div>

                            {/* Bar Visualizer */}
                            <div className="h-1.5 w-full bg-border-subtle rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${isCorrectOption ? 'bg-[#4ADE9A]' : 'bg-brand-primary'}`}
                                style={{ width: `${percentage}%` }}
                              />
                            </div>

                            <span className="text-[10px] text-text-muted mt-2">
                              {count} students chose this
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default ExamResultsPage;

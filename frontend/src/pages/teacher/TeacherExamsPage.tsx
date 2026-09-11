import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  ClipboardList, Plus, Search, Filter, Clock, HelpCircle,
  Award, Eye, Edit3, Trash2, CheckCircle2, AlertCircle,
  Users, BarChart2, Calendar, Globe, Lock, MoreVertical,
  RotateCcw
} from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { Exam } from '../../types';
import toast from 'react-hot-toast';

const getSubjectBadgeClass = (subject: string) => {
  const s = subject.toLowerCase();
  if (s.includes('math')) return 'badge-subject-math';
  if (s.includes('science') || s.includes('evs')) return 'badge-subject-science';
  if (s.includes('marathi') || s.includes('english') || s.includes('language')) return 'badge-subject-languages';
  return 'badge-primary';
};

const TeacherExamsPage: React.FC = () => {
  const navigate = useNavigate();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [standardFilter, setStandardFilter] = useState<string>('All');
  const [statusFilter, setStatusFilter] = useState<string>('All');

  useEffect(() => {
    fetchExams();
  }, []);

  const fetchExams = async () => {
    setLoading(true);
    try {
      const res = await api.get('/teacher/exams');
      setExams(res.data.exams || []);
    } catch (err) {
      console.error('Failed to load teacher exams', err);
      toast.error('Failed to load exams.');
    } finally {
      setLoading(false);
    }
  };

  const handleTogglePublish = async (examId: string, currentStatus: boolean, questionCount: number) => {
    if (!currentStatus && questionCount === 0) {
      toast.error('Please add at least one question before publishing.');
      return;
    }

    try {
      const res = await api.put(`/exams/${examId}/publish`);
      toast.success(res.data.isPublished ? 'Exam published!' : 'Exam unpublished (saved as draft).');
      setExams(prev =>
        prev.map(e => (e._id === examId ? { ...e, isPublished: res.data.isPublished } : e))
      );
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to update publish state');
    }
  };

  const handleDelete = async (examId: string, title: string) => {
    if (!window.confirm(`Are you sure you want to delete "${title}"? All student attempts will also be removed.`)) {
      return;
    }

    try {
      await api.delete(`/exams/${examId}`);
      toast.success('Exam deleted.');
      setExams(prev => prev.filter(e => e._id !== examId));
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to delete exam');
    }
  };

  const filteredExams = exams.filter(e => {
    const matchesSearch = e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.subject && e.subject.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (e.chapter && e.chapter.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesStd = standardFilter === 'All' || e.standard.toString() === standardFilter;
    const matchesStatus =
      statusFilter === 'All' ||
      (statusFilter === 'Published' && e.isPublished) ||
      (statusFilter === 'Draft' && !e.isPublished);

    return matchesSearch && matchesStd && matchesStatus;
  });

  const totalAttempts = exams.reduce((sum, e) => sum + (e.attemptCount || 0), 0);
  const publishedCount = exams.filter(e => e.isPublished).length;

  return (
    <div className="flex min-h-screen bg-page transition-colors">
      <Sidebar />
      <main className="flex-1 ml-0 md:ml-64 pt-14 md:pt-0 transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="p-2 rounded-xl bg-[#6C63F2]/10 text-brand-primary">
                  <ClipboardList className="w-5 h-5" />
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-brand-primary">
                  Assessment Management
                </span>
              </div>
              <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">
                Exams & Question Papers
              </h1>
              <p className="text-text-secondary text-sm mt-1">
                Author MCQ examinations, set negative marking rules, and inspect class performance
              </p>
            </div>

            <Link
              to="/teacher/exams/new"
              className="btn-primary self-start sm:self-auto py-2.5 px-5 rounded-xl text-xs font-bold flex items-center gap-2 shadow-lg shadow-brand-primary/20"
            >
              <Plus className="w-4 h-4" /> Create New Exam
            </Link>
          </div>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-8">
            <div className="card-soft p-4 flex items-center gap-3 bg-surface">
              <div className="w-10 h-10 rounded-xl bg-[#6C63F2]/10 text-brand-primary flex items-center justify-center font-bold">
                <ClipboardList className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">Total Exams</p>
                <p className="text-xl font-heading font-bold text-text-primary">{exams.length}</p>
              </div>
            </div>

            <div className="card-soft p-4 flex items-center gap-3 bg-surface">
              <div className="w-10 h-10 rounded-xl bg-[#4ADE9A]/15 text-[#4ADE9A] flex items-center justify-center font-bold">
                <Globe className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">Published</p>
                <p className="text-xl font-heading font-bold text-text-primary">{publishedCount}</p>
              </div>
            </div>

            <div className="card-soft p-4 flex items-center gap-3 bg-surface">
              <div className="w-10 h-10 rounded-xl bg-[#FFC24B]/15 text-[#FFC24B] flex items-center justify-center font-bold">
                <Lock className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">Drafts</p>
                <p className="text-xl font-heading font-bold text-text-primary">
                  {exams.length - publishedCount}
                </p>
              </div>
            </div>

            <div className="card-soft p-4 flex items-center gap-3 bg-surface">
              <div className="w-10 h-10 rounded-xl bg-[#5AC8FA]/15 text-[#5AC8FA] flex items-center justify-center font-bold">
                <Users className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">Student Submissions</p>
                <p className="text-xl font-heading font-bold text-text-primary">{totalAttempts}</p>
              </div>
            </div>
          </div>

          {/* Filter Toolbar */}
          <div className="card-soft p-4 rounded-2xl border border-border-subtle bg-surface mb-6 flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
              <input
                type="text"
                placeholder="Search exams by title, subject or chapter..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2 bg-surface-alt border border-border-subtle rounded-xl text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary transition-all"
              />
            </div>

            <div className="flex items-center gap-2">
              <select
                value={standardFilter}
                onChange={e => setStandardFilter(e.target.value)}
                className="px-3 py-2 bg-surface-alt border border-border-subtle rounded-xl text-xs text-text-primary focus:outline-none focus:border-brand-primary"
              >
                <option value="All">All Standards</option>
                {[...Array(10)].map((_, i) => (
                  <option key={i + 1} value={String(i + 1)}>
                    Std {i + 1}
                  </option>
                ))}
              </select>

              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="px-3 py-2 bg-surface-alt border border-border-subtle rounded-xl text-xs text-text-primary focus:outline-none focus:border-brand-primary"
              >
                <option value="All">All Status</option>
                <option value="Published">Published</option>
                <option value="Draft">Draft</option>
              </select>
            </div>
          </div>

          {/* Exams List */}
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="card-soft h-56 rounded-2xl animate-pulse bg-surface-alt" />
              ))}
            </div>
          ) : filteredExams.length === 0 ? (
            <div className="card-soft p-12 text-center max-w-md mx-auto my-8 bg-surface">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-[#6C63F2]/10 text-brand-primary flex items-center justify-center mb-4">
                <ClipboardList className="w-7 h-7" />
              </div>
              <h3 className="font-heading font-bold text-lg text-text-primary mb-1">
                No exams found
              </h3>
              <p className="text-xs text-text-secondary mb-5">
                {exams.length === 0
                  ? 'You have not authored any exams yet. Click below to build your first standardized test.'
                  : 'No exams match your active filter criteria.'}
              </p>
              {exams.length === 0 ? (
                <Link
                  to="/teacher/exams/new"
                  className="btn-primary text-xs py-2.5 px-4 inline-flex items-center gap-2"
                >
                  <Plus className="w-4 h-4" /> Create Your First Exam
                </Link>
              ) : (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    setStandardFilter('All');
                    setStatusFilter('All');
                  }}
                  className="btn-secondary text-xs py-2 px-4"
                >
                  Reset Filters
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredExams.map(exam => {
                const questionCount = exam.questions?.length || exam.questionCount || 0;

                return (
                  <div
                    key={exam._id}
                    className="card-soft p-5 flex flex-col justify-between hover:shadow-lg transition-all border border-border-subtle rounded-2xl bg-surface group"
                  >
                    <div>
                      {/* Top Badges */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="badge-primary text-[10px] py-0 px-2">
                            Std {exam.standard}
                          </span>
                          <span className={`${getSubjectBadgeClass(exam.subject)} text-[10px] font-semibold px-2 py-0.5 rounded-full`}>
                            {exam.subject}
                          </span>
                        </div>

                        <button
                          onClick={() => handleTogglePublish(exam._id, exam.isPublished, questionCount)}
                          title="Click to toggle publish status"
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1 transition-all ${
                            exam.isPublished
                              ? 'bg-[#4ADE9A]/15 text-[#16A34A] dark:text-[#4ADE9A] hover:bg-[#4ADE9A]/25'
                              : 'bg-surface-alt text-text-muted hover:text-text-primary border border-border-subtle'
                          }`}
                        >
                          {exam.isPublished ? (
                            <>
                              <Globe className="w-3 h-3" /> Published
                            </>
                          ) : (
                            <>
                              <Lock className="w-3 h-3" /> Draft
                            </>
                          )}
                        </button>
                      </div>

                      {/* Title & Chapter */}
                      <h3 className="font-heading font-bold text-base text-text-primary group-hover:text-brand-primary transition-colors line-clamp-2">
                        {exam.title}
                      </h3>

                      {exam.chapter && (
                        <p className="text-xs text-text-muted mt-0.5">
                          Chapter: {exam.chapter}
                        </p>
                      )}

                      {/* Specs */}
                      <div className="grid grid-cols-2 gap-2 my-4 p-3 bg-surface-alt rounded-xl border border-border-subtle text-xs">
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <Clock className="w-3.5 h-3.5 text-brand-primary flex-shrink-0" />
                          <span>{exam.durationMinutes} mins</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <HelpCircle className="w-3.5 h-3.5 text-[#5AC8FA] flex-shrink-0" />
                          <span>{questionCount} Questions</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <Award className="w-3.5 h-3.5 text-[#FFC24B] flex-shrink-0" />
                          <span>{exam.totalMarks} Marks</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <Users className="w-3.5 h-3.5 text-[#4ADE9A] flex-shrink-0" />
                          <span>{exam.attemptCount || 0} Submissions</span>
                        </div>
                      </div>

                      {/* Negative Marking tag */}
                      {exam.negativeMarking && (
                        <div className="text-[11px] text-[#E1447A] mb-3 flex items-center gap-1">
                          <AlertCircle className="w-3 h-3" />
                          <span>Negative Marking enabled (-{exam.negativeMarkValue} per wrong)</span>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="pt-3 border-t border-border-subtle space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <Link
                          to={`/teacher/exams/${exam._id}/results`}
                          className="btn-secondary text-xs py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 font-bold"
                        >
                          <BarChart2 className="w-3.5 h-3.5 text-brand-primary" /> Analytics
                        </Link>

                        <Link
                          to={`/teacher/exams/${exam._id}/edit`}
                          className="btn-secondary text-xs py-2 px-3 rounded-xl flex items-center justify-center gap-1.5 font-bold"
                        >
                          <Edit3 className="w-3.5 h-3.5 text-[#5AC8FA]" /> Edit Questions
                        </Link>
                      </div>

                      <div className="flex items-center justify-between pt-1">
                        <span className="text-[10px] text-text-muted">
                          Created {new Date(exam.createdAt).toLocaleDateString()}
                        </span>

                        <button
                          onClick={() => handleDelete(exam._id, exam.title)}
                          className="text-[11px] text-[#E1447A] hover:bg-[#E1447A]/10 p-1.5 rounded-lg transition-colors flex items-center gap-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" /> Delete
                        </button>
                      </div>
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

export default TeacherExamsPage;

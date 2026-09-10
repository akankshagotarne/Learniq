import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ClipboardList, Clock, HelpCircle, CheckCircle2, AlertCircle,
  Calendar, Award, ChevronRight, Filter, Search, RotateCcw,
  Sparkles, CheckCircle, Flame, BookOpen
} from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { Exam } from '../../types';
import { useAuth } from '../../context/AuthContext';

const getSubjectBadgeClass = (subject: string) => {
  const s = subject.toLowerCase();
  if (s.includes('math')) return 'badge-subject-math';
  if (s.includes('science') || s.includes('evs')) return 'badge-subject-science';
  if (s.includes('marathi') || s.includes('english') || s.includes('language')) return 'badge-subject-languages';
  return 'badge-primary';
};

const StudentExamsPage: React.FC = () => {
  const { user } = useAuth();
  const [exams, setExams] = useState<Exam[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'available' | 'upcoming' | 'completed'>('available');
  const [selectedSubject, setSelectedSubject] = useState<string>('All');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    fetchExams();
  }, [user]);

  const fetchExams = async () => {
    setLoading(true);
    try {
      const res = await api.get('/exams', {
        params: {
          standard: user?.currentStandard,
        },
      });
      setExams(res.data.exams || []);
    } catch (err) {
      console.error('Failed to fetch exams', err);
    } finally {
      setLoading(false);
    }
  };

  // Unique subjects
  const subjects = ['All', ...Array.from(new Set(exams.map(e => e.subject)))];

  // Filtering
  const filteredExams = exams.filter(e => {
    const matchesSubject = selectedSubject === 'All' || e.subject === selectedSubject;
    const matchesSearch = e.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (e.chapter && e.chapter.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSubject || !matchesSearch) return false;

    if (activeTab === 'available') {
      return e.availability === 'available' && (e.canAttempt || !e.myBestAttempt);
    } else if (activeTab === 'upcoming') {
      return e.availability === 'upcoming';
    } else {
      // completed
      return (e.myAttemptCount || 0) > 0;
    }
  });

  // Overview stats
  const completedCount = exams.filter(e => (e.myAttemptCount || 0) > 0).length;
  const avgScore = completedCount > 0
    ? Math.round(
        exams
          .filter(e => e.myBestAttempt)
          .reduce((sum, e) => sum + (e.myBestAttempt?.percentage || 0), 0) / completedCount
      )
    : 0;

  return (
    <div className="flex min-h-screen bg-page transition-colors">
      <Sidebar />
      <main className="flex-1 ml-16 md:ml-64 transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
            <div>
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
                <span className="text-xs font-bold text-text-primary">Standard {user.currentStandard}</span>
              </div>
            )}
          </div>

          {/* Stats Bar */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            <div className="card-soft p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#6C63F2]/10 text-[#6C63F2] flex items-center justify-center font-bold">
                <ClipboardList className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">Available Exams</p>
                <p className="text-xl font-heading font-bold text-text-primary">
                  {exams.filter(e => e.availability === 'available').length}
                </p>
              </div>
            </div>

            <div className="card-soft p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#4ADE9A]/15 text-[#4ADE9A] flex items-center justify-center font-bold">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">Completed</p>
                <p className="text-xl font-heading font-bold text-text-primary">{completedCount}</p>
              </div>
            </div>

            <div className="card-soft p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#FFC24B]/15 text-[#FFC24B] flex items-center justify-center font-bold">
                <Award className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">Average Score</p>
                <p className="text-xl font-heading font-bold text-text-primary">{avgScore}%</p>
              </div>
            </div>

            <div className="card-soft p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[#5AC8FA]/15 text-[#5AC8FA] flex items-center justify-center font-bold">
                <Clock className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs text-text-muted">Upcoming</p>
                <p className="text-xl font-heading font-bold text-text-primary">
                  {exams.filter(e => e.availability === 'upcoming').length}
                </p>
              </div>
            </div>
          </div>

          {/* Controls: Search, Subject filter, and Status Tabs */}
          <div className="space-y-4 mb-6">
            <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between">
              {/* Status Tabs */}
              <div className="flex bg-surface-alt p-1 rounded-xl border border-border-subtle self-start">
                <button
                  onClick={() => setActiveTab('available')}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                    activeTab === 'available'
                      ? 'bg-brand-primary text-white shadow-sm'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  Available ({exams.filter(e => e.availability === 'available').length})
                </button>
                <button
                  onClick={() => setActiveTab('upcoming')}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                    activeTab === 'upcoming'
                      ? 'bg-brand-primary text-white shadow-sm'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  Upcoming ({exams.filter(e => e.availability === 'upcoming').length})
                </button>
                <button
                  onClick={() => setActiveTab('completed')}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${
                    activeTab === 'completed'
                      ? 'bg-brand-primary text-white shadow-sm'
                      : 'text-text-secondary hover:text-text-primary'
                  }`}
                >
                  Completed ({completedCount})
                </button>
              </div>

              {/* Search bar */}
              <div className="relative w-full sm:w-64">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
                <input
                  type="text"
                  placeholder="Search exam or chapter..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 bg-surface border border-border-subtle rounded-xl text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-brand-primary transition-all"
                />
              </div>
            </div>

            {/* Subject Filters */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              <span className="text-xs font-semibold text-text-muted flex items-center gap-1 mr-1">
                <Filter className="w-3.5 h-3.5" /> Subject:
              </span>
              {subjects.map(subj => (
                <button
                  key={subj}
                  onClick={() => setSelectedSubject(subj)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
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

          {/* Exams List */}
          {loading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="card-soft h-56 rounded-2xl animate-pulse bg-surface-alt" />
              ))}
            </div>
          ) : filteredExams.length === 0 ? (
            <div className="card-soft p-12 text-center max-w-md mx-auto my-8">
              <div className="w-14 h-14 mx-auto rounded-2xl bg-[#6C63F2]/10 text-[#6C63F2] flex items-center justify-center mb-4">
                <ClipboardList className="w-7 h-7" />
              </div>
              <h3 className="font-heading font-bold text-lg text-text-primary mb-1">
                No exams found
              </h3>
              <p className="text-xs text-text-secondary mb-4">
                {activeTab === 'available'
                  ? 'There are no active exams available for your standard right now. Check back soon!'
                  : activeTab === 'upcoming'
                  ? 'No scheduled exams found. Teachers will post upcoming dates here.'
                  : 'You have not completed any exams yet. Start by taking an available exam above!'}
              </p>
              {activeTab !== 'available' && (
                <button
                  onClick={() => setActiveTab('available')}
                  className="btn-primary text-xs py-2 px-4 inline-flex items-center gap-2"
                >
                  <Sparkles className="w-3.5 h-3.5" /> View Available Exams
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredExams.map(exam => {
                const isUpcoming = exam.availability === 'upcoming';
                const isCompleted = (exam.myAttemptCount || 0) > 0;
                const bestAttempt = exam.myBestAttempt;
                const teacherObj = typeof exam.teacher === 'object' ? exam.teacher : null;

                return (
                  <div
                    key={exam._id}
                    className="card-soft p-5 flex flex-col justify-between hover:shadow-lg transition-all border border-border-subtle rounded-2xl relative group bg-surface"
                  >
                    <div>
                      {/* Top Badges */}
                      <div className="flex items-center justify-between gap-2 mb-3">
                        <span className={`${getSubjectBadgeClass(exam.subject)} text-[11px] font-semibold px-2.5 py-0.5 rounded-full`}>
                          {exam.subject}
                        </span>

                        {isUpcoming ? (
                          <span className="badge-warning text-[10px] py-0.5 px-2 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> Upcoming
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
                      <h3 className="font-heading font-bold text-base text-text-primary group-hover:text-brand-primary transition-colors line-clamp-2">
                        {exam.title}
                      </h3>

                      {exam.chapter && (
                        <p className="text-xs text-text-muted mt-0.5 flex items-center gap-1">
                          <BookOpen className="w-3 h-3" /> Chapter: {exam.chapter}
                        </p>
                      )}

                      {exam.description && (
                        <p className="text-xs text-text-secondary mt-2 line-clamp-2">
                          {exam.description}
                        </p>
                      )}

                      {/* Details & Specs */}
                      <div className="grid grid-cols-2 gap-2 my-4 p-3 bg-surface-alt rounded-xl border border-border-subtle text-xs">
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <Clock className="w-3.5 h-3.5 text-brand-primary flex-shrink-0" />
                          <span>{exam.durationMinutes} mins</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <HelpCircle className="w-3.5 h-3.5 text-[#5AC8FA] flex-shrink-0" />
                          <span>{exam.questionCount || exam.questions?.length || 0} Questions</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <Award className="w-3.5 h-3.5 text-[#FFC24B] flex-shrink-0" />
                          <span>{exam.totalMarks} Marks</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-text-secondary">
                          <AlertCircle className={`w-3.5 h-3.5 ${exam.negativeMarking ? 'text-[#E1447A]' : 'text-text-muted'} flex-shrink-0`} />
                          <span>
                            {exam.negativeMarking ? `-${exam.negativeMarkValue} wrong` : 'No negative'}
                          </span>
                        </div>
                      </div>

                      {/* Schedule info if set */}
                      {exam.scheduledStart && (
                        <div className="text-[11px] text-text-muted mb-3 flex items-center gap-1.5">
                          <Calendar className="w-3 h-3 text-brand-primary" />
                          <span>
                            Starts: {new Date(exam.scheduledStart).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Bottom teacher & Action Button */}
                    <div className="pt-3 border-t border-border-subtle">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <img
                            src={
                              teacherObj?.avatar ||
                              `https://ui-avatars.com/api/?name=${encodeURIComponent(teacherObj?.name || 'Teacher')}&background=6C63F2&color=fff&size=32`
                            }
                            alt={teacherObj?.name || 'Teacher'}
                            className="w-6 h-6 rounded-full object-cover"
                          />
                          <span className="text-[11px] font-medium text-text-secondary truncate max-w-[120px]">
                            {teacherObj?.name || 'Teacher'}
                          </span>
                        </div>

                        {exam.attemptLimit > 0 && (
                          <span className="text-[10px] text-text-muted font-medium">
                            {exam.myAttemptCount || 0}/{exam.attemptLimit} attempt
                          </span>
                        )}
                      </div>

                      {isUpcoming ? (
                        <button
                          disabled
                          className="w-full py-2.5 px-4 rounded-xl bg-surface-alt border border-border-subtle text-text-muted text-xs font-semibold cursor-not-allowed text-center"
                        >
                          Exam Not Started Yet
                        </button>
                      ) : exam.canAttempt ? (
                        <Link
                          to={`/student/exams/${exam._id}`}
                          className="btn-primary w-full py-2.5 px-4 rounded-xl text-xs font-bold text-center flex items-center justify-center gap-2 shadow-sm"
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
                          className="w-full py-2.5 px-4 rounded-xl bg-surface-alt hover:bg-surface border border-border-subtle text-text-primary text-xs font-bold text-center flex items-center justify-center gap-2 transition-all"
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
    </div>
  );
};

export default StudentExamsPage;

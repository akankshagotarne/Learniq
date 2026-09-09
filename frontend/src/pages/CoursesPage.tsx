import React, { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Filter, Star, BookOpen, Clock, Users, X } from 'lucide-react';
import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';
import api from '../services/api';
import { Course } from '../types';
import { useAuth } from '../context/AuthContext';

const SUBJECTS = ['All', 'Mathematics', 'Science', 'English', 'Social Science', 'Marathi', 'Environmental Studies'];
const STANDARDS = ['All', ...Array.from({ length: 10 }, (_, i) => String(i + 1))];

const getSubjectBadge = (subject: string) => {
  const lower = subject.toLowerCase();
  if (lower.includes('marathi') || lower.includes('english') || lower.includes('language') || lower.includes('hindi')) {
    return 'badge-subject-languages';
  }
  if (lower.includes('science') || lower.includes('environ') || lower.includes('evs')) {
    return 'badge-subject-science';
  }
  if (lower.includes('math')) {
    return 'badge-subject-math';
  }
  return 'bg-[#EDE9FE] text-[#6C63F2] dark:bg-[#2E2856] dark:text-[#B69CF2]';
};

const CoursesPage: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();

  const [filters, setFilters] = useState({
    search: searchParams.get('search') || '',
    standard: searchParams.get('standard') || 'All',
    subject: searchParams.get('subject') || 'All',
    free: searchParams.get('free') || 'All',
  });

  const fetchCourses = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (filters.search) params.search = filters.search;
      if (filters.standard !== 'All') params.standard = filters.standard;
      if (filters.subject !== 'All') params.subject = filters.subject;
      if (filters.free === 'free') params.free = 'true';
      if (filters.free === 'paid') params.free = 'false';

      const res = await api.get('/courses', { params });
      setCourses(res.data.courses || []);
    } catch {}
    setLoading(false);
  };

  useEffect(() => { fetchCourses(); }, [filters]);

  const setFilter = (key: string, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  return (
    <div className="min-h-screen bg-page flex flex-col">
      <Navbar />
      <div className="pt-20 flex-1">
        {/* Header */}
        <div className="bg-surface border-b border-border-subtle py-10 transition-colors">
          <div className="page-container">
            <h1 className="font-heading font-bold text-3xl md:text-4xl text-text-primary mb-2">
              Browse <span className="text-gradient">Courses</span>
            </h1>
            <p className="text-text-secondary text-base">Find the perfect course for your standard and subject</p>
          </div>
        </div>

        <div className="page-container py-8">
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Filters */}
            <div className="lg:w-64 flex-shrink-0">
              <div className="bg-surface border border-border-subtle rounded-card p-5 shadow-soft sticky top-24 transition-colors">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-heading font-semibold text-text-primary flex items-center gap-2 text-base">
                    <Filter className="w-4 h-4 text-brand-primary" /> Filters
                  </h3>
                  <button onClick={() => setFilters({ search: '', standard: 'All', subject: 'All', free: 'All' })}
                    className="text-text-muted hover:text-brand-primary text-xs flex items-center gap-1 font-medium transition-colors">
                    <X className="w-3.5 h-3.5" /> Reset
                  </button>
                </div>

                {/* Search */}
                <div className="relative mb-5">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
                  <input
                    type="text"
                    value={filters.search}
                    onChange={e => setFilter('search', e.target.value)}
                    placeholder="Search courses..."
                    className="w-full bg-surface-alt border border-border-subtle rounded-xl pl-9 pr-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-primary/30 focus:border-brand-primary transition-all"
                  />
                </div>

                {/* Standard */}
                <div className="mb-5">
                  <p className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-2">Standard</p>
                  <div className="flex flex-wrap gap-1.5">
                    {STANDARDS.map(s => (
                      <button key={s} onClick={() => setFilter('standard', s)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                          filters.standard === s
                            ? 'bg-brand-primary text-white shadow-sm'
                            : 'bg-surface-alt border border-border-subtle text-text-secondary hover:bg-surface hover:text-text-primary'
                        }`}>
                        {s === 'All' ? 'All' : `Std ${s}`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Subject */}
                <div className="mb-5">
                  <p className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-2">Subject</p>
                  <div className="space-y-1">
                    {SUBJECTS.map(s => (
                      <button key={s} onClick={() => setFilter('subject', s)}
                        className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          filters.subject === s
                            ? 'bg-brand-primary/10 text-brand-primary font-semibold border border-brand-primary/20'
                            : 'text-text-secondary hover:bg-surface-alt hover:text-text-primary'
                        }`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Price */}
                <div>
                  <p className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-2">Price</p>
                  <div className="space-y-1">
                    {[['All', 'All Courses'], ['free', 'Free Only'], ['paid', 'Paid Only']].map(([val, label]) => (
                      <button key={val} onClick={() => setFilter('free', val)}
                        className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                          filters.free === val
                            ? 'bg-brand-primary/10 text-brand-primary font-semibold border border-brand-primary/20'
                            : 'text-text-secondary hover:bg-surface-alt hover:text-text-primary'
                        }`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Course Grid */}
            <div className="flex-1">
              <div className="flex items-center justify-between mb-5">
                <p className="text-text-secondary text-sm font-medium">
                  {loading ? 'Loading...' : `${courses.length} courses found`}
                </p>
                {user?.currentStandard && (
                  <span className="badge bg-brand-primary/10 text-brand-primary border border-brand-primary/20 text-xs font-semibold">
                    Your Standard: Std {user.currentStandard}
                  </span>
                )}
              </div>

              {loading ? (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-6">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="card-soft overflow-hidden animate-pulse">
                      <div className="bg-surface-alt aspect-video" />
                      <div className="p-5 space-y-3">
                        <div className="bg-surface-alt h-4 rounded-md w-3/4" />
                        <div className="bg-surface-alt h-3 rounded-md w-1/2" />
                        <div className="bg-surface-alt h-3 rounded-md w-full" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : courses.length === 0 ? (
                <div className="bg-surface border border-border-subtle rounded-card p-12 text-center shadow-soft">
                  <div className="w-16 h-16 rounded-full bg-brand-primary/10 text-brand-primary flex items-center justify-center mx-auto mb-4">
                    <BookOpen className="w-8 h-8" />
                  </div>
                  <h3 className="font-heading font-semibold text-text-primary text-lg mb-2">No courses found</h3>
                  <p className="text-text-secondary text-sm max-w-sm mx-auto mb-5">Try selecting a different standard or subject filter to explore more courses.</p>
                  <button
                    onClick={() => setFilters({ search: '', standard: 'All', subject: 'All', free: 'All' })}
                    className="btn-primary text-xs px-4 py-2"
                  >
                    Clear All Filters
                  </button>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-6">
                  {courses.map(course => (
                    <Link key={course._id} to={`/courses/${course._id}`} className="course-card group">
                      <div className="relative overflow-hidden rounded-t-[15px]">
                        <img
                          src={course.thumbnail || `https://picsum.photos/seed/${course.subject}-${course.standard}/400/225`}
                          alt={course.title}
                          className="w-full aspect-video object-cover group-hover:scale-105 transition-transform duration-500"
                          onError={e => { (e.target as HTMLImageElement).src = 'https://picsum.photos/400/225'; }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent" />
                        <div className="absolute top-3 left-3 flex gap-2">
                          {course.isFree ? <span className="badge-free">FREE</span> : <span className="badge-paid">₹{course.price}</span>}
                          <span className="badge bg-white/90 text-[#22243A] backdrop-blur-sm border border-white/40 shadow-xs font-semibold">
                            Std {course.standard}
                          </span>
                        </div>
                      </div>
                      <div className="p-5">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`badge ${getSubjectBadge(course.subject)} font-medium`}>{course.subject}</span>
                          <span className="text-text-muted text-xs">{course.level}</span>
                        </div>
                        <h3 className="font-heading font-semibold text-text-primary text-base leading-snug mb-3 line-clamp-2 group-hover:text-brand-primary transition-colors">
                          {course.title}
                        </h3>
                        {course.teacher && (
                          <div className="flex items-center gap-2 mb-4">
                            <img
                              src={(course.teacher as any).avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent((course.teacher as any).name || 'T')}&background=6C63F2&color=fff&size=32`}
                              alt={(course.teacher as any).name}
                              className="w-6 h-6 rounded-full object-cover border border-border-subtle"
                            />
                            <span className="text-text-secondary text-xs font-medium truncate">{(course.teacher as any).name}</span>
                          </div>
                        )}
                        <div className="flex items-center justify-between pt-3 border-t border-border-subtle text-xs text-text-secondary">
                          <div className="flex items-center gap-1 font-semibold text-text-primary">
                            <Star className="w-3.5 h-3.5 text-accent-amber fill-accent-amber" />
                            <span>{course.rating || '4.8'}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <BookOpen className="w-3.5 h-3.5 text-brand-primary" /> {course.totalLectures} lectures
                          </div>
                          <div className="flex items-center gap-1">
                            <Users className="w-3.5 h-3.5 text-accent-mint" /> {course.enrolledCount || 0}
                          </div>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default CoursesPage;

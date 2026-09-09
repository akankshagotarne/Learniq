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
    <div className="min-h-screen">
      <Navbar />
      <div className="pt-20 min-h-screen bg-dark-900">
        {/* Header */}
        <div className="bg-dark-800 border-b border-white/10 py-10">
          <div className="page-container">
            <h1 className="font-display font-bold text-3xl md:text-4xl text-white mb-2">
              Browse <span className="gradient-text">Courses</span>
            </h1>
            <p className="text-white/50">Find the perfect course for your standard and subject</p>
          </div>
        </div>

        <div className="page-container py-8">
          <div className="flex flex-col lg:flex-row gap-6">
            {/* Filters */}
            <div className="lg:w-64 flex-shrink-0">
              <div className="glass-card p-5 sticky top-24">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-white font-semibold flex items-center gap-2"><Filter className="w-4 h-4" /> Filters</h3>
                  <button onClick={() => setFilters({ search: '', standard: 'All', subject: 'All', free: 'All' })}
                    className="text-white/40 hover:text-white text-xs flex items-center gap-1">
                    <X className="w-3 h-3" /> Reset
                  </button>
                </div>

                {/* Search */}
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30" />
                  <input
                    type="text"
                    value={filters.search}
                    onChange={e => setFilter('search', e.target.value)}
                    placeholder="Search..."
                    className="input-field pl-9 py-2 text-sm"
                  />
                </div>

                {/* Standard */}
                <div className="mb-4">
                  <p className="text-white/50 text-xs font-medium uppercase tracking-wide mb-2">Standard</p>
                  <div className="flex flex-wrap gap-1.5">
                    {STANDARDS.map(s => (
                      <button key={s} onClick={() => setFilter('standard', s)}
                        className={`px-2.5 py-1 rounded-lg text-xs transition-all ${
                          filters.standard === s ? 'bg-primary-500 text-white' : 'bg-white/5 text-white/50 hover:bg-white/10'
                        }`}>
                        {s === 'All' ? 'All' : `Std ${s}`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Subject */}
                <div className="mb-4">
                  <p className="text-white/50 text-xs font-medium uppercase tracking-wide mb-2">Subject</p>
                  <div className="space-y-1">
                    {SUBJECTS.map(s => (
                      <button key={s} onClick={() => setFilter('subject', s)}
                        className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-all ${
                          filters.subject === s ? 'bg-primary-500/20 text-primary-300' : 'text-white/50 hover:bg-white/5 hover:text-white'
                        }`}>
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Price */}
                <div>
                  <p className="text-white/50 text-xs font-medium uppercase tracking-wide mb-2">Price</p>
                  <div className="space-y-1">
                    {[['All', 'All'], ['free', 'Free Only'], ['paid', 'Paid Only']].map(([val, label]) => (
                      <button key={val} onClick={() => setFilter('free', val)}
                        className={`w-full text-left px-3 py-1.5 rounded-lg text-sm transition-all ${
                          filters.free === val ? 'bg-primary-500/20 text-primary-300' : 'text-white/50 hover:bg-white/5 hover:text-white'
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
                <p className="text-white/50 text-sm">
                  {loading ? 'Loading...' : `${courses.length} courses found`}
                </p>
                {user?.currentStandard && (
                  <span className="badge-primary">Your Standard: {user.currentStandard}</span>
                )}
              </div>

              {loading ? (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
                  {[...Array(6)].map((_, i) => (
                    <div key={i} className="glass-card overflow-hidden">
                      <div className="skeleton aspect-video" />
                      <div className="p-4 space-y-2">
                        <div className="skeleton h-4 rounded w-3/4" />
                        <div className="skeleton h-3 rounded w-1/2" />
                        <div className="skeleton h-3 rounded w-full" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : courses.length === 0 ? (
                <div className="text-center py-20">
                  <BookOpen className="w-16 h-16 text-white/10 mx-auto mb-4" />
                  <h3 className="text-white font-semibold mb-2">No courses found</h3>
                  <p className="text-white/40 text-sm">Try adjusting your filters.</p>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-5">
                  {courses.map(course => (
                    <Link key={course._id} to={`/courses/${course._id}`} className="course-card group">
                      <div className="relative">
                        <img
                          src={course.thumbnail || `https://picsum.photos/seed/${course.subject}-${course.standard}/400/225`}
                          alt={course.title}
                          className="w-full aspect-video object-cover group-hover:scale-105 transition-transform duration-500"
                          onError={e => { (e.target as HTMLImageElement).src = 'https://picsum.photos/400/225'; }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-dark-900/70 to-transparent" />
                        <div className="absolute top-3 left-3 flex gap-2">
                          {course.isFree ? <span className="badge-free">FREE</span> : <span className="badge-paid">₹{course.price}</span>}
                          <span className="badge bg-dark-800/80 text-white/70">Std {course.standard}</span>
                        </div>
                      </div>
                      <div className="p-5">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="badge-primary text-xs">{course.subject}</span>
                          <span className="text-white/30 text-xs">{course.level}</span>
                        </div>
                        <h3 className="font-semibold text-white text-sm leading-snug mb-3 line-clamp-2 group-hover:text-primary-300 transition-colors">
                          {course.title}
                        </h3>
                        {course.teacher && (
                          <div className="flex items-center gap-2 mb-3">
                            <img
                              src={(course.teacher as any).avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent((course.teacher as any).name || 'T')}&background=6C63FF&color=fff&size=32`}
                              alt={(course.teacher as any).name}
                              className="w-6 h-6 rounded-full object-cover"
                            />
                            <span className="text-white/50 text-xs truncate">{(course.teacher as any).name}</span>
                          </div>
                        )}
                        <div className="flex items-center gap-4 text-xs text-white/40">
                          <div className="flex items-center gap-1">
                            <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                            <span className="text-white/60">{course.rating}</span>
                          </div>
                          <div className="flex items-center gap-1">
                            <BookOpen className="w-3.5 h-3.5" /> {course.totalLectures} lectures
                          </div>
                          <div className="flex items-center gap-1">
                            <Users className="w-3.5 h-3.5" /> {course.enrolledCount}
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

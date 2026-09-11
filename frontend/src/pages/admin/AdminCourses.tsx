import React, { useEffect, useMemo, useState } from 'react';
import { Search, BookOpen, Star, Users, Flag, Layers } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { Course } from '../../types';
import toast from 'react-hot-toast';
import { ALL_SUBJECTS } from '../../constants/olympiadSubjects';

const SUBJECTS = ALL_SUBJECTS;

const getSubjectBadgeClass = (subject: string) => {
  const s = (subject || '').toLowerCase();
  if (s.includes('math')) return 'badge-subject-math';
  if (s.includes('science') || s.includes('evs')) return 'badge-subject-science';
  if (s.includes('marathi') || s.includes('english') || s.includes('hindi') || s.includes('language')) return 'badge-subject-languages';
  return 'badge-primary';
};

const AdminCourses: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [standardFilter, setStandardFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');

  useEffect(() => {
    api.get('/admin/courses')
      .then(r => setCourses(r.data.courses || []))
      .catch(() => toast.error('Failed to load courses.'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => courses.filter(c => {
    if (standardFilter && String(c.standard) !== standardFilter) return false;
    if (subjectFilter && c.subject !== subjectFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const teacherName = (c.teacher as any)?.name || '';
      if (!c.title?.toLowerCase().includes(q) && !teacherName.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [courses, search, standardFilter, subjectFilter]);

  const totalEnrolled = courses.reduce((s, c) => s + (c.enrolledCount || 0), 0);
  const activeCount = courses.filter(c => c.isActive).length;
  const flaggedCount = courses.filter(c => c.isFlagged).length;

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 ml-0 md:ml-64 pt-14 md:pt-0 transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="mb-8">
            <p className="text-brand-primary text-xs font-semibold tracking-wide uppercase mb-1">Admin</p>
            <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">All Courses</h1>
            <p className="text-text-secondary text-sm mt-1">Every course uploaded across the platform</p>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total Courses', value: courses.length, icon: BookOpen, iconBg: 'bg-[#EDE9FE] text-[#6C63F2]' },
              { label: 'Active', value: activeCount, icon: Layers, iconBg: 'bg-[#DCFCE7] text-[#16A34A]' },
              { label: 'Total Enrolled', value: totalEnrolled, icon: Users, iconBg: 'bg-[#E0F2FE] text-[#0284C7]' },
              { label: 'Flagged', value: flaggedCount, icon: Flag, iconBg: 'bg-[#FFE4EC] text-[#E1447A]' },
            ].map(({ label, value, icon: Icon, iconBg }) => (
              <div key={label} className="card-soft p-4 flex flex-col justify-between">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${iconBg}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xl md:text-2xl font-bold font-heading text-text-primary">{loading ? '...' : value}</p>
                  <p className="text-text-secondary text-xs mt-1 font-medium">{label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3 mb-6 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by title or teacher..."
                className="input-field pl-9"
              />
            </div>
            <select value={standardFilter} onChange={e => setStandardFilter(e.target.value)} className="input-field w-auto">
              <option value="">All Standards</option>
              {Array.from({ length: 10 }, (_, i) => <option key={i + 1} value={i + 1}>Standard {i + 1}</option>)}
            </select>
            <select value={subjectFilter} onChange={e => setSubjectFilter(e.target.value)} className="input-field w-auto">
              <option value="">All Subjects</option>
              {SUBJECTS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
            <span className="text-text-secondary text-sm font-medium">{filtered.length} course{filtered.length !== 1 ? 's' : ''}</span>
          </div>

          {loading ? (
            <div className="grid md:grid-cols-2 gap-4">
              {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-32 rounded-card" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="card-soft p-16 text-center">
              <BookOpen className="w-14 h-14 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary">No courses match your filters.</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {filtered.map(course => (
                <div key={course._id} className="card-soft p-5">
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className={getSubjectBadgeClass(course.subject)}>{course.subject}</span>
                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-surface-alt text-text-secondary">Std {course.standard}</span>
                    {course.isFree ? <span className="badge-free">Free</span> : <span className="badge-paid">₹{course.price}</span>}
                    {!course.isActive && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-surface-alt text-text-muted">Archived</span>}
                    {course.isFlagged && <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#FFE4EC] text-[#E1447A] flex items-center gap-1"><Flag className="w-3 h-3" /> Flagged</span>}
                  </div>
                  <h3 className="text-text-primary font-semibold text-base font-heading mb-1">{course.title}</h3>
                  <p className="text-text-secondary text-sm mb-3 line-clamp-2">{course.description}</p>
                  <div className="flex items-center gap-2 mb-3 p-2 bg-surface-alt rounded-xl border border-border-subtle">
                    <img
                      src={(course.teacher as any)?.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent((course.teacher as any)?.name || 'T')}&background=6C63F2&color=fff&size=32`}
                      alt={(course.teacher as any)?.name}
                      className="w-7 h-7 rounded-full object-cover"
                    />
                    <div className="min-w-0">
                      <p className="text-text-primary text-xs font-semibold truncate">{(course.teacher as any)?.name || 'Unknown teacher'}</p>
                      <p className="text-text-muted text-xs truncate">{(course.teacher as any)?.email}</p>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="p-2 bg-surface-alt rounded-xl border border-border-subtle">
                      <p className="text-text-primary text-sm font-bold font-heading">{course.totalLectures || 0}</p>
                      <p className="text-text-muted text-xs">Lectures</p>
                    </div>
                    <div className="p-2 bg-surface-alt rounded-xl border border-border-subtle">
                      <p className="text-text-primary text-sm font-bold font-heading">{course.enrolledCount || 0}</p>
                      <p className="text-text-muted text-xs">Enrolled</p>
                    </div>
                    <div className="p-2 bg-surface-alt rounded-xl border border-border-subtle flex flex-col items-center">
                      <p className="text-text-primary text-sm font-bold font-heading flex items-center gap-0.5"><Star className="w-3.5 h-3.5 text-[#FFC24B] fill-[#FFC24B]" />{course.rating?.toFixed(1) || '0.0'}</p>
                      <p className="text-text-muted text-xs">Rating</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminCourses;

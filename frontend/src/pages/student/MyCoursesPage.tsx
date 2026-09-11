import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Star, CheckCircle2, PlayCircle } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { Enrollment } from '../../types';
import { getCourseThumbnail, getTeacherPhoto } from '../../utils/courseImage';

const getSubjectBadgeClass = (subject: string) => {
  const s = (subject || '').toLowerCase();
  if (s.includes('math')) return 'badge-subject-math';
  if (s.includes('science') || s.includes('evs')) return 'badge-subject-science';
  if (s.includes('marathi') || s.includes('english') || s.includes('language')) return 'badge-subject-languages';
  return 'badge-primary';
};

const MyCoursesPage: React.FC = () => {
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/student/enrolled')
      .then(r => setEnrollments(r.data.enrollments || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex min-h-screen bg-page transition-colors">
      <Sidebar />
      <main className="flex-1 ml-0 md:ml-64 pt-14 md:pt-0 transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="mb-8">
            <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary mb-1">My Courses</h1>
            <p className="text-text-secondary text-sm">Courses you've purchased or enrolled in — pick up right where you left off.</p>
          </div>

          {loading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => (
                <div key={i} className="card-soft h-80 rounded-2xl animate-pulse bg-surface-alt" />
              ))}
            </div>
          ) : enrollments.length === 0 ? (
            <div className="card-soft p-12 text-center">
              <div className="w-16 h-16 rounded-full bg-brand-primary/10 text-brand-primary flex items-center justify-center mx-auto mb-4">
                <BookOpen className="w-8 h-8" />
              </div>
              <h3 className="font-heading font-semibold text-text-primary text-lg mb-2">No courses yet</h3>
              <p className="text-text-secondary text-sm max-w-sm mx-auto mb-5">
                You haven't purchased or enrolled in any courses. Browse the catalog to get started.
              </p>
              <Link to="/courses" className="btn-primary text-xs px-4 py-2 inline-block">Browse Courses</Link>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {enrollments.map(enr => {
                const course = enr.course;
                if (!course) return null;
                const teacher = course.teacher as any;
                const pct = Math.min(100, Math.max(0, enr.completionPercentage || 0));

                return (
                  <Link
                    key={enr._id}
                    to={`/courses/${course._id}`}
                    className="bg-white dark:bg-[#1B1C2E] border border-[#E7E7F2] dark:border-[#2E2F4A] rounded-2xl overflow-hidden shadow-[0_4px_20px_rgba(34,36,58,0.06)] hover:shadow-[0_8px_28px_rgba(34,36,58,0.10)] hover:-translate-y-1 transition-all duration-200 group flex flex-col"
                  >
                    <div className="aspect-[4/3] w-full overflow-hidden relative bg-[#F1F1FA] dark:bg-[#242540]">
                      <img
                        src={getCourseThumbnail(course)}
                        alt={course.title}
                        className="w-full h-full object-cover object-top group-hover:scale-105 transition-transform duration-300"
                        onError={e => { (e.target as HTMLImageElement).src = getCourseThumbnail(course); }}
                      />
                      <div className="absolute top-3 left-3">
                        <span className={`badge ${getSubjectBadgeClass(course.subject)} text-xs shadow-sm`}>
                          {course.subject}
                        </span>
                      </div>
                      <div className="absolute top-3 right-3">
                        {enr.isCompleted ? (
                          <span className="badge-free text-xs shadow-sm flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" /> Completed
                          </span>
                        ) : (
                          <span className="badge bg-white/90 text-[#22243A] backdrop-blur-sm border border-white/40 shadow-xs font-semibold text-xs">
                            {pct}% done
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="p-5 flex-1 flex flex-col">
                      <div className="flex-1">
                        <span className="text-[11px] font-semibold text-[#6C63F2] dark:text-[#8B82FF]">Std {course.standard}</span>
                        <h3 className="font-display font-semibold text-base text-[#22243A] dark:text-[#F4F4FA] leading-snug mt-1 mb-2 line-clamp-2 group-hover:text-[#6C63F2] dark:group-hover:text-[#8B82FF] transition-colors">
                          {course.title}
                        </h3>

                        {teacher && (
                          <div className="flex items-center gap-2 mb-3">
                            <img
                              src={getTeacherPhoto(teacher, course.subject)}
                              alt={teacher.name}
                              className="w-6 h-6 rounded-full object-cover border border-border-subtle"
                              onError={e => { (e.target as HTMLImageElement).src = getTeacherPhoto(null, course.subject); }}
                            />
                            <span className="text-text-secondary text-xs font-medium truncate">{teacher.name}</span>
                          </div>
                        )}

                        {/* Progress bar */}
                        <div className="mb-1">
                          <div className="w-full h-1.5 bg-[#F1F1FA] dark:bg-[#242540] rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${enr.isCompleted ? 'bg-[#4ADE9A]' : 'bg-[#6C63F2]'}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                        </div>
                        <div className="flex items-center justify-between text-[11px] text-text-muted mb-4">
                          <span>{pct}% complete</span>
                          <span className="flex items-center gap-1">
                            <Star className="w-3 h-3 text-[#FFC24B] fill-[#FFC24B]" /> {course.rating || '4.8'}
                          </span>
                        </div>
                      </div>

                      <span className="btn-primary text-xs px-4 py-2.5 w-full flex items-center justify-center gap-1.5">
                        <PlayCircle className="w-3.5 h-3.5" />
                        {pct > 0 ? 'Continue Learning' : 'Start Learning'}
                      </span>
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default MyCoursesPage;

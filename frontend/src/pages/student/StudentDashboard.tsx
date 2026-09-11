import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Radio, HelpCircle, ClipboardList, TrendingUp, Award, Flame, ChevronRight, Star, Bell, Calendar, Sparkles } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { Course, Notification, LiveSession } from '../../types';
import { getCourseThumbnail } from '../../utils/courseImage';

const getSubjectBadgeClass = (subject: string) => {
  const s = subject.toLowerCase();
  if (s.includes('math')) return 'badge-subject-math';
  if (s.includes('science') || s.includes('evs')) return 'badge-subject-science';
  if (s.includes('marathi') || s.includes('english') || s.includes('language')) return 'badge-subject-languages';
  return 'badge-primary';
};

const StudentDashboard: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [courses, setCourses] = useState<Course[]>([]);
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user?.currentStandard) {
      navigate('/student/standard');
      return;
    }
    const std = user.currentStandard;
    Promise.all([
      api.get(`/courses?standard=${std}`),
      api.get(`/live-sessions?standard=${std}`),
      api.get('/notifications'),
    ]).then(([c, l, n]) => {
      setCourses(c.data.courses || []);
      setLiveSessions((l.data.sessions || []).filter((s: LiveSession) => s.status !== 'ended').slice(0, 3));
      setNotifications(n.data.notifications || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [user, navigate]);

  const unreadNotifs = notifications.filter(n => !n.isRead).length;

  if (loading) {
    return (
      <div className="flex min-h-screen bg-[#F8F8FC] dark:bg-[#12121F]">
        <Sidebar />
        <div className="flex-1 ml-16 md:ml-64 p-6 lg:p-8">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}
          </div>
          <div className="grid grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-64 rounded-2xl" />)}
          </div>
        </div>
      </div>
    );
  }

  const statCards = [
    {
      label: 'Points Earned',
      value: user?.points || 0,
      icon: Star,
      iconBg: 'bg-[#FEF3C7] text-[#D97706]',
    },
    {
      label: 'Day Streak',
      value: `${user?.streak || 0} Days`,
      icon: Flame,
      iconBg: 'bg-[#DCFCE7] text-[#16A34A]',
    },
    {
      label: 'My Courses',
      value: courses.length,
      icon: BookOpen,
      iconBg: 'bg-[#EDE9FE] text-[#6C63F2]',
    },
    {
      label: 'Notifications',
      value: unreadNotifs,
      icon: Bell,
      iconBg: 'bg-[#FFE4EC] text-[#E1447A]',
    },
  ];

  return (
    <div className="flex min-h-screen bg-[#F8F8FC] dark:bg-[#12121F]">
      <Sidebar />
      <main className="flex-1 ml-16 md:ml-64 transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-7xl">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div>
              <h1 className="font-display font-bold text-2xl sm:text-3xl text-[#22243A] dark:text-[#F4F4FA]">
                Welcome back, <span className="gradient-text">{user?.name?.split(' ')[0]}!</span>
              </h1>
              <p className="text-[#6B6E8C] dark:text-[#A6A8C4] text-sm mt-1">
                {user?.currentStandard ? `Standard ${user.currentStandard} • ` : ''}
                {new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
            </div>
            <Link
              to="/student/standard"
              className="btn-secondary text-xs sm:text-sm py-2 px-4 inline-flex items-center gap-2 self-start sm:self-auto"
            >
              <span>Change Standard</span>
            </Link>
          </div>

          {/* Section 6.2 Top Stat Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6 mb-8">
            {statCards.map(({ label, value, icon: Icon, iconBg }) => (
              <div
                key={label}
                className="bg-white dark:bg-[#1B1C2E] border border-[#E7E7F2] dark:border-[#2E2F4A] rounded-2xl p-5 shadow-[0_4px_20px_rgba(34,36,58,0.06)] hover:shadow-[0_8px_28px_rgba(34,36,58,0.10)] transition-all duration-200"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[#6B6E8C] dark:text-[#A6A8C4] text-xs font-medium mb-1">{label}</p>
                    <p className="text-2xl sm:text-3xl font-display font-bold text-[#22243A] dark:text-[#F4F4FA]">{value}</p>
                  </div>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${iconBg}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-3 gap-6 lg:gap-8">
            {/* Left 2 Cols: Courses */}
            <div className="lg:col-span-2 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg sm:text-xl font-display font-bold text-[#22243A] dark:text-[#F4F4FA]">
                    Courses for Standard {user?.currentStandard}
                  </h2>
                  <p className="text-xs text-[#6B6E8C] dark:text-[#A6A8C4]">Comprehensive curriculum lessons and notes</p>
                </div>
                <Link to="/courses" className="text-[#6C63F2] dark:text-[#8B82FF] text-sm font-semibold hover:underline flex items-center gap-1">
                  <span>View All</span>
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </div>

              {courses.length === 0 ? (
                <div className="bg-white dark:bg-[#1B1C2E] border border-[#E7E7F2] dark:border-[#2E2F4A] rounded-2xl p-12 text-center shadow-sm">
                  <BookOpen className="w-12 h-12 text-[#A0A3C0] mx-auto mb-3" />
                  <p className="text-[#6B6E8C] dark:text-[#A6A8C4] text-sm">No courses available for Standard {user?.currentStandard} yet.</p>
                  <Link to="/student/standard" className="btn-primary mt-4 inline-block text-xs">Choose another standard</Link>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-5">
                  {courses.slice(0, 4).map(course => (
                    <Link
                      key={course._id}
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
                        <div className="absolute top-3 left-3 flex gap-1.5">
                          <span className={`badge ${getSubjectBadgeClass(course.subject)} text-xs shadow-sm`}>
                            {course.subject}
                          </span>
                        </div>
                      </div>

                      <div className="p-5 flex-1 flex flex-col justify-between">
                        <div>
                          <h3 className="text-base font-display font-semibold text-[#22243A] dark:text-[#F4F4FA] line-clamp-2 mb-2 group-hover:text-[#6C63F2] dark:group-hover:text-[#8B82FF] transition-colors">
                            {course.title}
                          </h3>
                          {course.isFree ? (
                            <span className="badge-free text-xs">FREE</span>
                          ) : (
                            <span className="badge-paid text-xs">₹{course.price}</span>
                          )}
                        </div>

                        <div className="flex items-center justify-between text-xs text-[#6B6E8C] dark:text-[#A6A8C4] pt-4 mt-2 border-t border-[#E7E7F2] dark:border-[#2E2F4A]">
                          <div className="flex items-center gap-1">
                            <Star className="w-3.5 h-3.5 text-[#FFC24B] fill-[#FFC24B]" />
                            <span className="font-semibold text-[#22243A] dark:text-[#F4F4FA]">{course.rating}</span>
                            <span>({course.totalRatings || 12})</span>
                          </div>
                          <span>{course.totalLectures} lectures</span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Right Column: Live Sessions & Badges */}
            <div className="space-y-6">
              {/* Upcoming Live Classes Card */}
              <div className="bg-white dark:bg-[#1B1C2E] border border-[#E7E7F2] dark:border-[#2E2F4A] rounded-2xl p-6 shadow-[0_4px_20px_rgba(34,36,58,0.06)]">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-[#E1447A] animate-pulse" />
                    <h3 className="font-display font-bold text-sm sm:text-base text-[#22243A] dark:text-[#F4F4FA]">
                      Upcoming Live Classes
                    </h3>
                  </div>
                  <Link to="/live-sessions" className="text-xs text-[#6C63F2] dark:text-[#8B82FF] font-semibold hover:underline">
                    View all
                  </Link>
                </div>

                {liveSessions.length === 0 ? (
                  <div className="py-6 text-center">
                    <Calendar className="w-8 h-8 text-[#A0A3C0] mx-auto mb-2" />
                    <p className="text-xs text-[#6B6E8C] dark:text-[#A6A8C4]">No live classes scheduled today.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {liveSessions.map(s => (
                      <Link
                        key={s._id}
                        to={`/live/${s.sessionCode}`}
                        className="block p-3.5 bg-[#F8F8FC] dark:bg-[#242540] border border-[#E7E7F2] dark:border-[#2E2F4A] rounded-xl hover:border-[#6C63F2]/40 transition-all"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-[#22243A] dark:text-[#F4F4FA] truncate">{s.title}</p>
                            <p className="text-[11px] text-[#6B6E8C] dark:text-[#A6A8C4] mt-0.5">{s.subject} • Std {s.standard}</p>
                          </div>
                          {s.status === 'live' ? (
                            <span className="badge-live text-[10px] flex-shrink-0">LIVE NOW</span>
                          ) : (
                            <span className="badge bg-[#EDE9FE] text-[#6C63F2] text-[10px] flex-shrink-0">
                              {s.scheduledAt ? new Date(s.scheduledAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'Today'}
                            </span>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              {/* Badges Collectibles Card (Section 6.4) */}
              <div className="bg-white dark:bg-[#1B1C2E] border border-[#E7E7F2] dark:border-[#2E2F4A] rounded-2xl p-6 shadow-[0_4px_20px_rgba(34,36,58,0.06)]">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-display font-bold text-sm sm:text-base text-[#22243A] dark:text-[#F4F4FA]">
                    My Learning Badges
                  </h3>
                  <span className="text-[11px] font-semibold text-[#4ADE9A]">3 Earned</span>
                </div>

                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { emoji: '🎯', name: 'Quiz Starter', bg: 'bg-[#DCFCE7] text-[#16A34A]' },
                    { emoji: '📚', name: 'Bookworm', bg: 'bg-[#EDE9FE] text-[#6C63F2]' },
                    { emoji: '🎓', name: 'Live Learner', bg: 'bg-[#FEF3C7] text-[#D97706]' },
                  ].map(b => (
                    <div
                      key={b.name}
                      className="text-center p-3 bg-[#F8F8FC] dark:bg-[#242540] border border-[#E7E7F2] dark:border-[#2E2F4A] rounded-2xl"
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center mx-auto mb-1.5 text-xl ${b.bg}`}>
                        {b.emoji}
                      </div>
                      <p className="text-[11px] font-semibold text-[#22243A] dark:text-[#F4F4FA] truncate">{b.name}</p>
                    </div>
                  ))}
                </div>

                <Link
                  to="/student/progress"
                  className="btn-primary w-full py-2.5 text-xs text-center justify-center"
                >
                  View Full Progress Report
                </Link>
              </div>

              {/* Quick Actions Card */}
              <div className="bg-white dark:bg-[#1B1C2E] border border-[#E7E7F2] dark:border-[#2E2F4A] rounded-2xl p-6 shadow-[0_4px_20px_rgba(34,36,58,0.06)]">
                <h3 className="font-display font-bold text-sm sm:text-base text-[#22243A] dark:text-[#F4F4FA] mb-4">
                  Quick Actions
                </h3>
                <div className="grid grid-cols-2 gap-2.5">
                  {[
                    { label: 'Take Exam', icon: ClipboardList, href: '/student/exams', color: 'text-[#6C63F2] bg-[#EDE9FE]' },
                    { label: 'Live Classes', icon: Radio, href: '/live-sessions', color: 'text-[#E1447A] bg-[#FFE4EC]' },
                    { label: 'Analytics', icon: TrendingUp, href: '/student/progress', color: 'text-[#16A34A] bg-[#DCFCE7]' },
                    { label: 'Standards', icon: Sparkles, href: '/student/standard', color: 'text-[#D97706] bg-[#FEF3C7]' },
                  ].map(({ label, icon: Icon, href, color }) => (
                    <Link
                      key={label}
                      to={href}
                      className="flex flex-col items-center gap-1.5 p-3 rounded-xl border border-[#E7E7F2] dark:border-[#2E2F4A] bg-[#F8F8FC] dark:bg-[#242540] hover:bg-[#F1F1FA] dark:hover:bg-[#2E2F4A] transition-all text-center"
                    >
                      <div className={`p-2 rounded-lg ${color}`}>
                        <Icon className="w-4 h-4" />
                      </div>
                      <span className="text-xs font-semibold text-[#22243A] dark:text-[#F4F4FA]">{label}</span>
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default StudentDashboard;

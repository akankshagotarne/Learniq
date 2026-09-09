import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { BookOpen, Radio, HelpCircle, ClipboardList, TrendingUp, Award, Flame, ChevronRight, Star } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { Course, Notification, LiveSession } from '../../types';

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
      <div className="flex min-h-screen">
        <Sidebar />
        <div className="flex-1 ml-64 p-8">
          <div className="grid grid-cols-4 gap-4 mb-8">
            {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}
          </div>
          <div className="grid grid-cols-3 gap-6">
            {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-64 rounded-2xl" />)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-16 md:ml-64 transition-all duration-300">
        <div className="p-6 lg:p-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="font-display font-bold text-2xl text-white">
                Welcome back, <span className="gradient-text">{user?.name?.split(' ')[0]}!</span>
              </h1>
              <p className="text-white/50 text-sm mt-1">
                {user?.currentStandard ? `Standard ${user.currentStandard} • ` : ''}{new Date().toLocaleDateString('en-IN', { weekday: 'long', month: 'long', day: 'numeric' })}
              </p>
            </div>
            <Link to="/student/standard" className="btn-outline text-sm py-2">
              Change Standard
            </Link>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {[
              { label: 'Points Earned', value: user?.points || 0, icon: Star, color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20' },
              { label: 'Day Streak', value: `${user?.streak || 0}🔥`, icon: Flame, color: 'text-orange-400', bg: 'bg-orange-500/10 border-orange-500/20' },
              { label: 'Courses', value: courses.length, icon: BookOpen, color: 'text-primary-400', bg: 'bg-primary-500/10 border-primary-500/20' },
              { label: 'Notifications', value: unreadNotifs, icon: null, color: 'text-secondary-400', bg: 'bg-secondary-500/10 border-secondary-500/20' },
            ].map(({ label, value, icon: Icon, color, bg }) => (
              <div key={label} className={`glass-card p-5 border ${bg}`}>
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-white/50 text-xs mb-1">{label}</p>
                    <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  </div>
                  {Icon && <Icon className={`w-5 h-5 ${color} opacity-60`} />}
                </div>
              </div>
            ))}
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* Courses */}
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-bold text-white">Courses — Standard {user?.currentStandard}</h2>
                <Link to="/courses" className="text-primary-400 text-sm hover:text-primary-300 flex items-center gap-1">
                  View All <ChevronRight className="w-4 h-4" />
                </Link>
              </div>

              {courses.length === 0 ? (
                <div className="glass-card p-12 text-center">
                  <BookOpen className="w-12 h-12 text-white/20 mx-auto mb-3" />
                  <p className="text-white/40">No courses available for Standard {user?.currentStandard} yet.</p>
                  <Link to="/student/standard" className="btn-primary mt-4 inline-block text-sm">Change Standard</Link>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-4">
                  {courses.slice(0, 4).map(course => (
                    <Link key={course._id} to={`/courses/${course._id}`} className="course-card group">
                      <img
                        src={course.thumbnail || `https://picsum.photos/seed/${course.subject}/320/180`}
                        alt={course.title}
                        className="w-full aspect-video object-cover"
                        onError={e => { (e.target as HTMLImageElement).src = 'https://picsum.photos/320/180'; }}
                      />
                      <div className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="badge-primary text-xs">{course.subject}</span>
                          {course.isFree ? <span className="badge-free text-xs">FREE</span> : <span className="badge-paid text-xs">₹{course.price}</span>}
                        </div>
                        <h3 className="text-sm font-semibold text-white line-clamp-2 group-hover:text-primary-300 transition-colors">{course.title}</h3>
                        <div className="flex items-center gap-1 mt-2">
                          <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                          <span className="text-xs text-white/40">{course.rating} • {course.totalLectures} lectures</span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            {/* Sidebar */}
            <div className="space-y-6">
              {/* Live Sessions */}
              <div className="glass-card p-5">
                <div className="flex items-center gap-2 mb-4">
                  <div className="live-dot" />
                  <h3 className="text-white font-semibold">Upcoming Live Classes</h3>
                </div>
                {liveSessions.length === 0 ? (
                  <p className="text-white/40 text-sm text-center py-4">No upcoming classes.</p>
                ) : (
                  <div className="space-y-3">
                    {liveSessions.map(s => (
                      <Link key={s._id} to={`/live/${s.sessionCode}`}
                        className="block p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-all group">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="text-white text-sm font-medium truncate">{s.title}</p>
                            <p className="text-white/40 text-xs mt-0.5">{s.subject}</p>
                          </div>
                          {s.status === 'live' ? (
                            <span className="badge-live flex-shrink-0">LIVE</span>
                          ) : (
                            <span className="text-white/30 text-xs flex-shrink-0">{s.scheduledAt ? new Date(s.scheduledAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : 'Scheduled'}</span>
                          )}
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
                <Link to="/live-sessions" className="btn-outline text-xs py-1.5 w-full mt-3 text-center block">
                  See All Live Classes
                </Link>
              </div>

              {/* Badges */}
              <div className="glass-card p-5">
                <h3 className="text-white font-semibold mb-4">My Badges</h3>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { emoji: '🎯', name: 'Quiz Starter' },
                    { emoji: '📚', name: 'Explorer' },
                    { emoji: '🎓', name: 'Live Learner' },
                  ].map(b => (
                    <div key={b.name} className="text-center p-2 bg-white/5 rounded-xl">
                      <div className="text-2xl mb-1">{b.emoji}</div>
                      <p className="text-white/50 text-xs">{b.name}</p>
                    </div>
                  ))}
                </div>
                <Link to="/student/progress" className="btn-outline text-xs py-1.5 w-full mt-3 text-center block">
                  View Progress
                </Link>
              </div>

              {/* Quick Actions */}
              <div className="glass-card p-5">
                <h3 className="text-white font-semibold mb-4">Quick Actions</h3>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { label: 'Take Quiz', icon: HelpCircle, href: '/student/quizzes', color: 'text-primary-400' },
                    { label: 'Assignments', icon: ClipboardList, href: '/student/assignments', color: 'text-secondary-400' },
                    { label: 'Progress', icon: TrendingUp, href: '/student/progress', color: 'text-accent-400' },
                    { label: 'Live Class', icon: Radio, href: '/live-sessions', color: 'text-red-400' },
                  ].map(({ label, icon: Icon, href, color }) => (
                    <Link key={label} to={href}
                      className="flex flex-col items-center gap-1.5 p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-all">
                      <Icon className={`w-5 h-5 ${color}`} />
                      <span className="text-white/60 text-xs text-center">{label}</span>
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

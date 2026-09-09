import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Users, HelpCircle, Radio, BarChart2, Plus, ChevronRight, Star, TrendingUp } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { Course, LiveSession } from '../../types';
import { getCourseThumbnail } from '../../utils/courseImage';

const TeacherDashboard: React.FC = () => {
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [stats, setStats] = useState({ students: 0, quizzes: 0, assignments: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/teacher/courses'),
      api.get('/teacher/live-sessions'),
      api.get('/teacher/students'),
      api.get('/teacher/quizzes'),
      api.get('/teacher/assignments'),
    ]).then(([c, l, s, q, a]) => {
      setCourses(c.data.courses || []);
      setSessions(l.data.sessions || []);
      setStats({
        students: s.data.students?.length || 0,
        quizzes: q.data.quizzes?.length || 0,
        assignments: a.data.assignments?.length || 0,
      });
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const statCards = [
    { label: 'My Courses', value: courses.length, icon: BookOpen, iconBg: 'bg-[#EDE9FE] text-[#6C63F2]', href: '/teacher/courses' },
    { label: 'Students Enrolled', value: stats.students, icon: Users, iconBg: 'bg-[#DCFCE7] text-[#16A34A]', href: '/teacher/students' },
    { label: 'Quizzes Created', value: stats.quizzes, icon: HelpCircle, iconBg: 'bg-[#FEF3C7] text-[#D97706]', href: '/teacher/quizzes' },
    { label: 'Assignments', value: stats.assignments, icon: BarChart2, iconBg: 'bg-[#FFE4EC] text-[#E1447A]', href: '/teacher/assignments' },
  ];

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 ml-16 md:ml-64 transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div>
              <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">
                Teacher Dashboard
              </h1>
              <p className="text-text-secondary text-sm mt-1">Hello, {user?.name?.split(' ')[0]}! Here's your teaching overview.</p>
            </div>
            <div className="flex gap-3">
              <Link to="/teacher/courses" className="btn-primary text-sm py-2 flex items-center gap-2">
                <Plus className="w-4 h-4" /> New Course
              </Link>
              <Link to="/teacher/live" className="btn-outline text-sm py-2 flex items-center gap-2">
                <Radio className="w-4 h-4 text-brand-primary" /> Start Live
              </Link>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-5 mb-8">
            {statCards.map(({ label, value, icon: Icon, iconBg, href }) => (
              <Link key={label} to={href} className="card-soft p-5 hover:-translate-y-0.5 transition-all flex flex-col justify-between">
                <div className="flex items-center justify-between mb-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${iconBg}`}>
                    <Icon className="w-5 h-5" />
                  </div>
                  <ChevronRight className="w-4 h-4 text-text-muted" />
                </div>
                <div>
                  <p className="text-2xl font-bold font-heading text-text-primary">{loading ? '...' : value}</p>
                  <p className="text-text-secondary text-xs mt-1 font-medium">{label}</p>
                </div>
              </Link>
            ))}
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* My Courses */}
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-text-primary font-heading font-semibold text-lg">My Courses</h2>
                <Link to="/teacher/courses" className="text-brand-primary text-sm font-medium hover:text-brand-primary-hover">View All</Link>
              </div>
              <div className="space-y-3">
                {loading ? (
                  [...Array(3)].map((_, i) => <div key={i} className="skeleton h-20 rounded-card" />)
                ) : courses.length === 0 ? (
                  <div className="card-soft p-8 text-center">
                    <BookOpen className="w-10 h-10 text-text-muted mx-auto mb-3" />
                    <p className="text-text-secondary text-sm">No courses yet.</p>
                    <Link to="/teacher/courses" className="btn-primary mt-4 inline-block text-sm">Create Course</Link>
                  </div>
                ) : (
                  courses.slice(0, 5).map(c => (
                    <div key={c._id} className="card-soft p-4 flex items-center gap-4 hover:bg-surface-alt transition-all">
                      <img
                        src={getCourseThumbnail(c)}
                        alt={c.title}
                        className="w-14 h-14 rounded-xl object-cover flex-shrink-0"
                        onError={e => { (e.target as HTMLImageElement).src = getCourseThumbnail(c); }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-text-primary font-semibold text-sm truncate font-heading">{c.title}</p>
                        <p className="text-text-secondary text-xs mt-0.5">{c.subject} • Std {c.standard} • {c.totalLectures} lectures</p>
                        <div className="flex items-center gap-1 mt-1">
                          <Star className="w-3 h-3 text-accent-amber fill-accent-amber" />
                          <span className="text-xs text-text-secondary font-medium">{c.rating} • {c.enrolledCount} students</span>
                        </div>
                      </div>
                      <Link to={`/courses/${c._id}`} className="text-text-muted hover:text-brand-primary transition-colors p-2">
                        <ChevronRight className="w-5 h-5" />
                      </Link>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Live Sessions */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-text-primary font-heading font-semibold text-lg">Live Sessions</h2>
                <Link to="/teacher/live" className="text-brand-primary text-sm font-medium hover:text-brand-primary-hover">Manage</Link>
              </div>
              <div className="space-y-3">
                {loading ? (
                  [...Array(3)].map((_, i) => <div key={i} className="skeleton h-20 rounded-card" />)
                ) : sessions.length === 0 ? (
                  <div className="card-soft p-6 text-center">
                    <Radio className="w-8 h-8 text-text-muted mx-auto mb-2" />
                    <p className="text-text-secondary text-sm">No sessions yet.</p>
                    <Link to="/teacher/live" className="btn-outline mt-3 inline-block text-xs py-2">Start Live</Link>
                  </div>
                ) : (
                  sessions.slice(0, 4).map(s => (
                    <div key={s._id} className="card-soft p-4">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-text-primary font-semibold text-sm truncate font-heading">{s.title}</p>
                        {s.status === 'live' ? (
                          <span className="badge-live text-xs">LIVE</span>
                        ) : s.status === 'scheduled' ? (
                          <span className="badge-subject-live text-xs">Scheduled</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-surface-alt text-text-muted">Ended</span>
                        )}
                      </div>
                      <p className="text-text-secondary text-xs">{s.subject} • Std {s.standard}</p>
                      <p className="text-text-muted text-xs mt-1">
                        {s.scheduledAt ? new Date(s.scheduledAt).toLocaleDateString('en-IN') : ''} •{' '}
                        Code: <span className="font-mono text-brand-primary font-semibold">{s.sessionCode}</span>
                      </p>
                    </div>
                  ))
                )}
                <Link to="/teacher/live" className="btn-outline text-xs py-2.5 w-full text-center block">
                  + Create New Session
                </Link>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default TeacherDashboard;

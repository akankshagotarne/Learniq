import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Users, HelpCircle, Radio, BarChart2, Plus, ChevronRight, Star, TrendingUp } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { Course, LiveSession } from '../../types';

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
    { label: 'My Courses', value: courses.length, icon: BookOpen, color: 'text-primary-400', bg: 'bg-primary-500/10 border-primary-500/20', href: '/teacher/courses' },
    { label: 'Students', value: stats.students, icon: Users, color: 'text-accent-400', bg: 'bg-accent-500/10 border-accent-500/20', href: '/teacher/students' },
    { label: 'Quizzes', value: stats.quizzes, icon: HelpCircle, color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20', href: '/teacher/quizzes' },
    { label: 'Assignments', value: stats.assignments, icon: BarChart2, color: 'text-secondary-400', bg: 'bg-secondary-500/10 border-secondary-500/20', href: '/teacher/assignments' },
  ];

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-16 md:ml-64 transition-all duration-300">
        <div className="p-6 lg:p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="font-display font-bold text-2xl text-white">
                Teacher Dashboard
              </h1>
              <p className="text-white/50 text-sm mt-1">Hello, {user?.name?.split(' ')[0]}! Here's your teaching overview.</p>
            </div>
            <div className="flex gap-3">
              <Link to="/teacher/courses" className="btn-primary text-sm py-2 flex items-center gap-2">
                <Plus className="w-4 h-4" /> New Course
              </Link>
              <Link to="/teacher/live" className="btn-secondary text-sm py-2 flex items-center gap-2">
                <Radio className="w-4 h-4" /> Start Live
              </Link>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
            {statCards.map(({ label, value, icon: Icon, color, bg, href }) => (
              <Link key={label} to={href} className={`glass-card p-5 border ${bg} hover:-translate-y-0.5 transition-all`}>
                <div className="flex items-center justify-between mb-2">
                  <Icon className={`w-5 h-5 ${color}`} />
                  <ChevronRight className="w-4 h-4 text-white/20" />
                </div>
                <p className={`text-2xl font-bold ${color}`}>{loading ? '...' : value}</p>
                <p className="text-white/50 text-xs mt-1">{label}</p>
              </Link>
            ))}
          </div>

          <div className="grid lg:grid-cols-3 gap-6">
            {/* My Courses */}
            <div className="lg:col-span-2">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-white font-semibold">My Courses</h2>
                <Link to="/teacher/courses" className="text-primary-400 text-sm hover:text-primary-300">View All</Link>
              </div>
              <div className="space-y-3">
                {loading ? (
                  [...Array(3)].map((_, i) => <div key={i} className="skeleton h-20 rounded-xl" />)
                ) : courses.length === 0 ? (
                  <div className="glass-card p-8 text-center">
                    <BookOpen className="w-10 h-10 text-white/20 mx-auto mb-3" />
                    <p className="text-white/40 text-sm">No courses yet.</p>
                    <Link to="/teacher/courses" className="btn-primary mt-4 inline-block text-sm">Create Course</Link>
                  </div>
                ) : (
                  courses.slice(0, 5).map(c => (
                    <div key={c._id} className="glass-card p-4 flex items-center gap-4 hover:bg-white/10 transition-all">
                      <img
                        src={c.thumbnail || `https://picsum.photos/seed/${c.subject}/64/64`}
                        alt={c.title}
                        className="w-14 h-14 rounded-xl object-cover flex-shrink-0"
                        onError={e => { (e.target as HTMLImageElement).src = 'https://picsum.photos/64/64'; }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-white font-medium text-sm truncate">{c.title}</p>
                        <p className="text-white/40 text-xs mt-0.5">{c.subject} • Std {c.standard} • {c.totalLectures} lectures</p>
                        <div className="flex items-center gap-1 mt-1">
                          <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                          <span className="text-xs text-white/40">{c.rating} • {c.enrolledCount} students</span>
                        </div>
                      </div>
                      <Link to={`/courses/${c._id}`} className="text-white/30 hover:text-primary-400 transition-colors">
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
                <h2 className="text-white font-semibold">Live Sessions</h2>
                <Link to="/teacher/live" className="text-primary-400 text-sm hover:text-primary-300">Manage</Link>
              </div>
              <div className="space-y-3">
                {loading ? (
                  [...Array(3)].map((_, i) => <div key={i} className="skeleton h-20 rounded-xl" />)
                ) : sessions.length === 0 ? (
                  <div className="glass-card p-6 text-center">
                    <Radio className="w-8 h-8 text-white/20 mx-auto mb-2" />
                    <p className="text-white/40 text-sm">No sessions yet.</p>
                    <Link to="/teacher/live" className="btn-secondary mt-3 inline-block text-xs py-2">Start Live</Link>
                  </div>
                ) : (
                  sessions.slice(0, 4).map(s => (
                    <div key={s._id} className="glass-card p-4">
                      <div className="flex items-center justify-between mb-1">
                        <p className="text-white font-medium text-sm">{s.title}</p>
                        {s.status === 'live' ? (
                          <span className="badge-live text-xs">LIVE</span>
                        ) : s.status === 'scheduled' ? (
                          <span className="badge bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs">Scheduled</span>
                        ) : (
                          <span className="badge bg-white/10 text-white/40 text-xs">Ended</span>
                        )}
                      </div>
                      <p className="text-white/40 text-xs">{s.subject} • Std {s.standard}</p>
                      <p className="text-white/30 text-xs mt-1">
                        {s.scheduledAt ? new Date(s.scheduledAt).toLocaleDateString('en-IN') : ''} •{' '}
                        Code: <span className="font-mono text-primary-400">{s.sessionCode}</span>
                      </p>
                    </div>
                  ))
                )}
                <Link to="/teacher/live" className="btn-secondary text-xs py-2 w-full text-center block">
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

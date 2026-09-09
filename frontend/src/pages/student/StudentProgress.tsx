import React, { useEffect, useState } from 'react';
import { BarChart2, TrendingUp, BookOpen, HelpCircle, Radio, Award, Flame } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { RadialBarChart, RadialBar, ResponsiveContainer, Tooltip } from 'recharts';

const StudentProgress: React.FC = () => {
  const { user } = useAuth();
  const [progress, setProgress] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/student/progress').then(r => setProgress(r.data.progress)).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const completionRate = progress?.enrollments?.length > 0
    ? Math.round(progress.enrollments.reduce((s: number, e: any) => s + (e.completionPercentage || 0), 0) / progress.enrollments.length)
    : 0;

  const radialData = [{ name: 'Completion', value: completionRate, fill: '#6C63FF' }];

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-16 md:ml-64 transition-all duration-300">
        <div className="p-6 lg:p-8">
          <h1 className="font-display font-bold text-2xl text-white mb-2">My Progress</h1>
          <p className="text-white/50 text-sm mb-8">Track your learning journey</p>

          {loading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[...Array(8)].map((_, i) => <div key={i} className="skeleton h-28 rounded-2xl" />)}
            </div>
          ) : !progress ? (
            <div className="glass-card p-12 text-center">
              <BarChart2 className="w-12 h-12 text-white/20 mx-auto mb-3" />
              <p className="text-white/40">No progress data yet. Start learning!</p>
            </div>
          ) : (
            <>
              {/* Overview */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
                {[
                  { label: 'Points', value: progress.totalPoints || 0, icon: Award, color: 'text-yellow-400' },
                  { label: 'Quiz Avg Score', value: `${progress.avgQuizScore || 0}%`, icon: HelpCircle, color: 'text-primary-400' },
                  { label: 'Courses Enrolled', value: progress.enrollments?.length || 0, icon: BookOpen, color: 'text-accent-400' },
                  { label: 'Live Classes', value: progress.liveClassesAttended || 0, icon: Radio, color: 'text-secondary-400' },
                ].map(({ label, value, icon: Icon, color }) => (
                  <div key={label} className="glass-card p-5">
                    <Icon className={`w-5 h-5 ${color} mb-2`} />
                    <p className={`text-2xl font-bold ${color}`}>{value}</p>
                    <p className="text-white/50 text-xs mt-1">{label}</p>
                  </div>
                ))}
              </div>

              <div className="grid lg:grid-cols-3 gap-6">
                {/* Completion Rate */}
                <div className="glass-card p-6 text-center">
                  <h3 className="text-white font-semibold mb-4">Overall Completion</h3>
                  <ResponsiveContainer width="100%" height={150}>
                    <RadialBarChart cx="50%" cy="50%" innerRadius="60%" outerRadius="90%" data={radialData} startAngle={90} endAngle={-270}>
                      <RadialBar background dataKey="value" cornerRadius={10} fill="#6C63FF" />
                    </RadialBarChart>
                  </ResponsiveContainer>
                  <p className="text-3xl font-bold gradient-text">{completionRate}%</p>
                  <p className="text-white/40 text-sm mt-1">Course completion</p>
                </div>

                {/* Course Progress */}
                <div className="lg:col-span-2 glass-card p-6">
                  <h3 className="text-white font-semibold mb-4">Enrolled Courses</h3>
                  {progress.enrollments?.length === 0 ? (
                    <p className="text-white/40 text-sm text-center py-8">No courses enrolled yet.</p>
                  ) : (
                    <div className="space-y-4">
                      {progress.enrollments?.slice(0, 5).map((e: any) => (
                        <div key={e._id}>
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-white text-sm font-medium truncate flex-1">{e.course?.title}</p>
                            <span className="text-white/50 text-xs ml-2">{e.completionPercentage || 0}%</span>
                          </div>
                          <div className="progress-bar">
                            <div className="progress-fill" style={{ width: `${e.completionPercentage || 0}%` }} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Quiz Results */}
              {progress.quizAttempts?.length > 0 && (
                <div className="glass-card p-6 mt-6">
                  <h3 className="text-white font-semibold mb-4">Recent Quiz Results</h3>
                  <div className="space-y-3">
                    {progress.quizAttempts.slice(0, 5).map((a: any) => (
                      <div key={a._id} className="flex items-center gap-4 p-3 bg-white/5 rounded-xl">
                        <div className="flex-1 min-w-0">
                          <p className="text-white text-sm font-medium truncate">{a.quiz?.title || 'Quiz'}</p>
                          <p className="text-white/30 text-xs">{new Date(a.createdAt).toLocaleDateString('en-IN')}</p>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-bold ${a.percentage >= 60 ? 'text-accent-400' : 'text-red-400'}`}>{a.score}/{a.totalMarks}</p>
                          <p className="text-white/40 text-xs">{a.percentage}%</p>
                        </div>
                        <div className="w-12 h-2 bg-white/10 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${a.percentage >= 60 ? 'bg-accent-500' : 'bg-red-500'}`}
                            style={{ width: `${a.percentage}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Badges */}
              <div className="glass-card p-6 mt-6">
                <h3 className="text-white font-semibold mb-4">Badges & Achievements</h3>
                <div className="flex flex-wrap gap-4">
                  {[
                    { emoji: '🎯', name: 'Quiz Starter', desc: 'Completed first quiz' },
                    { emoji: '📚', name: 'Learning Explorer', desc: 'Enrolled in courses' },
                    { emoji: '🎓', name: 'Live Learner', desc: 'Attended live class' },
                    { emoji: '🔥', name: '7-Day Learner', desc: `${user?.streak || 0}-day streak` },
                  ].map(b => (
                    <div key={b.name} className="glass-card p-4 text-center w-28">
                      <div className="text-3xl mb-2">{b.emoji}</div>
                      <p className="text-white text-xs font-semibold">{b.name}</p>
                      <p className="text-white/30 text-xs mt-0.5">{b.desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default StudentProgress;

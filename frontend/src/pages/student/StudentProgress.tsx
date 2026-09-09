import React, { useEffect, useState } from 'react';
import { BarChart2, TrendingUp, BookOpen, HelpCircle, Radio, Award, Flame } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { RadialBarChart, RadialBar, ResponsiveContainer } from 'recharts';

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

  const radialData = [{ name: 'Completion', value: completionRate, fill: '#6C63F2' }];

  return (
    <div className="flex min-h-screen bg-page transition-colors">
      <Sidebar />
      <main className="flex-1 ml-16 md:ml-64 transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="mb-8">
            <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary mb-1">My Progress</h1>
            <p className="text-text-secondary text-sm">Track your learning journey and accomplishments</p>
          </div>

          {loading ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
              {[...Array(8)].map((_, i) => <div key={i} className="card-soft h-28 rounded-2xl animate-pulse bg-surface-alt" />)}
            </div>
          ) : !progress ? (
            <div className="card-soft p-12 text-center">
              <BarChart2 className="w-12 h-12 text-text-muted mx-auto mb-3" />
              <p className="text-text-secondary text-sm font-medium">No progress data yet. Start learning!</p>
            </div>
          ) : (
            <>
              {/* Overview */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-5 mb-8">
                {[
                  { label: 'Points Earned', value: progress.totalPoints || 0, icon: Award, chipBg: 'bg-[#FFC24B]/15', iconColor: 'text-[#FFC24B]' },
                  { label: 'Quiz Avg Score', value: `${progress.avgQuizScore || 0}%`, icon: HelpCircle, chipBg: 'bg-[#6C63F2]/10', iconColor: 'text-[#6C63F2]' },
                  { label: 'Courses Enrolled', value: progress.enrollments?.length || 0, icon: BookOpen, chipBg: 'bg-[#4ADE9A]/15', iconColor: 'text-[#4ADE9A]' },
                  { label: 'Live Classes', value: progress.liveClassesAttended || 0, icon: Radio, chipBg: 'bg-[#5AC8FA]/15', iconColor: 'text-[#5AC8FA]' },
                ].map(({ label, value, icon: Icon, chipBg, iconColor }) => (
                  <div key={label} className="card-soft p-5">
                    <div className="flex items-center justify-between mb-3">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${chipBg} ${iconColor}`}>
                        <Icon className="w-5 h-5" />
                      </div>
                    </div>
                    <p className="text-2xl font-heading font-bold text-text-primary">{value}</p>
                    <p className="text-text-secondary text-xs mt-1 font-medium">{label}</p>
                  </div>
                ))}
              </div>

              <div className="grid lg:grid-cols-3 gap-6">
                {/* Completion Rate */}
                <div className="card-soft p-6 text-center">
                  <h3 className="font-heading font-semibold text-text-primary mb-4 text-base">Overall Completion</h3>
                  <ResponsiveContainer width="100%" height={150}>
                    <RadialBarChart cx="50%" cy="50%" innerRadius="60%" outerRadius="90%" data={radialData} startAngle={90} endAngle={-270}>
                      <RadialBar background dataKey="value" cornerRadius={10} fill="#6C63F2" />
                    </RadialBarChart>
                  </ResponsiveContainer>
                  <p className="text-3xl font-heading font-bold text-gradient mt-1">{completionRate}%</p>
                  <p className="text-text-secondary text-xs mt-1 font-medium">Average syllabus progress</p>
                </div>

                {/* Course Progress */}
                <div className="lg:col-span-2 card-soft p-6">
                  <h3 className="font-heading font-semibold text-text-primary mb-4 text-base">Enrolled Courses</h3>
                  {progress.enrollments?.length === 0 ? (
                    <p className="text-text-muted text-sm text-center py-8">No courses enrolled yet.</p>
                  ) : (
                    <div className="space-y-4">
                      {progress.enrollments?.slice(0, 5).map((e: any) => (
                        <div key={e._id}>
                          <div className="flex items-center justify-between mb-1.5">
                            <p className="text-text-primary text-sm font-semibold truncate flex-1">{e.course?.title}</p>
                            <span className="text-text-secondary text-xs ml-2 font-medium">{e.completionPercentage || 0}%</span>
                          </div>
                          <div className="h-2.5 w-full bg-surface-alt rounded-full overflow-hidden border border-border-subtle">
                            <div
                              className="h-full bg-gradient-to-r from-brand-primary to-accent-lilac rounded-full transition-all duration-500"
                              style={{ width: `${e.completionPercentage || 0}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Quiz Results */}
              {progress.quizAttempts?.length > 0 && (
                <div className="card-soft p-6 mt-6">
                  <h3 className="font-heading font-semibold text-text-primary mb-4 text-base">Recent Quiz Results</h3>
                  <div className="space-y-3">
                    {progress.quizAttempts.slice(0, 5).map((a: any) => (
                      <div key={a._id} className="flex items-center gap-4 p-3.5 bg-surface-alt border border-border-subtle rounded-xl">
                        <div className="flex-1 min-w-0">
                          <p className="text-text-primary text-sm font-semibold truncate">{a.quiz?.title || 'Quiz'}</p>
                          <p className="text-text-muted text-xs mt-0.5">{new Date(a.createdAt).toLocaleDateString('en-IN')}</p>
                        </div>
                        <div className="text-right">
                          <p className={`text-sm font-bold ${a.percentage >= 60 ? 'text-[#16A34A] dark:text-[#4ADE9A]' : 'text-[#E1447A]'}`}>
                            {a.score}/{a.totalMarks}
                          </p>
                          <p className="text-text-secondary text-xs font-medium">{a.percentage}%</p>
                        </div>
                        <div className="w-16 h-2 bg-surface border border-border-subtle rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full ${a.percentage >= 60 ? 'bg-accent-mint' : 'bg-[#E1447A]'}`}
                            style={{ width: `${a.percentage}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Badges */}
              <div className="card-soft p-6 mt-6">
                <h3 className="font-heading font-semibold text-text-primary mb-4 text-base">Badges & Achievements</h3>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                  {[
                    { emoji: '🎯', name: 'Quiz Starter', desc: 'Completed first quiz', bg: 'bg-[#DCFCE7] dark:bg-[#153428] text-[#16A34A] dark:text-[#4ADE9A]' },
                    { emoji: '📚', name: 'Learning Explorer', desc: 'Enrolled in courses', bg: 'bg-[#EDE9FE] dark:bg-[#28214C] text-[#6C63F2] dark:text-[#B69CF2]' },
                    { emoji: '🎓', name: 'Live Learner', desc: 'Attended live class', bg: 'bg-[#E0F2FE] dark:bg-[#0c3148] text-[#0284C7] dark:text-[#5AC8FA]' },
                    { emoji: '🔥', name: '7-Day Learner', desc: `${user?.streak || 0}-day streak`, bg: 'bg-[#FEF3C7] dark:bg-[#3D2C0C] text-[#D97706] dark:text-[#FFC24B]' },
                  ].map(b => (
                    <div key={b.name} className="bg-surface-alt border border-border-subtle rounded-xl p-4 text-center hover:shadow-soft transition-all">
                      <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-2 text-2xl ${b.bg} shadow-xs`}>
                        {b.emoji}
                      </div>
                      <p className="text-text-primary text-xs font-semibold">{b.name}</p>
                      <p className="text-text-secondary text-[11px] mt-0.5">{b.desc}</p>
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


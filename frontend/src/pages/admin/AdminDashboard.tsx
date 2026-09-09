import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, BookOpen, Radio, CreditCard, TrendingUp, Award, BarChart2, ChevronRight, UserCheck, UserX } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, LineChart, Line } from 'recharts';
import toast from 'react-hot-toast';

const AdminDashboard: React.FC = () => {
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [pendingTeachers, setPendingTeachers] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      api.get('/admin/stats'),
      api.get('/admin/users?role=teacher'),
    ]).then(([s, u]) => {
      setStats(s.data.stats);
      setPendingTeachers(u.data.users?.filter((t: any) => !t.isApproved) || []);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const approveTeacher = async (id: string, approve: boolean) => {
    try {
      await api.put(`/admin/users/${id}`, { isApproved: approve });
      setPendingTeachers(prev => prev.filter(t => t._id !== id));
      toast.success(approve ? 'Teacher approved!' : 'Teacher rejected');
    } catch { toast.error('Failed to update.'); }
  };

  const statCards = [
    { label: 'Total Students', value: stats?.students || 0, icon: Users, color: 'text-primary-400', bg: 'bg-primary-500/10 border-primary-500/20' },
    { label: 'Total Teachers', value: stats?.teachers || 0, icon: Award, color: 'text-secondary-400', bg: 'bg-secondary-500/10 border-secondary-500/20' },
    { label: 'Total Courses', value: stats?.courses || 0, icon: BookOpen, color: 'text-accent-400', bg: 'bg-accent-500/10 border-accent-500/20' },
    { label: 'Live Sessions', value: stats?.sessions || 0, icon: Radio, color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20' },
    { label: 'Total Lectures', value: stats?.lectures || 0, icon: BarChart2, color: 'text-blue-400', bg: 'bg-blue-500/10 border-blue-500/20' },
    { label: 'Revenue', value: `₹${((stats?.totalRevenue || 0) / 100).toFixed(0)}`, icon: CreditCard, color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20' },
  ];

  const chartData = [
    { name: 'Std 1-2', students: 120, courses: 8 },
    { name: 'Std 3-4', students: 180, courses: 10 },
    { name: 'Std 5-6', students: 250, courses: 12 },
    { name: 'Std 7-8', students: 310, courses: 14 },
    { name: 'Std 9-10', students: 420, courses: 16 },
  ];

  const pieData = [
    { name: 'Mathematics', value: 35, color: '#6C63FF' },
    { name: 'Science', value: 28, color: '#FF6584' },
    { name: 'English', value: 20, color: '#43C6AC' },
    { name: 'Social Sci.', value: 10, color: '#F7971E' },
    { name: 'Marathi', value: 7, color: '#4776E6' },
  ];

  const revenueData = [
    { month: 'Apr', revenue: 4200 },
    { month: 'May', revenue: 6800 },
    { month: 'Jun', revenue: 8100 },
    { month: 'Jul', revenue: 9500 },
    { month: 'Aug', revenue: 11200 },
    { month: 'Sep', revenue: 13400 },
  ];

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-16 md:ml-64 transition-all duration-300">
        <div className="p-6 lg:p-8">
          <div className="mb-8">
            <h1 className="font-display font-bold text-2xl text-white">Admin Dashboard</h1>
            <p className="text-white/50 text-sm mt-1">Platform overview and management</p>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
            {statCards.map(({ label, value, icon: Icon, color, bg }) => (
              <div key={label} className={`glass-card p-4 border ${bg}`}>
                <Icon className={`w-5 h-5 ${color} mb-2`} />
                <p className={`text-2xl font-bold ${color}`}>{loading ? '...' : value}</p>
                <p className="text-white/50 text-xs mt-1">{label}</p>
              </div>
            ))}
          </div>

          {/* Pending Teachers */}
          {pendingTeachers.length > 0 && (
            <div className="glass-card p-5 mb-6 border border-yellow-500/20 bg-yellow-500/5">
              <h3 className="text-yellow-400 font-semibold mb-3 flex items-center gap-2">
                ⚠️ Pending Teacher Approvals ({pendingTeachers.length})
              </h3>
              <div className="space-y-2">
                {pendingTeachers.map(teacher => (
                  <div key={teacher._id} className="flex items-center gap-3 p-3 bg-white/5 rounded-xl">
                    <img src={teacher.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(teacher.name)}&background=6C63FF&color=fff&size=40`}
                      alt={teacher.name} className="w-9 h-9 rounded-full object-cover" />
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium">{teacher.name}</p>
                      <p className="text-white/40 text-xs">{teacher.email}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => approveTeacher(teacher._id, true)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-accent-500/20 text-accent-400 border border-accent-500/30 rounded-lg text-xs hover:bg-accent-500/30 transition-all">
                        <UserCheck className="w-3.5 h-3.5" /> Approve
                      </button>
                      <button onClick={() => approveTeacher(teacher._id, false)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg text-xs hover:bg-red-500/30 transition-all">
                        <UserX className="w-3.5 h-3.5" /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Charts */}
          <div className="grid lg:grid-cols-2 gap-6 mb-6">
            {/* Students by Standard */}
            <div className="glass-card p-5">
              <h3 className="text-white font-semibold mb-4">Students by Standard Group</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="name" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} />
                  <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', fontSize: 12 }} />
                  <Bar dataKey="students" fill="#6C63FF" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Revenue */}
            <div className="glass-card p-5">
              <h3 className="text-white font-semibold mb-4">Revenue Trend (₹)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                  <XAxis dataKey="month" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} />
                  <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} axisLine={false} />
                  <Tooltip contentStyle={{ background: '#1a1a2e', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, color: '#fff', fontSize: 12 }} formatter={(v) => `₹${v}`} />
                  <Line type="monotone" dataKey="revenue" stroke="#FF6584" strokeWidth={2} dot={{ fill: '#FF6584' }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Subject Distribution */}
            <div className="glass-card p-5">
              <h3 className="text-white font-semibold mb-4">Popular Subjects</h3>
              <div className="flex items-center gap-6">
                <PieChart width={140} height={140}>
                  <Pie data={pieData} cx={65} cy={65} innerRadius={40} outerRadius={65} dataKey="value">
                    {pieData.map((e, i) => <Cell key={i} fill={e.color} />)}
                  </Pie>
                </PieChart>
                <div className="flex-1 space-y-2">
                  {pieData.map(({ name, value, color }) => (
                    <div key={name} className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                      <span className="text-white/60 text-xs flex-1">{name}</span>
                      <span className="text-white text-xs font-medium">{value}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Recent Users */}
            <div className="glass-card p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-semibold">Recent Registrations</h3>
                <Link to="/admin/students" className="text-primary-400 text-xs hover:text-primary-300">View All</Link>
              </div>
              <div className="space-y-2">
                {stats?.recentStudents?.map((s: any) => (
                  <div key={s._id} className="flex items-center gap-3 p-2.5 bg-white/5 rounded-lg">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-500 to-secondary-500 flex items-center justify-center text-xs font-bold text-white">
                      {s.name?.[0] || 'S'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-xs font-medium truncate">{s.name}</p>
                      <p className="text-white/30 text-xs">Std {s.currentStandard}</p>
                    </div>
                    <p className="text-white/30 text-xs">{new Date(s.createdAt).toLocaleDateString('en-IN')}</p>
                  </div>
                ))}
                {(!stats?.recentStudents || stats.recentStudents.length === 0) && (
                  <p className="text-white/40 text-sm text-center py-4">No recent students</p>
                )}
              </div>
            </div>
          </div>

          {/* Quick Links */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-6">
            {[
              { label: 'Manage Students', href: '/admin/students', icon: Users },
              { label: 'Manage Teachers', href: '/admin/teachers', icon: Award },
              { label: 'All Courses', href: '/admin/courses', icon: BookOpen },
              { label: 'Payments', href: '/admin/payments', icon: CreditCard },
            ].map(({ label, href, icon: Icon }) => (
              <Link key={label} to={href} className="glass-card-hover p-4 flex items-center gap-3 group">
                <Icon className="w-5 h-5 text-primary-400 group-hover:scale-110 transition-transform" />
                <span className="text-white/70 text-sm group-hover:text-white transition-colors">{label}</span>
                <ChevronRight className="w-4 h-4 text-white/20 ml-auto" />
              </Link>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminDashboard;

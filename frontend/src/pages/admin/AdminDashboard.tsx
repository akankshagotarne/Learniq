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
    { label: 'Total Students', value: stats?.students || 0, icon: Users, iconBg: 'bg-[#EDE9FE] text-[#6C63F2]' },
    { label: 'Total Teachers', value: stats?.teachers || 0, icon: Award, iconBg: 'bg-[#DCFCE7] text-[#16A34A]' },
    { label: 'Total Courses', value: stats?.courses || 0, icon: BookOpen, iconBg: 'bg-[#FEF3C7] text-[#D97706]' },
    { label: 'Live Sessions', value: stats?.sessions || 0, icon: Radio, iconBg: 'bg-[#FFE4EC] text-[#E1447A]' },
    { label: 'Total Lectures', value: stats?.lectures || 0, icon: BarChart2, iconBg: 'bg-[#E0F2FE] text-[#0284C7]' },
    { label: 'Revenue', value: `₹${((stats?.totalRevenue || 0) / 100).toFixed(0)}`, icon: CreditCard, iconBg: 'bg-[#F3E8FF] text-[#9333EA]' },
  ];

  const chartData = [
    { name: 'Std 1-2', students: 120, courses: 8 },
    { name: 'Std 3-4', students: 180, courses: 10 },
    { name: 'Std 5-6', students: 250, courses: 12 },
    { name: 'Std 7-8', students: 310, courses: 14 },
    { name: 'Std 9-10', students: 420, courses: 16 },
  ];

  const pieData = [
    { name: 'Mathematics', value: 32, color: '#6C63F2' },
    { name: 'Science', value: 26, color: '#4ADE9A' },
    { name: 'English', value: 18, color: '#5AC8FA' },
    { name: 'GK', value: 14, color: '#FFC24B' },
    { name: 'Computer', value: 10, color: '#B69CF2' },
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
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 ml-16 md:ml-64 transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="mb-8">
            <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">Admin Dashboard</h1>
            <p className="text-text-secondary text-sm mt-1">Platform overview and management</p>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
            {statCards.map(({ label, value, icon: Icon, iconBg }) => (
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

          {/* Pending Teachers */}
          {pendingTeachers.length > 0 && (
            <div className="card-soft p-5 mb-6 border-amber-300/60 bg-[#FEF3C7]/30">
              <h3 className="text-[#D97706] font-semibold mb-3 flex items-center gap-2 font-heading">
                ⚠️ Pending Teacher Approvals ({pendingTeachers.length})
              </h3>
              <div className="space-y-2">
                {pendingTeachers.map(teacher => (
                  <div key={teacher._id} className="flex items-center gap-3 p-3 bg-surface rounded-xl border border-border-subtle">
                    <img src={teacher.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(teacher.name)}&background=6C63F2&color=fff&size=40`}
                      alt={teacher.name} className="w-9 h-9 rounded-full object-cover" />
                    <div className="flex-1 min-w-0">
                      <p className="text-text-primary text-sm font-semibold font-heading">{teacher.name}</p>
                      <p className="text-text-secondary text-xs">{teacher.email}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => approveTeacher(teacher._id, true)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-[#DCFCE7] text-[#16A34A] border border-[#DCFCE7] rounded-lg text-xs font-medium hover:bg-[#DCFCE7]/80 transition-all">
                        <UserCheck className="w-3.5 h-3.5" /> Approve
                      </button>
                      <button onClick={() => approveTeacher(teacher._id, false)}
                        className="flex items-center gap-1 px-3 py-1.5 bg-[#FFE4EC] text-[#E1447A] border border-[#FFE4EC] rounded-lg text-xs font-medium hover:bg-[#FFE4EC]/80 transition-all">
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
            <div className="card-soft p-5">
              <h3 className="text-text-primary font-semibold mb-4 font-heading">Students by Standard Group</h3>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E7E7F2" />
                  <XAxis dataKey="name" tick={{ fill: '#6B6E8C', fontSize: 11 }} axisLine={false} />
                  <YAxis tick={{ fill: '#6B6E8C', fontSize: 11 }} axisLine={false} />
                  <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #E7E7F2', borderRadius: 12, color: '#22243A', fontSize: 12, boxShadow: '0 4px 20px rgba(34,36,58,0.06)' }} />
                  <Bar dataKey="students" fill="#6C63F2" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Revenue */}
            <div className="card-soft p-5">
              <h3 className="text-text-primary font-semibold mb-4 font-heading">Revenue Trend (₹)</h3>
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E7E7F2" />
                  <XAxis dataKey="month" tick={{ fill: '#6B6E8C', fontSize: 11 }} axisLine={false} />
                  <YAxis tick={{ fill: '#6B6E8C', fontSize: 11 }} axisLine={false} />
                  <Tooltip contentStyle={{ background: '#FFFFFF', border: '1px solid #E7E7F2', borderRadius: 12, color: '#22243A', fontSize: 12, boxShadow: '0 4px 20px rgba(34,36,58,0.06)' }} formatter={(v) => `₹${v}`} />
                  <Line type="monotone" dataKey="revenue" stroke="#FF8FA3" strokeWidth={3} dot={{ fill: '#FF8FA3', r: 4 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Subject Distribution */}
            <div className="card-soft p-5">
              <h3 className="text-text-primary font-semibold mb-4 font-heading">Popular Subjects</h3>
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
                      <span className="text-text-secondary text-xs flex-1 font-medium">{name}</span>
                      <span className="text-text-primary text-xs font-semibold">{value}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Recent Users */}
            <div className="card-soft p-5">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-text-primary font-semibold font-heading">Recent Registrations</h3>
                <Link to="/admin/students" className="text-brand-primary text-xs font-medium hover:text-brand-primary-hover">View All</Link>
              </div>
              <div className="space-y-2">
                {stats?.recentStudents?.map((s: any) => (
                  <div key={s._id} className="flex items-center gap-3 p-2.5 bg-surface-alt border border-border-subtle rounded-xl">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-brand-primary to-brand-secondary flex items-center justify-center text-xs font-bold text-white shadow-sm">
                      {s.name?.[0] || 'S'}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-text-primary text-xs font-semibold truncate font-heading">{s.name}</p>
                      <p className="text-text-secondary text-xs">Std {s.currentStandard}</p>
                    </div>
                    <p className="text-text-muted text-xs">{new Date(s.createdAt).toLocaleDateString('en-IN')}</p>
                  </div>
                ))}
                {(!stats?.recentStudents || stats.recentStudents.length === 0) && (
                  <p className="text-text-muted text-sm text-center py-4">No recent students</p>
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
              <Link key={label} to={href} className="card-soft p-4 flex items-center gap-3 group hover:-translate-y-0.5 transition-all">
                <div className="w-8 h-8 rounded-xl bg-[#EDE9FE] flex items-center justify-center text-brand-primary group-hover:scale-105 transition-transform">
                  <Icon className="w-4 h-4" />
                </div>
                <span className="text-text-primary text-sm font-medium">{label}</span>
                <ChevronRight className="w-4 h-4 text-text-muted ml-auto group-hover:text-brand-primary group-hover:translate-x-0.5 transition-all" />
              </Link>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminDashboard;

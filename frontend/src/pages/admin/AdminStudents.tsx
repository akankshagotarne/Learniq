import React, { useEffect, useState } from 'react';
import { Search, Users, GraduationCap, Award, Flame } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { User } from '../../types';
import toast from 'react-hot-toast';

const AdminStudents: React.FC = () => {
  const [students, setStudents] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 20;

  useEffect(() => {
    const t = setTimeout(() => {
      fetchStudents();
    }, search ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, page]);

  const fetchStudents = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/users', { params: { role: 'student', search: search || undefined, page, limit } });
      setStudents(res.data.users || []);
      setTotal(res.data.total || 0);
      setTotalPages(res.data.totalPages || 1);
    } catch {
      toast.error('Failed to load students.');
    } finally {
      setLoading(false);
    }
  };

  const toggleActive = async (student: User) => {
    try {
      await api.put(`/admin/users/${student._id}`, { isActive: !student.isActive });
      setStudents(prev => prev.map(s => s._id === student._id ? { ...s, isActive: !s.isActive } : s));
      toast.success(student.isActive ? 'Student deactivated.' : 'Student activated.');
    } catch {
      toast.error('Failed to update student.');
    }
  };

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 ml-0 md:ml-64 pt-14 md:pt-0 transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="mb-8">
            <p className="text-brand-primary text-xs font-semibold tracking-wide uppercase mb-1">Admin</p>
            <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">Manage Students</h1>
            <p className="text-text-secondary text-sm mt-1">All students registered on the platform</p>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total Students', value: total, icon: Users, iconBg: 'bg-[#EDE9FE] text-[#6C63F2]' },
              { label: 'This Page', value: students.length, icon: GraduationCap, iconBg: 'bg-[#DCFCE7] text-[#16A34A]' },
              { label: 'Avg Points', value: students.length ? Math.round(students.reduce((s, u) => s + (u.points || 0), 0) / students.length) : 0, icon: Award, iconBg: 'bg-[#FEF3C7] text-[#D97706]' },
              { label: 'On a Streak', value: students.filter(s => (s.streak || 0) > 0).length, icon: Flame, iconBg: 'bg-[#FFE4EC] text-[#E1447A]' },
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

          {/* Search */}
          <div className="flex items-center gap-4 mb-6">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={search}
                onChange={e => { setPage(1); setSearch(e.target.value); }}
                placeholder="Search by name or email..."
                className="input-field pl-9"
              />
            </div>
            <span className="text-text-secondary text-sm font-medium">{total} student{total !== 1 ? 's' : ''}</span>
          </div>

          {/* List */}
          {loading ? (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-20 rounded-card" />)}
            </div>
          ) : students.length === 0 ? (
            <div className="card-soft p-16 text-center">
              <Users className="w-14 h-14 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary">No students found.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {students.map(student => (
                <div key={student._id} className="card-soft p-4">
                  <div className="flex items-center gap-3 flex-wrap sm:flex-nowrap">
                    <img
                      src={student.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(student.name || 'S')}&background=6C63F2&color=fff&size=48`}
                      alt={student.name}
                      className="w-10 h-10 rounded-full object-cover flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-text-primary font-semibold text-sm font-heading">{student.name}</p>
                        {student.currentStandard != null && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#EDE9FE] text-[#6C63F2]">Std {student.currentStandard}</span>
                        )}
                        {!student.isActive && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#FFE4EC] text-[#E1447A]">Inactive</span>
                        )}
                      </div>
                      <p className="text-text-secondary text-xs truncate">{student.email}{student.phone ? ` • ${student.phone}` : ''}</p>
                      <p className="text-text-muted text-xs mt-0.5">
                        {student.points || 0} pts • {student.streak || 0}-day streak • Joined {new Date(student.createdAt).toLocaleDateString('en-IN')}
                      </p>
                    </div>
                    <button
                      onClick={() => toggleActive(student)}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                        student.isActive
                          ? 'bg-[#FFE4EC] text-[#E1447A] border-[#FFE4EC] hover:bg-[#FFE4EC]/80'
                          : 'bg-[#DCFCE7] text-[#16A34A] border-[#DCFCE7] hover:bg-[#DCFCE7]/80'
                      }`}
                    >
                      {student.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {!loading && totalPages > 1 && (
            <div className="flex items-center justify-center gap-3 mt-6">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="btn-outline text-sm py-1.5 px-4 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-text-secondary text-sm font-medium">Page {page} of {totalPages}</span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="btn-outline text-sm py-1.5 px-4 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminStudents;

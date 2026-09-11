import React, { useEffect, useState } from 'react';
import { Search, Award, UserCheck, UserX, Clock, BookOpen } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { User } from '../../types';
import toast from 'react-hot-toast';

type FilterMode = 'all' | 'pending' | 'approved';

const AdminTeachers: React.FC = () => {
  const [teachers, setTeachers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');

  useEffect(() => {
    const t = setTimeout(() => {
      fetchTeachers();
    }, search ? 350 : 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const fetchTeachers = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/users', { params: { role: 'teacher', search: search || undefined, limit: 100 } });
      setTeachers(res.data.users || []);
    } catch {
      toast.error('Failed to load teachers.');
    } finally {
      setLoading(false);
    }
  };

  const setApproval = async (teacher: User, approve: boolean) => {
    try {
      await api.put(`/admin/users/${teacher._id}`, { isApproved: approve });
      setTeachers(prev => prev.map(t => t._id === teacher._id ? { ...t, isApproved: approve } : t));
      toast.success(approve ? 'Teacher approved!' : 'Teacher rejected.');
    } catch {
      toast.error('Failed to update teacher.');
    }
  };

  const toggleActive = async (teacher: User) => {
    try {
      await api.put(`/admin/users/${teacher._id}`, { isActive: !teacher.isActive });
      setTeachers(prev => prev.map(t => t._id === teacher._id ? { ...t, isActive: !t.isActive } : t));
      toast.success(teacher.isActive ? 'Teacher deactivated.' : 'Teacher activated.');
    } catch {
      toast.error('Failed to update teacher.');
    }
  };

  const filtered = teachers.filter(t => filter === 'all' ? true : filter === 'pending' ? !t.isApproved : t.isApproved);
  const pendingCount = teachers.filter(t => !t.isApproved).length;

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 ml-0 md:ml-64 pt-14 md:pt-0 transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="mb-8">
            <p className="text-brand-primary text-xs font-semibold tracking-wide uppercase mb-1">Admin</p>
            <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">Manage Teachers</h1>
            <p className="text-text-secondary text-sm mt-1">Approve new teachers and manage existing ones</p>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 mb-6">
            {[
              { label: 'Total Teachers', value: teachers.length, icon: Award, iconBg: 'bg-[#EDE9FE] text-[#6C63F2]' },
              { label: 'Pending Approval', value: pendingCount, icon: Clock, iconBg: 'bg-[#FEF3C7] text-[#D97706]' },
              { label: 'Approved', value: teachers.length - pendingCount, icon: UserCheck, iconBg: 'bg-[#DCFCE7] text-[#16A34A]' },
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

          {/* Search + filter */}
          <div className="flex items-center gap-3 mb-6 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or email..."
                className="input-field pl-9"
              />
            </div>
            <div className="flex gap-2">
              {(['all', 'pending', 'approved'] as FilterMode[]).map(m => (
                <button
                  key={m}
                  onClick={() => setFilter(m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all capitalize ${
                    filter === m ? 'bg-brand-primary text-white border-brand-primary' : 'bg-surface text-text-secondary border-border-subtle hover:bg-surface-alt'
                  }`}
                >
                  {m}{m === 'pending' && pendingCount > 0 ? ` (${pendingCount})` : ''}
                </button>
              ))}
            </div>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-24 rounded-card" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="card-soft p-16 text-center">
              <Award className="w-14 h-14 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary">No teachers found.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(teacher => (
                <div key={teacher._id} className="card-soft p-4">
                  <div className="flex items-start gap-3 flex-wrap sm:flex-nowrap">
                    <img
                      src={teacher.avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent(teacher.name || 'T')}&background=6C63F2&color=fff&size=48`}
                      alt={teacher.name}
                      className="w-11 h-11 rounded-full object-cover flex-shrink-0"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-text-primary font-semibold text-sm font-heading">{teacher.name}</p>
                        {teacher.isApproved ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#DCFCE7] text-[#16A34A]">Approved</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#FEF3C7] text-[#D97706]">Pending</span>
                        )}
                        {!teacher.isActive && (
                          <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[#FFE4EC] text-[#E1447A]">Inactive</span>
                        )}
                      </div>
                      <p className="text-text-secondary text-xs truncate">{teacher.email}{teacher.phone ? ` • ${teacher.phone}` : ''}</p>
                      {(teacher.subjects?.length || teacher.standards?.length) && (
                        <p className="text-text-muted text-xs mt-1 flex items-center gap-1">
                          <BookOpen className="w-3.5 h-3.5" />
                          {teacher.subjects?.join(', ') || 'No subjects listed'}
                          {teacher.standards?.length ? ` • Std ${teacher.standards.join(', ')}` : ''}
                        </p>
                      )}
                      {teacher.qualification && (
                        <p className="text-text-muted text-xs mt-0.5">{teacher.qualification}{teacher.experience ? ` • ${teacher.experience}` : ''}</p>
                      )}
                    </div>
                    <div className="flex flex-col gap-2 flex-shrink-0 w-full sm:w-auto mt-2 sm:mt-0">
                      {!teacher.isApproved ? (
                        <div className="flex gap-2">
                          <button onClick={() => setApproval(teacher, true)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-[#DCFCE7] text-[#16A34A] border border-[#DCFCE7] rounded-lg text-xs font-medium hover:bg-[#DCFCE7]/80 transition-all">
                            <UserCheck className="w-3.5 h-3.5" /> Approve
                          </button>
                          <button onClick={() => setApproval(teacher, false)}
                            className="flex items-center gap-1 px-3 py-1.5 bg-[#FFE4EC] text-[#E1447A] border border-[#FFE4EC] rounded-lg text-xs font-medium hover:bg-[#FFE4EC]/80 transition-all">
                            <UserX className="w-3.5 h-3.5" /> Reject
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => toggleActive(teacher)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                            teacher.isActive
                              ? 'bg-[#FFE4EC] text-[#E1447A] border-[#FFE4EC] hover:bg-[#FFE4EC]/80'
                              : 'bg-[#DCFCE7] text-[#16A34A] border-[#DCFCE7] hover:bg-[#DCFCE7]/80'
                          }`}
                        >
                          {teacher.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminTeachers;

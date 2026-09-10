import React, { useEffect, useMemo, useState } from 'react';
import { Search, CreditCard, IndianRupee, CheckCircle2, XCircle, Clock } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { Payment } from '../../types';
import toast from 'react-hot-toast';

type StatusFilter = 'all' | 'completed' | 'pending' | 'failed';

const statusStyle: Record<string, string> = {
  completed: 'bg-[#DCFCE7] text-[#16A34A]',
  pending: 'bg-[#FEF3C7] text-[#D97706]',
  failed: 'bg-[#FFE4EC] text-[#E1447A]',
};

const AdminPayments: React.FC = () => {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  useEffect(() => {
    api.get('/admin/payments')
      .then(r => setPayments(r.data.payments || []))
      .catch(() => toast.error('Failed to load payments.'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => payments.filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const studentName = (p.student as any)?.name || '';
      const courseTitle = p.course?.title || p.lecture?.title || '';
      if (!studentName.toLowerCase().includes(q) && !courseTitle.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [payments, search, statusFilter]);

  const totalRevenue = payments.filter(p => p.status === 'completed').reduce((s, p) => s + (p.amount || 0), 0);
  const completedCount = payments.filter(p => p.status === 'completed').length;
  const pendingCount = payments.filter(p => p.status === 'pending').length;
  const failedCount = payments.filter(p => p.status === 'failed').length;

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 ml-16 md:ml-64 transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="mb-8">
            <p className="text-brand-primary text-xs font-semibold tracking-wide uppercase mb-1">Admin</p>
            <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">Payments</h1>
            <p className="text-text-secondary text-sm mt-1">All transactions across the platform</p>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total Revenue', value: `₹${totalRevenue.toLocaleString('en-IN')}`, icon: IndianRupee, iconBg: 'bg-[#F3E8FF] text-[#9333EA]' },
              { label: 'Completed', value: completedCount, icon: CheckCircle2, iconBg: 'bg-[#DCFCE7] text-[#16A34A]' },
              { label: 'Pending', value: pendingCount, icon: Clock, iconBg: 'bg-[#FEF3C7] text-[#D97706]' },
              { label: 'Failed', value: failedCount, icon: XCircle, iconBg: 'bg-[#FFE4EC] text-[#E1447A]' },
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

          {/* Filters */}
          <div className="flex items-center gap-3 mb-6 flex-wrap">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-muted" />
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by student or course..."
                className="input-field pl-9"
              />
            </div>
            <div className="flex gap-2">
              {(['all', 'completed', 'pending', 'failed'] as StatusFilter[]).map(m => (
                <button
                  key={m}
                  onClick={() => setStatusFilter(m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all capitalize ${
                    statusFilter === m ? 'bg-brand-primary text-white border-brand-primary' : 'bg-surface text-text-secondary border-border-subtle hover:bg-surface-alt'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
            <span className="text-text-secondary text-sm font-medium">{filtered.length} transaction{filtered.length !== 1 ? 's' : ''}</span>
          </div>

          {loading ? (
            <div className="space-y-3">
              {[...Array(6)].map((_, i) => <div key={i} className="skeleton h-16 rounded-card" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="card-soft p-16 text-center">
              <CreditCard className="w-14 h-14 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary">No payments match your filters.</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {filtered.map(payment => (
                <div key={payment._id} className="card-soft p-4 flex items-center gap-3 flex-wrap sm:flex-nowrap">
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary font-semibold text-sm font-heading truncate">
                      {(payment.student as any)?.name || 'Unknown student'}
                    </p>
                    <p className="text-text-secondary text-xs truncate">
                      {payment.course?.title || payment.lecture?.title || 'Untitled item'} • {payment.type}
                    </p>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${statusStyle[payment.status] || 'bg-surface-alt text-text-muted'}`}>
                    {payment.status}
                  </span>
                  <p className="text-text-primary text-sm font-bold w-24 text-right">₹{payment.amount?.toLocaleString('en-IN')}</p>
                  <p className="text-text-muted text-xs w-28 text-right">{new Date(payment.createdAt).toLocaleDateString('en-IN')}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminPayments;

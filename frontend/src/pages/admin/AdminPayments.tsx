import ExportToolbar from '../../components/admin/ExportToolbar';
import React, { useEffect, useMemo, useState } from 'react';
import { Search, CreditCard, IndianRupee, CheckCircle2, XCircle, Clock, Eye, Trash2, Undo2, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { Payment, PaymentStats } from '../../types';
import toast from 'react-hot-toast';
import { ConfirmDialog } from '../../components/admin/ProfileParts';
import { apiError, removePayment, restorePayment } from '../../services/profileService';

type StatusFilter = 'all' | 'completed' | 'pending' | 'failed' | 'unconfirmed';

/** Label shown for a status (unconfirmed = kept for audit, not matched to a captured LIVE payment) */
const statusLabel = (status: string) => (status === 'unconfirmed' ? 'Not confirmed' : status);

const statusStyle: Record<string, string> = {
  completed: 'bg-[#DCFCE7] text-[#16A34A]',
  pending: 'bg-[#FEF3C7] text-[#D97706]',
  failed: 'bg-[#FFE4EC] text-[#E1447A]',
  refunded: 'bg-surface-alt text-text-muted',
  unconfirmed: 'bg-[#E0E7FF] text-[#4F46E5]',
};

const itemTitle = (p: Payment) =>
  p.course?.title || p.lecture?.title || p.itemTitle || (p.exam ? `${p.exam.title} — Std ${p.exam.standard}` : 'Untitled item');

const AdminPayments: React.FC = () => {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [stats, setStats] = useState<PaymentStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  // 'active' = normal list; 'history' = every record incl. Not confirmed / archived (kept for audit, never revenue)
  const [view, setView] = useState<'active' | 'history' | 'removed'>('active');
  const [reloadKey, setReloadKey] = useState(0);
  const [removing, setRemoving] = useState<Payment | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [details, setDetails] = useState<Payment | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get('/admin/payments', { params: { view } })
      .then(r => {
        if (cancelled) return;
        setPayments(r.data.payments || []);
        setStats(r.data.stats || null); // totals come from the server (same calculation as the dashboard)
      })
      .catch(() => { if (!cancelled) { setPayments([]); setStats(null); toast.error('Failed to load payments.'); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [view, reloadKey]);

  const sourceOf = (p: Payment) => p.source || (p.type === 'olympiad' ? 'olympiad' : 'course');
  const isVerified = (p: Payment) => p.status === 'completed';
  const reasonOk = !removing || !isVerified(removing) || reason.trim().length >= 5;
  const doRemove = async () => {
    if (!removing || busy) return;
    setBusy(true);
    try {
      await removePayment(sourceOf(removing), removing._id, reason.trim());
      toast.success('Payment removed from the history. It can be restored from the Removed view.');
      setRemoving(null); setReason(''); setReloadKey(k => k + 1);
    } catch (e) { toast.error(apiError(e, 'The payment could not be removed. Nothing was changed.').message); }
    finally { setBusy(false); }
  };
  const doRestore = async (p: Payment) => {
    setBusy(true);
    try { await restorePayment(sourceOf(p), p._id); toast.success('Payment restored to the history.'); setReloadKey(k => k + 1); }
    catch (e) { toast.error(apiError(e, 'The payment could not be restored.').message); }
    finally { setBusy(false); }
  };

  // a filter chip that does not exist in the other view must not stay selected
  useEffect(() => { if (view === 'active' && statusFilter === 'unconfirmed') setStatusFilter('all'); }, [view, statusFilter]);

  const filtered = useMemo(() => payments.filter(p => {
    if (statusFilter !== 'all' && p.status !== statusFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const studentName = (p.student as any)?.name || '';
      const courseTitle = itemTitle(p);
      if (!studentName.toLowerCase().includes(q) && !courseTitle.toLowerCase().includes(q)) return false;
    }
    return true;
  }), [payments, search, statusFilter]);

  const totalRevenue = stats?.totalRevenue ?? 0;
  const completedCount = stats?.completedCount ?? 0;
  const pendingCount = stats?.pendingCount ?? 0;
  const failedCount = stats?.failedCount ?? 0;
  const historyCount = stats?.historyCount ?? 0;
  const removedCount = stats?.removedCount ?? 0;

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="mb-8">
            <p className="text-brand-primary text-xs font-semibold tracking-wide uppercase mb-1">Admin</p>
            <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">Payments</h1>
            <p className="text-text-secondary text-sm mt-1">All transactions across the platform</p>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
            {[
              { label: 'Total Revenue', value: `₹${totalRevenue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`, icon: IndianRupee, iconBg: 'bg-[#F3E8FF] text-[#9333EA]' },
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
          {!loading && (view === 'history' ? (
            <p className="text-text-secondary text-xs -mt-3 mb-6">
              <b>Payment History</b> — every record, including <b>Not confirmed</b> and archived ones. They are kept for audit and are never counted in revenue.{' '}
              <button onClick={() => setView('active')} className="underline font-semibold text-brand-primary">Back to active payments</button>
            </p>
          ) : historyCount > 0 && (
            <p className="text-text-secondary text-xs -mt-3 mb-6">
              {historyCount} older record{historyCount !== 1 ? 's are' : ' is'} hidden from this list (<b>Not confirmed</b> / archived). They are kept for audit and are not counted in revenue.{' '}
              <button onClick={() => setView('history')} className="underline font-semibold text-brand-primary">View Payment History</button>
            </p>
          ))}

          <div className="mb-5 flex gap-2" role="tablist" aria-label="Payment views">
            {([['active', 'Payments'], ['history', 'Payment History'], ['removed', `Removed${removedCount ? ` (${removedCount})` : ''}`]] as const).map(([id, label]) => (
              <button key={id} role="tab" aria-selected={view === id} onClick={() => setView(id)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${view === id ? 'border-brand-primary bg-brand-primary text-white' : 'border-border-subtle bg-surface text-text-secondary hover:bg-surface-alt'}`}>{label}</button>
            ))}
          </div>
          {view === 'removed' && <p className="text-text-secondary text-xs mb-4">Records an admin removed from the history. They are kept (never deleted), are not counted anywhere, and can be restored.</p>}

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
              {(['all', 'completed', 'pending', 'failed', ...(view === 'history' ? ['unconfirmed'] : [])] as StatusFilter[]).map(m => (
                <button
                  key={m}
                  onClick={() => setStatusFilter(m)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all capitalize ${
                    statusFilter === m ? 'bg-brand-primary text-white border-brand-primary' : 'bg-surface text-text-secondary border-border-subtle hover:bg-surface-alt'
                  }`}
                >
                  {statusLabel(m)}
                </button>
              ))}
            </div>
            <span className="text-text-secondary text-sm font-medium">{filtered.length} transaction{filtered.length !== 1 ? 's' : ''}</span>
            <ExportToolbar section="payments" params={{ view, status: statusFilter, search: search.trim() }} disabled={loading} scopeLabel="payments matching the current view, status and search" className="sm:ml-auto" />
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
                <div key={payment._id} className="card-soft p-4 flex items-center gap-x-3 gap-y-2 flex-wrap sm:flex-nowrap">
                  {/* phones: who / what on the first line (wrapping, nothing cut off), status · amount · date below */}
                  <div className="w-full sm:w-auto sm:flex-1 min-w-0">
                    <p className="text-text-primary font-semibold text-sm font-heading break-words sm:truncate">
                      {(payment.student as any)?.name || 'Unknown student'}
                    </p>
                    <p className="text-text-secondary text-xs break-words sm:truncate">
                      {itemTitle(payment)} • {payment.type}
                    </p>
                  </div>
                  <span
                    title={payment.status === 'unconfirmed' ? (payment.reviewNote || 'Not matched to a captured LIVE Razorpay payment — excluded from revenue.') : (payment.failureReason || undefined)}
                    className={`px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${statusStyle[payment.status] || 'bg-surface-alt text-text-muted'}`}
                  >
                    {statusLabel(payment.status)}
                  </span>
                  {payment.archivedAt && <span className="text-[10px] text-text-muted" title={payment.archiveReason || 'Archived — kept for audit'}>Archived</span>}
                  <p className="text-text-primary text-sm font-bold ml-auto sm:ml-0 sm:w-24 text-right">₹{payment.amount?.toLocaleString('en-IN')}</p>
                  <p className="text-text-muted text-xs sm:w-28 text-right">{new Date(payment.createdAt).toLocaleDateString('en-IN')}</p>
                  <div className="flex items-center gap-1.5 ml-auto">
                    <button type="button" onClick={() => setDetails(payment)} aria-label={`View details of ${(payment.student as any)?.name || 'payment'}`} className="inline-flex items-center gap-1 rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 text-xs font-semibold text-text-secondary hover:bg-surface-alt"><Eye className="w-3.5 h-3.5" aria-hidden="true" /> View</button>
                    {view === 'removed' ? (
                      <button type="button" disabled={busy} onClick={() => doRestore(payment)} className="inline-flex items-center gap-1 rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 text-xs font-semibold text-brand-primary hover:bg-surface-alt disabled:opacity-60"><Undo2 className="w-3.5 h-3.5" aria-hidden="true" /> Restore</button>
                    ) : (
                      <button type="button" onClick={() => { setReason(''); setRemoving(payment); }} className="inline-flex items-center gap-1 rounded-lg border border-border-subtle bg-surface px-2.5 py-1.5 text-xs font-semibold text-[#E1447A] hover:bg-surface-alt"><Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Remove from History</button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <ConfirmDialog
        open={!!removing} tone="danger" busy={busy}
        title="Remove Payment from History?"
        message={removing && (
          <>
            <p>This removes the record from the normal history and from revenue totals. The transaction itself is kept and can be restored. Nothing is refunded and nobody loses exam access or certificates.</p>
            <dl className="mt-3 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-xs">
              <dt className="font-semibold text-text-muted">Student</dt><dd className="text-text-primary break-words">{(removing.student as any)?.name || 'Unknown student'}</dd>
              <dt className="font-semibold text-text-muted">Amount</dt><dd className="text-text-primary">₹{removing.amount?.toLocaleString('en-IN')}</dd>
              <dt className="font-semibold text-text-muted">Status</dt><dd className="text-text-primary capitalize">{statusLabel(removing.status)}</dd>
              <dt className="font-semibold text-text-muted">Transaction</dt><dd className="text-text-primary break-all">{removing.paymentId || removing.orderId || removing._id}</dd>
            </dl>
          </>
        )}
        extra={removing && (
          <div>
            <label htmlFor="rm-reason" className="mb-1 block text-xs font-semibold text-text-secondary">Reason{isVerified(removing) ? ' (required for a verified payment)' : ' (optional)'}</label>
            <textarea id="rm-reason" rows={2} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} className="input-field" placeholder="e.g. Duplicate test entry" />
          </div>
        )}
        confirmLabel={busy ? 'Removing…' : 'Remove Record'} confirmDisabled={!reasonOk}
        onConfirm={doRemove} onCancel={() => { if (!busy) setRemoving(null); }}
      />

      {details && createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-slate-900/70 p-4" role="presentation" onClick={() => setDetails(null)}>
          <div role="dialog" aria-modal="true" aria-label="Payment details" onClick={e => e.stopPropagation()} className="relative w-full max-w-md rounded-2xl border border-border-subtle bg-surface p-5 sm:p-6 shadow-2xl">
            <button type="button" onClick={() => setDetails(null)} aria-label="Close" className="absolute right-3 top-3 rounded-lg p-1.5 text-text-muted hover:bg-surface-alt"><X className="h-4 w-4" /></button>
            <h3 className="font-heading font-bold text-lg text-text-primary mb-3">Payment details</h3>
            <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-2 text-sm">
              {([
                ['Student', (details.student as any)?.name || 'Unknown student'],
                ['Contact', (details.student as any)?.email || (details.student as any)?.phone || '—'],
                ['For', itemTitle(details)],
                ['Amount', `₹${details.amount?.toLocaleString('en-IN')} ${details.currency || ''}`],
                ['Status', statusLabel(details.status)],
                ['Provider', details.provider || 'Razorpay'],
                ['Order', details.orderId || '—'],
                ['Payment', details.paymentId || '—'],
                ['Created', new Date(details.createdAt).toLocaleString('en-IN')],
                ['Paid', details.paidAt ? new Date(details.paidAt).toLocaleString('en-IN') : '—'],
                ...(details.removedAt ? [['Removed', new Date(details.removedAt).toLocaleString('en-IN')], ['Removal reason', details.removalReason || '—']] : []),
              ] as [string, string][]).map(([k, v]) => (<React.Fragment key={k}><dt className="text-xs font-semibold text-text-muted">{k}</dt><dd className="text-text-primary break-words">{v}</dd></React.Fragment>))}
            </dl>
          </div>
        </div>, document.body)}
    </div>
  );
};

export default AdminPayments;

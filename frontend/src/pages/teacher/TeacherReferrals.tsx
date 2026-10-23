import React, { useCallback, useEffect, useState } from 'react';
import { Copy, Link2, Share2, Users, BadgeCheck, Hourglass, Search, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import Sidebar from '../../components/layout/Sidebar';
import { ErrorBox, Pager, selectCls, useDebounced } from '../../components/referral/adminBits';
import { mentorReferralApi, MentorOverview, MentorRow } from '../../services/mentorReferrals';
import { formatISTDate } from '../../utils/olympiadFormat';

const LIMIT = 10;
const std = (n: number | null) => (n === null || n === undefined ? '—' : n === 99 ? 'Others' : `Std ${n}`);

const copy = async (text: string, what: string) => {
  try { await navigator.clipboard.writeText(text); toast.success(`${what} copied`); }
  catch { toast.error('Copy is not available here. Please select the text and copy it.'); }
};

const Badge: React.FC<{ row: MentorRow }> = ({ row }) => (
  <span data-testid="status-badge" className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${row.statusCode === 'SUCCESSFUL' ? 'bg-[#E6F8EE] text-[#117A43] border-[#9BE0BA]' : 'bg-[#FFF4DD] text-[#8A5A00] border-[#F5D58A]'}`}>
    {row.statusCode === 'SUCCESSFUL' ? <BadgeCheck className="w-3 h-3" aria-hidden /> : <Hourglass className="w-3 h-3" aria-hidden />}{row.status}
  </span>
);

const Stat: React.FC<{ icon: React.ElementType; label: string; value: number | string; id: string }> = ({ icon: Icon, label, value, id }) => (
  <div className="card-soft rounded-card border border-border-subtle p-4" data-testid={`mstat-${id}`}>
    <Icon className="w-5 h-5 text-brand-primary" aria-hidden />
    <p className="mt-2 text-2xl font-heading font-bold text-text-primary" data-testid={`mstat-${id}-value`}>{value}</p>
    <p className="text-xs font-semibold text-text-secondary">{label}</p>
  </div>
);

const TeacherReferrals: React.FC = () => {
  const [ov, setOv] = useState<MentorOverview | null>(null);
  const [ovError, setOvError] = useState('');
  const [rows, setRows] = useState<MentorRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const q = useDebounced(search);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const loadOverview = useCallback(() => { setOvError(''); mentorReferralApi.me().then(setOv).catch(() => setOvError('We could not load your referral code. Please try again.')); }, []);
  const loadRows = useCallback(() => {
    setLoading(true); setError('');
    mentorReferralApi.list({ page, limit: LIMIT, q, status, type })
      .then(r => { setRows(r.referrals); setTotal(r.total); })
      .catch(() => setError('We could not load your referrals. Please try again.'))
      .finally(() => setLoading(false));
  }, [page, q, status, type]);
  useEffect(loadOverview, [loadOverview]);
  useEffect(loadRows, [loadRows]);
  useEffect(() => { setPage(1); }, [q, status, type]);

  const share = async () => {
    if (!ov) return;
    const data = { title: 'Join LearnIQ', text: 'Join LearnIQ using my link.', url: ov.link };
    try { if (navigator.share) { await navigator.share(data); return; } } catch (e) { if ((e as Error).name === 'AbortError') return; }
    copy(ov.link, 'Link');
  };
  const filtered = !!(q || status || type);

  return (
    <div className="flex min-h-screen bg-page transition-colors">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto" data-testid="teacher-referrals">
          <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">Mentor Referrals</h1>
          <p className="text-text-secondary text-sm mt-1">Invite people to LearnIQ and track your referrals.</p>
          <p className="text-text-muted text-xs mt-2 mb-5 max-w-2xl">Share your referral link to help people discover LearnIQ. Track registrations, approval status, and successful referrals in one place.</p>

          {ovError && <ErrorBox message={ovError} onRetry={loadOverview} />}
          <section aria-label="Your referral code" className="card-soft rounded-card border border-border-subtle p-4 sm:p-5 mb-5" data-testid="mentor-code-card">
            <p className="text-xs font-semibold text-text-secondary">Your referral code</p>
            <p className="font-mono text-xl tracking-widest text-text-primary mt-1 break-all" data-testid="mentor-code">{ov ? ov.code : '…'}</p>
            <p className="text-xs text-text-muted mt-3 break-all" data-testid="mentor-link">{ov ? ov.link : ''}</p>
            <div className="flex flex-wrap gap-2 mt-3">
              <button disabled={!ov} onClick={() => ov && copy(ov.code, 'Code')} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border border-border-subtle bg-surface disabled:opacity-50" data-testid="copy-code"><Copy className="w-3.5 h-3.5" aria-hidden /> Copy Code</button>
              <button disabled={!ov} onClick={() => ov && copy(ov.link, 'Link')} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl border border-border-subtle bg-surface disabled:opacity-50" data-testid="copy-link"><Link2 className="w-3.5 h-3.5" aria-hidden /> Copy Link</button>
              <button disabled={!ov} onClick={share} className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-xl bg-brand-primary text-white disabled:opacity-50" data-testid="share-link"><Share2 className="w-3.5 h-3.5" aria-hidden /> Share</button>
            </div>
          </section>

          <section aria-label="Summary" className="grid grid-cols-1 min-[420px]:grid-cols-3 gap-3 mb-6">
            <Stat id="total" icon={Users} label="Total referrals" value={ov ? ov.stats.totalReferrals : '—'} />
            <Stat id="successful" icon={BadgeCheck} label="Successful" value={ov ? ov.stats.successful : '—'} />
            <Stat id="pending" icon={Hourglass} label="Pending" value={ov ? ov.stats.pending : '—'} />
          </section>

          <section aria-label="Referrals" data-testid="mentor-table">
            <div className="flex flex-col sm:flex-row gap-2 mb-3">
              <label className="relative flex-1"><span className="sr-only">Search by name</span>
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" aria-hidden />
                <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name" className={`${selectCls} pl-9`} data-testid="mentor-search" /></label>
              <select aria-label="Status" value={status} onChange={e => setStatus(e.target.value)} className={`${selectCls} sm:w-40`} data-testid="mentor-status"><option value="">All statuses</option><option value="SUCCESSFUL">Successful</option><option value="PENDING">Pending</option></select>
              <select aria-label="User type" value={type} onChange={e => setType(e.target.value)} className={`${selectCls} sm:w-40`} data-testid="mentor-type"><option value="">All types</option><option value="student">Student</option><option value="teacher">Teacher</option></select>
            </div>
            {error && <ErrorBox message={error} onRetry={loadRows} />}
            {loading ? (
              <div className="space-y-2" data-testid="mentor-skeleton" aria-busy="true" aria-label="Loading referrals">{[0, 1, 2, 3].map(i => <div key={i} className="h-12 rounded-xl bg-surface-alt animate-pulse" />)}</div>
            ) : !error && rows.length === 0 ? (
              <div className="text-center py-12 rounded-card border border-dashed border-border-subtle" data-testid="mentor-empty">
                <p className="font-semibold text-text-primary text-sm">{filtered ? 'No referrals match your filters.' : 'No referrals yet.'}</p>
                <p className="text-xs text-text-muted mt-1">{filtered ? 'Try clearing the search or filters.' : 'Share your link. People who register with it will show up here.'}</p>
              </div>
            ) : !error && (
              <>
                <div className="hidden md:block overflow-x-auto rounded-card border border-border-subtle">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-alt text-left text-[11px] uppercase tracking-wide text-text-secondary"><tr>
                      {['#', 'Referred Person', 'User Type', 'Standard/Class', 'Joined On', 'Status', 'Actions'].map(h => <th key={h} scope="col" className="px-3 py-2.5 font-semibold">{h}</th>)}
                    </tr></thead>
                    <tbody>{rows.map(r => (
                      <tr key={r.no} className="border-t border-border-subtle" data-testid="mentor-row">
                        <td className="px-3 py-2.5">{r.no}</td><td className="px-3 py-2.5 font-medium text-text-primary">{r.name}</td><td className="px-3 py-2.5">{r.userType}</td>
                        <td className="px-3 py-2.5">{std(r.standard)}</td><td className="px-3 py-2.5 whitespace-nowrap">{formatISTDate(r.registeredAt)}</td><td className="px-3 py-2.5"><Badge row={r} /></td>
                        <td className="px-3 py-2.5 text-text-muted">—</td>
                      </tr>))}</tbody>
                  </table>
                </div>
                <ul className="md:hidden space-y-2" data-testid="mentor-cards">{rows.map(r => (
                  <li key={r.no} className="rounded-xl border border-border-subtle bg-surface p-3" data-testid="mentor-card">
                    <div className="flex items-start justify-between gap-2"><p className="font-semibold text-text-primary text-sm">#{r.no} · {r.name}</p><Badge row={r} /></div>
                    <p className="text-xs text-text-secondary mt-1">{r.userType}{r.userType === 'Student' ? ` · ${std(r.standard)}` : ''} · Joined {formatISTDate(r.registeredAt)}</p>
                  </li>))}</ul>
                <Pager page={page} limit={LIMIT} total={total} onPage={setPage} />
              </>
            )}
            <button onClick={() => { loadOverview(); loadRows(); }} className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary"><RefreshCw className="w-3 h-3" aria-hidden /> Refresh</button>
          </section>
        </div>
      </main>
    </div>
  );
};
export default TeacherReferrals;

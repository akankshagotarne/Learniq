import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Download, Eye, FileText, Loader2, Receipt, Search, Wallet, X } from 'lucide-react';
import toast from 'react-hot-toast';
import Sidebar from '../../components/layout/Sidebar';
import {
  transactionsApi, message, TxDetail, TxList, TxQuery, TxRow,
} from '../../services/studentTransactions';

const LIMIT = 10;
const EMPTY_Q: TxQuery = { tab: 'all', type: '', status: '', component: '', method: '', search: '', range: '', from: '', to: '', page: 1, limit: LIMIT };

const inr = (n: number | null | undefined) => `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const when = (iso?: string | null) => (iso ? new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(new Date(iso)) + ' IST' : '—');
const credit = (n: number) => `${n > 0 ? '+' : ''}${n} Credit${Math.abs(n) === 1 ? '' : 's'}`;
const amountOf = (r: TxRow) => (r.kind === 'CREDIT' ? credit(r.creditChange || 0) : inr(r.amount));
const amountClass = (r: TxRow) => (r.kind === 'CREDIT' ? ((r.creditChange || 0) > 0 ? 'text-emerald-600' : 'text-red-500') : 'text-text-primary');

const STATUS_STYLE: Record<string, string> = {
  SUCCESS: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', PENDING: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  FAILED: 'bg-red-500/15 text-red-700 dark:text-red-300', REFUNDED: 'bg-sky-500/15 text-sky-700 dark:text-sky-300',
};
const StatusPill: React.FC<{ r: Pick<TxRow, 'status' | 'statusLabel'> }> = ({ r }) => (
  <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLE[r.status] || ''}`}>{r.statusLabel}</span>
);

const TYPE_OPTIONS: Record<string, [string, string][]> = {
  all: [['EXAM_PAYMENT', 'Exam Payment'], ['INTERVIEW_PAYMENT', 'Interview Payment'], ['PACKAGE_PAYMENT', 'Package Payment'], ['REFERRAL_CREDIT', 'Referral Credit'], ['EXAM_CREDIT_USED', 'Exam Credit Used'], ['INTERVIEW_CREDIT_USED', 'Interview Credit Used'], ['ADMIN_CREDIT_GRANT', 'Admin Credit Grant'], ['CREDIT_ADJUSTMENT', 'Credit Adjustment'], ['CREDIT_REVERSAL', 'Credit Reversal']],
  payments: [['EXAM_PAYMENT', 'Exam Payment'], ['INTERVIEW_PAYMENT', 'Interview Payment'], ['PACKAGE_PAYMENT', 'Package Payment']],
  credits: [['REFERRAL_CREDIT', 'Referral Credit'], ['EXAM_CREDIT_USED', 'Exam Credit Used'], ['INTERVIEW_CREDIT_USED', 'Interview Credit Used'], ['ADMIN_CREDIT_GRANT', 'Admin Credit Grant'], ['CREDIT_ADJUSTMENT', 'Credit Adjustment'], ['CREDIT_REVERSAL', 'Credit Reversal']],
};
const COMPONENT_OPTIONS: Record<string, [string, string][]> = {
  all: [['EXAM', 'Exam'], ['INTERVIEW', 'Interview'], ['PACKAGE', 'Package'], ['CREDIT', 'Credit Transaction'], ['REFERRAL', 'Referral']],
  payments: [['EXAM', 'Exam'], ['INTERVIEW', 'Interview'], ['PACKAGE', 'Package']],
  credits: [['EXAM', 'Exam'], ['INTERVIEW', 'Interview'], ['CREDIT', 'Credit Transaction'], ['REFERRAL', 'Referral']],
};
const METHOD_OPTIONS: [string, string][] = [['upi', 'UPI'], ['card', 'Card'], ['netbanking', 'Net Banking'], ['wallet', 'Wallet'], ['other', 'Other / Razorpay']];

const Card: React.FC<{ label: string; value: React.ReactNode; hint?: string; testid: string }> = ({ label, value, hint, testid }) => (
  <div className="card-soft p-4 min-w-0">
    <p className="text-[11px] uppercase tracking-wide text-text-muted font-semibold">{label}</p>
    <p data-testid={testid} className="mt-1 text-xl sm:text-2xl font-heading font-bold text-text-primary truncate">{value}</p>
    {hint && <p className="text-xs text-text-secondary mt-0.5">{hint}</p>}
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block min-w-0"><span className="block text-[11px] font-semibold text-text-muted mb-1">{label}</span>{children}</label>
);
const selectCls = 'w-full rounded-xl border border-border bg-surface text-text-primary text-sm px-3 py-2';

const DetailRow: React.FC<{ k: string; v?: React.ReactNode }> = ({ k, v }) => (v === undefined || v === null || v === '' ? null : (
  <div className="flex flex-col sm:flex-row sm:gap-4 py-1.5 border-b border-border/50 last:border-0">
    <dt className="sm:w-44 shrink-0 text-xs text-text-muted">{k}</dt><dd className="text-sm text-text-primary font-medium break-all">{v}</dd>
  </div>
));

const DetailModal: React.FC<{ id: string; onClose: () => void; onReceipt: (r: TxRow) => void; busy: string }> = ({ id, onClose, onReceipt, busy }) => {
  const [d, setD] = useState<TxDetail | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { let on = true; transactionsApi.detail(id).then((x) => on && setD(x)).catch((e) => on && setErr(message(e, 'Could not load this transaction.'))); return () => { on = false; }; }, [id]);
  useEffect(() => { const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  const isPay = d?.kind === 'PAYMENT';
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="tx-title" data-testid="tx-detail" onClick={(e) => e.stopPropagation()}
        className="w-full sm:max-w-lg max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-surface p-5 sm:p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3 mb-3">
          <h2 id="tx-title" className="font-heading font-bold text-lg text-text-primary">Transaction Details</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="p-1 rounded-lg hover:bg-surface-alt"><X className="w-5 h-5" /></button>
        </div>
        {err ? <p role="alert" className="text-sm text-red-600 py-6 text-center">{err}</p> : !d ? <p className="py-8 text-center text-sm text-text-secondary"><Loader2 className="inline w-4 h-4 animate-spin mr-2" />Loading…</p> : (
          <>
            <div className="text-center mb-4">
              <StatusPill r={d} />
              <p className="mt-2 font-semibold text-text-primary">{d.purpose || d.description}</p>
              <p className={`text-2xl font-heading font-bold ${amountClass(d)}`}>{amountOf(d)}</p>
            </div>
            <dl>
              <DetailRow k="Transaction ID" v={d.transactionId} />
              {isPay && <DetailRow k="Receipt number" v={d.receiptNumber} />}
              <DetailRow k="Date & time" v={when(d.date)} />
              <DetailRow k="Type" v={d.description} />
              <DetailRow k="Component" v={d.componentLabel} />
              {isPay ? (
                <>
                  <DetailRow k="Payment method" v={d.payment?.paymentMethod} />
                  <DetailRow k="Razorpay order ID" v={d.payment?.razorpayOrderId} />
                  <DetailRow k="Razorpay payment ID" v={d.payment?.razorpayPaymentId} />
                  <DetailRow k="Verified at" v={d.payment?.verifiedAt ? when(d.payment.verifiedAt) : undefined} />
                  <DetailRow k="Note" v={d.payment?.failureNote} />
                  <DetailRow k="Student" v={d.student?.name} /><DetailRow k="Email" v={d.student?.email} /><DetailRow k="Phone" v={d.student?.phone} />
                  <DetailRow k="Standard" v={d.student?.standard} /><DetailRow k="Student ID" v={d.student?.studentId} />
                </>
              ) : (
                <>
                  <DetailRow k="Source" v={d.credit?.source === 'REFERRAL' ? 'Referral' : d.credit?.source === 'ADMIN' ? 'Administrator' : d.credit?.source === 'EXAM' ? 'Redeemed for an exam / interview' : d.credit?.source} />
                  <DetailRow k="Related exam" v={d.credit?.relatedTitle || d.detail} />
                  <DetailRow k="Balance after" v={d.credit ? `${d.credit.balanceAfter} credit${d.credit.balanceAfter === 1 ? '' : 's'}` : undefined} />
                  <DetailRow k="Money received" v="₹0.00 — exam credits are not money" />
                </>
              )}
            </dl>
            <div className="mt-5 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
              <button type="button" onClick={onClose} className="rounded-xl border border-border px-4 py-2.5 text-sm text-text-primary">Close</button>
              {d.receiptAvailable && <button type="button" disabled={busy === d.id} onClick={() => onReceipt(d)} data-testid="tx-detail-receipt" className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm"><Download className="w-4 h-4" />Download Receipt (PDF)</button>}
              {d.statementAvailable && <button type="button" disabled={busy === d.id} onClick={() => onReceipt(d)} data-testid="tx-detail-statement" className="btn-primary inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm"><FileText className="w-4 h-4" />Download Transaction Statement</button>}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

const StudentPaymentsPage: React.FC = () => {
  const [q, setQ] = useState<TxQuery>(EMPTY_Q);
  const [searchText, setSearchText] = useState('');
  const [data, setData] = useState<TxList | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState('');
  const seq = useRef(0);

  useEffect(() => { const t = setTimeout(() => setQ((p) => (p.search === searchText.trim() ? p : { ...p, search: searchText.trim(), page: 1 })), 300); return () => clearTimeout(t); }, [searchText]);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true); setError('');
    try { const r = await transactionsApi.list(q); if (mine === seq.current) setData(r); }
    catch (e: any) { if (mine === seq.current) setError(message(e, 'Could not load your transactions. Check your connection and try again.')); }
    finally { if (mine === seq.current) setLoading(false); }
  }, [q]);
  useEffect(() => { load(); }, [load]);

  const patch = (p: Partial<TxQuery>) => { setQ((cur) => ({ ...cur, ...p, page: p.page ?? 1 })); };
  const changeTab = (tab: TxQuery['tab']) => { setSelected(new Set()); setQ((cur) => ({ ...cur, tab, type: '', component: '', method: '', page: 1 })); };
  const resetFilters = () => { setSearchText(''); setQ((cur) => ({ ...EMPTY_Q, tab: cur.tab })); };

  const download = async (r: Pick<TxRow, 'id' | 'kind'>) => {
    setBusy(r.id);
    try {
      await (r.kind === 'PAYMENT' ? transactionsApi.receipt(r.id) : transactionsApi.statement(r.id));
      toast.success(r.kind === 'PAYMENT' ? 'Receipt downloaded.' : 'Statement downloaded.');
      if (r.kind === 'PAYMENT') load(); // the receipt number now exists
    } catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  };
  const downloadSelected = async () => {
    setBusy('bulk');
    try {
      const r = await transactionsApi.bulk([...selected]);
      toast.success(`${r.included ?? selected.size} receipt${(r.included ?? selected.size) === 1 ? '' : 's'} downloaded${r.excluded ? `; ${r.excluded} selected item${r.excluded === 1 ? ' was' : 's were'} not eligible and left out` : ''}.`);
      setSelected(new Set()); load();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(''); }
  };

  const items = data?.items || [];
  const eligible = items.filter((r) => r.receiptAvailable);
  const toggle = (id: string) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOnPage = eligible.length > 0 && eligible.every((r) => selected.has(r.id));
  const tabCls = (t: string) => `px-4 py-2 rounded-xl text-sm font-semibold whitespace-nowrap ${q.tab === t ? 'bg-primary text-white' : 'text-text-secondary hover:bg-surface-alt'}`;
  const showSelect = q.tab === 'payments';
  const filtered = !!(q.type || q.status || q.component || q.method || q.search || q.range);

  const actions = (r: TxRow) => (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => setOpenId(r.id)} data-testid="tx-view" className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-semibold text-text-primary hover:bg-surface-alt"><Eye className="w-3.5 h-3.5" />View</button>
      {r.receiptAvailable && <button type="button" disabled={busy === r.id} onClick={() => download(r)} data-testid="tx-receipt" className="inline-flex items-center gap-1 rounded-lg bg-primary/10 text-primary px-2.5 py-1.5 text-xs font-semibold hover:bg-primary/20 disabled:opacity-60"><Download className="w-3.5 h-3.5" />Receipt</button>}
      {r.kind === 'CREDIT' && <button type="button" disabled={busy === r.id} onClick={() => download(r)} data-testid="tx-statement" className="inline-flex items-center gap-1 rounded-lg bg-primary/10 text-primary px-2.5 py-1.5 text-xs font-semibold hover:bg-primary/20 disabled:opacity-60"><FileText className="w-3.5 h-3.5" />Statement</button>}
    </div>
  );

  return (
    <div className="flex min-h-screen bg-page transition-colors">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto" data-testid="payments-page">
          <header className="mb-6">
            <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">Payments &amp; Transactions</h1>
            <p className="text-text-secondary text-sm mt-1">View your payments, track exam credits, and download your receipts.</p>
          </header>

          {data && (
            <>
              <section aria-label="Payment summary" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-3">
                <Card testid="sum-total" label="Total Payments" value={inr(data.summary.money.totalPaid)} hint="Verified money paid" />
                <Card testid="sum-success" label="Successful Payments" value={data.summary.money.successfulCount} />
                <Card testid="sum-pending" label="Pending Payments" value={data.summary.money.pendingCount} />
                <Card testid="sum-failed" label="Failed Payments" value={data.summary.money.failedCount} />
              </section>
              <section aria-label="Credit summary" className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
                <Card testid="cr-earned" label="Credits Earned" value={data.summary.credits.earned} hint="From referrals" />
                <Card testid="cr-admin" label="Granted by Admin" value={data.summary.credits.grantedByAdmin} />
                <Card testid="cr-used" label="Credits Used" value={data.summary.credits.used} />
                <Card testid="cr-balance" label="Available Credits" value={data.summary.credits.balance} hint="Not money" />
              </section>
            </>
          )}

          <div role="tablist" aria-label="Transaction views" className="flex gap-1 overflow-x-auto mb-4 p-1 rounded-2xl bg-surface border border-border w-full sm:w-fit">
            {([['all', 'All Transactions'], ['payments', 'Payments'], ['credits', 'Credit Usage']] as const).map(([t, l]) => (
              <button key={t} role="tab" aria-selected={q.tab === t} data-testid={`tab-${t}`} type="button" onClick={() => changeTab(t)} className={tabCls(t)}>{l}</button>
            ))}
          </div>

          <section className="card-soft p-4 mb-4" aria-label="Filters">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="col-span-2 md:col-span-3 lg:col-span-2 relative">
                <Field label="Search">
                  <span className="relative block"><Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
                    <input type="search" value={searchText} onChange={(e) => setSearchText(e.target.value)} placeholder="Transaction, order or payment ID" data-testid="tx-search" className={`${selectCls} pl-9`} /></span>
                </Field>
              </div>
              <Field label="Transaction Type"><select value={q.type} onChange={(e) => patch({ type: e.target.value })} className={selectCls} data-testid="f-type"><option value="">All</option>{TYPE_OPTIONS[q.tab].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
              <Field label="Status"><select value={q.status} onChange={(e) => patch({ status: e.target.value })} className={selectCls} data-testid="f-status"><option value="">All</option><option value="SUCCESS">Successful</option><option value="PENDING">Pending</option><option value="FAILED">Failed</option><option value="REFUNDED">Refunded</option></select></Field>
              <Field label="Component"><select value={q.component} onChange={(e) => patch({ component: e.target.value })} className={selectCls} data-testid="f-component"><option value="">All</option>{COMPONENT_OPTIONS[q.tab].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
              {q.tab !== 'credits' && <Field label="Payment Method"><select value={q.method} onChange={(e) => patch({ method: e.target.value })} className={selectCls} data-testid="f-method"><option value="">All</option>{METHOD_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>}
              <Field label="Date Range"><select value={q.range} onChange={(e) => patch({ range: e.target.value as TxQuery['range'], from: '', to: '' })} className={selectCls} data-testid="f-range"><option value="">All time</option><option value="current_month">Current month</option><option value="previous_month">Previous month</option><option value="custom">Custom range</option></select></Field>
              {q.range === 'custom' && (<>
                <Field label="From"><input type="date" value={q.from} max={q.to || undefined} onChange={(e) => patch({ from: e.target.value })} className={selectCls} data-testid="f-from" /></Field>
                <Field label="To"><input type="date" value={q.to} min={q.from || undefined} onChange={(e) => patch({ to: e.target.value })} className={selectCls} data-testid="f-to" /></Field>
              </>)}
            </div>
            {filtered && <button type="button" onClick={resetFilters} className="mt-3 text-xs font-semibold text-primary" data-testid="f-reset">Clear filters</button>}
          </section>

          {showSelect && (
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <p className="text-sm text-text-secondary" data-testid="sel-count" aria-live="polite">{selected.size} selected</p>
              <button type="button" disabled={!selected.size || busy === 'bulk'} onClick={downloadSelected} data-testid="bulk-download"
                className="btn-primary inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm disabled:opacity-50">{busy === 'bulk' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}Download Selected Receipts (PDF)</button>
            </div>
          )}

          {error ? (
            <div role="alert" data-testid="tx-error" className="card-soft p-8 text-center">
              <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-2" /><p className="text-sm text-text-primary mb-3">{error}</p>
              <button type="button" onClick={load} data-testid="tx-retry" className="btn-primary px-4 py-2 rounded-xl text-sm">Retry</button>
            </div>
          ) : loading && !data ? (
            <div data-testid="tx-loading" className="card-soft p-10 flex items-center justify-center text-sm text-text-secondary"><Loader2 className="w-5 h-5 animate-spin mr-2" />Loading transactions…</div>
          ) : items.length === 0 ? (
            <div data-testid="tx-empty" className="card-soft p-10 text-center">
              <Wallet className="w-12 h-12 text-text-muted mx-auto mb-3" />
              <p className="text-text-primary font-medium">{filtered ? 'No transactions match your filters.' : 'No transactions yet.'}</p>
              <p className="text-text-secondary text-sm mt-1">{filtered ? 'Try changing or clearing the filters.' : 'Your exam, interview, and payment transactions will appear here.'}</p>
            </div>
          ) : (
            <div className={loading ? 'opacity-60 transition-opacity' : ''} aria-busy={loading}>
              <div className="hidden md:block card-soft overflow-x-auto">
                <table className="w-full text-sm" data-testid="tx-table">
                  <thead><tr className="text-left text-xs uppercase tracking-wide text-text-muted border-b border-border">
                    {showSelect && <th scope="col" className="p-3 w-10"><input type="checkbox" aria-label="Select all receipts on this page" checked={allOnPage} disabled={!eligible.length} onChange={() => setSelected((s) => { const n = new Set(s); eligible.forEach((r) => (allOnPage ? n.delete(r.id) : n.add(r.id))); return n; })} /></th>}
                    <th scope="col" className="p-3">Date &amp; Time</th><th scope="col" className="p-3">Description</th><th scope="col" className="p-3">Component</th>
                    <th scope="col" className="p-3">{q.tab === 'credits' ? 'Credit Change' : 'Amount / Credits'}</th><th scope="col" className="p-3">Method</th>
                    {q.tab !== 'credits' && <th scope="col" className="p-3">Transaction ID</th>}<th scope="col" className="p-3">Status</th><th scope="col" className="p-3">Action</th>
                  </tr></thead>
                  <tbody>{items.map((r) => (
                    <tr key={r.id} data-testid="tx-row" className="border-b border-border/60 align-top">
                      {showSelect && <td className="p-3"><input type="checkbox" aria-label={`Select ${r.description} receipt`} disabled={!r.receiptAvailable} checked={selected.has(r.id)} onChange={() => toggle(r.id)} data-testid="tx-select" /></td>}
                      <td className="p-3 whitespace-nowrap text-text-secondary">{when(r.date)}</td>
                      <td className="p-3"><p className="font-medium text-text-primary">{r.description}</p>{r.detail && <p className="text-xs text-text-muted">{r.detail}</p>}</td>
                      <td className="p-3 text-text-primary">{r.componentLabel}</td>
                      <td className={`p-3 font-semibold whitespace-nowrap ${amountClass(r)}`}>{amountOf(r)}</td>
                      <td className="p-3 text-text-primary">{r.methodLabel}</td>
                      {q.tab !== 'credits' && <td className="p-3 font-mono text-xs break-all max-w-[11rem]" title={r.transactionId}>{r.transactionId}</td>}
                      <td className="p-3"><StatusPill r={r} /></td>
                      <td className="p-3">{actions(r)}</td>
                    </tr>))}</tbody>
                </table>
              </div>
              <ul className="md:hidden space-y-3" data-testid="tx-cards">{items.map((r) => (
                <li key={r.id} data-testid="tx-card" className="card-soft p-4">
                  <div className="flex items-start gap-3">
                    {showSelect && <input type="checkbox" className="mt-1 w-5 h-5" aria-label={`Select ${r.description} receipt`} disabled={!r.receiptAvailable} checked={selected.has(r.id)} onChange={() => toggle(r.id)} />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2"><p className="font-semibold text-text-primary">{r.description}</p><StatusPill r={r} /></div>
                      {r.detail && <p className="text-xs text-text-muted">{r.detail}</p>}
                      <p className={`mt-1 text-lg font-bold ${amountClass(r)}`}>{amountOf(r)}</p>
                      <p className="text-xs text-text-secondary">{when(r.date)} · {r.methodLabel}</p>
                      <p className="text-[11px] font-mono text-text-muted break-all mt-1">{r.transactionId}</p>
                      <div className="mt-3">{actions(r)}</div>
                    </div>
                  </div>
                </li>))}</ul>
              {data && data.pagination.pages > 1 && (
                <nav className="flex items-center justify-between gap-3 mt-4" aria-label="Transaction pages">
                  <button type="button" onClick={() => setQ((c) => ({ ...c, page: Math.max(1, c.page - 1) }))} disabled={data.pagination.page <= 1 || loading} data-testid="tx-prev" className="rounded-xl border border-border px-4 py-2 text-sm text-text-primary disabled:opacity-50">Previous</button>
                  <span className="text-xs text-text-secondary" data-testid="tx-page-info">Page {data.pagination.page} of {data.pagination.pages}</span>
                  <button type="button" onClick={() => setQ((c) => ({ ...c, page: Math.min(data.pagination.pages, c.page + 1) }))} disabled={data.pagination.page >= data.pagination.pages || loading} data-testid="tx-next" className="rounded-xl border border-border px-4 py-2 text-sm text-text-primary disabled:opacity-50">Next</button>
                </nav>
              )}
            </div>
          )}
        </div>
        {openId && <DetailModal id={openId} onClose={() => setOpenId(null)} busy={busy} onReceipt={(r) => download(r)} />}
      </main>
    </div>
  );
};

export default StudentPaymentsPage;

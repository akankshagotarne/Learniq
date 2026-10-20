import React, { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Gift, Users, BadgeCheck, Hourglass, ShieldQuestion, Ban, Ticket, Wallet, Download, Search, Loader2, Settings as SettingsIcon, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import Sidebar from '../../components/layout/Sidebar';
import SendCredits from '../../components/referral/SendCredits';
import { Busy, ErrorBox, Field, Modal, Pager, StatusPill, selectCls, useDebounced, useNarrow } from '../../components/referral/adminBits';
import {
  adminReferralApi, AdminOverview, AdminReferralDetail, AdminReferralRow, AdminTx, ReferralSettings, Filters,
} from '../../services/referrals';
import { olympiadErrorCode, olympiadErrorMessage } from '../../services/olympiad';
import { formatISTDate, formatISTDateTime } from '../../utils/olympiadFormat';

type Tab = 'overview' | 'referrals' | 'transactions' | 'send' | 'settings';
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'Overview' }, { key: 'referrals', label: 'All referrals' }, { key: 'transactions', label: 'Credit transactions' },
  { key: 'send', label: 'Send exam credits' }, { key: 'settings', label: 'Settings' },
];
const STD = (n: number | null) => (n === null || n === undefined ? '—' : n === 99 ? 'Others' : `Std ${n}`);
const TX_TYPES = [['REFERRAL_REWARD', 'Referral reward'], ['ADMIN_GRANT', 'Admin grant'], ['EXAM_REDEMPTION', 'Exam redemption'], ['ADMIN_ADJUSTMENT', 'Adjustment'], ['REVERSAL', 'Reversal']];

// ───────────────────────── overview ─────────────────────────
const Metric: React.FC<{ icon: React.ElementType; label: string; value: React.ReactNode; hint: string; tone: string; id: string }> = ({ icon: Icon, label, value, hint, tone, id }) => (
  <div className="card-soft rounded-card border border-border-subtle p-4" data-testid={`metric-${id}`}>
    <span className={`inline-flex w-9 h-9 rounded-xl items-center justify-center ${tone}`}><Icon className="w-[18px] h-[18px]" aria-hidden /></span>
    <p className="mt-3 text-2xl font-heading font-bold text-text-primary" data-testid={`metric-${id}-value`}>{value}</p>
    <p className="text-xs font-semibold text-text-secondary">{label}</p>
    <p className="text-[11px] text-text-muted mt-0.5">{hint}</p>
  </div>
);

const Bars: React.FC<{ title: string; data: { date: string; count: number }[]; color: string; testId: string }> = ({ title, data, color, testId }) => {
  const max = Math.max(1, ...data.map(d => d.count));
  const total = data.reduce((s, d) => s + d.count, 0);
  return (
    <figure className="card-soft rounded-card border border-border-subtle p-4" data-testid={testId}>
      <figcaption className="flex items-baseline justify-between gap-2"><span className="text-sm font-semibold text-text-primary">{title}</span><span className="text-xs text-text-secondary">{total} in total</span></figcaption>
      {data.length === 0 ? <p className="text-xs text-text-muted py-8 text-center">No activity in this period.</p> : (
        <div className="flex items-end gap-1 h-28 mt-3" role="img" aria-label={`${title}: ${data.map(d => `${d.date} ${d.count}`).join(', ')}`}>
          {data.map(d => (
            <div key={d.date} className="flex-1 min-w-[4px] rounded-t" style={{ height: `${Math.max(6, (d.count / max) * 100)}%`, background: color }} title={`${formatISTDate(`${d.date}T12:00:00+05:30`)}: ${d.count}`} />
          ))}
        </div>
      )}
    </figure>
  );
};

const Overview: React.FC = () => {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<AdminOverview | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    setError('');
    try { setData(await adminReferralApi.overview(days)); } catch (err) { setError(olympiadErrorMessage(err, 'We could not load the overview.')); }
  }, [days]);
  useEffect(() => { void load(); }, [load]);
  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!data) return <Busy />;
  const m = data.metrics;
  return (
    <div data-testid="overview">
      <div className="flex items-center justify-between gap-3 mb-3">
        <p className="text-sm text-text-secondary">Totals are for all time. Charts show the last {data.days} days.</p>
        <select className={`${selectCls} w-32`} value={days} onChange={e => setDays(Number(e.target.value))} aria-label="Chart period"><option value={7}>7 days</option><option value={30}>30 days</option><option value={90}>90 days</option></select>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <Metric id="total" icon={Users} label="Total referrals" value={m.totalReferrals} hint="Students who joined with a code" tone="bg-[#E0E7FF] text-[#4338CA]" />
        <Metric id="successful" icon={BadgeCheck} label="Successful referrals" value={m.successfulReferrals} hint={`${m.successRate}% of all referrals`} tone="bg-[#DCFCE7] text-[#16A34A]" />
        <Metric id="pending" icon={Hourglass} label="Pending rewards" value={m.pendingReferrals} hint="Qualified, credit not yet added" tone="bg-[#FEF3C7] text-[#D97706]" />
        <Metric id="review" icon={ShieldQuestion} label="Under review" value={m.underReview} hint="Held for a manual check" tone="bg-[#E0E7FF] text-[#4338CA]" />
        <Metric id="rejected" icon={Ban} label="Rejected" value={m.rejected} hint="Not eligible for a reward" tone="bg-[#FFE4EC] text-[#BE185D]" />
        <Metric id="awarded" icon={Gift} label="Referral credits awarded" value={m.referralCreditsAwarded} hint="Earned through referrals" tone="bg-[#FEF3C7] text-[#D97706]" />
        <Metric id="admin" icon={Ticket} label="Admin-granted credits" value={m.adminGrantedCredits} hint={`Adjustments (net): ${m.adjustmentsNet}`} tone="bg-[#CCFBF1] text-[#0D9488]" />
        <Metric id="redeemed" icon={Wallet} label="Credits redeemed" value={m.creditsRedeemed} hint={`${m.availableCredits} still available`} tone="bg-[#CCFBF1] text-[#0D9488]" />
      </div>
      <div className="grid md:grid-cols-3 gap-3 mb-5">
        <Bars testId="chart-referrals" title="New referrals per day" data={data.referralsByDate} color="#6C63F2" />
        <Bars testId="chart-issued" title="Credits issued per day" data={data.creditsIssuedByDate} color="#16A34A" />
        <Bars testId="chart-redeemed" title="Credits used per day" data={data.creditsRedeemedByDate} color="#F59E0B" />
      </div>
      <section className="card-soft rounded-card border border-border-subtle p-4" aria-label="Top referrers">
        <h3 className="font-heading font-bold text-text-primary mb-2">Top referrers</h3>
        {data.topReferrers.length === 0 ? <p className="text-sm text-text-secondary" data-testid="top-empty">No rewarded referrals yet.</p> : (
          <ol className="divide-y divide-border-subtle text-sm" data-testid="top-referrers">
            {data.topReferrers.map((t, i) => <li key={t.studentId} className="py-2 flex items-center justify-between gap-3"><span className="min-w-0 break-words"><span className="text-text-muted mr-2">{i + 1}.</span><span className="font-semibold text-text-primary">{t.name}</span></span><span className="text-xs text-text-secondary whitespace-nowrap">{t.referrals} referral{t.referrals === 1 ? '' : 's'} · {t.credits} credit{t.credits === 1 ? '' : 's'}</span></li>)}
          </ol>
        )}
      </section>
    </div>
  );
};

// ───────────────────────── referral detail + review ─────────────────────────
const ReferralDetail: React.FC<{ id: string; onClose: () => void; onChanged: () => void }> = ({ id, onClose, onChanged }) => {
  const [d, setD] = useState<AdminReferralDetail | null>(null);
  const [error, setError] = useState('');
  const [action, setAction] = useState<null | 'under_review' | 'reject' | 'approve'>(null);
  const [reason, setReason] = useState('');
  const [reverse, setReverse] = useState<'' | 'yes' | 'no'>('');
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => { let off = false; adminReferralApi.referral(id).then(r => { if (!off) setD(r); }).catch(err => { if (!off) setError(olympiadErrorMessage(err, 'Could not load this referral.')); }); return () => { off = true; }; }, [id]);

  const run = async (act: 'under_review' | 'reject' | 'approve' | 'retry_reward') => {
    if (busy || !d) return;
    setFormError('');
    if (act !== 'approve' && act !== 'retry_reward' && reason.trim().length < 3) { setFormError('Please give a reason (at least 3 characters).'); return; }
    if (act === 'reject' && d.rewardStatus === 'REWARDED' && !reverse) { setFormError('This referral was already rewarded. Choose whether the credit is reversed or kept.'); return; }
    setBusy(true);
    try {
      const r = await adminReferralApi.review(d.id, { action: act, reason: reason.trim() || undefined, ...(act === 'reject' && d.rewardStatus === 'REWARDED' ? { reverseReward: reverse === 'yes' } : {}) });
      setD(r); setAction(null); setReason(''); setReverse(''); onChanged(); toast.success('Referral updated.');
    } catch (err) {
      const code = olympiadErrorCode(err);
      setFormError(code === 'INSUFFICIENT_CREDITS' ? 'The student has already used this credit, so it cannot be reversed. Keep the credit or adjust the balance separately.' : olympiadErrorMessage(err, 'The change could not be saved.'));
    } finally { setBusy(false); }
  };

  const person = (label: string, p: AdminReferralDetail['referrer']) => (
    <div className="min-w-0"><p className="text-[11px] text-text-muted">{label}</p><p className="font-semibold text-text-primary break-words">{p.name}{p.deleted ? ' (account deleted)' : ''}</p><p className="text-xs text-text-secondary break-all">{p.email || '—'}</p><p className="text-xs text-text-secondary">{p.phone || '—'} · {STD(p.standard)}</p></div>
  );
  return (
    <Modal title="Referral details" onClose={onClose} wide locked={busy} testId="referral-dialog">
      {error && <ErrorBox message={error} />}
      {!d && !error && <Busy />}
      {d && (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">{person('Referrer', d.referrer)}{person('Referred student', d.referred)}</div>
          <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            <div><dt className="text-[11px] text-text-muted">Code used</dt><dd className="font-mono font-semibold">{d.code}</dd></div>
            <div><dt className="text-[11px] text-text-muted">Registered</dt><dd>{formatISTDateTime(d.registeredAt)}</dd></div>
            <div><dt className="text-[11px] text-text-muted">Status</dt><dd><StatusPill value={d.status} /></dd></div>
            <div><dt className="text-[11px] text-text-muted">Reward</dt><dd><StatusPill value={d.rewardStatus} /> {d.credits > 0 ? `· ${d.credits} credit(s)` : ''}</dd></div>
          </dl>
          {d.risk.length > 0 && <p className="text-xs rounded-lg bg-[#E0E7FF] text-[#4338CA] px-3 py-2" data-testid="risk-note">Review signal: {d.risk.map(r => (r === 'VELOCITY' ? 'many referrals from this code in a short time' : r)).join(', ')}. This is a hint for a human check, not a verdict.</p>}
          <section><h3 className="text-sm font-bold text-text-primary mb-1">History</h3>
            <ol className="text-xs border border-border-subtle rounded-xl divide-y divide-border-subtle" data-testid="timeline">{d.timeline.map((e, i) => <li key={i} className="px-3 py-2"><span className="font-semibold">{e.event.replace(/_/g, ' ')}</span> · {formatISTDateTime(e.at)}{e.byName ? ` · ${e.byName}` : ''}{e.reason ? <span className="block text-text-secondary break-words">{e.reason}</span> : null}</li>)}</ol>
          </section>
          {d.transactions.length > 0 && <p className="text-xs text-text-secondary">Linked credit entries: {d.transactions.map(t => `${t.delta > 0 ? '+' : ''}${t.delta} (${t.type.replace(/_/g, ' ').toLowerCase()})`).join(', ')}</p>}

          {action ? (
            <div className="rounded-xl border border-border-subtle p-3 space-y-3" data-testid="review-form">
              <p className="text-sm font-semibold text-text-primary">{action === 'reject' ? 'Reject this referral' : action === 'under_review' ? 'Put under review' : 'Approve this referral'}</p>
              {action !== 'approve' && <Field label="Reason (required, recorded in the history)"><input value={reason} onChange={e => setReason(e.target.value)} maxLength={500} className={selectCls} data-testid="review-reason" /></Field>}
              {action === 'reject' && d.rewardStatus === 'REWARDED' && (
                <fieldset className="text-sm" data-testid="reward-decision"><legend className="text-xs font-semibold text-text-secondary mb-1">The credit was already awarded. What should happen to it?</legend>
                  <label className="flex items-center gap-2 min-h-[36px]"><input type="radio" name="rev" checked={reverse === 'yes'} onChange={() => setReverse('yes')} /> Reverse the credit (deduct it from the referrer)</label>
                  <label className="flex items-center gap-2 min-h-[36px]"><input type="radio" name="rev" checked={reverse === 'no'} onChange={() => setReverse('no')} /> Keep the credit</label>
                </fieldset>)}
              {formError && <p role="alert" className="text-xs text-[#9D174D]" data-testid="review-error">{formError}</p>}
              <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
                <button onClick={() => { setAction(null); setFormError(''); }} disabled={busy} className="btn-outline min-h-[40px] text-xs">Cancel</button>
                <button onClick={() => void run(action)} disabled={busy} className={`${action === 'reject' ? 'btn-danger' : 'btn-primary'} min-h-[40px] text-xs inline-flex items-center justify-center gap-2`} data-testid="review-confirm">{busy && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden />} Confirm</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2 justify-end">
              {d.status === 'UNDER_REVIEW' && <button onClick={() => setAction('approve')} className="btn-primary min-h-[40px] text-xs" data-testid="act-approve">Approve</button>}
              {d.status === 'SUCCESSFUL' && d.rewardStatus !== 'REWARDED' && <button onClick={() => void run('retry_reward')} disabled={busy} className="btn-primary min-h-[40px] text-xs" data-testid="act-retry">Issue credit now</button>}
              {d.status !== 'UNDER_REVIEW' && d.status !== 'REJECTED' && <button onClick={() => setAction('under_review')} className="btn-outline min-h-[40px] text-xs" data-testid="act-review">Put under review</button>}
              {d.status !== 'REJECTED' && <button onClick={() => setAction('reject')} className="btn-danger min-h-[40px] text-xs" data-testid="act-reject">Reject</button>}
              <button onClick={onClose} className="btn-outline min-h-[40px] text-xs">Close</button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};

// ───────────────────────── all referrals ─────────────────────────
const PAGE = 20;
const Referrals: React.FC<{ onChanged: () => void }> = ({ onChanged }) => {
  const narrow = useNarrow();
  const [q, setQ] = useState(''); const search = useDebounced(q.trim());
  const [status, setStatus] = useState('all'); const [reward, setReward] = useState('all'); const [standard, setStandard] = useState('all');
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [flagged, setFlagged] = useState(false);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: AdminReferralRow[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const filters: Filters = { q: search, status, reward, standard, from, to, review: flagged ? 'flagged' : undefined };
  const key = JSON.stringify(filters);
  useEffect(() => { setPage(1); }, [key]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const r = await adminReferralApi.referrals({ ...JSON.parse(key), page, limit: PAGE }); setData({ rows: r.referrals, total: r.total }); }
    catch (err) { setError(olympiadErrorMessage(err, 'We could not load the referrals.')); }
    finally { setLoading(false); }
  }, [key, page]);
  useEffect(() => { void load(); }, [load]);
  const reset = () => { setQ(''); setStatus('all'); setReward('all'); setStandard('all'); setFrom(''); setTo(''); setFlagged(false); };
  const dirty = !!(q || status !== 'all' || reward !== 'all' || standard !== 'all' || from || to || flagged);
  const doExport = async () => { setExporting(true); try { await adminReferralApi.exportReferrals(filters); } catch (err) { toast.error(olympiadErrorMessage(err, 'Could not export.')); } finally { setExporting(false); } };

  return (
    <div data-testid="referrals-tab">
      <div className="card-soft rounded-card border border-border-subtle p-4 mb-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Search"><div className="relative"><Search className="w-4 h-4 text-text-muted absolute left-3 top-1/2 -translate-y-1/2" aria-hidden /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Name, code or ID" className={`${selectCls} pl-9`} data-testid="ref-search" /></div></Field>
          <Field label="Status"><select className={selectCls} value={status} onChange={e => setStatus(e.target.value)} data-testid="ref-status"><option value="all">All</option><option value="SUCCESSFUL">Successful</option><option value="UNDER_REVIEW">Under review</option><option value="REJECTED">Rejected</option></select></Field>
          <Field label="Reward"><select className={selectCls} value={reward} onChange={e => setReward(e.target.value)} data-testid="ref-reward"><option value="all">All</option><option value="REWARDED">Rewarded</option><option value="PENDING">Pending</option><option value="WITHHELD">Withheld</option><option value="REVERSED">Reversed</option><option value="NOT_REWARDED">Not rewarded</option></select></Field>
          <Field label="Standard"><select className={selectCls} value={standard} onChange={e => setStandard(e.target.value)}><option value="all">All</option>{Array.from({ length: 10 }, (_, i) => i + 1).map(n => <option key={n} value={n}>Std {n}</option>)}<option value="99">Others</option></select></Field>
          <Field label="Registered from"><input type="date" className={selectCls} value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></Field>
          <Field label="Registered to"><input type="date" className={selectCls} value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></Field>
          <label className="flex items-center gap-2 text-sm min-h-[44px] self-end"><input type="checkbox" checked={flagged} onChange={e => setFlagged(e.target.checked)} className="w-4 h-4" /> Only flagged for review</label>
        </div>
        <div className="flex flex-wrap gap-2 justify-between mt-3">
          <button onClick={reset} disabled={!dirty} className="text-xs font-semibold py-1.5 px-3 rounded-xl border border-border-subtle bg-surface-alt disabled:opacity-50" data-testid="ref-reset">Reset filters</button>
          <button onClick={doExport} disabled={exporting} className="btn-outline inline-flex items-center gap-2 text-xs min-h-[36px]" data-testid="ref-export">{exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Download className="w-3.5 h-3.5" aria-hidden />} Export CSV</button>
        </div>
      </div>
      {error && <ErrorBox message={error} onRetry={load} />}
      <div className={`card-soft rounded-card border border-border-subtle overflow-hidden ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
        {!data ? <Busy /> : data.rows.length === 0 ? <div className="p-10 text-center text-sm text-text-secondary" data-testid="ref-empty">No referrals match the selected filters.</div> : narrow ? (
          <ul className="divide-y divide-border-subtle" data-testid="ref-list">{data.rows.map(r => (
            <li key={r.id} className="p-3" data-testid="ref-row">
              <div className="flex items-start justify-between gap-2"><button onClick={() => setOpenId(r.id)} className="font-semibold text-brand-primary text-left hover:underline break-words">{r.referredName}</button><StatusPill value={r.status} /></div>
              <p className="text-xs text-text-secondary mt-0.5">Referred by {r.referrerName} · {r.code}</p><p className="text-xs text-text-muted">{formatISTDate(r.registeredAt)} · {STD(r.standard)} · reward <StatusPill value={r.rewardStatus} /></p>
            </li>))}</ul>
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[820px]" data-testid="ref-table">
            <thead className="bg-surface-alt border-b border-border-subtle"><tr>{['Referred student', 'Referrer', 'Code', 'Standard', 'Registered', 'Status', 'Reward', 'Credits', ''].map(h => <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-text-secondary whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>{data.rows.map(r => (
              <tr key={r.id} className="border-b border-border-subtle last:border-0 align-top" data-testid="ref-row">
                <td className="px-3 py-2.5 font-semibold text-text-primary">{r.referredName}{r.risk.length > 0 && <span className="ml-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[#E0E7FF] text-[#4338CA]">flagged</span>}</td>
                <td className="px-3 py-2.5">{r.referrerName}</td><td className="px-3 py-2.5 font-mono text-xs">{r.code}</td><td className="px-3 py-2.5 whitespace-nowrap">{STD(r.standard)}</td>
                <td className="px-3 py-2.5 whitespace-nowrap text-xs">{formatISTDate(r.registeredAt)}</td><td className="px-3 py-2.5"><StatusPill value={r.status} /></td><td className="px-3 py-2.5"><StatusPill value={r.rewardStatus} /></td>
                <td className="px-3 py-2.5">{r.credits || '—'}</td><td className="px-3 py-2.5"><button onClick={() => setOpenId(r.id)} className="text-xs font-semibold text-brand-primary hover:underline whitespace-nowrap" data-testid="ref-open">View</button></td>
              </tr>))}</tbody></table></div>
        )}
      </div>
      {data && <Pager page={page} limit={PAGE} total={data.total} loading={loading} onPage={setPage} />}
      {openId && <ReferralDetail id={openId} onClose={() => setOpenId(null)} onChanged={() => { void load(); onChanged(); }} />}
    </div>
  );
};

// ───────────────────────── credit transactions ─────────────────────────
const Transactions: React.FC = () => {
  const narrow = useNarrow();
  const [student, setStudent] = useState(''); const debounced = useDebounced(student.trim());
  const [type, setType] = useState('all'); const [source, setSource] = useState('all'); const [batch, setBatch] = useState(''); const batchQ = useDebounced(batch.trim());
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [page, setPage] = useState(1);
  const [data, setData] = useState<{ rows: AdminTx[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [exporting, setExporting] = useState(false);
  const filters: Filters = { student: debounced, type, source, batchId: batchQ, from, to };
  const key = JSON.stringify(filters);
  useEffect(() => { setPage(1); }, [key]);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try { const r = await adminReferralApi.transactions({ ...JSON.parse(key), page, limit: PAGE }); setData({ rows: r.transactions, total: r.total }); }
    catch (err) { setError(olympiadErrorMessage(err, 'We could not load the transactions.')); }
    finally { setLoading(false); }
  }, [key, page]);
  useEffect(() => { void load(); }, [load]);
  const dirty = !!(student || type !== 'all' || source !== 'all' || batch || from || to);
  const reset = () => { setStudent(''); setType('all'); setSource('all'); setBatch(''); setFrom(''); setTo(''); };
  const doExport = async () => { setExporting(true); try { await adminReferralApi.exportTransactions(filters); } catch (err) { toast.error(olympiadErrorMessage(err, 'Could not export.')); } finally { setExporting(false); } };
  const Delta = ({ v }: { v: number }) => <span className={`font-bold ${v > 0 ? 'text-[#15803D]' : 'text-[#B91C1C]'}`}>{v > 0 ? `+${v}` : v}</span>;
  return (
    <div data-testid="transactions-tab">
      <div className="card-soft rounded-card border border-border-subtle p-4 mb-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <Field label="Student name"><input value={student} onChange={e => setStudent(e.target.value)} className={selectCls} data-testid="tx-student" /></Field>
          <Field label="Type"><select className={selectCls} value={type} onChange={e => setType(e.target.value)} data-testid="tx-type"><option value="all">All types</option>{TX_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></Field>
          <Field label="Source"><select className={selectCls} value={source} onChange={e => setSource(e.target.value)}><option value="all">All</option><option value="REFERRAL">Referral</option><option value="ADMIN">Admin</option><option value="EXAM">Exam</option><option value="SYSTEM">System</option></select></Field>
          <Field label="Batch ID"><input value={batch} onChange={e => setBatch(e.target.value)} placeholder="CG-…" className={`${selectCls} font-mono`} /></Field>
          <Field label="From"><input type="date" className={selectCls} value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" className={selectCls} value={to} min={from || undefined} onChange={e => setTo(e.target.value)} /></Field>
        </div>
        <div className="flex flex-wrap gap-2 justify-between mt-3">
          <button onClick={reset} disabled={!dirty} className="text-xs font-semibold py-1.5 px-3 rounded-xl border border-border-subtle bg-surface-alt disabled:opacity-50">Reset filters</button>
          <button onClick={doExport} disabled={exporting} className="btn-outline inline-flex items-center gap-2 text-xs min-h-[36px]" data-testid="tx-export">{exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <Download className="w-3.5 h-3.5" aria-hidden />} Export CSV</button>
        </div>
      </div>
      {error && <ErrorBox message={error} onRetry={load} />}
      <div className={`card-soft rounded-card border border-border-subtle overflow-hidden ${loading ? 'opacity-60' : ''}`} aria-busy={loading}>
        {!data ? <Busy /> : data.rows.length === 0 ? <div className="p-10 text-center text-sm text-text-secondary" data-testid="tx-empty">No credit transactions match the selected filters.</div> : narrow ? (
          <ul className="divide-y divide-border-subtle" data-testid="tx-list">{data.rows.map(t => (
            <li key={t.id} className="p-3 text-sm" data-testid="tx-row"><div className="flex justify-between gap-2"><span className="font-semibold break-words">{t.studentName || 'Student'}</span><Delta v={t.delta} /></div><p className="text-xs text-text-secondary">{t.type.replace(/_/g, ' ').toLowerCase()} · {formatISTDateTime(t.at)}</p><p className="text-xs text-text-muted break-words">{t.reason || t.examTitle || ''} · {t.performedBy}</p></li>))}</ul>
        ) : (
          <div className="overflow-x-auto"><table className="w-full text-sm min-w-[860px]" data-testid="tx-table">
            <thead className="bg-surface-alt border-b border-border-subtle"><tr>{['Date', 'Student', 'Type', 'Credits', 'Reason / exam', 'By', 'Batch'].map(h => <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-text-secondary whitespace-nowrap">{h}</th>)}</tr></thead>
            <tbody>{data.rows.map(t => (
              <tr key={t.id} className="border-b border-border-subtle last:border-0 align-top" data-testid="tx-row">
                <td className="px-3 py-2.5 whitespace-nowrap text-xs">{formatISTDateTime(t.at)}</td><td className="px-3 py-2.5 font-semibold text-text-primary">{t.studentName || '—'}</td>
                <td className="px-3 py-2.5 text-xs">{t.type.replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase())}</td><td className="px-3 py-2.5"><Delta v={t.delta} /></td>
                <td className="px-3 py-2.5 text-xs break-words min-w-[12rem]">{t.reason || '—'}{t.examTitle ? <span className="block text-text-secondary">{t.examTitle}</span> : null}</td>
                <td className="px-3 py-2.5 text-xs">{t.performedBy}</td><td className="px-3 py-2.5 font-mono text-[11px]">{t.batchId || '—'}</td>
              </tr>))}</tbody></table></div>
        )}
      </div>
      {data && <Pager page={page} limit={PAGE} total={data.total} loading={loading} onPage={setPage} />}
    </div>
  );
};

// ───────────────────────── settings ─────────────────────────
const SettingsPanel: React.FC<{ settings: ReferralSettings | null; onSaved: (s: ReferralSettings) => void }> = ({ settings, onSaved }) => {
  const [form, setForm] = useState({ enabled: true, creditsPerReferral: '1', maxBulkSize: '200', maxCreditsPerStudent: '20', flagAfterPerHour: '5', rewardUnderReview: false });
  const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const [check, setCheck] = useState<string>(''); const [checking, setChecking] = useState(false);
  useEffect(() => { if (settings) setForm({ enabled: settings.enabled, creditsPerReferral: String(settings.creditsPerReferral), maxBulkSize: String(settings.maxBulkSize), maxCreditsPerStudent: String(settings.maxCreditsPerStudent), flagAfterPerHour: String(settings.flagAfterPerHour), rewardUnderReview: settings.rewardUnderReview }); }, [settings]);
  if (!settings) return <Busy />;
  const num = (v: string) => (v.trim() === '' ? NaN : Number(v));
  const save = async () => {
    setError('');
    const body = { enabled: form.enabled, rewardUnderReview: form.rewardUnderReview, creditsPerReferral: num(form.creditsPerReferral), maxBulkSize: num(form.maxBulkSize), maxCreditsPerStudent: num(form.maxCreditsPerStudent), flagAfterPerHour: num(form.flagAfterPerHour) };
    if (![body.creditsPerReferral, body.maxBulkSize, body.maxCreditsPerStudent, body.flagAfterPerHour].every(Number.isInteger)) { setError('Every number must be a whole number.'); return; }
    setSaving(true);
    try { const s = await adminReferralApi.saveSettings(body); onSaved(s); toast.success('Settings saved.'); } catch (err) { setError(olympiadErrorMessage(err, 'Settings could not be saved.')); } finally { setSaving(false); }
  };
  const runCheck = async () => {
    setChecking(true); setCheck('');
    try { const r = await adminReferralApi.reconcile(false); setCheck(r.drift.length ? `${r.drift.length} of ${r.checked} balances differ from the ledger. Contact the developer team to repair them.` : `All ${r.checked} balances match the ledger.`); }
    catch (err) { setCheck(olympiadErrorMessage(err, 'The check could not be completed.')); } finally { setChecking(false); }
  };
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  return (
    <div className="max-w-2xl space-y-4" data-testid="settings-tab">
      <section className="card-soft rounded-card border border-border-subtle p-4 space-y-4">
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={form.enabled} onChange={set('enabled')} className="mt-1 w-5 h-5" data-testid="set-enabled" /><span><span className="font-semibold text-text-primary block">Referral programme is active</span><span className="text-xs text-text-secondary">When off, new registrations earn nothing and codes are not accepted. Existing credits can still be used.</span></span></label>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Credits per successful referral (1–10)"><input type="number" min={1} max={10} value={form.creditsPerReferral} onChange={set('creditsPerReferral')} className={selectCls} data-testid="set-per-referral" /></Field>
          <Field label="Maximum credits per student in one grant (1–100)"><input type="number" min={1} max={100} value={form.maxCreditsPerStudent} onChange={set('maxCreditsPerStudent')} className={selectCls} /></Field>
          <Field label="Maximum students in one bulk grant (1–1000)"><input type="number" min={1} max={1000} value={form.maxBulkSize} onChange={set('maxBulkSize')} className={selectCls} data-testid="set-bulk-max" /></Field>
          <Field label="Hold a referrer for review after this many referrals in an hour (2–100)"><input type="number" min={2} max={100} value={form.flagAfterPerHour} onChange={set('flagAfterPerHour')} className={selectCls} /></Field>
        </div>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={form.rewardUnderReview} onChange={set('rewardUnderReview')} className="mt-1 w-5 h-5" /><span><span className="font-semibold text-text-primary block">Reward referrals that are under review</span><span className="text-xs text-text-secondary">Off by default: held referrals earn nothing until you approve them.</span></span></label>
        <p className="text-xs text-text-muted">Credits do not expire. Changes apply to new activity only; past referrals and credits are never rewritten.{settings.updatedByName ? ` Last changed by ${settings.updatedByName}${settings.updatedAt ? ` on ${formatISTDateTime(settings.updatedAt)}` : ''}.` : ''}</p>
        {error && <p role="alert" className="text-xs text-[#9D174D]" data-testid="set-error">{error}</p>}
        <div className="flex justify-end"><button onClick={() => void save()} disabled={saving} className="btn-primary min-h-[44px] inline-flex items-center gap-2" data-testid="set-save">{saving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden />} Save settings</button></div>
      </section>
      <section className="card-soft rounded-card border border-border-subtle p-4">
        <h3 className="font-heading font-bold text-text-primary">Balance check</h3>
        <p className="text-xs text-text-secondary mt-1">Compares every student&apos;s credit balance with the credit ledger. Read-only.</p>
        <button onClick={() => void runCheck()} disabled={checking} className="btn-outline inline-flex items-center gap-2 text-xs min-h-[40px] mt-3" data-testid="run-check">{checking ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden /> : <RefreshCw className="w-3.5 h-3.5" aria-hidden />} Check balances</button>
        {check && <p className="text-sm mt-3" role="status" data-testid="check-result">{check}</p>}
      </section>
    </div>
  );
};

// ───────────────────────── page ─────────────────────────
const AdminReferEarn: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as Tab | null;
  const tab: Tab = TABS.some(t => t.key === raw) ? (raw as Tab) : 'overview';
  const [settings, setSettings] = useState<ReferralSettings | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => { adminReferralApi.settings().then(setSettings).catch(() => setSettings(null)); }, []);
  const go = (t: Tab) => setParams(t === 'overview' ? {} : { tab: t }, { replace: true });
  const bump = () => setVersion(v => v + 1);
  return (
    <div className="flex min-h-screen bg-page transition-colors">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-6xl mx-auto" data-testid="admin-refer">
          <p className="text-brand-primary text-xs font-semibold tracking-wide uppercase mb-1">Rewards</p>
          <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary flex items-center gap-2"><Gift className="w-6 h-6 text-[#FFC24B]" aria-hidden /> Refer &amp; Earn</h1>
          <p className="text-text-secondary text-sm mt-1 mb-5">Referrals, exam credits and manual grants in one place.</p>
          <div className="flex gap-2 overflow-x-auto pb-2 mb-4" role="tablist" aria-label="Refer and earn sections" data-testid="admin-tabs">
            {TABS.map(t => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} onClick={() => go(t.key)} data-testid={`tab-${t.key}`}
                className={`flex-shrink-0 text-xs font-semibold px-4 py-2 rounded-full border transition-colors ${tab === t.key ? 'bg-brand-primary text-white border-brand-primary' : 'bg-surface text-text-primary border-border-subtle hover:bg-surface-alt'}`}>
                {t.key === 'settings' && <SettingsIcon className="w-3 h-3 inline mr-1 -mt-0.5" aria-hidden />}{t.label}
              </button>
            ))}
          </div>
          {tab === 'overview' && <Overview key={version} />}
          {tab === 'referrals' && <Referrals onChanged={bump} />}
          {tab === 'transactions' && <Transactions key={version} />}
          {tab === 'send' && <SendCredits settings={settings} onChanged={bump} />}
          {tab === 'settings' && <SettingsPanel settings={settings} onSaved={setSettings} />}
        </div>
      </main>
    </div>
  );
};

export default AdminReferEarn;

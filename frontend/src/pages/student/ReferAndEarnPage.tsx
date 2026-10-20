import React, { useCallback, useEffect, useState } from 'react';
import { Gift, Copy, Check, Share2, Users, BadgeCheck, Ticket, Wallet, Loader2, AlertTriangle, UserPlus, GraduationCap, ChevronLeft, ChevronRight, Send, MessageCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import Sidebar from '../../components/layout/Sidebar';
import { referralApi, MyReferralOverview, MyReferralRow, CreditTx } from '../../services/referrals';
import { olympiadErrorMessage } from '../../services/olympiad';
import { formatISTDate } from '../../utils/olympiadFormat';

const PAGE = 10;

const copyText = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove(); return ok;
  } catch { return false; }
};

const StatCard: React.FC<{ icon: React.ElementType; label: string; value: number; hint?: string; tone: string; testId: string }> = ({ icon: Icon, label, value, hint, tone, testId }) => (
  <div className="card-soft rounded-card border border-border-subtle p-4" data-testid={testId}>
    <span className={`inline-flex w-9 h-9 rounded-xl items-center justify-center ${tone}`}><Icon className="w-[18px] h-[18px]" aria-hidden /></span>
    <p className="mt-3 text-2xl font-heading font-bold text-text-primary" data-testid={`${testId}-value`}>{value}</p>
    <p className="text-xs font-semibold text-text-secondary">{label}</p>
    {hint && <p className="text-[11px] text-text-muted mt-0.5">{hint}</p>}
  </div>
);

const STATUS_STYLE: Record<string, string> = {
  Successful: 'bg-[#DCFCE7] text-[#15803D]', Pending: 'bg-[#FEF3C7] text-[#B45309]', 'Under review': 'bg-[#E0E7FF] text-[#4338CA]', Rejected: 'bg-[#FFE4EC] text-[#9D174D]',
};

const ReferAndEarnPage: React.FC = () => {
  const [data, setData] = useState<MyReferralOverview | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState<'code' | 'link' | null>(null);
  const [tab, setTab] = useState<'referrals' | 'history'>('referrals');
  const [refs, setRefs] = useState<{ rows: MyReferralRow[]; total: number } | null>(null);
  const [hist, setHist] = useState<{ rows: CreditTx[]; total: number } | null>(null);
  const [page, setPage] = useState(1);
  const [tabLoading, setTabLoading] = useState(false);
  const [tabError, setTabError] = useState('');

  const loadOverview = useCallback(async () => {
    setError('');
    try { setData(await referralApi.me()); } catch (err) { setError(olympiadErrorMessage(err, 'We could not load your referral details.')); }
  }, []);
  useEffect(() => { void loadOverview(); }, [loadOverview]);

  useEffect(() => {
    let cancelled = false;
    setTabLoading(true); setTabError('');
    (tab === 'referrals'
      ? referralApi.myReferrals(page, PAGE).then(r => { if (!cancelled) setRefs({ rows: r.referrals, total: r.total }); })
      : referralApi.myCredits(page, PAGE).then(r => { if (!cancelled) setHist({ rows: r.transactions, total: r.total }); }))
      .catch(err => { if (!cancelled) setTabError(olympiadErrorMessage(err, 'We could not load this list.')); })
      .finally(() => { if (!cancelled) setTabLoading(false); });
    return () => { cancelled = true; };
  }, [tab, page, data?.stats.totalReferrals, data?.stats.available]);

  const doCopy = async (what: 'code' | 'link') => {
    if (!data) return;
    const ok = await copyText(what === 'code' ? data.code : data.link);
    if (ok) { setCopied(what); toast.success(what === 'code' ? 'Referral code copied' : 'Referral link copied'); setTimeout(() => setCopied(null), 2000); }
    else toast.error('Could not copy. Please select the text and copy it manually.');
  };

  const message = data ? `Join me on LearnIQ and prepare for the Olympiad! Register with my referral code ${data.code} or use this link: ${data.link}` : '';
  const canNativeShare = typeof navigator !== 'undefined' && typeof (navigator as Navigator & { share?: unknown }).share === 'function';
  const nativeShare = async () => {
    if (!data) return;
    try { await navigator.share({ title: 'Join me on LearnIQ', text: message, url: data.link }); } catch (e) { if ((e as Error)?.name !== 'AbortError') toast.error('Sharing was not completed.'); }
  };

  const total = tab === 'referrals' ? refs?.total ?? 0 : hist?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const s = data?.stats;

  return (
    <div className="flex min-h-screen bg-page transition-colors">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0">
        <div className="p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto" data-testid="refer-page">
          <p className="text-brand-primary text-xs font-semibold tracking-wide uppercase mb-1">Rewards</p>
          <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary flex items-center gap-2"><Gift className="w-6 h-6 text-[#FFC24B]" aria-hidden /> Refer &amp; Earn</h1>
          <p className="text-text-secondary text-sm mt-1 mb-6">Invite your friends to LearnIQ. When a friend joins with your code, you earn an exam credit that you can use to open an Olympiad exam without paying.</p>

          {error && (
            <div className="rounded-xl border border-[#F9A8C0] bg-[#FFE4EC] p-4 mb-5 text-sm text-[#9D174D]" role="alert" data-testid="refer-error">
              <p className="flex items-center gap-2 font-semibold"><AlertTriangle className="w-4 h-4" aria-hidden /> {error}</p>
              <button onClick={loadOverview} className="mt-3 text-xs font-semibold px-3 py-1.5 rounded-lg bg-white border border-border-subtle text-text-primary">Try again</button>
            </div>
          )}
          {!data && !error && <div className="flex items-center justify-center gap-3 py-24 text-sm text-text-secondary" data-testid="refer-loading"><Loader2 className="w-5 h-5 animate-spin text-brand-primary" aria-hidden /> Loading…</div>}

          {data && s && (
            <>
              {!data.enabled && <div className="rounded-xl border border-[#FCD34D] bg-[#FEF3C7] p-3 mb-4 text-sm text-[#92400E]" data-testid="refer-paused">The referral programme is paused right now. Your credits are safe and can still be used.</div>}

              <section className="card-soft rounded-card border border-border-subtle p-5 mb-5" aria-label="Your referral code">
                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Your referral code</p>
                <div className="mt-2 flex flex-col sm:flex-row sm:items-center gap-3">
                  <div className="flex-1 min-w-0 rounded-xl border-2 border-dashed border-brand-primary/50 bg-surface-alt px-4 py-3 text-center sm:text-left">
                    <span className="font-mono text-2xl sm:text-3xl font-bold tracking-[0.2em] text-brand-primary select-all" data-testid="refer-code">{data.code}</span>
                  </div>
                  <button onClick={() => doCopy('code')} className="btn-primary inline-flex items-center justify-center gap-2 min-h-[44px]" data-testid="copy-code">
                    {copied === 'code' ? <Check className="w-4 h-4" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />} {copied === 'code' ? 'Copied' : 'Copy code'}
                  </button>
                </div>

                <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide mt-5">Your referral link</p>
                <div className="mt-2 flex flex-col sm:flex-row gap-2">
                  <input readOnly value={data.link} onFocus={e => e.currentTarget.select()} className="input-field flex-1 min-w-0 text-sm" aria-label="Referral link" data-testid="refer-link" />
                  <button onClick={() => doCopy('link')} className="btn-outline inline-flex items-center justify-center gap-2 min-h-[44px]" data-testid="copy-link">
                    {copied === 'link' ? <Check className="w-4 h-4" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />} {copied === 'link' ? 'Copied' : 'Copy link'}
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap gap-2" data-testid="share-row">
                  <a href={`https://wa.me/?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-[#25D366] text-white text-sm font-semibold hover:opacity-90" data-testid="share-whatsapp">
                    <MessageCircle className="w-4 h-4" aria-hidden /> WhatsApp
                  </a>
                  <a href={`https://t.me/share/url?url=${encodeURIComponent(data.link)}&text=${encodeURIComponent(`Join me on LearnIQ! Use my referral code ${data.code}.`)}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 min-h-[44px] rounded-xl bg-[#229ED9] text-white text-sm font-semibold hover:opacity-90" data-testid="share-telegram">
                    <Send className="w-4 h-4" aria-hidden /> Telegram
                  </a>
                  {canNativeShare && (
                    <button onClick={nativeShare} className="inline-flex items-center gap-2 px-4 min-h-[44px] rounded-xl border border-border-subtle bg-surface text-text-primary text-sm font-semibold hover:bg-surface-alt" data-testid="share-native">
                      <Share2 className="w-4 h-4" aria-hidden /> Share…
                    </button>
                  )}
                </div>
              </section>

              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5" data-testid="refer-stats">
                <StatCard testId="stat-total" icon={Users} label="Total referrals" value={s.totalReferrals} hint="Friends who joined with your code" tone="bg-[#E0E7FF] text-[#4338CA]" />
                <StatCard testId="stat-successful" icon={BadgeCheck} label="Successful referrals" value={s.successful} hint="Credit awarded" tone="bg-[#DCFCE7] text-[#16A34A]" />
                <StatCard testId="stat-earned" icon={Ticket} label="Credits earned" value={s.creditsEarned} hint={s.creditsFromAdmin ? `+ ${s.creditsFromAdmin} from LearnIQ` : 'From referrals'} tone="bg-[#FEF3C7] text-[#D97706]" />
                <StatCard testId="stat-available" icon={Wallet} label="Available credits" value={s.available} hint={s.creditsUsed ? `${s.creditsUsed} used for exams` : '1 credit = 1 exam'} tone="bg-[#CCFBF1] text-[#0D9488]" />
              </div>
              {(s.pending > 0 || s.underReview > 0) && (
                <p className="text-xs text-text-secondary -mt-2 mb-5" data-testid="stat-notes">
                  {s.pending > 0 && <>{s.pending} referral{s.pending === 1 ? '' : 's'} waiting for the credit to be added. </>}
                  {s.underReview > 0 && <>{s.underReview} referral{s.underReview === 1 ? ' is' : 's are'} being reviewed by the LearnIQ team.</>}
                </p>
              )}

              <section className="mb-6" aria-label="How it works">
                <h2 className="font-heading font-bold text-lg text-text-primary mb-3">How it works</h2>
                <ol className="grid sm:grid-cols-3 gap-3" data-testid="how-it-works">
                  {[
                    { icon: Share2, t: 'Share your code', d: 'Send your code or link to a friend who is not on LearnIQ yet.' },
                    { icon: UserPlus, t: 'Your friend registers', d: 'They create a new student account using your code.' },
                    { icon: GraduationCap, t: 'You earn a credit', d: `You get ${data.creditsPerReferral} exam credit${data.creditsPerReferral === 1 ? '' : 's'}. Use 1 credit to open 1 paid Olympiad exam.` },
                  ].map((st, i) => (
                    <li key={st.t} className="card-soft rounded-card border border-border-subtle p-4 flex gap-3">
                      <span className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-primary text-white text-sm font-bold flex items-center justify-center" aria-hidden>{i + 1}</span>
                      <div><p className="font-semibold text-sm text-text-primary flex items-center gap-1.5"><st.icon className="w-4 h-4 text-brand-primary" aria-hidden /> {st.t}</p><p className="text-xs text-text-secondary mt-1">{st.d}</p></div>
                    </li>
                  ))}
                </ol>
                <p className="text-[11px] text-text-muted mt-2">Credits are earned only when a genuinely new student registers with your code. They cannot be sold or transferred, and they do not expire. LearnIQ may review referrals that look unusual.</p>
              </section>

              <div className="flex gap-2 mb-3" role="tablist" aria-label="Referral lists">
                {([['referrals', 'My referrals'], ['history', 'Credit history']] as const).map(([k, label]) => (
                  <button key={k} role="tab" aria-selected={tab === k} onClick={() => { setTab(k); setPage(1); }} data-testid={`tab-${k}`}
                    className={`text-xs font-semibold px-4 py-2 rounded-full border transition-colors ${tab === k ? 'bg-brand-primary text-white border-brand-primary' : 'bg-surface text-text-primary border-border-subtle hover:bg-surface-alt'}`}>{label}</button>
                ))}
              </div>

              <div className={`card-soft rounded-card border border-border-subtle overflow-hidden ${tabLoading ? 'opacity-60' : ''}`} aria-busy={tabLoading}>
                {tabError ? (
                  <div className="p-6 text-sm text-[#9D174D]" role="alert">{tabError}</div>
                ) : tab === 'referrals' ? (
                  !refs || refs.rows.length === 0 ? (
                    <div className="p-10 text-center text-sm text-text-secondary" data-testid="referrals-empty">{tabLoading ? 'Loading…' : 'No referrals yet. Share your code to get started.'}</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm min-w-[480px]" data-testid="referrals-table">
                        <thead className="bg-surface-alt border-b border-border-subtle"><tr>{['#', 'Friend', 'Joined on', 'Status', 'Credit'].map(h => <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-text-secondary whitespace-nowrap">{h}</th>)}</tr></thead>
                        <tbody>
                          {refs.rows.map(r => (
                            <tr key={r.no} className="border-b border-border-subtle last:border-0" data-testid="referral-row">
                              <td className="px-3 py-2.5 text-text-muted">{r.no}</td>
                              <td className="px-3 py-2.5 font-semibold text-text-primary">{r.name}</td>
                              <td className="px-3 py-2.5 whitespace-nowrap">{formatISTDate(r.registeredAt)}</td>
                              <td className="px-3 py-2.5"><span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[r.status] || ''}`}>{r.status}</span></td>
                              <td className="px-3 py-2.5 font-semibold">{r.credits > 0 ? `+${r.credits}` : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )
                ) : !hist || hist.rows.length === 0 ? (
                  <div className="p-10 text-center text-sm text-text-secondary" data-testid="history-empty">{tabLoading ? 'Loading…' : 'No credit activity yet.'}</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[480px]" data-testid="history-table">
                      <thead className="bg-surface-alt border-b border-border-subtle"><tr>{['Date', 'Activity', 'Credits'].map(h => <th key={h} className="text-left px-3 py-2 text-xs font-semibold text-text-secondary">{h}</th>)}</tr></thead>
                      <tbody>
                        {hist.rows.map(t => (
                          <tr key={t.id} className="border-b border-border-subtle last:border-0" data-testid="history-row">
                            <td className="px-3 py-2.5 whitespace-nowrap">{formatISTDate(t.at)}</td>
                            <td className="px-3 py-2.5"><span className="font-semibold text-text-primary">{t.label}</span>{t.examTitle ? <span className="block text-xs text-text-secondary">{t.examTitle}</span> : null}</td>
                            <td className={`px-3 py-2.5 font-bold ${t.delta > 0 ? 'text-[#15803D]' : 'text-[#B91C1C]'}`}>{t.delta > 0 ? `+${t.delta}` : t.delta}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
              {total > PAGE && (
                <div className="flex items-center justify-between gap-3 mt-3 text-xs text-text-secondary" data-testid="refer-pagination">
                  <span>Page {page} of {pages}</span>
                  <div className="flex gap-2">
                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1 || tabLoading} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border-subtle bg-surface disabled:opacity-50"><ChevronLeft className="w-3.5 h-3.5" aria-hidden /> Previous</button>
                    <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page >= pages || tabLoading} className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-border-subtle bg-surface disabled:opacity-50">Next <ChevronRight className="w-3.5 h-3.5" aria-hidden /></button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default ReferAndEarnPage;

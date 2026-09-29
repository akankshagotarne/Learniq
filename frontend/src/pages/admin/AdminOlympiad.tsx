import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import {
  Trophy, Users, IndianRupee, CheckCircle2, XCircle, Clock, BarChart2, TrendingUp, TrendingDown, Target, RefreshCw,
} from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import { olympiadApi, olympiadErrorMessage } from '../../services/olympiad';
import { OlympiadAdminStats, OlympiadExam } from '../../types/olympiad';
import { formatDuration, formatISTDateTime, formatISTRange, formatRupees } from '../../utils/olympiadFormat';

type AdminExam = OlympiadExam & { stats: OlympiadAdminStats };

const payStyle: Record<string, string> = {
  SUCCESS: 'bg-[#DCFCE7] text-[#16A34A]',
  PENDING: 'bg-[#FEF3C7] text-[#D97706]',
  FAILED: 'bg-[#FFE4EC] text-[#E1447A]',
  REFUNDED: 'bg-surface-alt text-text-secondary',
};

const windowLabel: Record<string, string> = { upcoming: 'Upcoming', open: 'Open', closed: 'Closed' };

const AdminOlympiad: React.FC = () => {
  const [exams, setExams] = useState<AdminExam[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [attempts, setAttempts] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [tab, setTab] = useState<'results' | 'payments'>('results');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const loadExams = useCallback(async () => {
    setLoading(true);
    try {
      const list = await olympiadApi.adminExams();
      setExams(list);
      setSelectedId(prev => prev || list[0]?._id || '');
    } catch (err: any) {
      toast.error(olympiadErrorMessage(err, 'Failed to load Olympiad exams.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadExams(); }, [loadExams]);

  const createExam = async () => {
    setSeeding(true);
    try {
      await olympiadApi.adminSeed();
      toast.success('Olympiad exams created.');
      await loadExams();
    } catch (err: any) {
      toast.error(olympiadErrorMessage(err, 'Could not create the Olympiad exams.'));
    } finally {
      setSeeding(false);
    }
  };

  useEffect(() => {
    if (!selectedId) return;
    setDetailLoading(true);
    Promise.all([olympiadApi.adminAttempts(selectedId), olympiadApi.adminPayments(selectedId)])
      .then(([a, p]) => { setAttempts(a); setPayments(p); })
      .catch(err => toast.error(olympiadErrorMessage(err, 'Failed to load details.')))
      .finally(() => setDetailLoading(false));
  }, [selectedId]);

  const exam = exams.find(e => e._id === selectedId);
  const s = exam?.stats;

  const cards = s ? [
    { label: 'Registrations', value: s.totalRegistrations, icon: Users, iconBg: 'bg-[#EDE9FE] text-[#6C63F2]' },
    { label: 'Revenue', value: formatRupees(s.revenue), icon: IndianRupee, iconBg: 'bg-[#F3E8FF] text-[#9333EA]' },
    { label: 'Payments Succeeded', value: s.successfulPayments, icon: CheckCircle2, iconBg: 'bg-[#DCFCE7] text-[#16A34A]' },
    { label: 'Payments Failed', value: s.failedPayments, icon: XCircle, iconBg: 'bg-[#FFE4EC] text-[#E1447A]' },
    { label: 'Attempts', value: s.totalAttempts, icon: BarChart2, iconBg: 'bg-[#E0F2FE] text-[#0284C7]' },
    { label: 'Completed', value: s.completedAttempts, icon: Target, iconBg: 'bg-[#DCFCE7] text-[#16A34A]' },
    { label: 'Average Score', value: `${s.averageScore}/${exam!.totalMarks}`, icon: BarChart2, iconBg: 'bg-[#FEF3C7] text-[#D97706]' },
    { label: 'Highest Score', value: s.highestScore, icon: TrendingUp, iconBg: 'bg-[#DCFCE7] text-[#16A34A]' },
    { label: 'Lowest Score', value: s.lowestScore, icon: TrendingDown, iconBg: 'bg-[#FFE4EC] text-[#E1447A]' },
    { label: 'In Progress', value: s.inProgressAttempts, icon: Clock, iconBg: 'bg-[#FEF3C7] text-[#D97706]' },
  ] : [];

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 ml-0 md:ml-64 pt-14 md:pt-0 transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="mb-8 flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div>
              <p className="text-brand-primary text-xs font-semibold tracking-wide uppercase mb-1">Admin</p>
              <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary flex items-center gap-2">
                <Trophy className="w-6 h-6 text-[#FFC24B]" /> Olympiad Exams
              </h1>
              <p className="text-text-secondary text-sm mt-1">Registrations, payments, attempts and results</p>
            </div>
            <button onClick={() => void loadExams()} className="self-start sm:self-auto flex items-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-xl border border-border-subtle bg-surface-alt text-text-primary">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>

          {loading ? (
            <div className="card-soft h-40 rounded-2xl animate-pulse bg-surface-alt" />
          ) : !exam ? (
            <div className="card-soft p-10 text-center text-sm text-text-secondary">
              <p className="mb-4">No Olympiad exams exist in the database yet.</p>
              <button
                onClick={() => void createExam()}
                disabled={seeding}
                className="btn-primary text-xs py-2.5 px-5 rounded-xl font-bold disabled:opacity-60"
              >
                {seeding ? 'Creating…' : 'Create Olympiad Exams (Std 9 & 10)'}
              </button>
            </div>
          ) : (
            <>
              {exams.length > 1 && (
                <select
                  value={selectedId}
                  onChange={e => setSelectedId(e.target.value)}
                  className="mb-4 px-3 py-2 bg-surface border border-border-subtle rounded-xl text-sm text-text-primary"
                >
                  {exams.map(e => <option key={e._id} value={e._id}>{e.title}</option>)}
                </select>
              )}

              {/* Exam info */}
              <div className="card-soft rounded-2xl p-5 mb-6">
                <div className="flex flex-wrap items-center gap-2 mb-2">
                  <h2 className="font-heading font-bold text-lg text-text-primary">{exam.title}</h2>
                  <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full bg-[#EDE9FE] text-[#6C63F2]">{windowLabel[exam.window] || exam.window}</span>
                </div>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs text-text-secondary">
                  <p><span className="text-text-muted block">Standard</span><b className="text-text-primary">{exam.standard}</b></p>
                  <p><span className="text-text-muted block">Conducted by</span><b className="text-text-primary">{exam.conductedBy}</b></p>
                  <p><span className="text-text-muted block">Questions / Marks</span><b className="text-text-primary">{exam.totalQuestions} / {exam.totalMarks}</b></p>
                  <p><span className="text-text-muted block">Duration / Fee</span><b className="text-text-primary">{exam.durationMinutes} min / {formatRupees(exam.fee)}</b></p>
                  <p className="col-span-2"><span className="text-text-muted block">Window (IST)</span><b className="text-text-primary">{formatISTRange(exam.startDate, exam.endDate)}</b></p>
                </div>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-6">
                {cards.map(({ label, value, icon: Icon, iconBg }) => (
                  <div key={label} className="card-soft p-4 flex flex-col justify-between">
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${iconBg}`}><Icon className="w-4 h-4" /></div>
                    <div>
                      <p className="text-xl font-bold font-heading text-text-primary">{value}</p>
                      <p className="text-text-secondary text-xs mt-1 font-medium">{label}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Tabs */}
              <div className="flex bg-surface-alt p-1 rounded-xl border border-border-subtle self-start mb-4 w-fit">
                {(['results', 'payments'] as const).map(t => (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`px-4 py-2 rounded-lg text-xs font-semibold transition-all ${tab === t ? 'bg-brand-primary text-white shadow-sm' : 'text-text-secondary hover:text-text-primary'}`}
                  >
                    {t === 'results' ? `Results (${attempts.length})` : `Payments (${payments.length})`}
                  </button>
                ))}
              </div>

              <div className="card-soft rounded-2xl overflow-hidden">
                <div className="overflow-x-auto">
                  {tab === 'results' ? (
                    <table className="w-full text-xs min-w-[720px]">
                      <thead className="bg-surface-alt text-text-muted">
                        <tr className="text-left">
                          <th className="p-3 font-semibold">Rank</th>
                          <th className="p-3 font-semibold">Student</th>
                          <th className="p-3 font-semibold">Status</th>
                          <th className="p-3 font-semibold">Score</th>
                          <th className="p-3 font-semibold">%</th>
                          <th className="p-3 font-semibold">C / W / U</th>
                          <th className="p-3 font-semibold">Time taken</th>
                          <th className="p-3 font-semibold">Submitted</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailLoading ? (
                          <tr><td colSpan={8} className="p-6 text-center text-text-muted">Loading…</td></tr>
                        ) : attempts.length === 0 ? (
                          <tr><td colSpan={8} className="p-6 text-center text-text-muted">No attempts yet.</td></tr>
                        ) : attempts.map((a, i) => (
                          <tr key={a._id} className="border-t border-border-subtle">
                            <td className="p-3 text-text-secondary">{a.status === 'COMPLETED' ? i + 1 : '—'}</td>
                            <td className="p-3">
                              <p className="font-semibold text-text-primary">{a.student?.name || 'Unknown'}</p>
                              <p className="text-text-muted">{a.student?.email}</p>
                            </td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${a.status === 'COMPLETED' ? 'bg-[#DCFCE7] text-[#16A34A]' : 'bg-[#FEF3C7] text-[#D97706]'}`}>
                                {a.status === 'COMPLETED' ? 'Completed' : 'In progress'}
                              </span>
                            </td>
                            <td className="p-3 text-text-primary font-semibold">{a.status === 'COMPLETED' ? `${a.score}/${a.totalMarks}` : '—'}</td>
                            <td className="p-3 text-text-secondary">{a.status === 'COMPLETED' ? `${a.percentage}%` : '—'}</td>
                            <td className="p-3 text-text-secondary">{a.status === 'COMPLETED' ? `${a.correctCount} / ${a.wrongCount} / ${a.unansweredCount}` : '—'}</td>
                            <td className="p-3 text-text-secondary">{a.status === 'COMPLETED' ? formatDuration(a.timeTakenSeconds) : '—'}</td>
                            <td className="p-3 text-text-secondary">{a.submittedAt ? formatISTDateTime(a.submittedAt) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <table className="w-full text-xs min-w-[720px]">
                      <thead className="bg-surface-alt text-text-muted">
                        <tr className="text-left">
                          <th className="p-3 font-semibold">Student</th>
                          <th className="p-3 font-semibold">Amount</th>
                          <th className="p-3 font-semibold">Status</th>
                          <th className="p-3 font-semibold">Order ID</th>
                          <th className="p-3 font-semibold">Payment ID</th>
                          <th className="p-3 font-semibold">Verified</th>
                          <th className="p-3 font-semibold">Created</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailLoading ? (
                          <tr><td colSpan={7} className="p-6 text-center text-text-muted">Loading…</td></tr>
                        ) : payments.length === 0 ? (
                          <tr><td colSpan={7} className="p-6 text-center text-text-muted">No payments yet.</td></tr>
                        ) : payments.map(p => (
                          <tr key={p._id} className="border-t border-border-subtle">
                            <td className="p-3">
                              <p className="font-semibold text-text-primary">{p.student?.name || 'Unknown'}</p>
                              <p className="text-text-muted">{p.student?.email}</p>
                            </td>
                            <td className="p-3 text-text-primary font-semibold">{formatRupees(p.amount)}</td>
                            <td className="p-3">
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${payStyle[p.status] || ''}`}>{p.status}</span>
                              {p.failureReason && <p className="text-[10px] text-text-muted mt-0.5 max-w-[180px] truncate" title={p.failureReason}>{p.failureReason}</p>}
                            </td>
                            <td className="p-3 text-text-secondary font-mono">{p.razorpayOrderId || '—'}</td>
                            <td className="p-3 text-text-secondary font-mono">{p.razorpayPaymentId || '—'}</td>
                            <td className="p-3 text-text-secondary">{p.verifiedAt ? `${formatISTDateTime(p.verifiedAt)}${p.verifiedVia ? ` (${p.verifiedVia})` : ''}` : '—'}</td>
                            <td className="p-3 text-text-secondary">{formatISTDateTime(p.createdAt)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
};

export default AdminOlympiad;

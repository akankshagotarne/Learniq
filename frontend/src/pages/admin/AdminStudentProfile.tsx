import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Award, BookOpen, CheckCircle2, CreditCard, Flame, IndianRupee, KeyRound, Mail, Phone, Power, Trash2, Trophy, UserCheck, UserX, Users,
} from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import {
  Badge, BackButton, ConfirmDialog, EmptyState, InfoRow, ProfileError, ProfileSkeleton, Section, Stat, Tabs, Tone, avatarFor, maskEmail,
} from '../../components/admin/ProfileParts';
import { adminProfilesApi } from '../../services/adminProfiles';
import { olympiadErrorMessage } from '../../services/olympiad';
import { AdminProfilePayment, AdminStudentProfile } from '../../types/adminProfile';
import { formatDuration, formatISTDate, formatISTDateTime, formatRupees } from '../../utils/olympiadFormat';
import { COURSES_ENABLED } from '../../constants/features';

type TabId = 'overview' | 'courses' | 'olympiad' | 'payments';
type Pending = 'deactivate' | 'reset' | 'delete' | null;

const PAYMENT_TONE: Record<AdminProfilePayment['status'], Tone> = { completed: 'green', pending: 'amber', failed: 'pink', refunded: 'gray', unconfirmed: 'gray' };
const PAYMENT_LABEL: Record<AdminProfilePayment['status'], string> = { completed: 'Paid', pending: 'Pending', failed: 'Failed', refunded: 'Refunded', unconfirmed: 'Under review' };
const KIND_LABEL: Record<string, string> = { course: 'Course', lecture: 'Lecture', note: 'Notes', olympiad: 'Olympiad' };

const AdminStudentProfilePage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<AdminStudentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('overview');
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current; // ignore a slow response for a student the admin has already left
    setLoading(true); setError(null);
    try {
      const p = await adminProfilesApi.student(id);
      if (ticket === latest.current) setProfile(p);
    } catch (err: any) {
      if (ticket !== latest.current) return;
      setProfile(null);
      setError(err?.response?.status === 404 ? 'This student could not be found.' : olympiadErrorMessage(err, 'Could not load this student.'));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => { setTab('overview'); void load(); }, [load]);

  const back = () => navigate('/admin/students');

  const setActive = async (isActive: boolean) => {
    if (!profile) return;
    setBusy(true);
    try {
      await adminProfilesApi.update(profile.user._id, { isActive });
      setProfile({ ...profile, user: { ...profile.user, isActive } });
      toast.success(isActive ? 'Student activated.' : 'Student deactivated.');
      setPending(null);
    } catch (err: any) {
      toast.error(olympiadErrorMessage(err, 'Failed to update student.'));
    } finally { setBusy(false); }
  };

  const sendReset = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      const r = await adminProfilesApi.sendPasswordReset(profile.user._id);
      toast.success(r.message);
      setPending(null);
    } catch (err: any) {
      toast.error(olympiadErrorMessage(err, 'Could not send the reset email.'));
      setPending(null);
    } finally { setBusy(false); }
  };

  const deleteStudent = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      const r = await adminProfilesApi.deleteStudent(profile.user._id);
      toast.success(r.message || 'Student deleted.');
      setPending(null);
      navigate('/admin/students', { replace: true });
    } catch (err: any) {
      toast.error(olympiadErrorMessage(err, 'Failed to delete student.'));
    } finally { setBusy(false); }
  };

  const u = profile?.user;
  const a = profile?.academic;

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 md:ml-64 pt-14 md:pt-0 transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-6xl mx-auto">
          <BackButton label="Back to students" onClick={back} />

          {loading ? <ProfileSkeleton /> : error || !profile || !u || !a ? (
            <ProfileError message={error || 'Could not load this student.'} onRetry={() => void load()} onBack={back} backLabel="Back to students" />
          ) : (
            <>
              {/* Header */}
              <div className="card-soft p-5 md:p-6 rounded-2xl mb-6">
                <div className="flex flex-col md:flex-row md:items-center gap-5">
                  <img src={avatarFor(u.name, u.avatar)} alt={u.name} className="w-20 h-20 rounded-full object-cover flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h1 className="font-heading font-bold text-2xl text-text-primary break-words">{u.name}</h1>
                      {u.currentStandard != null && <Badge>Std {u.currentStandard}</Badge>}
                      <Badge tone={u.isActive ? 'green' : 'pink'}>{u.isActive ? 'Active' : 'Deactivated'}</Badge>
                    </div>
                    <p className="text-text-secondary text-sm mt-1 flex items-center gap-1.5 flex-wrap"><Mail className="w-3.5 h-3.5" />{u.email}
                      {u.phone && <><span className="text-text-muted">•</span><Phone className="w-3.5 h-3.5" />{u.phone}</>}
                    </p>
                    <p className="text-text-muted text-xs mt-1">Joined {formatISTDate(u.createdAt)}{u.lastLogin ? ` • Last login ${formatISTDateTime(u.lastLogin)}` : ''}</p>
                  </div>
                </div>

                {/* Account actions */}
                <div className="flex flex-wrap gap-2 mt-5 pt-5 border-t border-border-subtle">
                  {u.isActive ? (
                    <button onClick={() => setPending('deactivate')} className="px-3 py-2 rounded-lg text-xs font-medium border bg-[#FFE4EC] text-[#E1447A] border-[#FFE4EC] inline-flex items-center gap-1.5">
                      <UserX className="w-3.5 h-3.5" /> Deactivate
                    </button>
                  ) : (
                    <button onClick={() => void setActive(true)} disabled={busy} className="px-3 py-2 rounded-lg text-xs font-medium border bg-[#DCFCE7] text-[#16A34A] border-[#DCFCE7] inline-flex items-center gap-1.5 disabled:opacity-60">
                      <UserCheck className="w-3.5 h-3.5" /> Activate
                    </button>
                  )}
                  <button onClick={() => setPending('reset')} className="px-3 py-2 rounded-lg text-xs font-medium border border-border-subtle bg-surface text-text-primary hover:bg-surface-alt inline-flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5" /> Send password reset
                  </button>
                  {COURSES_ENABLED && (
                    <button onClick={() => setTab('courses')} className="px-3 py-2 rounded-lg text-xs font-medium border border-border-subtle bg-surface text-text-primary hover:bg-surface-alt inline-flex items-center gap-1.5">
                      <BookOpen className="w-3.5 h-3.5" /> View enrolled courses
                    </button>
                  )}
                  <button onClick={() => setTab('payments')} className="px-3 py-2 rounded-lg text-xs font-medium border border-border-subtle bg-surface text-text-primary hover:bg-surface-alt inline-flex items-center gap-1.5">
                    <CreditCard className="w-3.5 h-3.5" /> View payment history
                  </button>
                  <button onClick={() => setTab('olympiad')} className="px-3 py-2 rounded-lg text-xs font-medium border border-border-subtle bg-surface text-text-primary hover:bg-surface-alt inline-flex items-center gap-1.5">
                    <Trophy className="w-3.5 h-3.5" /> View Olympiad history
                  </button>
                  <button onClick={() => setPending('delete')} className="px-3 py-2 rounded-lg text-xs font-medium border bg-surface text-[#E1447A] border-[#F9C6D7] hover:bg-[#FFE4EC] inline-flex items-center gap-1.5 sm:ml-auto">
                    <Trash2 className="w-3.5 h-3.5" /> Delete student
                  </button>
                </div>
                <p className="text-text-muted text-xs mt-3">Passwords are stored securely and can never be viewed. "Send password reset" emails the student a link to choose a new one.</p>
              </div>

              <Tabs<TabId>
                active={tab} onChange={setTab}
                tabs={[
                  { id: 'overview', label: 'Overview' },
                  { id: 'courses', label: 'Courses', count: profile.courses.length },
                  { id: 'olympiad', label: 'Olympiad', count: profile.olympiad.attempts.length },
                  { id: 'payments', label: 'Payments', count: profile.payments.summary.total },
                ].filter(t => COURSES_ENABLED || t.id !== 'courses') as { id: TabId; label: string; count?: number }[]}
              />

              {tab === 'overview' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Stat label="Points" value={a.points} icon={<Award className="w-4 h-4" />} tone="amber" />
                    <Stat label="Day streak" value={a.streak} icon={<Flame className="w-4 h-4" />} tone="pink" />
                    {COURSES_ENABLED && <Stat label="Courses enrolled" value={a.coursesEnrolled} icon={<BookOpen className="w-4 h-4" />} tone="violet" />}
                    {COURSES_ENABLED && <Stat label="Courses completed" value={a.coursesCompleted} icon={<CheckCircle2 className="w-4 h-4" />} tone="green" />}
                    <Stat label="Olympiad registrations" value={a.olympiadRegistrations} icon={<Users className="w-4 h-4" />} tone="violet" />
                    <Stat label="Olympiad attempts" value={a.olympiadAttempts} icon={<Trophy className="w-4 h-4" />} tone="amber" />
                    <Stat label="Best Olympiad score" value={a.olympiadBestPercentage == null ? '—' : `${a.olympiadBestPercentage}%`} icon={<Trophy className="w-4 h-4" />} tone="green" />
                    <Stat label="Total paid" value={formatRupees(profile.payments.summary.totalPaid)} icon={<IndianRupee className="w-4 h-4" />} tone="green" />
                  </div>
                  <div className="grid md:grid-cols-2 gap-6">
                    <Section title="Personal information">
                      <dl>
                        <InfoRow label="Full name">{u.name}</InfoRow>
                        <InfoRow label="Email">{u.email}</InfoRow>
                        <InfoRow label="Mobile number">{u.phone || '—'}</InfoRow>
                        <InfoRow label="Standard">{u.currentStandard != null ? `Standard ${u.currentStandard}` : '—'}</InfoRow>
                        <InfoRow label="Date joined">{formatISTDate(u.createdAt)}</InfoRow>
                        <InfoRow label="Account status"><Badge tone={u.isActive ? 'green' : 'pink'}>{u.isActive ? 'Active' : 'Deactivated'}</Badge></InfoRow>
                      </dl>
                    </Section>
                    <Section title="Learning summary">
                      <dl>
                        <InfoRow label="Average course progress">{a.averageProgress}%</InfoRow>
                        <InfoRow label="Olympiad exams completed">{a.olympiadCompleted}</InfoRow>
                        <InfoRow label="Last active">{u.lastActiveDate ? formatISTDate(u.lastActiveDate) : '—'}</InfoRow>
                        <InfoRow label="Successful payments">{profile.payments.summary.successful}</InfoRow>
                        <InfoRow label="Pending / failed">{profile.payments.summary.pending} / {profile.payments.summary.failed}</InfoRow>
                      </dl>
                    </Section>
                  </div>
                </div>
              )}

              {COURSES_ENABLED && tab === 'courses' && (
                <Section title="Enrolled courses">
                  {profile.courses.length === 0 ? <EmptyState icon={<BookOpen className="w-10 h-10" />} text="This student has not enrolled in any course yet." /> : (
                    <ul className="divide-y divide-border-subtle">
                      {profile.courses.map(c => (
                        <li key={c._id} className="py-3">
                          <div className="flex items-center justify-between gap-3 flex-wrap">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-text-primary">{c.course?.title || 'Course no longer available'}</p>
                              <p className="text-xs text-text-muted">
                                {[c.course?.subject, c.course?.standard != null ? `Std ${c.course.standard}` : null].filter(Boolean).join(' • ')}
                                {c.course ? ' • ' : ''}Enrolled {formatISTDate(c.enrolledAt)}
                              </p>
                            </div>
                            {c.completed ? <Badge tone="green">Completed</Badge> : <Badge tone="amber">In progress</Badge>}
                          </div>
                          <div className="flex items-center gap-3 mt-2">
                            <div className="progress-bar flex-1" aria-label={`Progress ${c.progress}%`}><div className="progress-fill" style={{ width: `${Math.min(100, Math.max(0, c.progress))}%` }} /></div>
                            <span className="text-xs font-semibold text-text-secondary w-10 text-right">{c.progress}%</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
              )}

              {tab === 'olympiad' && (
                <div className="space-y-6">
                  <Section title="Registrations">
                    {profile.olympiad.registrations.length === 0 ? <EmptyState icon={<Trophy className="w-10 h-10" />} text="No paid Olympiad registration yet." /> : (
                      <ul className="divide-y divide-border-subtle">
                        {profile.olympiad.registrations.map(r => (
                          <li key={r.examId} className="py-3 flex items-center justify-between gap-3 flex-wrap">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-text-primary">{r.examTitle}{r.standard != null ? ` — Std ${r.standard}` : ''}</p>
                              <p className="text-xs text-text-muted">Registered {formatISTDateTime(r.registeredAt)} • Fee paid {formatRupees(r.amount)}</p>
                            </div>
                            <Badge tone={r.attemptStatus === 'COMPLETED' ? 'green' : r.attemptStatus === 'IN_PROGRESS' ? 'amber' : 'gray'}>
                              {r.attemptStatus === 'COMPLETED' ? 'Exam completed' : r.attemptStatus === 'IN_PROGRESS' ? 'Exam in progress' : 'Not started'}
                            </Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Section>
                  <Section title="Attempts & results">
                    {profile.olympiad.attempts.length === 0 ? <EmptyState icon={<Trophy className="w-10 h-10" />} text="No Olympiad attempt yet." /> : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-text-muted border-b border-border-subtle">
                              <th className="py-2 pr-4 font-medium">Exam</th><th className="py-2 pr-4 font-medium">Status</th><th className="py-2 pr-4 font-medium">Score</th>
                              <th className="py-2 pr-4 font-medium">Percentage</th><th className="py-2 pr-4 font-medium">Result</th><th className="py-2 pr-4 font-medium">Grade</th>
                              <th className="py-2 pr-4 font-medium">Time</th><th className="py-2 font-medium">Certificate</th>
                            </tr>
                          </thead>
                          <tbody>
                            {profile.olympiad.attempts.map(at => (
                              <tr key={at._id} className="border-b border-border-subtle last:border-0">
                                <td className="py-3 pr-4 text-text-primary">{at.standard != null ? `Std ${at.standard}` : 'Olympiad'}<span className="block text-xs text-text-muted">{at.submittedAt ? formatISTDate(at.submittedAt) : at.startedAt ? `Started ${formatISTDate(at.startedAt)}` : ''}</span></td>
                                <td className="py-3 pr-4"><Badge tone={at.status === 'COMPLETED' ? 'green' : 'amber'}>{at.status === 'COMPLETED' ? 'Completed' : 'In progress'}</Badge></td>
                                <td className="py-3 pr-4 text-text-primary">{at.score != null ? `${at.score} / ${at.totalMarks}` : '—'}</td>
                                <td className="py-3 pr-4 font-semibold text-text-primary">{at.percentage != null ? `${at.percentage}%` : '—'}</td>
                                <td className="py-3 pr-4">{at.result ? <Badge tone={at.result === 'PASS' ? 'green' : 'pink'}>{at.result}</Badge> : '—'}</td>
                                <td className="py-3 pr-4 text-text-primary">{at.grade || '—'}</td>
                                <td className="py-3 pr-4 text-text-secondary">{at.status === 'COMPLETED' ? formatDuration(at.timeTakenSeconds) : '—'}</td>
                                <td className="py-3 text-xs">
                                  {at.certificate
                                    ? <span className="font-mono text-text-primary">{at.certificate.number}{at.certificate.status === 'REVOKED' && <span className="ml-1 text-[#E1447A]">(revoked)</span>}</span>
                                    : <span className="text-text-muted">{at.result === 'FAIL' ? 'Not available' : '—'}</span>}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Section>
                </div>
              )}

              {tab === 'payments' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Stat label="Total amount paid" value={formatRupees(profile.payments.summary.totalPaid)} icon={<IndianRupee className="w-4 h-4" />} tone="green" />
                    <Stat label="Successful payments" value={profile.payments.summary.successful} icon={<CheckCircle2 className="w-4 h-4" />} tone="green" />
                    <Stat label="Pending payments" value={profile.payments.summary.pending} icon={<Power className="w-4 h-4" />} tone="amber" />
                    <Stat label="Failed payments" value={profile.payments.summary.failed} icon={<UserX className="w-4 h-4" />} tone="pink" />
                  </div>
                  <Section title="Payment history">
                    {profile.payments.items.length === 0 ? <EmptyState icon={<CreditCard className="w-10 h-10" />} text="No payments yet." /> : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs text-text-muted border-b border-border-subtle">
                              <th className="py-2 pr-4 font-medium">Item</th><th className="py-2 pr-4 font-medium">Amount</th><th className="py-2 pr-4 font-medium">Status</th>
                              <th className="py-2 pr-4 font-medium">Date</th><th className="py-2 font-medium">Razorpay reference</th>
                            </tr>
                          </thead>
                          <tbody>
                            {profile.payments.items.map(p => (
                              <tr key={`${p.kind}-${p._id}`} className="border-b border-border-subtle last:border-0">
                                <td className="py-3 pr-4 text-text-primary">{p.title}<span className="block text-xs text-text-muted">{KIND_LABEL[p.kind] || p.kind}</span></td>
                                <td className="py-3 pr-4 font-semibold text-text-primary">{formatRupees(p.amount)}</td>
                                <td className="py-3 pr-4"><Badge tone={PAYMENT_TONE[p.status] || 'gray'}>{PAYMENT_LABEL[p.status] || p.status}</Badge>{p.archived && <span className="block text-xs text-text-muted mt-1">History only</span>}</td>
                                <td className="py-3 pr-4 text-text-secondary whitespace-nowrap">{formatISTDate(p.date)}</td>
                                <td className="py-3 text-xs font-mono text-text-secondary">{p.paymentId || '—'}{p.orderId && <span className="block text-text-muted">{p.orderId}</span>}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <p className="text-xs text-text-muted mt-4">Razorpay references are masked for security. Only verified payments count towards the total paid.</p>
                  </Section>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <ConfirmDialog
        open={pending === 'deactivate'} tone="danger" busy={busy} title="Deactivate this student?" confirmLabel="Deactivate"
        message={<>{u?.name} will not be able to use LearnIQ until you activate the account again. Their data and payments are kept.</>}
        onConfirm={() => void setActive(false)} onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending === 'reset'} busy={busy} title="Send password reset email?" confirmLabel="Send email"
        message={<>A link to choose a new password will be emailed to <b className="text-text-primary">{maskEmail(u?.email)}</b>. The link expires in 15 minutes. The current password is never shown.</>}
        note="Passwords are stored securely and cannot be viewed."
        onConfirm={() => void sendReset()} onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending === 'delete'} tone="danger" busy={busy} title="Delete this student permanently?" confirmLabel="Delete student"
        message={<><b className="text-text-primary">{u?.name}</b> ({u?.email}) and all of their activity — results, certificates, AI interviews and notifications — will be removed. This cannot be undone.</>}
        note="Payment records are kept for accounting and will show the student's name. To pause an account instead, use Deactivate."
        onConfirm={() => void deleteStudent()} onCancel={() => setPending(null)}
      />
    </div>
  );
};

export default AdminStudentProfilePage;

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  BookOpen, ClipboardList, FileText, GraduationCap, KeyRound, Mail, Phone, Radio, ShieldOff, Trophy, UserCheck, UserX, Users, Video,
} from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import {
  Badge, BackButton, ConfirmDialog, EmptyState, InfoRow, ProfileError, ProfileSkeleton, Section, Stat, Tabs, Tone, avatarFor, maskEmail,
} from '../../components/admin/ProfileParts';
import { adminProfilesApi } from '../../services/adminProfiles';
import { olympiadErrorMessage } from '../../services/olympiad';
import { AdminTeacherProfile } from '../../types/adminProfile';
import { formatISTDate, formatISTDateTime, formatRupees } from '../../utils/olympiadFormat';

type TabId = 'overview' | 'courses' | 'activity';
type Pending = 'deactivate' | 'unapprove' | 'reset' | null;

const SESSION_TONE: Record<string, Tone> = { live: 'green', scheduled: 'violet', ended: 'gray', cancelled: 'pink' };

const AdminTeacherProfilePage: React.FC = () => {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<AdminTeacherProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>('overview');
  const [pending, setPending] = useState<Pending>(null);
  const [busy, setBusy] = useState(false);
  const latest = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++latest.current;
    setLoading(true); setError(null);
    try {
      const p = await adminProfilesApi.teacher(id);
      if (ticket === latest.current) setProfile(p);
    } catch (err: any) {
      if (ticket !== latest.current) return;
      setProfile(null);
      setError(err?.response?.status === 404 ? 'This teacher could not be found.' : olympiadErrorMessage(err, 'Could not load this teacher.'));
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }, [id]);

  useEffect(() => { setTab('overview'); void load(); }, [load]);

  const back = () => navigate('/admin/teachers');

  const patch = async (change: { isActive?: boolean; isApproved?: boolean }, success: string) => {
    if (!profile) return;
    setBusy(true);
    try {
      await adminProfilesApi.update(profile.user._id, change);
      setProfile({ ...profile, user: { ...profile.user, ...change } });
      toast.success(success);
      setPending(null);
    } catch (err: any) {
      toast.error(olympiadErrorMessage(err, 'Failed to update teacher.'));
    } finally { setBusy(false); }
  };

  const sendReset = async () => {
    if (!profile) return;
    setBusy(true);
    try {
      toast.success((await adminProfilesApi.sendPasswordReset(profile.user._id)).message);
    } catch (err: any) {
      toast.error(olympiadErrorMessage(err, 'Could not send the reset email.'));
    } finally { setBusy(false); setPending(null); }
  };

  const u = profile?.user;
  const t = profile?.teaching;

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 md:ml-64 pt-14 md:pt-0 transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-6xl mx-auto">
          <BackButton label="Back to teachers" onClick={back} />

          {loading ? <ProfileSkeleton /> : error || !profile || !u || !t ? (
            <ProfileError message={error || 'Could not load this teacher.'} onRetry={() => void load()} onBack={back} backLabel="Back to teachers" />
          ) : (
            <>
              <div className="card-soft p-5 md:p-6 rounded-2xl mb-6">
                <div className="flex flex-col md:flex-row md:items-center gap-5">
                  <img src={avatarFor(u.name, u.avatar)} alt={u.name} className="w-20 h-20 rounded-full object-cover flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h1 className="font-heading font-bold text-2xl text-text-primary break-words">{u.name}</h1>
                      <Badge tone={u.isApproved ? 'green' : 'amber'}>{u.isApproved ? 'Approved' : 'Pending approval'}</Badge>
                      <Badge tone={u.isActive ? 'green' : 'pink'}>{u.isActive ? 'Active' : 'Deactivated'}</Badge>
                    </div>
                    <p className="text-text-secondary text-sm mt-1 flex items-center gap-1.5 flex-wrap"><Mail className="w-3.5 h-3.5" />{u.email}
                      {u.phone && <><span className="text-text-muted">•</span><Phone className="w-3.5 h-3.5" />{u.phone}</>}
                    </p>
                    <p className="text-text-muted text-xs mt-1">
                      Joined {u.createdAt ? formatISTDate(u.createdAt) : '—'}{u.lastLogin ? ` • Last login ${formatISTDateTime(u.lastLogin)}` : ''}
                    </p>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mt-5 pt-5 border-t border-border-subtle">
                  {!u.isApproved ? (
                    <button onClick={() => void patch({ isApproved: true }, 'Teacher approved!')} disabled={busy} className="px-3 py-2 rounded-lg text-xs font-medium border bg-[#DCFCE7] text-[#16A34A] border-[#DCFCE7] inline-flex items-center gap-1.5 disabled:opacity-60">
                      <UserCheck className="w-3.5 h-3.5" /> Approve teacher
                    </button>
                  ) : (
                    <button onClick={() => setPending('unapprove')} className="px-3 py-2 rounded-lg text-xs font-medium border bg-[#FEF3C7] text-[#D97706] border-[#FEF3C7] inline-flex items-center gap-1.5">
                      <ShieldOff className="w-3.5 h-3.5" /> Revoke approval
                    </button>
                  )}
                  {u.isActive ? (
                    <button onClick={() => setPending('deactivate')} className="px-3 py-2 rounded-lg text-xs font-medium border bg-[#FFE4EC] text-[#E1447A] border-[#FFE4EC] inline-flex items-center gap-1.5">
                      <UserX className="w-3.5 h-3.5" /> Deactivate
                    </button>
                  ) : (
                    <button onClick={() => void patch({ isActive: true }, 'Teacher activated.')} disabled={busy} className="px-3 py-2 rounded-lg text-xs font-medium border bg-[#DCFCE7] text-[#16A34A] border-[#DCFCE7] inline-flex items-center gap-1.5 disabled:opacity-60">
                      <UserCheck className="w-3.5 h-3.5" /> Activate
                    </button>
                  )}
                  <button onClick={() => setPending('reset')} className="px-3 py-2 rounded-lg text-xs font-medium border border-border-subtle bg-surface text-text-primary hover:bg-surface-alt inline-flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5" /> Send password reset
                  </button>
                </div>
                <p className="text-text-muted text-xs mt-3">Passwords are stored securely and can never be viewed. "Send password reset" emails the teacher a link to choose a new one.</p>
              </div>

              <Tabs<TabId>
                active={tab} onChange={setTab}
                tabs={[{ id: 'overview', label: 'Overview' }, { id: 'courses', label: 'Courses', count: profile.courseList.length }, { id: 'activity', label: 'Activity' }]}
              />

              {tab === 'overview' && (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <Stat label="Courses created" value={t.courses.total} icon={<BookOpen className="w-4 h-4" />} tone="violet" />
                    <Stat label="Active courses" value={t.courses.active} icon={<UserCheck className="w-4 h-4" />} tone="green" />
                    <Stat label="Archived courses" value={t.courses.archived} icon={<ShieldOff className="w-4 h-4" />} tone="amber" />
                    <Stat label="Students" value={t.students} icon={<Users className="w-4 h-4" />} tone="violet" />
                    <Stat label="Lectures uploaded" value={t.lectures} icon={<Video className="w-4 h-4" />} tone="pink" />
                    <Stat label="Live sessions" value={t.liveSessions} icon={<Radio className="w-4 h-4" />} tone="green" />
                    <Stat label="Exams (published / draft)" value={`${t.exams.published} / ${t.exams.drafts}`} icon={<Trophy className="w-4 h-4" />} tone="amber" />
                    <Stat label="Quizzes / Assignments" value={`${t.quizzes} / ${t.assignments}`} icon={<ClipboardList className="w-4 h-4" />} tone="violet" />
                  </div>
                  <div className="grid md:grid-cols-2 gap-6">
                    <Section title="Personal information">
                      <dl>
                        <InfoRow label="Full name">{u.name}</InfoRow>
                        <InfoRow label="Email">{u.email}</InfoRow>
                        <InfoRow label="Mobile number">{u.phone || '—'}</InfoRow>
                        <InfoRow label="Date joined">{u.createdAt ? formatISTDate(u.createdAt) : '—'}</InfoRow>
                        <InfoRow label="Account status"><Badge tone={u.isActive ? 'green' : 'pink'}>{u.isActive ? 'Active' : 'Deactivated'}</Badge></InfoRow>
                        <InfoRow label="Approval status"><Badge tone={u.isApproved ? 'green' : 'amber'}>{u.isApproved ? 'Approved' : 'Pending'}</Badge></InfoRow>
                      </dl>
                    </Section>
                    <Section title="Teaching profile" icon={<GraduationCap className="w-4 h-4 text-brand-primary" />}>
                      <dl>
                        <InfoRow label="Subjects">{u.subjects.length ? u.subjects.join(', ') : '—'}</InfoRow>
                        <InfoRow label="Standards">{u.standards.length ? u.standards.map(s => `Std ${s}`).join(', ') : '—'}</InfoRow>
                        <InfoRow label="Qualification">{u.qualification || '—'}</InfoRow>
                        <InfoRow label="Experience">{u.experience || '—'}</InfoRow>
                        <InfoRow label="Notes uploaded">{t.notes}</InfoRow>
                      </dl>
                      {u.bio && <p className="text-sm text-text-secondary mt-3 whitespace-pre-line">{u.bio}</p>}
                    </Section>
                  </div>
                </div>
              )}

              {tab === 'courses' && (
                <Section title="Courses created">
                  {profile.courseList.length === 0 ? <EmptyState icon={<BookOpen className="w-10 h-10" />} text="This teacher has not created any course yet." /> : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-xs text-text-muted border-b border-border-subtle">
                            <th className="py-2 pr-4 font-medium">Course</th><th className="py-2 pr-4 font-medium">Status</th><th className="py-2 pr-4 font-medium">Students</th>
                            <th className="py-2 pr-4 font-medium">Lectures</th><th className="py-2 pr-4 font-medium">Price</th><th className="py-2 font-medium">Created</th>
                          </tr>
                        </thead>
                        <tbody>
                          {profile.courseList.map(c => (
                            <tr key={c._id} className="border-b border-border-subtle last:border-0">
                              <td className="py-3 pr-4 text-text-primary">{c.title}<span className="block text-xs text-text-muted">{[c.subject, c.standard != null ? `Std ${c.standard}` : null].filter(Boolean).join(' • ')}</span></td>
                              <td className="py-3 pr-4"><Badge tone={c.active ? 'green' : 'gray'}>{c.active ? 'Active' : 'Archived'}</Badge>{c.flagged && <span className="ml-1"><Badge tone="pink">Flagged</Badge></span>}</td>
                              <td className="py-3 pr-4 text-text-primary">{c.students}</td>
                              <td className="py-3 pr-4 text-text-primary">{c.lectures}</td>
                              <td className="py-3 pr-4 text-text-primary">{c.isFree ? 'Free' : formatRupees(c.price)}</td>
                              <td className="py-3 text-text-secondary whitespace-nowrap">{c.createdAt ? formatISTDate(c.createdAt) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Section>
              )}

              {tab === 'activity' && (
                <div className="grid md:grid-cols-2 gap-6">
                  <Section title="Account activity">
                    <dl>
                      <InfoRow label="Last login">{profile.activity.lastLogin ? formatISTDateTime(profile.activity.lastLogin) : 'No login recorded'}</InfoRow>
                      <InfoRow label="Date joined">{profile.activity.joinedAt ? formatISTDate(profile.activity.joinedAt) : '—'}</InfoRow>
                      <InfoRow label="Approval date">{profile.activity.approvedAt ? formatISTDate(profile.activity.approvedAt) : 'Not recorded'}</InfoRow>
                      <InfoRow label="Last course created">{profile.activity.lastCourseCreatedAt ? formatISTDate(profile.activity.lastCourseCreatedAt) : '—'}</InfoRow>
                      <InfoRow label="Exams created">{t.exams.total}</InfoRow>
                    </dl>
                  </Section>
                  <Section title="Recent live sessions" icon={<FileText className="w-4 h-4 text-brand-primary" />}>
                    {profile.recentLiveSessions.length === 0 ? <EmptyState icon={<Radio className="w-10 h-10" />} text="No live sessions yet." /> : (
                      <ul className="divide-y divide-border-subtle">
                        {profile.recentLiveSessions.map(s => (
                          <li key={s._id} className="py-3 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-text-primary truncate">{s.title}</p>
                              <p className="text-xs text-text-muted">{[s.subject, s.standard != null ? `Std ${s.standard}` : null].filter(Boolean).join(' • ')}{s.scheduledAt ? ` • ${formatISTDateTime(s.scheduledAt)}` : ''}</p>
                            </div>
                            <Badge tone={SESSION_TONE[s.status] || 'gray'}>{s.status}</Badge>
                          </li>
                        ))}
                      </ul>
                    )}
                  </Section>
                </div>
              )}
            </>
          )}
        </div>
      </main>

      <ConfirmDialog
        open={pending === 'deactivate'} tone="danger" busy={busy} title="Deactivate this teacher?" confirmLabel="Deactivate"
        message={<>{u?.name} will not be able to log in until you activate the account again. Their courses and lectures are kept.</>}
        onConfirm={() => void patch({ isActive: false }, 'Teacher deactivated.')} onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending === 'unapprove'} tone="danger" busy={busy} title="Revoke this teacher's approval?" confirmLabel="Revoke approval"
        message={<>{u?.name} will lose access to teacher tools until you approve the account again. Their courses are kept.</>}
        onConfirm={() => void patch({ isApproved: false }, 'Approval revoked.')} onCancel={() => setPending(null)}
      />
      <ConfirmDialog
        open={pending === 'reset'} busy={busy} title="Send password reset email?" confirmLabel="Send email"
        message={<>A link to choose a new password will be emailed to <b className="text-text-primary">{maskEmail(u?.email)}</b>. The link expires in 15 minutes. The current password is never shown.</>}
        note="Passwords are stored securely and cannot be viewed."
        onConfirm={() => void sendReset()} onCancel={() => setPending(null)}
      />
    </div>
  );
};

export default AdminTeacherProfilePage;

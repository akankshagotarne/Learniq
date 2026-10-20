import React, { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
import { ArrowLeft, Eye, HelpCircle, Loader, Lock, RefreshCw, ScrollText, Settings, Shield, Square, Unlock, Users, WifiOff } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { useAdminConsole } from '../../features/live/useAdminConsole';
import { ParticipantsPanel } from '../../features/live/ParticipantsPanel';
import { HostMcqPanel } from '../../features/live/HostMcqPanel';
import { MeetingSettingsPanel, summarize } from '../../features/live/MeetingSettings';

type Tab = 'people' | 'question' | 'settings' | 'audit';
interface AuditRow { id: string; at: string; action: string; actorName: string; actorRole: string; targetName: string | null; outcome: string; reason: string | null }

const ACTION_LABEL: Record<string, string> = {
  CONSOLE_JOIN: 'Opened the console', CONSOLE_LEAVE: 'Left the console', MCQ_LAUNCH: 'Launched a question', MCQ_CLOSE: 'Closed the question',
  PARTICIPANT_MUTE: 'Muted a participant', PARTICIPANT_PERMISSIONS: 'Changed a permission', PARTICIPANT_REMOVE: 'Removed a participant',
  ADMISSION_LOCK: 'Locked admission', ADMISSION_UNLOCK: 'Unlocked admission', SETTINGS_CHANGE: 'Changed meeting settings', MODE_CHANGE: 'Changed the visibility mode',
  SELECT_STUDENTS: 'Changed selected students', SPOTLIGHT: 'Changed the spotlight', MEETING_END: 'Ended the meeting', WAITING_APPROVE: 'Admitted a waiting student',
  WAITING_DENY: 'Declined a waiting student', MEETING_MARKED_ENDED: 'Closed a stale class', UNAUTHORIZED_ATTEMPT: 'Blocked: not authorised',
};

const AuditTrail: React.FC<{ code: string; refreshKey: number }> = ({ code, refreshKey }) => {
  const [rows, setRows] = useState<AuditRow[] | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    api.get(`/admin/live-classes/${encodeURIComponent(code)}/audit`, { params: { limit: 100 } })
      .then((r) => { if (live) { setRows(r.data.entries || []); setErr(''); } })
      .catch(() => { if (live) setErr('The activity log could not be loaded.'); });
    return () => { live = false; };
  }, [code, refreshKey]);
  if (err) return <p role="alert" className="text-sm text-rose-600 p-4">{err}</p>;
  if (!rows) return <p className="text-sm text-text-muted p-4 flex items-center gap-2"><Loader className="w-4 h-4 animate-spin" />Loading activity…</p>;
  if (!rows.length) return <p className="text-sm text-text-muted p-4">No administrative actions recorded yet.</p>;
  return (
    <ol className="divide-y divide-border-subtle" data-testid="audit-trail">
      {rows.map((r) => (
        <li key={r.id} className="px-4 py-2.5 text-sm">
          <div className="flex items-center justify-between gap-2"><span className="font-medium text-text-primary">{ACTION_LABEL[r.action] || r.action}{r.targetName ? ` — ${r.targetName}` : ''}</span>
            <span className={`text-[11px] font-semibold rounded-full px-2 py-0.5 ${r.outcome === 'SUCCESS' ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>{r.outcome === 'SUCCESS' ? 'Done' : r.outcome === 'REJECTED' ? 'Refused' : 'Failed'}</span></div>
          <p className="text-xs text-text-muted">{r.actorName} ({r.actorRole}) · {new Date(r.at).toLocaleString('en-IN')}{r.reason ? ` · ${r.reason}` : ''}</p>
        </li>
      ))}
    </ol>
  );
};

/**
 * Administrative Moderation Console. The administrator oversees the class WITHOUT joining it: no tile, no camera/microphone, no
 * attendance entry, and no recording. Every action is confirmed by the server and written to the append-only audit trail.
 */
const AdminLiveConsole: React.FC = () => {
  const { code = '' } = useParams<{ code: string }>();
  const c = useAdminConsole(code);
  const [tab, setTab] = useState<Tab>('people');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [auditKey, setAuditKey] = useState(0);
  const notify = useCallback((m: string, error?: boolean) => { (error ? toast.error : toast.success)(m); setAuditKey((k) => k + 1); }, []);

  const end = async () => {
    setEnding(true);
    const r = await c.endMeeting();
    setEnding(false); setConfirmEnd(false);
    if (r.ok) notify('The class was ended for everyone.'); else notify(r.message || 'The class could not be ended.', true);
  };
  const lockToggle = async () => { const r = await c.manager.lock(!c.counts.locked); notify(r.ok ? (c.counts.locked ? 'Admission unlocked.' : 'Admission locked - no one new can join.') : (r.message || 'Not changed.'), !r.ok); };

  const shell = (inner: React.ReactNode) => (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 transition-all duration-300">
        <div className="p-3 sm:p-6 lg:p-8 max-w-6xl mx-auto" data-testid="admin-console">{inner}</div>
      </main>
    </div>
  );
  const back = <Link to="/admin/live" className="inline-flex items-center gap-1.5 text-sm text-brand-primary font-medium min-h-[44px]"><ArrowLeft className="w-4 h-4" />All live classes</Link>;

  if (c.status === 'connecting') return shell(<div className="py-24 text-center text-text-secondary" role="status"><Loader className="w-8 h-8 animate-spin mx-auto mb-3" />Opening the moderation console…</div>);
  if (c.status === 'not-active' || c.status === 'error') {
    return shell(<div className="card-soft p-8 text-center max-w-md mx-auto mt-10" data-testid="console-unavailable">
      <Shield className="w-10 h-10 text-text-muted mx-auto mb-3" /><p className="font-semibold text-text-primary mb-1">{c.status === 'not-active' ? 'This class is not running' : 'The console could not be opened'}</p>
      <p className="text-sm text-text-secondary mb-4">{c.message}</p>
      <div className="flex gap-2 justify-center">{c.status === 'error' && <button className="btn-primary min-h-[44px]" onClick={c.retry}>Try again</button>}{back}</div></div>);
  }
  if (c.status === 'ended') {
    return shell(<div className="card-soft p-8 text-center max-w-md mx-auto mt-10" data-testid="console-ended"><Square className="w-10 h-10 text-text-muted mx-auto mb-3" /><p className="font-semibold text-text-primary mb-1">This class has ended</p><p className="text-sm text-text-secondary mb-4">{c.message}</p>
      <button className="btn-outline min-h-[44px] mb-2" onClick={() => setTab('audit')}>Review the activity log</button><div>{back}</div>
      {tab === 'audit' && <div className="mt-4 text-left border-t border-border-subtle"><AuditTrail code={code} refreshKey={auditKey} /></div>}</div>);
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'people', label: `People (${c.participants.filter((p) => !p.isHost).length})`, icon: <Users className="w-4 h-4" /> },
    { id: 'question', label: 'Live question', icon: <HelpCircle className="w-4 h-4" /> },
    { id: 'settings', label: 'Visibility', icon: <Settings className="w-4 h-4" /> },
    { id: 'audit', label: 'Activity log', icon: <ScrollText className="w-4 h-4" /> },
  ];

  return shell(
    <>
      {back}
      {!c.online && <div role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-amber-100 text-amber-900 text-sm px-3 py-2" data-testid="console-offline"><WifiOff className="w-4 h-4" />Connection lost - reconnecting. Actions are paused until it returns.</div>}
      {c.stale && <div role="status" className="mb-3 rounded-xl bg-amber-100 text-amber-900 text-sm px-3 py-2" data-testid="console-stale">Nobody is in this class right now. If the teacher is not coming back, you can end it below.</div>}
      <div className="card-soft p-4 mb-4">
        <div className="flex flex-wrap items-start gap-3 justify-between">
          <div className="min-w-0"><p className="text-brand-primary text-xs font-semibold tracking-wide uppercase">Moderation console</p>
            <h1 className="font-heading font-bold text-xl text-text-primary break-words">{c.title || code}</h1>
            <p className="text-xs text-text-secondary mt-1 flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" />You are overseeing this class without joining it. You do not appear to participants and nothing is recorded from the class.</p>
            <p className="text-xs text-text-muted mt-1">{c.counts.hostPresent ? 'Teacher is in the class' : 'Teacher is not in the class'} · {c.counts.students} student{c.counts.students === 1 ? '' : 's'} · {c.counts.waiting} waiting · {summarize(c.config)}</p></div>
          <div className="flex flex-wrap gap-2">
            <button onClick={lockToggle} disabled={!c.online} className="btn-outline min-h-[44px] text-sm inline-flex items-center gap-1.5" data-testid="lock-toggle">{c.counts.locked ? <><Unlock className="w-4 h-4" />Unlock admission</> : <><Lock className="w-4 h-4" />Lock admission</>}</button>
            <button onClick={async () => { const r = await c.refresh(); notify(r.ok ? 'Refreshed.' : (r.message || 'Could not refresh.'), !r.ok); }} className="btn-outline min-h-[44px] w-11 inline-flex items-center justify-center" aria-label="Refresh"><RefreshCw className="w-4 h-4" /></button>
            {confirmEnd
              ? <span className="inline-flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 px-3 min-h-[44px] text-sm text-rose-700">End for everyone?
                <button className="font-bold underline" onClick={end} disabled={ending} data-testid="console-confirm-end">{ending ? 'Ending…' : 'End'}</button><button className="underline" onClick={() => setConfirmEnd(false)}>Cancel</button></span>
              : <button onClick={() => setConfirmEnd(true)} disabled={!c.online} className="min-h-[44px] px-4 rounded-xl bg-rose-50 text-rose-600 border border-rose-200 text-sm font-medium inline-flex items-center gap-1.5" data-testid="console-end"><Square className="w-4 h-4" />End class</button>}
          </div>
        </div>
      </div>

      <div role="tablist" className="flex gap-1 overflow-x-auto mb-3 -mx-1 px-1">
        {TABS.map((t) => <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => { setTab(t.id); if (t.id === 'audit') setAuditKey((k) => k + 1); }}
          className={`flex-shrink-0 min-h-[44px] px-3 rounded-xl text-sm font-medium inline-flex items-center gap-1.5 border ${tab === t.id ? 'bg-brand-primary text-white border-brand-primary' : 'bg-surface text-text-secondary border-border-subtle'}`}>{t.icon}{t.label}</button>)}
      </div>

      <div className="card-soft overflow-hidden" role="tabpanel">
        {tab === 'people' && (
          <div className="max-h-[70dvh] flex flex-col">
            <ParticipantsPanel participants={c.participants} config={c.config} manager={c.manager} waiting={c.waiting} locked={c.counts.locked} embedded onNotify={notify} />
          </div>
        )}
        {tab === 'question' && (
          <div className="p-3 sm:p-4"><HostMcqPanel mcq={c.mcq} host={c.hostMcq} onLaunch={c.launchMcq} onClose={c.closeMcq} onDismiss={() => setTab('people')} /></div>
        )}
        {tab === 'settings' && (
          <div className="p-3 sm:p-4 space-y-3">
            <p className="text-sm text-text-secondary">Current: <b>{summarize(c.config)}</b>. Changes apply to everyone in the class at once and are recorded in the activity log.</p>
            <button className="btn-primary min-h-[48px]" onClick={() => setSettingsOpen(true)} data-testid="open-visibility">Change visibility &amp; meeting rules</button>
          </div>
        )}
        {tab === 'audit' && <AuditTrail code={code} refreshKey={auditKey} />}
      </div>

      {settingsOpen && (
        <MeetingSettingsPanel config={c.config} onApply={async (patch, v) => { const r = await c.updateConfig(patch, v); setAuditKey((k) => k + 1); return r as any; }}
          onRevert={async () => (await c.revertConfig()) as any} onClose={() => setSettingsOpen(false)} />
      )}
    </>,
  );
};

export default AdminLiveConsole;

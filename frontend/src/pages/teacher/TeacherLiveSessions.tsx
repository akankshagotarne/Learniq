import React, { useEffect, useState } from 'react';
import { MeetingSettingsForm, summarize } from '../../features/live/MeetingSettings';
import { DEFAULT_CONFIG, type MeetingConfig } from '../../features/live/types';
import { DEFAULT_AUDIENCE, audienceLabel, clone, validateAudience } from '../../features/live/audience';
import { Link } from 'react-router-dom';
import { Radio, Plus, Copy, CheckCircle, Play, Square, Clock, Users, Link2 } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { LiveSession } from '../../types';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import { ALL_SUBJECTS } from '../../constants/olympiadSubjects';

/** the server owns selection / spotlight / presenters / version; only the host's chosen settings are sent */
const stripServerFields = (c: MeetingConfig) => { const { selectedUserIds, presenterUserIds, spotlightUserId, locked, configVersion, info, audienceLegacy, audienceSummary, ...rest } = c as any; return rest; };
const NEW_CONFIG = (): MeetingConfig => ({ ...DEFAULT_CONFIG, audience: clone(DEFAULT_AUDIENCE) });

const TeacherLiveSessions: React.FC = () => {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [meetingCfg, setMeetingCfg] = useState<MeetingConfig>(NEW_CONFIG);
  const [invited, setInvited] = useState<LiveSession[]>([]);
  const [editing, setEditing] = useState<{ id: string; title: string; cfg: MeetingConfig } | null>(null);
  const [savingCfg, setSavingCfg] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', subject: 'Mathematics', standard: '10', scheduledAt: '' });

  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    setLoading(true);
    try {
      const res = await api.get('/teacher/live-sessions');
      setSessions(res.data.sessions || []);
      setInvited(res.data.invitedSessions || []);
    } catch {}
    setLoading(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const problem = validateAudience(meetingCfg.audience);
    if (problem) { toast.error(problem); return; }
    setCreating(true);
    try {
      const res = await api.post('/live-sessions', {
        ...form,
        standard: parseInt(form.standard),
        scheduledAt: form.scheduledAt || new Date().toISOString(),
        meetingConfig: stripServerFields(meetingCfg),
      });
      toast.success('Live session created!');
      setSessions(prev => [res.data.session, ...prev]);
      setShowCreate(false);
      setForm({ title: '', description: '', subject: 'Mathematics', standard: '10', scheduledAt: '' });
      setMeetingCfg(NEW_CONFIG());
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to create session');
    } finally {
      setCreating(false);
    }
  };

  const saveCfg = async () => {
    if (!editing) return;
    const problem = validateAudience(editing.cfg.audience);
    if (problem) { toast.error(problem); return; }
    setSavingCfg(true);
    try {
      const res = await api.put(`/teacher/live-sessions/${editing.id}/meeting-config`, { meetingConfig: stripServerFields(editing.cfg) });
      setSessions(prev => prev.map(x => x._id === editing.id ? ({ ...x, meetingConfig: res.data.meetingConfig } as any) : x));
      toast.success('Meeting settings saved.');
      setEditing(null);
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Settings were not saved.');
    } finally { setSavingCfg(false); }
  };

  const handleStart = async (id: string) => {
    try {
      await api.post(`/teacher/live-sessions/${id}/start`);
      setSessions(prev => prev.map(s => s._id === id ? { ...s, status: 'live', startedAt: new Date().toISOString() } : s));
      toast.success('Session is now LIVE!');
    } catch { toast.error('Failed to start session'); }
  };

  const handleEnd = async (id: string) => {
    try {
      await api.post(`/teacher/live-sessions/${id}/end`);
      setSessions(prev => prev.map(s => s._id === id ? { ...s, status: 'ended' } : s));
      toast('Session ended.', { icon: '📚' });
    } catch { toast.error('Failed to end session'); }
  };

  const copyLink = (session: LiveSession) => {
    const link = session.joinUrl || `${window.location.origin}/live/${session.sessionCode}`;
    navigator.clipboard.writeText(link);
    toast.success('Session link copied!');
  };

  const subjects = ALL_SUBJECTS;

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 min-w-0 ml-0 lg:ml-[var(--sidebar-w,16rem)] pt-14 lg:pt-0 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
            <div>
              <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">Live Sessions</h1>
              <p className="text-text-secondary text-sm mt-1">Create and manage your live teaching sessions</p>
            </div>
            <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> Create Session
            </button>
          </div>

          {/* Create Modal */}
          {showCreate && (
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div role="dialog" aria-modal="true" aria-label="Create live session" className="bg-surface border border-border-subtle rounded-2xl shadow-xl p-5 sm:p-6 w-full max-w-md sm:max-w-lg max-h-[calc(100dvh-2rem)] overflow-y-auto animate-slide-up">
                <h2 className="text-text-primary font-bold text-xl mb-5 font-heading">Create Live Session</h2>
                <form onSubmit={handleCreate} className="space-y-4">
                  <div>
                    <label className="input-label">Session Title</label>
                    <input type="text" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                      placeholder="e.g., Trigonometry Masterclass" className="input-field" required />
                  </div>
                  <div>
                    <label className="input-label">Description</label>
                    <textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))}
                      placeholder="What will you teach?" className="input-field" rows={3} />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="input-label">Standard</label>
                      <select value={form.standard} onChange={e => setForm(p => ({ ...p, standard: e.target.value }))} className="input-field">
                        {Array.from({ length: 10 }, (_, i) => <option key={i+1} value={i+1}>Standard {i+1}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="input-label">Subject</label>
                      <select value={form.subject} onChange={e => setForm(p => ({ ...p, subject: e.target.value }))} className="input-field">
                        {subjects.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="input-label">Schedule Date & Time (optional)</label>
                    <input type="datetime-local" value={form.scheduledAt} onChange={e => setForm(p => ({ ...p, scheduledAt: e.target.value }))} className="input-field" />
                  </div>
                  <fieldset className="border border-border-subtle rounded-xl p-3" data-testid="meeting-setup">
                    <legend className="px-1 text-sm font-semibold text-text-primary">Meeting setup &amp; participant visibility</legend>
                    <MeetingSettingsForm value={meetingCfg} onChange={patch => setMeetingCfg(c => ({ ...c, ...patch }))} idPrefix="create" />
                    <p className="text-xs text-text-muted mt-2">{summarize(meetingCfg)}. You can change this later, even during the class.</p>
                  </fieldset>
                  <div className="flex gap-3 pt-2">
                    <button type="submit" disabled={creating || !!validateAudience(meetingCfg.audience)} className="btn-primary flex-1">
                      {creating ? 'Creating...' : 'Create Session'}
                    </button>
                    <button type="button" onClick={() => setShowCreate(false)} className="btn-outline flex-1">Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {editing && (
            <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center sm:p-4">
              <div role="dialog" aria-modal="true" aria-label="Meeting settings" className="bg-surface border border-border-subtle rounded-t-3xl sm:rounded-2xl shadow-xl p-5 w-full max-w-lg max-h-[100dvh] sm:max-h-[90dvh] overflow-y-auto pb-[max(1.25rem,env(safe-area-inset-bottom))]">
                <h2 className="text-text-primary font-bold text-lg mb-1 font-heading">Meeting settings</h2>
                <p className="text-text-secondary text-xs mb-4 truncate">{editing.title}</p>
                <MeetingSettingsForm value={editing.cfg} onChange={patch => setEditing(e => e && ({ ...e, cfg: { ...e.cfg, ...patch } }))} idPrefix="edit" />
                <div className="flex gap-3 pt-4">
                  <button onClick={saveCfg} disabled={savingCfg || !!validateAudience(editing.cfg.audience)} className="btn-primary flex-1 min-h-[48px]">{savingCfg ? 'Saving...' : 'Save settings'}</button>
                  <button onClick={() => setEditing(null)} className="btn-outline flex-1 min-h-[48px]">Cancel</button>
                </div>
              </div>
            </div>
          )}

          {invited.length > 0 && (
            <section className="mb-8" aria-label="Classes you are invited to" data-testid="invited-sessions">
              <h2 className="font-heading font-semibold text-text-primary mb-3">Invited as a participant</h2>
              <div className="space-y-3">
                {invited.map(s => (
                  <div key={s._id} className="card-soft p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-text-primary break-words">{s.title} {s.status === 'live' && <span className="badge-live ml-1">LIVE</span>}</p>
                      <p className="text-xs text-text-muted">Hosted by {(s.teacher as any)?.name || 'another teacher'} · {s.subject}{s.scheduledAt ? ` · ${new Date(s.scheduledAt).toLocaleString('en-IN')}` : ''}</p>
                      <p className="text-xs text-text-secondary mt-0.5">You join as an attendee; the host controls the class.</p>
                    </div>
                    {s.status === 'live' ? <Link to={`/live/${s.sessionCode}`} className="btn-primary text-sm py-2 px-4 min-h-[44px] inline-flex items-center justify-center gap-1.5"><Radio className="w-4 h-4" /> Join</Link> : <span className="text-xs text-text-muted">Not started yet</span>}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Sessions List */}
          {loading ? (
            <div className="space-y-4">
              {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-32 rounded-card" />)}
            </div>
          ) : sessions.length === 0 ? (
            <div className="card-soft p-16 text-center">
              <Radio className="w-16 h-16 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary mb-4">No live sessions yet. Create your first one!</p>
              <button onClick={() => setShowCreate(true)} className="btn-primary">Create Session</button>
            </div>
          ) : (
            <div className="space-y-4">
              {sessions.map(session => (
                <div key={session._id} className="card-soft p-4 sm:p-5">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <h3 className="text-text-primary font-semibold text-base font-heading break-words min-w-0">{session.title}</h3>
                        {session.status === 'live' ? (
                          <span className="badge-live">LIVE</span>
                        ) : session.status === 'scheduled' ? (
                          <span className="badge-subject-live text-xs">Scheduled</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-surface-alt text-text-muted">Ended</span>
                        )}
                      </div>
                      <p className="text-text-secondary text-sm mb-3">{session.description}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-text-muted">
                        <span className="font-medium text-text-secondary">{session.subject} • Std {session.standard}</span>
                        {session.scheduledAt && <span><Clock className="w-3.5 h-3.5 inline mr-1 text-text-muted" />{new Date(session.scheduledAt).toLocaleString('en-IN')}</span>}
                        <span><Users className="w-3.5 h-3.5 inline mr-1 text-text-muted" />{(session as any).totalParticipants || 0} participants</span>
                        <span data-testid="audience-label" className="font-medium text-brand-primary">For: {audienceLabel((session as any).meetingConfig?.audience)}</span>
                      </div>

                      {/* Join URL */}
                      <div className="mt-3 flex items-center gap-2 p-2.5 bg-surface-alt border border-border-subtle rounded-xl">
                        <Link2 className="w-4 h-4 text-brand-primary flex-shrink-0" />
                        <span className="text-brand-primary text-xs font-mono truncate font-medium">
                          {session.joinUrl || `${window.location.origin}/live/${session.sessionCode}`}
                        </span>
                        <button onClick={() => copyLink(session)} aria-label="Copy join link"
                          className="flex-shrink-0 w-9 h-9 inline-flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary transition-colors">
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap md:flex-col gap-2 md:flex-shrink-0">
                      {session.status === 'scheduled' && (
                        <button onClick={() => setEditing({ id: session._id, title: session.title, cfg: { ...DEFAULT_CONFIG, ...((session as any).meetingConfig || {}) } })}
                          className="btn-outline text-sm py-2 px-4 min-h-[44px]" data-testid="edit-meeting-settings">Meeting settings</button>
                      )}
                      {session.status === 'scheduled' && (
                        <button onClick={() => handleStart(session._id)}
                          className="btn-primary text-sm py-2 px-4 flex items-center gap-1.5">
                          <Play className="w-4 h-4" /> Go Live
                        </button>
                      )}
                      {session.status === 'live' && (
                        <>
                          <Link to={`/live/${session.sessionCode}`}
                            className="btn-primary text-sm py-2 px-4 flex items-center gap-1.5">
                            <Radio className="w-4 h-4" /> Join Session
                          </Link>
                          <button onClick={() => handleEnd(session._id)}
                            className="px-4 py-2 bg-[#FFE4EC] text-[#E1447A] border border-[#FFE4EC] hover:bg-[#FFE4EC]/80 font-medium text-sm rounded-xl transition-all flex items-center gap-1.5">
                            <Square className="w-4 h-4" /> End Session
                          </button>
                        </>
                      )}
                      <button onClick={() => copyLink(session)}
                        className="btn-outline text-sm py-2 px-4 flex items-center gap-1.5">
                        <Copy className="w-4 h-4" /> Copy Link
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default TeacherLiveSessions;

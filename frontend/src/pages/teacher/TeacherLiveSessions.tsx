import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radio, Plus, Copy, CheckCircle, Play, Square, Clock, Users, Link2 } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { LiveSession } from '../../types';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';
import { ALL_SUBJECTS } from '../../constants/olympiadSubjects';

const TeacherLiveSessions: React.FC = () => {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ title: '', description: '', subject: 'Mathematics', standard: '10', scheduledAt: '' });

  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    setLoading(true);
    try {
      const res = await api.get('/teacher/live-sessions');
      setSessions(res.data.sessions || []);
    } catch {}
    setLoading(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await api.post('/live-sessions', {
        ...form,
        standard: parseInt(form.standard),
        scheduledAt: form.scheduledAt || new Date().toISOString(),
      });
      toast.success('Live session created!');
      setSessions(prev => [res.data.session, ...prev]);
      setShowCreate(false);
      setForm({ title: '', description: '', subject: 'Mathematics', standard: '10', scheduledAt: '' });
    } catch (e: any) {
      toast.error(e.response?.data?.message || 'Failed to create session');
    } finally {
      setCreating(false);
    }
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
      <main className="flex-1 ml-0 md:ml-64 pt-14 md:pt-0 transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
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
              <div className="bg-surface border border-border-subtle rounded-2xl shadow-xl p-6 w-full max-w-md animate-slide-up">
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
                  <div className="flex gap-3 pt-2">
                    <button type="submit" disabled={creating} className="btn-primary flex-1">
                      {creating ? 'Creating...' : 'Create Session'}
                    </button>
                    <button type="button" onClick={() => setShowCreate(false)} className="btn-outline flex-1">Cancel</button>
                  </div>
                </form>
              </div>
            </div>
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
                <div key={session._id} className="card-soft p-5">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <h3 className="text-text-primary font-semibold text-base font-heading">{session.title}</h3>
                        {session.status === 'live' ? (
                          <span className="badge-live">LIVE</span>
                        ) : session.status === 'scheduled' ? (
                          <span className="badge-subject-live text-xs">Scheduled</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-surface-alt text-text-muted">Ended</span>
                        )}
                      </div>
                      <p className="text-text-secondary text-sm mb-3">{session.description}</p>
                      <div className="flex flex-wrap gap-4 text-xs text-text-muted">
                        <span className="font-medium text-text-secondary">{session.subject} • Std {session.standard}</span>
                        {session.scheduledAt && <span><Clock className="w-3.5 h-3.5 inline mr-1 text-text-muted" />{new Date(session.scheduledAt).toLocaleString('en-IN')}</span>}
                        <span><Users className="w-3.5 h-3.5 inline mr-1 text-text-muted" />{(session as any).totalParticipants || 0} participants</span>
                      </div>

                      {/* Join URL */}
                      <div className="mt-3 flex items-center gap-2 p-2.5 bg-surface-alt border border-border-subtle rounded-xl">
                        <Link2 className="w-4 h-4 text-brand-primary flex-shrink-0" />
                        <span className="text-brand-primary text-xs font-mono truncate font-medium">
                          {session.joinUrl || `${window.location.origin}/live/${session.sessionCode}`}
                        </span>
                        <button onClick={() => copyLink(session)}
                          className="flex-shrink-0 text-text-muted hover:text-text-primary transition-colors p-1">
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="flex md:flex-col gap-2 flex-shrink-0">
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

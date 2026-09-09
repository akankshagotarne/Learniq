import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radio, Plus, Copy, CheckCircle, Play, Square, Clock, Users, Link2 } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { LiveSession } from '../../types';
import { useAuth } from '../../context/AuthContext';
import toast from 'react-hot-toast';

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

  const subjects = ['Mathematics', 'Science', 'English', 'Social Science', 'Marathi', 'Environmental Studies'];

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 ml-16 md:ml-64 transition-all duration-300">
        <div className="p-6 lg:p-8">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="font-display font-bold text-2xl text-white">Live Sessions</h1>
              <p className="text-white/50 text-sm mt-1">Create and manage your live teaching sessions</p>
            </div>
            <button onClick={() => setShowCreate(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" /> Create Session
            </button>
          </div>

          {/* Create Modal */}
          {showCreate && (
            <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
              <div className="glass-card p-6 w-full max-w-md animate-slide-up">
                <h2 className="text-white font-bold text-xl mb-5">Create Live Session</h2>
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
                  <div className="flex gap-3">
                    <button type="submit" disabled={creating} className="btn-primary flex-1">
                      {creating ? 'Creating...' : 'Create Session'}
                    </button>
                    <button type="button" onClick={() => setShowCreate(false)} className="btn-ghost flex-1">Cancel</button>
                  </div>
                </form>
              </div>
            </div>
          )}

          {/* Sessions List */}
          {loading ? (
            <div className="space-y-4">
              {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-32 rounded-2xl" />)}
            </div>
          ) : sessions.length === 0 ? (
            <div className="glass-card p-16 text-center">
              <Radio className="w-16 h-16 text-white/10 mx-auto mb-4" />
              <p className="text-white/40 mb-4">No live sessions yet. Create your first one!</p>
              <button onClick={() => setShowCreate(true)} className="btn-primary">Create Session</button>
            </div>
          ) : (
            <div className="space-y-4">
              {sessions.map(session => (
                <div key={session._id} className="glass-card p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="text-white font-semibold">{session.title}</h3>
                        {session.status === 'live' ? (
                          <span className="badge-live">LIVE</span>
                        ) : session.status === 'scheduled' ? (
                          <span className="badge bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs">Scheduled</span>
                        ) : (
                          <span className="badge bg-white/10 text-white/40 text-xs">Ended</span>
                        )}
                      </div>
                      <p className="text-white/50 text-sm mb-2">{session.description}</p>
                      <div className="flex flex-wrap gap-4 text-xs text-white/40">
                        <span>{session.subject} • Std {session.standard}</span>
                        {session.scheduledAt && <span><Clock className="w-3 h-3 inline mr-1" />{new Date(session.scheduledAt).toLocaleString('en-IN')}</span>}
                        <span><Users className="w-3 h-3 inline mr-1" />{(session as any).totalParticipants || 0} participants</span>
                      </div>

                      {/* Join URL */}
                      <div className="mt-3 flex items-center gap-2 p-2 bg-white/5 rounded-lg">
                        <Link2 className="w-3.5 h-3.5 text-primary-400 flex-shrink-0" />
                        <span className="text-primary-400 text-xs font-mono truncate">
                          {session.joinUrl || `${window.location.origin}/live/${session.sessionCode}`}
                        </span>
                        <button onClick={() => copyLink(session)}
                          className="flex-shrink-0 text-white/30 hover:text-white transition-colors">
                          <Copy className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-col gap-2 flex-shrink-0">
                      {session.status === 'scheduled' && (
                        <button onClick={() => handleStart(session._id)}
                          className="flex items-center gap-1.5 px-4 py-2 bg-accent-500 hover:bg-accent-400 text-white text-sm font-medium rounded-xl transition-all">
                          <Play className="w-4 h-4" /> Go Live
                        </button>
                      )}
                      {session.status === 'live' && (
                        <>
                          <Link to={`/live/${session.sessionCode}`}
                            className="flex items-center gap-1.5 px-4 py-2 bg-primary-500 hover:bg-primary-400 text-white text-sm font-medium rounded-xl transition-all">
                            <Radio className="w-4 h-4" /> Join Session
                          </Link>
                          <button onClick={() => handleEnd(session._id)}
                            className="flex items-center gap-1.5 px-4 py-2 bg-red-500/20 text-red-400 border border-red-500/30 text-sm rounded-xl hover:bg-red-500/30 transition-all">
                            <Square className="w-4 h-4" /> End Session
                          </button>
                        </>
                      )}
                      <button onClick={() => copyLink(session)}
                        className="flex items-center gap-1.5 px-4 py-2 bg-white/5 text-white/60 text-sm rounded-xl hover:bg-white/10 transition-all">
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

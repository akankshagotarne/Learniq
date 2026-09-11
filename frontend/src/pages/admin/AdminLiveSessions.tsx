import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radio, Clock, Users, Copy, Link2 } from 'lucide-react';
import Sidebar from '../../components/layout/Sidebar';
import api from '../../services/api';
import { LiveSession } from '../../types';
import toast from 'react-hot-toast';

type StatusFilter = 'all' | 'scheduled' | 'live' | 'ended' | 'cancelled';

const AdminLiveSessions: React.FC = () => {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  useEffect(() => {
    api.get('/live-sessions')
      .then(r => setSessions(r.data.sessions || []))
      .catch(() => toast.error('Failed to load live sessions.'))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(
    () => statusFilter === 'all' ? sessions : sessions.filter(s => s.status === statusFilter),
    [sessions, statusFilter]
  );

  const liveCount = sessions.filter(s => s.status === 'live').length;
  const scheduledCount = sessions.filter(s => s.status === 'scheduled').length;

  const copyLink = (session: LiveSession) => {
    const link = session.joinUrl || `${window.location.origin}/live/${session.sessionCode}`;
    navigator.clipboard.writeText(link);
    toast.success('Session link copied!');
  };

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 ml-0 md:ml-64 pt-14 md:pt-0 transition-all duration-300">
        <div className="p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="mb-8">
            <p className="text-brand-primary text-xs font-semibold tracking-wide uppercase mb-1">Admin</p>
            <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary">Live Sessions</h1>
            <p className="text-text-secondary text-sm mt-1">Every live class scheduled across the platform</p>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            {[
              { label: 'Total Sessions', value: sessions.length, icon: Radio, iconBg: 'bg-[#EDE9FE] text-[#6C63F2]' },
              { label: 'Live Now', value: liveCount, icon: Radio, iconBg: 'bg-[#FFE4EC] text-[#E1447A]' },
              { label: 'Scheduled', value: scheduledCount, icon: Clock, iconBg: 'bg-[#FEF3C7] text-[#D97706]' },
            ].map(({ label, value, icon: Icon, iconBg }) => (
              <div key={label} className="card-soft p-4 flex flex-col justify-between">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${iconBg}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xl md:text-2xl font-bold font-heading text-text-primary">{loading ? '...' : value}</p>
                  <p className="text-text-secondary text-xs mt-1 font-medium">{label}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Filter */}
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            {(['all', 'live', 'scheduled', 'ended', 'cancelled'] as StatusFilter[]).map(m => (
              <button
                key={m}
                onClick={() => setStatusFilter(m)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all capitalize ${
                  statusFilter === m ? 'bg-brand-primary text-white border-brand-primary' : 'bg-surface text-text-secondary border-border-subtle hover:bg-surface-alt'
                }`}
              >
                {m}
              </button>
            ))}
            <span className="text-text-secondary text-sm font-medium ml-auto">{filtered.length} session{filtered.length !== 1 ? 's' : ''}</span>
          </div>

          {loading ? (
            <div className="space-y-4">
              {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-28 rounded-card" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="card-soft p-16 text-center">
              <Radio className="w-14 h-14 text-text-muted mx-auto mb-4" />
              <p className="text-text-secondary">No live sessions match this filter.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filtered.map(session => (
                <div key={session._id} className="card-soft p-5">
                  <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-2 flex-wrap">
                        <h3 className="text-text-primary font-semibold text-base font-heading">{session.title}</h3>
                        {session.status === 'live' ? (
                          <span className="badge-live">LIVE</span>
                        ) : session.status === 'scheduled' ? (
                          <span className="badge-subject-live text-xs">Scheduled</span>
                        ) : session.status === 'cancelled' ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[#FFE4EC] text-[#E1447A]">Cancelled</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-surface-alt text-text-muted">Ended</span>
                        )}
                      </div>
                      <p className="text-text-secondary text-sm mb-2">
                        By <span className="font-medium text-text-primary">{session.teacher?.name || 'Unknown teacher'}</span>
                      </p>
                      <div className="flex flex-wrap gap-4 text-xs text-text-muted">
                        <span className="font-medium text-text-secondary">{session.subject} • Std {session.standard}</span>
                        {session.scheduledAt && <span><Clock className="w-3.5 h-3.5 inline mr-1 text-text-muted" />{new Date(session.scheduledAt).toLocaleString('en-IN')}</span>}
                        <span><Users className="w-3.5 h-3.5 inline mr-1 text-text-muted" />{session.currentParticipants || 0} active • {session.totalParticipants || 0} total</span>
                      </div>
                      <div className="mt-3 flex items-center gap-2 p-2.5 bg-surface-alt border border-border-subtle rounded-xl max-w-md">
                        <Link2 className="w-4 h-4 text-brand-primary flex-shrink-0" />
                        <span className="text-brand-primary text-xs font-mono truncate font-medium">
                          {session.joinUrl || `${window.location.origin}/live/${session.sessionCode}`}
                        </span>
                        <button onClick={() => copyLink(session)} className="flex-shrink-0 text-text-muted hover:text-text-primary transition-colors p-1">
                          <Copy className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {session.status === 'live' && (
                      <Link to={`/live/${session.sessionCode}`} className="btn-primary text-sm py-2 px-4 flex items-center gap-1.5 flex-shrink-0">
                        <Radio className="w-4 h-4" /> Watch Session
                      </Link>
                    )}
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

export default AdminLiveSessions;

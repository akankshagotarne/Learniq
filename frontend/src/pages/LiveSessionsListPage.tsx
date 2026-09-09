import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Radio, Clock, Users, ChevronRight, Search, Filter } from 'lucide-react';
import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';
import api from '../services/api';
import { LiveSession } from '../types';
import { useAuth } from '../context/AuthContext';

const LiveSessionsListPage: React.FC = () => {
  const [sessions, setSessions] = useState<LiveSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const { user } = useAuth();

  useEffect(() => {
    const params: Record<string, string> = {};
    if (filter !== 'all') params.status = filter;
    if (user?.currentStandard && user.role === 'student') params.standard = String(user.currentStandard);

    api.get('/live-sessions', { params }).then(r => setSessions(r.data.sessions || [])).catch(() => {}).finally(() => setLoading(false));
  }, [filter, user]);

  const getStatusBadge = (status: string) => {
    if (status === 'live') return <span className="badge-live">LIVE NOW</span>;
    if (status === 'scheduled') return <span className="badge bg-[#E0F2FE] text-[#0284C7] dark:bg-[#075985]/30 dark:text-[#38BDF8] border border-[#BAE6FD] dark:border-[#0284C7]/30 text-xs font-semibold">Scheduled</span>;
    return <span className="badge bg-surface-alt border border-border-subtle text-text-muted text-xs font-medium">Ended</span>;
  };

  return (
    <div className="min-h-screen bg-page flex flex-col">
      <Navbar />
      <div className="pt-20 flex-1">
        <div className="bg-surface border-b border-border-subtle py-10 transition-colors">
          <div className="page-container">
            <h1 className="font-heading font-bold text-3xl md:text-4xl text-text-primary mb-2">
              <span className="text-gradient">Live</span> Classes
            </h1>
            <p className="text-text-secondary text-base">Join live interactive classes with expert teachers</p>
          </div>
        </div>

        <div className="page-container py-8">
          {/* Filter */}
          <div className="flex flex-wrap gap-2 mb-6">
            {[['all', 'All Classes'], ['live', '🔴 Live Now'], ['scheduled', 'Upcoming'], ['ended', 'Past Classes']].map(([val, label]) => (
              <button key={val} onClick={() => setFilter(val)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  filter === val
                    ? 'bg-brand-primary text-white shadow-sm'
                    : 'bg-surface border border-border-subtle text-text-secondary hover:bg-surface-alt hover:text-text-primary shadow-xs'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="grid md:grid-cols-2 gap-5">
              {[...Array(4)].map((_, i) => <div key={i} className="card-soft h-40 rounded-2xl animate-pulse bg-surface-alt" />)}
            </div>
          ) : sessions.length === 0 ? (
            <div className="card-soft p-12 text-center max-w-lg mx-auto">
              <div className="w-16 h-16 rounded-full bg-brand-primary/10 text-brand-primary flex items-center justify-center mx-auto mb-4">
                <Radio className="w-8 h-8" />
              </div>
              <h3 className="font-heading font-semibold text-text-primary text-lg mb-2">No live classes {filter !== 'all' ? `(${filter})` : ''}</h3>
              <p className="text-text-secondary text-sm">Check back soon or explore our recorded video courses.</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-5">
              {sessions.map(session => (
                <div key={session._id} className="card-soft p-6 hover:-translate-y-1 transition-all">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        {getStatusBadge(session.status)}
                        <span className="badge bg-surface-alt border border-border-subtle text-text-secondary text-xs font-medium">{session.subject}</span>
                      </div>
                      <h3 className="font-heading font-semibold text-text-primary text-lg">{session.title}</h3>
                    </div>
                  </div>

                  {session.description && (
                    <p className="text-text-secondary text-sm mb-4 line-clamp-2 leading-relaxed">{session.description}</p>
                  )}

                  <div className="flex flex-wrap items-center gap-4 mb-4 text-xs text-text-secondary font-medium">
                    <span className="badge bg-brand-primary/10 text-brand-primary border border-brand-primary/20">Std {session.standard}</span>
                    {session.scheduledAt && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-accent-sky" />
                        {new Date(session.scheduledAt).toLocaleString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Users className="w-3.5 h-3.5 text-accent-mint" /> {session.currentParticipants} participants
                    </span>
                  </div>

                  {session.teacher && (
                    <div className="flex items-center gap-2.5 mb-5 pt-3 border-t border-border-subtle">
                      <img
                        src={(session.teacher as any).avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent((session.teacher as any).name || 'T')}&background=6C63F2&color=fff&size=32`}
                        alt={(session.teacher as any).name}
                        className="w-7 h-7 rounded-full object-cover border border-border-subtle"
                      />
                      <span className="text-text-secondary text-xs font-medium">{(session.teacher as any).name}</span>
                    </div>
                  )}

                  {session.status !== 'ended' && (
                    <Link
                      to={`/live/${session.sessionCode}`}
                      className={`block w-full text-center py-2.5 rounded-xl text-sm font-semibold transition-all shadow-sm ${
                        session.status === 'live'
                          ? 'bg-gradient-to-r from-[#E1447A] to-[#FF8FA3] text-white hover:opacity-95'
                          : 'btn-secondary text-center'
                      }`}
                    >
                      {session.status === 'live' ? '🔴 Join Live Classroom' : 'View Session Details'}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
};

export default LiveSessionsListPage;


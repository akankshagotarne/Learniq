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
    if (status === 'scheduled') return <span className="badge bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs">Scheduled</span>;
    return <span className="badge bg-white/10 text-white/40 text-xs">Ended</span>;
  };

  return (
    <div className="min-h-screen">
      <Navbar />
      <div className="pt-20 bg-dark-900 min-h-screen">
        <div className="bg-dark-800 border-b border-white/10 py-10">
          <div className="page-container">
            <h1 className="font-display font-bold text-3xl md:text-4xl text-white mb-2">
              <span className="gradient-text">Live</span> Classes
            </h1>
            <p className="text-white/50">Join live interactive classes with expert teachers</p>
          </div>
        </div>

        <div className="page-container py-8">
          {/* Filter */}
          <div className="flex gap-2 mb-6">
            {[['all', 'All'], ['live', '🔴 Live Now'], ['scheduled', 'Upcoming'], ['ended', 'Past']].map(([val, label]) => (
              <button key={val} onClick={() => setFilter(val)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${
                  filter === val ? 'bg-primary-500 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-4">
              {[...Array(4)].map((_, i) => <div key={i} className="skeleton h-32 rounded-2xl" />)}
            </div>
          ) : sessions.length === 0 ? (
            <div className="text-center py-20">
              <Radio className="w-16 h-16 text-white/10 mx-auto mb-4" />
              <h3 className="text-white font-semibold mb-2">No live classes {filter !== 'all' ? `(${filter})` : ''}</h3>
              <p className="text-white/40 text-sm">Check back later or change your filter.</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 gap-4">
              {sessions.map(session => (
                <div key={session._id} className="glass-card p-5 hover:-translate-y-0.5 transition-all">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        {getStatusBadge(session.status)}
                        <span className="text-white/30 text-xs">{session.subject}</span>
                      </div>
                      <h3 className="text-white font-semibold">{session.title}</h3>
                    </div>
                  </div>

                  {session.description && (
                    <p className="text-white/50 text-sm mb-3 line-clamp-2">{session.description}</p>
                  )}

                  <div className="flex items-center gap-4 mb-4 text-xs text-white/40">
                    <span>Standard {session.standard}</span>
                    {session.scheduledAt && (
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(session.scheduledAt).toLocaleString('en-IN', { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <Users className="w-3 h-3" /> {session.currentParticipants} live
                    </span>
                  </div>

                  {session.teacher && (
                    <div className="flex items-center gap-2 mb-4">
                      <img
                        src={(session.teacher as any).avatar || `https://ui-avatars.com/api/?name=T&background=6C63FF&color=fff&size=32`}
                        alt={(session.teacher as any).name}
                        className="w-7 h-7 rounded-full object-cover"
                      />
                      <span className="text-white/50 text-xs">{(session.teacher as any).name}</span>
                    </div>
                  )}

                  {session.status !== 'ended' && (
                    <Link
                      to={`/live/${session.sessionCode}`}
                      className={`block w-full text-center py-2.5 rounded-xl text-sm font-semibold transition-all ${
                        session.status === 'live'
                          ? 'bg-gradient-to-r from-red-500 to-red-600 text-white hover:from-red-400 hover:to-red-500'
                          : 'btn-outline'
                      }`}
                    >
                      {session.status === 'live' ? '🔴 Join Live Now' : 'View Details'}
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

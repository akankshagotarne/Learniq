import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Sidebar from '../../components/layout/Sidebar';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { resolveFileUrl } from '../../utils/fileUrl';
import { SupportTicket } from '../../types';
import toast from 'react-hot-toast';
import {
  HelpCircle, Send, Paperclip, X, ArrowLeft, Loader,
  Clock, CircleDot, CheckCircle2, Image as ImageIcon, GraduationCap, User as UserIcon,
} from 'lucide-react';

type StatusFilter = 'all' | 'open' | 'in-progress' | 'resolved';

const StatusBadge: React.FC<{ status: SupportTicket['status'] }> = ({ status }) => {
  const map = {
    open: { label: 'Open', cls: 'bg-[#EDE9FE] text-[#6C63F2]', Icon: CircleDot },
    'in-progress': { label: 'In Progress', cls: 'bg-[#FEF3C7] text-[#D97706]', Icon: Clock },
    resolved: { label: 'Resolved', cls: 'bg-[#DCFCE7] text-[#16A34A]', Icon: CheckCircle2 },
  } as const;
  const { label, cls, Icon } = map[status];
  return (
    <span className={`badge ${cls} inline-flex items-center gap-1 font-semibold`}>
      <Icon className="w-3 h-3" /> {label}
    </span>
  );
};

const timeAgo = (iso: string) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
};

const AdminSupport: React.FC = () => {
  const { user } = useAuth();
  const { id: routeId } = useParams<{ id?: string }>();
  const navigate = useNavigate();

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [loadingTicket, setLoadingTicket] = useState(false);

  const [replyText, setReplyText] = useState('');
  const [replyFile, setReplyFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [updatingStatus, setUpdatingStatus] = useState(false);

  const replyFileInputRef = useRef<HTMLInputElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const fetchTickets = () => {
    api.get('/admin/support/tickets', { params: statusFilter !== 'all' ? { status: statusFilter } : {} })
      .then(r => setTickets(r.data.tickets || []))
      .catch(() => toast.error('Could not load support tickets.'))
      .finally(() => setLoadingList(false));
  };

  useEffect(() => { setLoadingList(true); fetchTickets(); }, [statusFilter]);

  const openTicket = (id: string) => {
    navigate(`/admin/support/${id}`);
  };

  useEffect(() => {
    if (!routeId) { setSelectedTicket(null); return; }
    setLoadingTicket(true);
    api.get(`/support/tickets/${routeId}`)
      .then(r => setSelectedTicket(r.data.ticket))
      .catch(() => toast.error('Could not load this ticket.'))
      .finally(() => setLoadingTicket(false));
  }, [routeId]);

  // Light polling while a ticket thread is open, to pick up follow-up
  // replies from the student/teacher without a manual refresh.
  useEffect(() => {
    if (!routeId) return;
    const interval = setInterval(() => {
      api.get(`/support/tickets/${routeId}`)
        .then(r => setSelectedTicket(r.data.ticket))
        .catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [routeId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedTicket?.messages.length]);

  const submitReply = async () => {
    if (!routeId) return;
    if (!replyText.trim() && !replyFile) { toast.error('Write a message, or attach a screenshot.'); return; }

    const fd = new FormData();
    fd.append('message', replyText.trim());
    if (replyFile) fd.append('attachment', replyFile);

    setSending(true);
    try {
      const res = await api.post(`/support/tickets/${routeId}/reply`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const ticket: SupportTicket = res.data.ticket;
      setSelectedTicket(ticket);
      setTickets(prev => prev.map(t => (t._id === ticket._id ? { ...t, status: ticket.status, lastMessageAt: ticket.lastMessageAt } : t)));
      setReplyText('');
      setReplyFile(null);
      if (replyFileInputRef.current) replyFileInputRef.current.value = '';
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Could not send your reply.');
    } finally {
      setSending(false);
    }
  };

  const changeStatus = async (status: SupportTicket['status']) => {
    if (!routeId) return;
    setUpdatingStatus(true);
    try {
      const res = await api.patch(`/admin/support/tickets/${routeId}/status`, { status });
      setSelectedTicket(res.data.ticket);
      setTickets(prev => prev.map(t => (t._id === routeId ? { ...t, status } : t)));
      toast.success(`Marked as ${status.replace('-', ' ')}`);
    } catch {
      toast.error('Could not update status.');
    } finally {
      setUpdatingStatus(false);
    }
  };

  const openCount = tickets.filter(t => t.status === 'open').length;
  const inProgressCount = tickets.filter(t => t.status === 'in-progress').length;
  const resolvedCount = tickets.filter(t => t.status === 'resolved').length;

  const mobileShowDetail = !!routeId;

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 ml-0 md:ml-64 pt-14 md:pt-0 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="mb-6">
            <p className="text-brand-primary text-xs font-semibold tracking-wide uppercase mb-1">Admin</p>
            <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary flex items-center gap-2">
              <HelpCircle className="w-7 h-7 text-brand-primary" /> Help &amp; Support Inbox
            </h1>
            <p className="text-text-secondary text-sm mt-1">
              Issues, bugs, and glitches reported by students and teachers.
            </p>
          </div>

          {/* Stat cards */}
          <div className="grid grid-cols-3 gap-4 mb-6">
            {[
              { label: 'Open', value: openCount, cls: 'bg-[#EDE9FE] text-[#6C63F2]' },
              { label: 'In Progress', value: inProgressCount, cls: 'bg-[#FEF3C7] text-[#D97706]' },
              { label: 'Resolved', value: resolvedCount, cls: 'bg-[#DCFCE7] text-[#16A34A]' },
            ].map(({ label, value, cls }) => (
              <div key={label} className="card-soft p-4">
                <div className={`w-9 h-9 rounded-xl flex items-center justify-center mb-3 ${cls}`}>
                  <HelpCircle className="w-4 h-4" />
                </div>
                <p className="text-xl md:text-2xl font-bold font-heading text-text-primary">{loadingList ? '...' : value}</p>
                <p className="text-text-secondary text-xs mt-1 font-medium">{label}</p>
              </div>
            ))}
          </div>

          {/* Filter */}
          <div className="flex items-center gap-2 mb-5 flex-wrap">
            {(['all', 'open', 'in-progress', 'resolved'] as StatusFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setStatusFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all capitalize ${
                  statusFilter === f ? 'bg-brand-primary text-white border-brand-primary' : 'bg-surface text-text-secondary border-border-subtle hover:bg-surface-alt'
                }`}
              >
                {f.replace('-', ' ')}
              </button>
            ))}
          </div>

          <div className="grid md:grid-cols-[360px_1fr] gap-5 items-start">
            {/* Ticket list */}
            <div className={`${mobileShowDetail ? 'hidden md:block' : 'block'} card-soft p-2 rounded-card border border-border-subtle max-h-[70vh] overflow-y-auto`}>
              {loadingList ? (
                <div className="p-8 text-center text-text-muted text-sm flex items-center justify-center gap-2">
                  <Loader className="w-4 h-4 animate-spin" /> Loading...
                </div>
              ) : tickets.length === 0 ? (
                <div className="p-8 text-center">
                  <HelpCircle className="w-10 h-10 text-text-muted mx-auto mb-3" />
                  <p className="text-text-secondary text-sm">No tickets here.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {tickets.map(t => (
                    <button
                      key={t._id}
                      onClick={() => openTicket(t._id)}
                      className={`w-full text-left p-3 rounded-xl transition-all ${routeId === t._id ? 'bg-brand-primary/10 border border-brand-primary/30' : 'hover:bg-surface-alt border border-transparent'}`}
                    >
                      <div className="flex items-center gap-1.5 mb-1">
                        {t.userRole === 'teacher' ? <GraduationCap className="w-3.5 h-3.5 text-brand-secondary flex-shrink-0" /> : <UserIcon className="w-3.5 h-3.5 text-brand-primary flex-shrink-0" />}
                        <span className="text-[11px] font-semibold text-text-secondary truncate">{t.userName}</span>
                      </div>
                      <p className="text-sm font-semibold text-text-primary line-clamp-1">{t.subject}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <StatusBadge status={t.status} />
                        <span className="text-[11px] text-text-muted">{timeAgo(t.lastMessageAt)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Detail */}
            <div className={`${mobileShowDetail ? 'block' : 'hidden md:block'} card-soft rounded-card border border-border-subtle flex flex-col h-[70vh]`}>
              {!routeId ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                  <HelpCircle className="w-12 h-12 text-text-muted mb-3" />
                  <p className="text-text-secondary text-sm">Select a ticket to see the conversation.</p>
                </div>
              ) : loadingTicket || !selectedTicket ? (
                <div className="flex-1 flex items-center justify-center text-text-muted text-sm gap-2">
                  <Loader className="w-4 h-4 animate-spin" /> Loading...
                </div>
              ) : (
                <>
                  {/* Thread header */}
                  <div className="p-4 border-b border-border-subtle flex-shrink-0">
                    <button onClick={() => navigate('/admin/support')} className="md:hidden flex items-center gap-1.5 text-text-muted text-xs mb-2">
                      <ArrowLeft className="w-3.5 h-3.5" /> Back to tickets
                    </button>
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div>
                        <h2 className="font-heading font-bold text-text-primary text-base">{selectedTicket.subject}</h2>
                        <p className="text-text-muted text-xs mt-0.5 capitalize">
                          {selectedTicket.userName} · {selectedTicket.userRole} · {selectedTicket.category.replace('-', ' ')}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {(['open', 'in-progress', 'resolved'] as SupportTicket['status'][]).map(s => (
                          <button
                            key={s}
                            disabled={updatingStatus || selectedTicket.status === s}
                            onClick={() => changeStatus(s)}
                            className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold border capitalize transition-all disabled:cursor-default ${
                              selectedTicket.status === s
                                ? 'bg-brand-primary text-white border-brand-primary'
                                : 'bg-surface text-text-secondary border-border-subtle hover:bg-surface-alt'
                            }`}
                          >
                            {s.replace('-', ' ')}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {selectedTicket.messages.map((m, i) => {
                      const isMine = m.sender === user?._id;
                      return (
                        <div key={m._id || i} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${isMine ? 'bg-brand-primary text-white' : 'bg-surface-alt text-text-primary'}`}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className={`text-[11px] font-semibold ${isMine ? 'text-white/90' : 'text-text-secondary'}`}>
                                {isMine ? 'You' : `${m.senderName} · ${m.senderRole}`}
                              </span>
                              <span className={`text-[10px] ${isMine ? 'text-white/70' : 'text-text-muted'}`}>{timeAgo(m.createdAt)}</span>
                            </div>
                            {m.message && <p className="text-sm whitespace-pre-wrap break-words">{m.message}</p>}
                            {m.attachmentUrl && (
                              <a href={resolveFileUrl(m.attachmentUrl)} target="_blank" rel="noopener noreferrer" className="block mt-2">
                                <img src={resolveFileUrl(m.attachmentUrl)} alt="Attachment" className="rounded-lg max-h-48 object-cover border border-white/20" />
                              </a>
                            )}
                          </div>
                        </div>
                      );
                    })}
                    <div ref={threadEndRef} />
                  </div>

                  {/* Reply box */}
                  <div className="p-3 border-t border-border-subtle flex-shrink-0">
                    {replyFile && (
                      <div className="flex items-center gap-2 mb-2 px-2.5 py-1.5 bg-surface-alt rounded-lg text-xs text-text-secondary w-fit">
                        <ImageIcon className="w-3.5 h-3.5" /> {replyFile.name}
                        <button onClick={() => { setReplyFile(null); if (replyFileInputRef.current) replyFileInputRef.current.value = ''; }}>
                          <X className="w-3.5 h-3.5 text-text-muted hover:text-[#E1447A]" />
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <input ref={replyFileInputRef} type="file" accept="image/*" onChange={e => setReplyFile(e.target.files?.[0] || null)} className="hidden" />
                      <button
                        onClick={() => replyFileInputRef.current?.click()}
                        title="Attach a screenshot"
                        className="p-2.5 bg-surface-alt text-text-muted hover:text-brand-primary border border-border-subtle rounded-xl transition-all flex-shrink-0"
                      >
                        <Paperclip className="w-4 h-4" />
                      </button>
                      <input
                        value={replyText}
                        onChange={e => setReplyText(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') submitReply(); }}
                        placeholder="Reply to this ticket..."
                        className="flex-1 bg-surface-alt border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
                      />
                      <button
                        onClick={submitReply}
                        disabled={sending}
                        className="p-2.5 bg-brand-primary hover:bg-brand-primary-hover text-white rounded-xl transition-all shadow-xs disabled:opacity-60 flex-shrink-0"
                      >
                        {sending ? <Loader className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default AdminSupport;

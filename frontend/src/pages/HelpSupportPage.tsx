import React, { useEffect, useRef, useState } from 'react';
import Sidebar from '../components/layout/Sidebar';
import { useAuth } from '../context/AuthContext';
import api from '../services/api';
import { resolveFileUrl } from '../utils/fileUrl';
import { SupportTicket } from '../types';
import toast from 'react-hot-toast';
import {
  HelpCircle, Plus, Send, Paperclip, X, ArrowLeft, Loader,
  Clock, CircleDot, CheckCircle2, Image as ImageIcon,
} from 'lucide-react';

const CATEGORIES: { value: SupportTicket['category']; label: string }[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'glitch', label: 'Glitch / Freeze' },
  { value: 'live-class', label: 'Live Class Issue' },
  { value: 'payment', label: 'Payment Issue' },
  { value: 'course-content', label: 'Course Content' },
  { value: 'account', label: 'Account / Login' },
  { value: 'other', label: 'Other' },
];

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

const HelpSupportPage: React.FC = () => {
  const { user } = useAuth();

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicket | null>(null);
  const [loadingTicket, setLoadingTicket] = useState(false);

  const [showNewForm, setShowNewForm] = useState(false);
  const [newSubject, setNewSubject] = useState('');
  const [newCategory, setNewCategory] = useState<SupportTicket['category']>('other');
  const [newMessage, setNewMessage] = useState('');
  const [newFile, setNewFile] = useState<File | null>(null);
  const [creating, setCreating] = useState(false);

  const [replyText, setReplyText] = useState('');
  const [replyFile, setReplyFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);

  const newFileInputRef = useRef<HTMLInputElement>(null);
  const replyFileInputRef = useRef<HTMLInputElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const fetchTickets = () => {
    api.get('/support/tickets')
      .then(r => setTickets(r.data.tickets || []))
      .catch(() => toast.error('Could not load your support tickets.'))
      .finally(() => setLoadingList(false));
  };

  useEffect(() => { fetchTickets(); }, []);

  const openTicket = (id: string) => {
    setSelectedId(id);
    setShowNewForm(false);
    setLoadingTicket(true);
    api.get(`/support/tickets/${id}`)
      .then(r => setSelectedTicket(r.data.ticket))
      .catch(() => toast.error('Could not load this ticket.'))
      .finally(() => setLoadingTicket(false));
  };

  // Light polling while a ticket thread is open, so an admin's reply shows
  // up without the student/teacher needing to manually refresh.
  useEffect(() => {
    if (!selectedId) return;
    const interval = setInterval(() => {
      api.get(`/support/tickets/${selectedId}`)
        .then(r => setSelectedTicket(r.data.ticket))
        .catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [selectedId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedTicket?.messages.length]);

  const resetNewForm = () => {
    setNewSubject(''); setNewCategory('other'); setNewMessage(''); setNewFile(null);
    if (newFileInputRef.current) newFileInputRef.current.value = '';
  };

  const submitNewTicket = async () => {
    if (!newSubject.trim()) { toast.error('Please add a subject.'); return; }
    if (!newMessage.trim() && !newFile) { toast.error('Describe the issue, or attach a screenshot.'); return; }

    const fd = new FormData();
    fd.append('subject', newSubject.trim());
    fd.append('category', newCategory);
    fd.append('message', newMessage.trim());
    if (newFile) fd.append('attachment', newFile);

    setCreating(true);
    try {
      const res = await api.post('/support/tickets', fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const ticket: SupportTicket = res.data.ticket;
      setTickets(prev => [{ ...ticket, messages: [] }, ...prev]);
      setSelectedTicket(ticket);
      setSelectedId(ticket._id);
      setShowNewForm(false);
      resetNewForm();
      toast.success('Ticket sent to the admin team!');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Could not send your ticket.');
    } finally {
      setCreating(false);
    }
  };

  const submitReply = async () => {
    if (!selectedId) return;
    if (!replyText.trim() && !replyFile) { toast.error('Write a message, or attach a screenshot.'); return; }

    const fd = new FormData();
    fd.append('message', replyText.trim());
    if (replyFile) fd.append('attachment', replyFile);

    setSending(true);
    try {
      const res = await api.post(`/support/tickets/${selectedId}/reply`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
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

  const mobileShowDetail = !!selectedId || showNewForm;

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 ml-0 md:ml-64 pt-14 md:pt-0 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="text-brand-primary text-xs font-semibold tracking-wide uppercase mb-1">
                {user?.role === 'teacher' ? 'Teacher' : 'Student'}
              </p>
              <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary flex items-center gap-2">
                <HelpCircle className="w-7 h-7 text-brand-primary" /> Help &amp; Support
              </h1>
              <p className="text-text-secondary text-sm mt-1">
                Message the admin team about any issue, glitch, or bug — with a screenshot if it helps.
              </p>
            </div>
            <button
              onClick={() => { setShowNewForm(true); setSelectedId(null); setSelectedTicket(null); }}
              className="btn-primary text-sm px-4 py-2.5 flex items-center gap-1.5"
            >
              <Plus className="w-4 h-4" /> New Ticket
            </button>
          </div>

          <div className="grid md:grid-cols-[320px_1fr] gap-5 items-start">
            {/* Ticket list */}
            <div className={`${mobileShowDetail ? 'hidden md:block' : 'block'} card-soft p-2 rounded-card border border-border-subtle max-h-[75vh] overflow-y-auto`}>
              {loadingList ? (
                <div className="p-8 text-center text-text-muted text-sm flex items-center justify-center gap-2">
                  <Loader className="w-4 h-4 animate-spin" /> Loading...
                </div>
              ) : tickets.length === 0 ? (
                <div className="p-8 text-center">
                  <HelpCircle className="w-10 h-10 text-text-muted mx-auto mb-3" />
                  <p className="text-text-secondary text-sm">No tickets yet.</p>
                  <p className="text-text-muted text-xs mt-1">Raise one if you hit any issue.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {tickets.map(t => (
                    <button
                      key={t._id}
                      onClick={() => openTicket(t._id)}
                      className={`w-full text-left p-3 rounded-xl transition-all ${selectedId === t._id ? 'bg-brand-primary/10 border border-brand-primary/30' : 'hover:bg-surface-alt border border-transparent'}`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-semibold text-text-primary line-clamp-1">{t.subject}</p>
                      </div>
                      <div className="flex items-center gap-2 mt-1.5">
                        <StatusBadge status={t.status} />
                        <span className="text-[11px] text-text-muted">{timeAgo(t.lastMessageAt)}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Detail / New ticket form */}
            <div className={`${mobileShowDetail ? 'block' : 'hidden md:block'} card-soft rounded-card border border-border-subtle flex flex-col h-[75vh]`}>
              {showNewForm ? (
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                  <button onClick={() => setShowNewForm(false)} className="md:hidden flex items-center gap-1.5 text-text-muted text-xs mb-1">
                    <ArrowLeft className="w-3.5 h-3.5" /> Back to tickets
                  </button>
                  <h2 className="font-heading font-bold text-text-primary text-lg">Raise a New Ticket</h2>

                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1.5">Subject</label>
                    <input
                      value={newSubject}
                      onChange={e => setNewSubject(e.target.value)}
                      placeholder="Short summary of the issue"
                      className="w-full bg-surface-alt border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1.5">Category</label>
                    <select
                      value={newCategory}
                      onChange={e => setNewCategory(e.target.value as SupportTicket['category'])}
                      className="w-full bg-surface-alt border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
                    >
                      {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1.5">Describe the issue</label>
                    <textarea
                      value={newMessage}
                      onChange={e => setNewMessage(e.target.value)}
                      rows={5}
                      placeholder="What happened? What were you trying to do?"
                      className="w-full bg-surface-alt border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-primary/30 resize-none"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-text-secondary block mb-1.5">Attach a screenshot (optional)</label>
                    <input ref={newFileInputRef} type="file" accept="image/*" onChange={e => setNewFile(e.target.files?.[0] || null)} className="hidden" />
                    <button
                      onClick={() => newFileInputRef.current?.click()}
                      className="flex items-center gap-2 px-3.5 py-2.5 bg-surface-alt border border-border-subtle rounded-xl text-xs font-semibold text-text-secondary hover:text-brand-primary hover:border-brand-primary/30 transition-all"
                    >
                      <Paperclip className="w-3.5 h-3.5" /> {newFile ? newFile.name : 'Choose an image'}
                    </button>
                  </div>

                  <button
                    onClick={submitNewTicket}
                    disabled={creating}
                    className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-60"
                  >
                    {creating ? <><Loader className="w-4 h-4 animate-spin" /> Sending...</> : <><Send className="w-4 h-4" /> Send to Admin</>}
                  </button>
                </div>
              ) : !selectedId ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                  <HelpCircle className="w-12 h-12 text-text-muted mb-3" />
                  <p className="text-text-secondary text-sm">Select a ticket to see the conversation,</p>
                  <p className="text-text-secondary text-sm">or raise a new one.</p>
                </div>
              ) : loadingTicket || !selectedTicket ? (
                <div className="flex-1 flex items-center justify-center text-text-muted text-sm gap-2">
                  <Loader className="w-4 h-4 animate-spin" /> Loading...
                </div>
              ) : (
                <>
                  {/* Thread header */}
                  <div className="p-4 border-b border-border-subtle flex-shrink-0">
                    <button onClick={() => { setSelectedId(null); setSelectedTicket(null); }} className="md:hidden flex items-center gap-1.5 text-text-muted text-xs mb-2">
                      <ArrowLeft className="w-3.5 h-3.5" /> Back to tickets
                    </button>
                    <div className="flex items-start justify-between gap-2">
                      <h2 className="font-heading font-bold text-text-primary text-base">{selectedTicket.subject}</h2>
                      <StatusBadge status={selectedTicket.status} />
                    </div>
                    <p className="text-text-muted text-xs mt-1 capitalize">{selectedTicket.category.replace('-', ' ')}</p>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {selectedTicket.messages.map((m, i) => {
                      const isMine = m.sender === user?._id;
                      const isAdmin = m.senderRole === 'admin';
                      return (
                        <div key={m._id || i} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${isMine ? 'bg-brand-primary text-white' : isAdmin ? 'bg-[#EDE9FE] text-text-primary' : 'bg-surface-alt text-text-primary'}`}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className={`text-[11px] font-semibold ${isMine ? 'text-white/90' : 'text-text-secondary'}`}>
                                {isMine ? 'You' : m.senderName}{isAdmin && !isMine ? ' · Admin' : ''}
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
                          placeholder="Type a message..."
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

export default HelpSupportPage;

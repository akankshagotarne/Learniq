import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import Sidebar from '../../components/layout/Sidebar';
import { useAuth } from '../../context/AuthContext';
import api from '../../services/api';
import { resolveFileUrl } from '../../utils/fileUrl';
import { CourseDoubtThread } from '../../types';
import toast from 'react-hot-toast';
import {
  MessageCircle, Send, Paperclip, X, ArrowLeft, Loader, Image as ImageIcon, Clock,
} from 'lucide-react';

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

const TeacherDoubts: React.FC = () => {
  const { user } = useAuth();
  const { id: routeId } = useParams<{ id?: string }>();
  const navigate = useNavigate();

  const [threads, setThreads] = useState<CourseDoubtThread[]>([]);
  const [loadingList, setLoadingList] = useState(true);

  const [selectedThread, setSelectedThread] = useState<CourseDoubtThread | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);

  const [replyText, setReplyText] = useState('');
  const [replyFile, setReplyFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);

  const replyFileInputRef = useRef<HTMLInputElement>(null);
  const threadEndRef = useRef<HTMLDivElement>(null);

  const fetchThreads = () => {
    api.get('/teacher/doubts')
      .then(r => setThreads(r.data.threads || []))
      .catch(() => toast.error('Could not load student questions.'))
      .finally(() => setLoadingList(false));
  };

  useEffect(() => { fetchThreads(); }, []);

  const openThread = (id: string) => navigate(`/teacher/doubts/${id}`);

  useEffect(() => {
    if (!routeId) { setSelectedThread(null); return; }
    setLoadingThread(true);
    api.get(`/teacher/doubts/${routeId}`)
      .then(r => setSelectedThread(r.data.thread))
      .catch(() => toast.error('Could not load this conversation.'))
      .finally(() => setLoadingThread(false));
  }, [routeId]);

  // Light polling while a thread is open, to pick up follow-up questions
  // without a manual refresh.
  useEffect(() => {
    if (!routeId) return;
    const interval = setInterval(() => {
      api.get(`/teacher/doubts/${routeId}`)
        .then(r => setSelectedThread(r.data.thread))
        .catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, [routeId]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [selectedThread?.messages.length]);

  const submitReply = async () => {
    if (!routeId) return;
    if (!replyText.trim() && !replyFile) { toast.error('Write a reply, or attach a screenshot.'); return; }

    const fd = new FormData();
    fd.append('message', replyText.trim());
    if (replyFile) fd.append('attachment', replyFile);

    setSending(true);
    try {
      const res = await api.post(`/teacher/doubts/${routeId}/reply`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      const thread: CourseDoubtThread = res.data.thread;
      setSelectedThread(thread);
      setThreads(prev => prev.map(t => (t._id === thread._id ? { ...t, lastMessageAt: thread.lastMessageAt, lastSenderRole: 'teacher' } : t)));
      setReplyText('');
      setReplyFile(null);
      if (replyFileInputRef.current) replyFileInputRef.current.value = '';
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'Could not send your reply.');
    } finally {
      setSending(false);
    }
  };

  const awaitingCount = threads.filter(t => t.lastSenderRole === 'student').length;
  const mobileShowDetail = !!routeId;

  return (
    <div className="flex min-h-screen bg-page">
      <Sidebar />
      <main className="flex-1 ml-16 md:ml-64 transition-all duration-300">
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto">
          <div className="mb-6">
            <p className="text-brand-primary text-xs font-semibold tracking-wide uppercase mb-1">Teacher</p>
            <h1 className="font-heading font-bold text-2xl md:text-3xl text-text-primary flex items-center gap-2">
              <MessageCircle className="w-7 h-7 text-brand-primary" /> Student Questions
            </h1>
            <p className="text-text-secondary text-sm mt-1">
              Doubts your students asked about your courses{awaitingCount > 0 && !loadingList ? ` — ${awaitingCount} awaiting your reply` : ''}.
            </p>
          </div>

          <div className="grid md:grid-cols-[340px_1fr] gap-5 items-start">
            {/* Thread list */}
            <div className={`${mobileShowDetail ? 'hidden md:block' : 'block'} card-soft p-2 rounded-card border border-border-subtle max-h-[75vh] overflow-y-auto`}>
              {loadingList ? (
                <div className="p-8 text-center text-text-muted text-sm flex items-center justify-center gap-2">
                  <Loader className="w-4 h-4 animate-spin" /> Loading...
                </div>
              ) : threads.length === 0 ? (
                <div className="p-8 text-center">
                  <MessageCircle className="w-10 h-10 text-text-muted mx-auto mb-3" />
                  <p className="text-text-secondary text-sm">No questions yet.</p>
                  <p className="text-text-muted text-xs mt-1">Enrolled students can ask you about a course from its page.</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {threads.map(t => {
                    const courseObj = typeof t.course === 'object' ? t.course : null;
                    const needsReply = t.lastSenderRole === 'student';
                    return (
                      <button
                        key={t._id}
                        onClick={() => openThread(t._id)}
                        className={`w-full text-left p-3 rounded-xl transition-all ${routeId === t._id ? 'bg-brand-primary/10 border border-brand-primary/30' : 'hover:bg-surface-alt border border-transparent'}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-text-primary truncate">{t.studentName}</p>
                          {needsReply && <span className="w-2 h-2 rounded-full bg-[#E1447A] flex-shrink-0 mt-1.5" title="Awaiting your reply" />}
                        </div>
                        <p className="text-xs text-text-secondary truncate mt-0.5">{courseObj ? courseObj.title : 'Course'}</p>
                        <div className="flex items-center gap-1.5 mt-1.5 text-[11px] text-text-muted">
                          <Clock className="w-3 h-3" /> {timeAgo(t.lastMessageAt)}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Detail */}
            <div className={`${mobileShowDetail ? 'block' : 'hidden md:block'} card-soft rounded-card border border-border-subtle flex flex-col h-[75vh]`}>
              {!routeId ? (
                <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                  <MessageCircle className="w-12 h-12 text-text-muted mb-3" />
                  <p className="text-text-secondary text-sm">Select a conversation to see the question.</p>
                </div>
              ) : loadingThread || !selectedThread ? (
                <div className="flex-1 flex items-center justify-center text-text-muted text-sm gap-2">
                  <Loader className="w-4 h-4 animate-spin" /> Loading...
                </div>
              ) : (
                <>
                  {/* Header */}
                  <div className="p-4 border-b border-border-subtle flex-shrink-0">
                    <button onClick={() => navigate('/teacher/doubts')} className="md:hidden flex items-center gap-1.5 text-text-muted text-xs mb-2">
                      <ArrowLeft className="w-3.5 h-3.5" /> Back to questions
                    </button>
                    <h2 className="font-heading font-bold text-text-primary text-base">{selectedThread.studentName}</h2>
                    <p className="text-text-muted text-xs mt-0.5">
                      {typeof selectedThread.course === 'object' ? `${selectedThread.course.title} · Std ${selectedThread.course.standard}` : 'Course'}
                    </p>
                  </div>

                  {/* Messages */}
                  <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {selectedThread.messages.map((m, i) => {
                      const isMine = m.sender === user?._id;
                      return (
                        <div key={m._id || i} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] rounded-2xl px-3.5 py-2.5 ${isMine ? 'bg-brand-primary text-white' : 'bg-surface-alt text-text-primary'}`}>
                            <div className="flex items-center gap-1.5 mb-1">
                              <span className={`text-[11px] font-semibold ${isMine ? 'text-white/90' : 'text-text-secondary'}`}>
                                {isMine ? 'You' : m.senderName}
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
                        placeholder="Type your answer..."
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

export default TeacherDoubts;

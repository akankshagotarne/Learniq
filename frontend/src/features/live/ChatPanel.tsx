import React, { useEffect, useRef, useState } from 'react';
import { Crown, MessageSquare, Send, Trash2, X } from 'lucide-react';
import type { ChatItem } from './types';
import type { ChatPlacement } from './logic';

export type ChatMode = ChatPlacement;

/**
 * Class chat - always SECONDARY and never an overlay. Closed until the user opens it; then it takes its OWN space in the room layout
 * (RoomBody): a column beside the stage on wide / landscape screens, or the area underneath the stage on phones held upright.
 * The message list is the only scroll region; header and composer never move. The draft lives in the parent so closing the panel keeps it.
 */
export const ChatPanel: React.FC<{
  mode: ChatMode; messages: ChatItem[]; canChat: boolean; chatMode: 'everyone' | 'host_only' | 'off'; isHost: boolean;
  onSend: (text: string) => Promise<{ ok: boolean }>; onClose: () => void; onDelete?: (id: string) => void;
  draft?: string; onDraftChange?: (text: string) => void;
}> = ({ mode, messages, canChat, chatMode, isHost, onSend, onClose, onDelete, draft, onDraftChange }) => {
  const [localText, setLocalText] = useState('');
  const text = draft ?? localText;
  const setText = onDraftChange ?? setLocalText;
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // newest message in view - scrolls the LIST only (scrollIntoView would also scroll the page / the room)
  useEffect(() => { const el = list.current; if (el) el.scrollTop = el.scrollHeight; }, [messages.length, mode]);
  // keyboard focus on open only where there is a hardware pointer; on touch screens the keyboard opens when the student taps the field
  useEffect(() => { if (mode === 'docked' && typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches) input.current?.focus(); }, [mode]);

  const submit = async () => {
    const t = text.trim(); if (!t || sending) return;
    setSending(true);
    const r = await onSend(t);
    setSending(false);
    if (r.ok) setText('');
  };

  const shell = mode === 'docked'
    ? 'relative w-[min(20rem,42vw)] lg:w-80 flex-shrink-0 border-l border-border-subtle'
    : 'relative flex-1 min-h-0 w-full rounded-t-2xl border-t border-border-subtle';
  return (
    <>
      <aside data-testid="chat-panel" data-chat-mode={mode} aria-label="Class chat" className={`${shell} bg-surface text-text-primary flex flex-col min-h-0 overflow-hidden`}>
        <div className="flex items-center justify-between px-3 h-11 sm:h-12 border-b border-border-subtle flex-shrink-0">
          <div className="flex items-center gap-2"><MessageSquare className="w-4 h-4 text-brand-primary" /><h2 className="font-heading text-sm font-semibold text-text-primary">Class chat</h2></div>
          <button onClick={onClose} aria-label="Close chat" className="w-11 h-11 -mr-2 inline-flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary"><X className="w-4 h-4" /></button>
        </div>
        <div ref={list} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden overscroll-contain p-3 space-y-2" role="log" aria-live="polite" data-testid="chat-messages">
          {messages.length === 0 && (
            <div className="h-full min-h-[3.5rem] flex flex-col items-center justify-center gap-1 text-center text-text-muted" data-testid="chat-empty">
              <MessageSquare className="w-5 h-5 opacity-60" aria-hidden="true" /><p className="text-xs">No messages yet. Start the conversation.</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={m._id || i} className={`${m.senderRole === 'teacher' || m.senderRole === 'admin' ? 'bg-brand-primary/10 border-brand-primary/20' : 'bg-surface-alt border-border-subtle'} border rounded-xl p-2.5`}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`text-xs font-semibold ${m.senderRole === 'teacher' ? 'text-brand-primary' : 'text-text-primary'}`}>{m.senderName}</span>
                {m.senderRole === 'teacher' && <Crown className="w-3 h-3 text-accent-amber" />}
                {m.senderRole === 'admin' && <span className="text-[10px] font-bold uppercase tracking-wide text-sky-700 bg-sky-100 rounded px-1">Admin</span>}
                <span className="text-text-muted text-[10px] ml-auto font-mono">{new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                {isHost && m._id && onDelete && <button aria-label="Delete message" onClick={() => onDelete(m._id!)} className="p-1 text-text-muted hover:text-red-500"><Trash2 className="w-3 h-3" /></button>}
              </div>
              <p className="text-text-secondary text-xs leading-relaxed break-words">{m.message}</p>
            </div>
          ))}
        </div>
        <div className="px-3 py-2 border-t border-border-subtle flex-shrink-0" data-testid="chat-composer">
          {canChat ? (
            <form onSubmit={(e) => { e.preventDefault(); submit(); }} className="flex gap-2">
              <input ref={input} value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Type a message…" aria-label="Message" enterKeyHint="send"
                className="flex-1 min-w-0 bg-surface-alt border border-border-subtle rounded-xl px-3 h-11 text-base sm:text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-primary/30" />
              <button type="submit" disabled={sending || !text.trim()} aria-label="Send message" className="w-11 h-11 inline-flex items-center justify-center bg-brand-primary text-white rounded-xl disabled:opacity-50"><Send className="w-4 h-4" /></button>
            </form>
          ) : (
            <p className="text-center text-xs text-text-muted py-2">{chatMode === 'off' ? 'Chat is switched off for this class.' : 'Only the teacher can send messages right now.'}</p>
          )}
        </div>
      </aside>
    </>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { Crown, MessageSquare, Send, Trash2, X } from 'lucide-react';
import type { ChatItem } from './types';

export type ChatMode = 'docked' | 'slideover' | 'sheet';

/**
 * Class chat - always SECONDARY. Closed until the user opens it; then a docked column (large screens), a slide-over (tablets) or a bottom
 * sheet (phones). It never sits on top of the stage by default and never takes a fixed share of a phone screen.
 */
export const ChatPanel: React.FC<{
  mode: ChatMode; messages: ChatItem[]; canChat: boolean; chatMode: 'everyone' | 'host_only' | 'off'; isHost: boolean;
  onSend: (text: string) => Promise<{ ok: boolean }>; onClose: () => void; onDelete?: (id: string) => void;
}> = ({ mode, messages, canChat, chatMode, isHost, onSend, onClose, onDelete }) => {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [messages.length]);
  useEffect(() => { if (mode !== 'sheet') input.current?.focus(); }, [mode]);

  const submit = async () => {
    const t = text.trim(); if (!t || sending) return;
    setSending(true);
    const r = await onSend(t);
    setSending(false);
    if (r.ok) setText('');
  };

  const shell = mode === 'docked'
    ? 'relative w-80 flex-shrink-0 border-l border-border-subtle'
    : mode === 'slideover'
      ? 'fixed top-0 right-0 bottom-0 z-40 w-[22rem] max-w-[90vw] shadow-2xl border-l border-border-subtle pt-[env(safe-area-inset-top)]'
      : 'fixed inset-x-0 bottom-0 z-40 h-[72dvh] max-h-[560px] rounded-t-2xl shadow-2xl border-t border-border-subtle';
  return (
    <>
      {mode !== 'docked' && <button aria-label="Close chat" onClick={onClose} className="fixed inset-0 z-30 bg-black/40 cursor-default" tabIndex={-1} />}
      <aside data-testid="chat-panel" data-chat-mode={mode} aria-label="Class chat" className={`${shell} bg-surface flex flex-col min-h-0`}>
        <div className="flex items-center justify-between px-3 h-12 border-b border-border-subtle flex-shrink-0">
          <div className="flex items-center gap-2"><MessageSquare className="w-4 h-4 text-brand-primary" /><h2 className="font-heading text-sm font-semibold text-text-primary">Class chat</h2></div>
          <button onClick={onClose} aria-label="Close chat" className="w-11 h-11 -mr-2 inline-flex items-center justify-center rounded-lg text-text-muted hover:text-text-primary"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-3 space-y-2" role="log" aria-live="polite">
          {messages.length === 0 && <p className="text-center text-text-muted text-xs py-8">No messages yet.</p>}
          {messages.map((m, i) => (
            <div key={m._id || i} className={`${m.senderRole === 'teacher' ? 'bg-brand-primary/10 border-brand-primary/20' : 'bg-surface-alt border-border-subtle'} border rounded-xl p-2.5`}>
              <div className="flex items-center gap-1.5 mb-0.5">
                <span className={`text-xs font-semibold ${m.senderRole === 'teacher' ? 'text-brand-primary' : 'text-text-primary'}`}>{m.senderName}</span>
                {m.senderRole === 'teacher' && <Crown className="w-3 h-3 text-accent-amber" />}
                <span className="text-text-muted text-[10px] ml-auto font-mono">{new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                {isHost && m._id && onDelete && <button aria-label="Delete message" onClick={() => onDelete(m._id!)} className="p-1 text-text-muted hover:text-red-500"><Trash2 className="w-3 h-3" /></button>}
              </div>
              <p className="text-text-secondary text-xs leading-relaxed break-words">{m.message}</p>
            </div>
          ))}
          <div ref={end} />
        </div>
        <div className="p-3 border-t border-border-subtle pb-[max(0.75rem,env(safe-area-inset-bottom))] flex-shrink-0">
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

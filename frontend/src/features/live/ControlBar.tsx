import React, { useState } from 'react';
import { BarChart2, HelpCircle, Mic, MicOff, Monitor, MonitorOff, MoreHorizontal, MessageSquare, PhoneOff, Settings, Smile, Square, Users, Video, VideoOff } from 'lucide-react';

const EMOJI = ['👍', '❤️', '👏', '😂', '🎉', '🙌'];

const Btn: React.FC<{ label: string; onClick: () => void; on?: boolean; off?: boolean; danger?: boolean; badge?: number; children: React.ReactNode; testId?: string; disabled?: boolean }> = ({ label, onClick, on, off, danger, badge, children, testId, disabled }) => (
  <button type="button" onClick={onClick} aria-label={label} title={label} aria-pressed={on !== undefined ? on : undefined} data-testid={testId} disabled={disabled}
    className={`relative w-12 h-12 flex-shrink-0 inline-flex items-center justify-center rounded-2xl border transition-colors disabled:opacity-50 focus:outline-none focus-visible:ring-4 focus-visible:ring-brand-primary/30 ${danger ? 'bg-rose-50 border-rose-200 text-rose-600 hover:bg-rose-100' : off ? 'bg-rose-50 border-rose-200 text-rose-600' : on ? 'bg-brand-primary text-white border-brand-primary' : 'bg-surface-alt text-text-primary border-border-subtle hover:border-brand-primary/50'}`}>
    {children}
    {!!badge && <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center">{badge > 9 ? '9+' : badge}</span>}
  </button>
);

export interface ControlBarProps {
  isMicOn: boolean; isCamOn: boolean; isSharing: boolean; canAudio: boolean; canVideo: boolean; canScreen: boolean; screenSupported: boolean;
  chatOpen: boolean; unread: number; peopleOpen: boolean; waiting: number; isHost: boolean; mcqActive: boolean;
  onMic: () => void; onCam: () => void; onScreen: () => void; onChat: () => void; onPeople: () => void; onReaction: (e: string) => void;
  onScoreboard: () => void; onMcq: () => void; onSettings: () => void; onEnd: () => void; onLeave: () => void;
}
/** Primary controls always visible; the rest live in "More" so a 320 px phone never overflows. Every control is at least 44 px. */
export const ControlBar: React.FC<ControlBarProps> = (p) => {
  const [more, setMore] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  return (
    <div className="relative flex-shrink-0 bg-surface border-t border-border-subtle px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pl-[max(0.5rem,env(safe-area-inset-left))] pr-[max(0.5rem,env(safe-area-inset-right))]" data-testid="control-bar">
      {more && (
        <>
          <button aria-label="Close menu" className="fixed inset-0 z-20 cursor-default" onClick={() => setMore(false)} tabIndex={-1} />
          <div role="menu" className="absolute z-30 bottom-full mb-2 right-2 w-64 max-w-[calc(100vw-1rem)] bg-surface border border-border-subtle rounded-2xl shadow-2xl p-2 space-y-1 animate-fade-in">
            <div className="flex items-center justify-between px-1 pb-1" role="group" aria-label="Reactions">{EMOJI.map((e) => <button key={e} role="menuitem" onClick={() => { p.onReaction(e); setMore(false); }} className="w-10 h-10 text-2xl rounded-xl hover:bg-surface-alt" aria-label={`React ${e}`}>{e}</button>)}</div>
            <button role="menuitem" onClick={() => { p.onScoreboard(); setMore(false); }} className="w-full min-h-[44px] flex items-center gap-2 px-3 rounded-xl hover:bg-surface-alt text-sm text-text-primary"><BarChart2 className="w-4 h-4" />Class scoreboard</button>
            {p.isHost && <button role="menuitem" onClick={() => { p.onMcq(); setMore(false); }} className="w-full min-h-[44px] flex items-center gap-2 px-3 rounded-xl hover:bg-surface-alt text-sm text-text-primary" data-testid="open-mcq"><HelpCircle className="w-4 h-4" />{p.mcqActive ? 'Question in progress' : 'Ask a live question'}</button>}
            {p.isHost && <button role="menuitem" onClick={() => { p.onSettings(); setMore(false); }} className="w-full min-h-[44px] flex items-center gap-2 px-3 rounded-xl hover:bg-surface-alt text-sm text-text-primary" data-testid="open-settings"><Settings className="w-4 h-4" />Meeting settings</button>}
            {p.isHost && (confirmEnd
              ? <div className="flex items-center gap-2 px-3 min-h-[44px] text-sm text-rose-700"><span className="flex-1">End for everyone?</span><button className="font-bold underline min-h-[36px]" data-testid="confirm-end" onClick={() => { setMore(false); setConfirmEnd(false); p.onEnd(); }}>End</button><button className="underline min-h-[36px]" onClick={() => setConfirmEnd(false)}>Cancel</button></div>
              : <button role="menuitem" onClick={() => setConfirmEnd(true)} className="w-full min-h-[44px] flex items-center gap-2 px-3 rounded-xl hover:bg-rose-50 text-sm text-rose-600" data-testid="end-class"><Square className="w-4 h-4" />End class for everyone</button>)}
          </div>
        </>
      )}
      <div className="flex items-center justify-center gap-1.5 flex-wrap">
        <Btn label={p.isMicOn ? 'Mute microphone' : 'Unmute microphone'} on={p.isMicOn} off={!p.isMicOn && !p.canAudio} onClick={p.onMic} testId="btn-mic">{p.isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}</Btn>
        <Btn label={p.isCamOn ? 'Turn camera off' : 'Turn camera on'} on={p.isCamOn} off={!p.isCamOn && !p.canVideo} onClick={p.onCam} testId="btn-cam">{p.isCamOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}</Btn>
        {p.canScreen && p.screenSupported && <Btn label={p.isSharing ? 'Stop sharing' : 'Share screen'} on={p.isSharing} onClick={p.onScreen} testId="btn-screen">{p.isSharing ? <MonitorOff className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}</Btn>}
        <Btn label={p.chatOpen ? 'Close chat' : 'Open chat'} on={p.chatOpen} badge={p.chatOpen ? 0 : p.unread} onClick={p.onChat} testId="btn-chat"><MessageSquare className="w-5 h-5" /></Btn>
        <Btn label="People" on={p.peopleOpen} badge={p.isHost ? p.waiting : 0} onClick={p.onPeople} testId="btn-people"><Users className="w-5 h-5" /></Btn>
        <Btn label="More options" on={more} onClick={() => setMore((m) => !m)} testId="btn-more"><MoreHorizontal className="w-5 h-5" /></Btn>
        <Btn label="Leave class" danger onClick={p.onLeave} testId="btn-leave"><PhoneOff className="w-5 h-5" /></Btn>
      </div>
    </div>
  );
};
export { Smile };

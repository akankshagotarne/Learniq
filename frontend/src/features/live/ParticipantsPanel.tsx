import React, { useState } from 'react';
import { Crown, Lock, MicOff, Mic, Pin, PinOff, Presentation, UserCheck, UserX, Video, VideoOff, X, Bell, Star, MoreHorizontal, Trash2 } from 'lucide-react';
import { Avatar } from './Stage';
import type { Ack, MeetingConfig, RoomParticipant, WaitingEntry } from './types';

export interface ManagerActions {
  mute: (socketId: string) => Promise<Ack>;
  permission: (socketId: string, p: { mic?: boolean; camera?: boolean; present?: boolean }) => Promise<Ack>;
  ask?: (socketId: string, type: 'camera' | 'mic') => Promise<Ack>;
  remove: (socketId: string, allowRejoin?: boolean) => Promise<Ack>;
  spotlight: (userId: string | null) => Promise<Ack>;
  select: (userIds: string[]) => Promise<Ack>;
  lock: (locked: boolean) => Promise<Ack>;
  approve?: (socketId: string) => Promise<Ack>;
  deny?: (socketId: string) => Promise<Ack>;
}

const IconBtn: React.FC<{ label: string; onClick: () => void; active?: boolean; danger?: boolean; children: React.ReactNode; disabled?: boolean }> = ({ label, onClick, active, danger, children, disabled }) => (
  <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled} onClick={onClick}
    className={`w-11 h-11 inline-flex items-center justify-center rounded-xl border text-xs transition-colors disabled:opacity-40 ${danger ? 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100' : active ? 'border-brand-primary bg-brand-primary/10 text-brand-primary' : 'border-border-subtle bg-surface-alt text-text-secondary hover:text-text-primary'}`}>{children}</button>
);

/**
 * People list. Everyone sees who the server lets them see; managers (the host, or an administrator in the console) also get
 * moderation controls. Every control is a server request - the list changes only when the server confirms it.
 */
export const ParticipantsPanel: React.FC<{
  participants: RoomParticipant[]; selfSocketId?: string; config: MeetingConfig; manager?: ManagerActions; waiting?: WaitingEntry[]; locked?: boolean;
  onClose?: () => void; embedded?: boolean; onNotify?: (m: string, error?: boolean) => void; showSelf?: boolean;
}> = ({ participants, selfSocketId, config, manager, waiting = [], locked, onClose, embedded, onNotify, showSelf = true }) => {
  const [open, setOpen] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const selected = new Set(config.selectedUserIds || []);
  const presenters = new Set(config.presenterUserIds || []);

  const run = async (key: string, fn: () => Promise<Ack>, okMsg?: string) => {
    setBusy(key);
    const r = await fn();
    setBusy(null);
    if (!r.ok) onNotify?.(r.message || 'That did not work. Nothing was changed.', true); else if (okMsg) onNotify?.(okMsg);
    return r;
  };
  const list = participants.filter((p) => showSelf || p.socketId !== selfSocketId);
  const students = list.filter((p) => !p.isHost).length;

  const body = (
    <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain" data-testid="participants-panel">
      {manager && (
        <div className="px-3 py-2 border-b border-border-subtle space-y-2">
          <button onClick={() => run('lock', () => manager.lock(!locked), locked ? 'Class unlocked' : 'Class locked')} disabled={busy === 'lock'} aria-pressed={!!locked} data-testid="lock-toggle"
            className={`w-full min-h-[44px] flex items-center justify-center gap-2 rounded-xl border text-sm font-semibold ${locked ? 'border-amber-300 bg-amber-50 text-amber-800' : 'border-border-subtle bg-surface-alt text-text-primary'}`}>
            <Lock className="w-4 h-4" />{locked ? 'Admission locked - tap to unlock' : 'Lock admission'}
          </button>
          {waiting.length > 0 && manager.approve && manager.deny && (
            <div className="rounded-xl bg-amber-50 border border-amber-200 p-2 space-y-1.5" data-testid="waiting-list">
              <p className="text-xs font-bold text-amber-800 flex items-center gap-1.5"><Bell className="w-3.5 h-3.5" />{waiting.length} waiting to join</p>
              {waiting.map((w) => (
                <div key={w.socketId} className="flex items-center gap-2">
                  <span className="flex-1 truncate text-sm text-text-primary">{w.name}</span>
                  <IconBtn label={`Admit ${w.name}`} onClick={() => run(`a${w.socketId}`, () => manager.approve!(w.socketId))}><UserCheck className="w-4 h-4 text-emerald-600" /></IconBtn>
                  <IconBtn label={`Decline ${w.name}`} onClick={() => run(`d${w.socketId}`, () => manager.deny!(w.socketId))} danger><UserX className="w-4 h-4" /></IconBtn>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <ul className="divide-y divide-border-subtle">
        {list.map((p) => {
          const isSelf = p.socketId === selfSocketId;
          const expanded = open === p.socketId;
          return (
            <li key={p.socketId} data-testid={`person-${p.socketId}`} className="px-3 py-2">
              <div className="flex items-center gap-2.5">
                <Avatar name={p.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary truncate flex items-center gap-1.5">{p.name}{isSelf && <span className="text-text-muted font-normal">(You)</span>}{p.isHost && <Crown className="w-3.5 h-3.5 text-amber-500" aria-label="Teacher" />}
                    {config.spotlightUserId === p.userId && <Pin className="w-3 h-3 text-brand-primary" aria-label="Spotlighted" />}{selected.has(p.userId) && <Star className="w-3 h-3 text-amber-500" aria-label="Selected" />}{presenters.has(p.userId) && <Presentation className="w-3 h-3 text-emerald-600" aria-label="Presenter" />}</p>
                  <p className="text-[11px] text-text-muted">{p.isHost ? 'Teacher' : p.role === 'teacher' ? 'Guest teacher (attendee)' : p.standard ? (p.standard === 99 ? 'Others' : `Standard ${p.standard}`) : 'Student'}</p>
                </div>
                {p.isMicOn ? <Mic className="w-4 h-4 text-emerald-600" aria-label="Microphone on" /> : <MicOff className="w-4 h-4 text-text-muted" aria-label="Microphone off" />}
                {p.isCameraOn ? <Video className="w-4 h-4 text-emerald-600" aria-label="Camera on" /> : <VideoOff className="w-4 h-4 text-text-muted" aria-label="Camera off" />}
                {manager && !p.isHost && !isSelf && <IconBtn label={`Actions for ${p.name}`} onClick={() => { setOpen(expanded ? null : p.socketId); setConfirm(null); }} active={expanded}><MoreHorizontal className="w-4 h-4" /></IconBtn>}
              </div>
              {manager && expanded && !p.isHost && (
                <div className="mt-2 flex flex-wrap gap-1.5" data-testid={`actions-${p.socketId}`}>
                  {p.isMicOn && <IconBtn label="Mute now" onClick={() => run(`m${p.socketId}`, () => manager.mute(p.socketId), `${p.name} muted`)}><MicOff className="w-4 h-4" /></IconBtn>}
                  <IconBtn label={p.micBlocked ? 'Allow microphone' : 'Block microphone'} active={p.micBlocked} onClick={() => run(`mb${p.socketId}`, () => manager.permission(p.socketId, { mic: !!p.micBlocked }), p.micBlocked ? 'Microphone allowed' : 'Microphone blocked')}><Mic className="w-4 h-4" /></IconBtn>
                  <IconBtn label={p.cameraBlocked ? 'Allow camera' : 'Block camera'} active={p.cameraBlocked} onClick={() => run(`cb${p.socketId}`, () => manager.permission(p.socketId, { camera: !!p.cameraBlocked }), p.cameraBlocked ? 'Camera allowed' : 'Camera blocked')}><Video className="w-4 h-4" /></IconBtn>
                  <IconBtn label={config.spotlightUserId === p.userId ? 'End spotlight' : 'Spotlight'} active={config.spotlightUserId === p.userId} onClick={() => run(`s${p.socketId}`, () => manager.spotlight(config.spotlightUserId === p.userId ? null : p.userId))}>{config.spotlightUserId === p.userId ? <PinOff className="w-4 h-4" /> : <Pin className="w-4 h-4" />}</IconBtn>
                  {config.hostCanSelectStudents !== false && <IconBtn label={selected.has(p.userId) ? 'Remove from selected' : 'Show to the class (select)'} active={selected.has(p.userId)} onClick={() => run(`sel${p.socketId}`, () => manager.select(selected.has(p.userId) ? [...selected].filter((x) => x !== p.userId) : [...selected, p.userId]))}><Star className="w-4 h-4" /></IconBtn>}
                  {config.screenShare === 'host_and_presenters' && <IconBtn label={presenters.has(p.userId) ? 'Remove presenter' : 'Make presenter'} active={presenters.has(p.userId)} onClick={() => run(`pr${p.socketId}`, () => manager.permission(p.socketId, { present: !presenters.has(p.userId) }))}><Presentation className="w-4 h-4" /></IconBtn>}
                  {manager.ask && !p.isCameraOn && <IconBtn label="Ask to turn on camera" onClick={() => run(`ac${p.socketId}`, () => manager.ask!(p.socketId, 'camera'), 'Request sent')}><Video className="w-4 h-4 text-brand-primary" /></IconBtn>}
                  {confirm === p.socketId ? (
                    <span className="inline-flex items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-2 min-h-[44px] text-xs text-rose-700">Remove {p.name.split(' ')[0]}?
                      <button className="font-bold underline min-h-[32px] px-1" onClick={() => { setConfirm(null); setOpen(null); run(`rm${p.socketId}`, () => manager.remove(p.socketId), `${p.name} removed`); }} data-testid="confirm-remove">Yes</button>
                      <button className="underline min-h-[32px] px-1" onClick={() => setConfirm(null)}>No</button></span>
                  ) : <IconBtn label={`Remove ${p.name}`} danger onClick={() => setConfirm(p.socketId)}><Trash2 className="w-4 h-4" /></IconBtn>}
                </div>
              )}
            </li>
          );
        })}
        {list.length === 0 && <li className="px-3 py-8 text-center text-xs text-text-muted">Nobody else is here yet.</li>}
      </ul>
    </div>
  );
  if (embedded) return <div className="flex flex-col min-h-0">{body}</div>;
  return (
    <>
      <button aria-label="Close people" onClick={onClose} className="fixed inset-0 z-30 bg-black/40 cursor-default" tabIndex={-1} />
      <aside aria-label="People" className="fixed z-40 bg-surface flex flex-col min-h-0 shadow-2xl inset-x-0 bottom-0 h-[72dvh] max-h-[560px] rounded-t-2xl border-t border-border-subtle sm:inset-x-auto sm:right-0 sm:top-0 sm:bottom-0 sm:h-auto sm:max-h-none sm:w-[22rem] sm:rounded-none sm:border-l sm:border-t-0 sm:pt-[env(safe-area-inset-top)]">
        <div className="flex items-center justify-between px-3 h-12 border-b border-border-subtle flex-shrink-0">
          <h2 className="font-heading text-sm font-semibold text-text-primary">People <span className="text-text-muted font-normal">· {students} student{students === 1 ? '' : 's'}</span></h2>
          <button onClick={onClose} aria-label="Close people" className="w-11 h-11 -mr-2 inline-flex items-center justify-center text-text-muted hover:text-text-primary"><X className="w-4 h-4" /></button>
        </div>
        {body}
      </aside>
    </>
  );
};

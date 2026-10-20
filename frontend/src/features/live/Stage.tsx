import React from 'react';
import { Crown, MicOff, Monitor, Loader, VideoOff, Radio, Pin, ShieldCheck } from 'lucide-react';
import { StreamVideo } from './media';
import { initials, StageChoice, stageState } from './logic';
import type { RoomParticipant } from './types';

const PALETTE = ['bg-indigo-500/25 text-indigo-200', 'bg-emerald-500/25 text-emerald-200', 'bg-rose-500/25 text-rose-200', 'bg-amber-500/25 text-amber-200', 'bg-sky-500/25 text-sky-200', 'bg-violet-500/25 text-violet-200'];
export const Avatar: React.FC<{ name: string; size?: 'sm' | 'md' | 'xl' }> = ({ name, size = 'md' }) => (
  <div aria-hidden="true" className={`${PALETTE[(name.charCodeAt(0) || 0) % PALETTE.length]} rounded-full flex items-center justify-center font-bold ${size === 'xl' ? 'w-24 h-24 text-3xl' : size === 'md' ? 'w-12 h-12 text-base' : 'w-8 h-8 text-xs'}`}>{initials(name)}</div>
);

interface TileProps {
  p: RoomParticipant; stream: MediaStream | null; isSelf: boolean; selfStream: MediaStream | null; selfCamOn: boolean; selfMicOn: boolean;
  onPin?: (id: string) => void; className?: string; compact?: boolean;
}
/** One participant. A picture is shown only when the person's camera is on AND a stream was allowed to reach us; otherwise their initials. */
export const Tile: React.FC<TileProps> = ({ p, stream, isSelf, selfStream, selfCamOn, selfMicOn, className = '', compact = false }) => {
  const camOn = isSelf ? selfCamOn : p.isCameraOn;
  const micOn = isSelf ? selfMicOn : p.isMicOn;
  const shown = isSelf ? selfStream : stream;
  const showVideo = !!shown && (camOn || p.isScreenSharing);
  return (
    <div data-testid={`tile-${p.socketId}`} className={`relative overflow-hidden rounded-xl bg-[#14162a] border border-white/10 ${className}`}>
      {showVideo ? (
        <StreamVideo stream={shown} muted={isSelf || true} mirror={isSelf && !p.isScreenSharing} isPortrait={p.isPortrait} className="absolute inset-0 w-full h-full" label={`${p.name} video`} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center"><Avatar name={p.name} size={compact ? 'sm' : 'md'} /></div>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1 px-1.5 py-1 bg-gradient-to-t from-black/70 to-transparent text-white">
        {p.isHost && <Crown className="w-3 h-3 text-amber-300 flex-shrink-0" aria-label="Teacher" />}
        {p.isAdmin && <ShieldCheck className="w-3 h-3 text-sky-300 flex-shrink-0" aria-label="Admin moderator" />}
        <span className="truncate text-[11px] font-medium">{isSelf ? 'You' : p.name}{p.isAdmin ? ' · Admin' : ''}</span>
        {!micOn && <MicOff className="w-3 h-3 text-rose-300 ml-auto flex-shrink-0" aria-label="Microphone off" />}
      </div>
    </div>
  );
};

interface MainStageProps {
  choice: StageChoice; participants: RoomParticipant[]; streams: Record<string, MediaStream>; selfSocketId?: string; selfStream: MediaStream | null;
  /** screen-share streams of other people, and our own screen / camera (the camera and the screen are separate streams) */
  screens?: Record<string, MediaStream>; selfScreen?: MediaStream | null; selfCam?: MediaStream | null;
  selfCamOn: boolean; hostPresent: boolean; hostName?: string; hostMissingStream?: boolean; reconnecting: boolean; isHost: boolean; sharing: boolean;
}
/** The MAIN stage: the shared screen, else the spotlit person, else the teacher's camera - never the chat, never an arbitrary tile. */
export const MainStage: React.FC<MainStageProps> = ({ choice, participants, streams, screens = {}, selfScreen = null, selfCam = null, selfSocketId, selfStream, selfCamOn, hostPresent, hostName = 'the teacher', reconnecting, isHost, sharing }) => {
  const target = participants.find((p) => p.socketId === choice.socketId);
  const isSelfTarget = !!target && target.socketId === selfSocketId;
  const isScreen = choice.kind === 'screen';
  // the shared screen and the camera are different streams: the stage shows the screen, the picture-in-picture shows the camera
  const stream = isScreen
    ? (isSelfTarget ? selfScreen || selfStream : (choice.socketId ? screens[choice.socketId] || null : null))
    : (isSelfTarget ? selfStream : (choice.socketId ? streams[choice.socketId] || null : null));
  const pipStream = isScreen && target ? (isSelfTarget ? selfCam : streams[target.socketId] || null) : null;
  const pipCamOn = !!target && (isSelfTarget ? selfCamOn : target.isCameraOn);
  const hostP = participants.find((p) => p.isHost);
  const state = stageState(choice, hostP, !!stream, hostPresent);
  const label = choice.kind === 'screen' ? `${target?.isHost ? 'Teacher' : target?.name || 'Someone'} is sharing their screen` : choice.kind === 'spotlight' ? `${target?.name} (spotlight)` : target?.name || hostName;

  return (
    <div data-testid="main-stage" data-stage-kind={choice.kind} data-stage-state={state} className="relative w-full h-full min-h-0 rounded-2xl overflow-hidden bg-[#0d0f1f] border border-white/10">
      {stream && (state === 'screen' || state === 'camera') && (
        <StreamVideo stream={stream} muted={isSelfTarget || true} contain mirror={isSelfTarget && choice.kind !== 'screen'} isPortrait={target?.isPortrait} className="absolute inset-0 w-full h-full" label={label} />
      )}

      {state !== 'screen' && state !== 'camera' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center px-6 gap-3 text-white/80" role="status" aria-live="polite">
          {state === 'host-away' && (<><Radio className="w-9 h-9 text-white/50" /><p className="font-heading font-semibold text-base">{isHost ? 'Your class is ready' : 'Waiting for the teacher to start'}</p><p className="text-sm text-white/60 max-w-xs">{isHost ? 'Students will appear as they join.' : "You're in the class. The teacher's video will appear here as soon as they join."}</p></>)}
          {state === 'connecting' && (<><Loader className="w-9 h-9 animate-spin text-white/60" /><p className="font-semibold text-base">{reconnecting ? 'Reconnecting…' : `Connecting to ${hostName}…`}</p><p className="text-sm text-white/60">This usually takes a few seconds.</p></>)}
          {state === 'camera-off' && (<>{target && <Avatar name={target.name} size="xl" />}<p className="font-semibold text-base flex items-center gap-2"><VideoOff className="w-4 h-4" />{target?.name || hostName}&apos;s camera is off</p><p className="text-sm text-white/60">You can still hear the class{target && !target.isMicOn ? ' when they unmute' : ''}.</p></>)}
        </div>
      )}

      {state === 'screen' && target && (
        <div data-testid="camera-pip" data-pip-live={pipCamOn && !!pipStream ? 'true' : 'false'}
          className="absolute right-2 bottom-2 z-10 w-[30%] min-w-[84px] max-w-[132px] md:portrait:max-w-[220px] lg:max-w-[220px] aspect-video overflow-hidden rounded-lg bg-[#14162a] border border-white/25 shadow-lg">
          {pipCamOn && pipStream
            ? <StreamVideo stream={pipStream} muted contain mirror={isSelfTarget} isPortrait={target.isPortrait} className="absolute inset-0 w-full h-full" label={`${target.name} camera`} />
            : <div className="absolute inset-0 flex items-center justify-center"><Avatar name={target.name} size="sm" /></div>}
          {!pipCamOn && <span className="sr-only">{target.name}&apos;s camera is off</span>}
        </div>
      )}

      {(state === 'screen' || (state === 'camera' && choice.kind !== 'host')) && (
        <div className="absolute top-2 left-2 right-2 flex items-center gap-1.5 pointer-events-none">
          <span className="inline-flex items-center gap-1.5 max-w-full rounded-full bg-black/60 text-white text-xs px-2.5 py-1">
            {choice.kind === 'screen' ? <Monitor className="w-3.5 h-3.5" /> : <Pin className="w-3.5 h-3.5" />}<span className="truncate">{sharing && isSelfTarget ? 'You are sharing your screen' : label}</span>
          </span>
        </div>
      )}
      {state === 'camera' && choice.kind === 'host' && target && (
        <div className="absolute bottom-2 left-2 inline-flex items-center gap-1.5 rounded-full bg-black/55 text-white text-xs px-2.5 py-1 pointer-events-none"><Crown className="w-3.5 h-3.5 text-amber-300" /><span className="truncate max-w-[60vw]">{target.name}</span>{!target.isMicOn && <MicOff className="w-3 h-3 text-rose-300" />}</div>
      )}
      {isSelfTarget && !selfCamOn && choice.kind === 'host' && <span className="sr-only">Your camera is off</span>}
    </div>
  );
};

/** The box the main stage lives in. A phone held upright gets a landscape (16:9) stage so the whole camera frame fits; wider / shorter screens fill the space. */
export const StageBox: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex-1 min-h-0 max-lg:portrait:flex-none max-lg:portrait:w-full max-lg:portrait:aspect-video" data-testid="stage-box">{children}</div>
);

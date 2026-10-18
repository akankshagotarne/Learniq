import React, { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Loader2, Mic, MicOff, RefreshCw, SwitchCamera, Video, VideoOff, WifiOff } from 'lucide-react';
import { useInterviewRoom, mediaProblemMessage, RoomPhase } from '../../hooks/useInterviewRoom';

const PHASE_TEXT: Partial<Record<RoomPhase, string>> = {
  preparing: 'Checking your camera and microphone…',
  'awaiting-permission': 'Waiting for camera and microphone permission - choose Allow in your browser…',
  joining: 'Joining the interview room…',
  'waiting-peer': 'Waiting for the other person to join…',
  connecting: 'Connecting video…',
  reconnecting: 'Connection lost. Reconnecting…',
  ended: 'The interview has ended.',
  replaced: 'This interview was opened in another tab or window, so this one was closed.',
};

const Video_: React.FC<{ stream: MediaStream | null; muted?: boolean; mirror?: boolean; label: string; off?: boolean; testId: string; placeholder?: string }> = ({ stream, muted, mirror, label, off, testId, placeholder }) => {
  const ref = useRef<HTMLVideoElement>(null);
  const [blocked, setBlocked] = useState(false); // the browser may refuse to start sound without a click (autoplay policy)
  useEffect(() => {
    const v = ref.current; if (!v) return;
    if (v.srcObject !== stream) v.srcObject = stream;
    if (stream) v.play().then(() => setBlocked(false), () => setBlocked(true));
  }, [stream]);
  return (
    <div className="relative rounded-2xl overflow-hidden bg-[#0B1020] aspect-video w-full border border-border-subtle">
      <video ref={ref} autoPlay playsInline muted={muted} data-testid={testId} className={`w-full h-full object-cover ${mirror ? '-scale-x-100' : ''} ${off ? 'opacity-0' : ''}`} />
      {(off || !stream) && <div className="absolute inset-0 flex items-center justify-center text-white/70 text-xs text-center px-3" data-testid={`${testId}-placeholder`}><VideoOff className="w-6 h-6 mr-2 shrink-0" aria-hidden="true" /> {placeholder || 'Camera off'}</div>}
      {blocked && stream && <button type="button" onClick={() => ref.current?.play().then(() => setBlocked(false), () => undefined)} className="absolute inset-x-0 bottom-9 mx-auto w-fit px-3 py-1.5 rounded-full bg-white text-black text-xs font-semibold" data-testid={`${testId}-play`}>Tap to start sound</button>}
      <span className="absolute left-2 bottom-2 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-black/55 text-white">{label}</span>
    </div>
  );
};

interface Props {
  interviewId: string;
  role: 'teacher' | 'student';
  peerLabel: string;
  onEnded?: () => void;
  /** page-level action buttons shown beside the call controls (complete / leave ...) */
  actions?: React.ReactNode;
}

/** The two-way call surface shared by teacher and student. Media never touches the server. */
const InterviewRoomView: React.FC<Props> = ({ interviewId, role, peerLabel, onEnded, actions }) => {
  const r = useInterviewRoom({ interviewId, role, enabled: true, onEnded });
  const busy = ['preparing', 'awaiting-permission', 'joining'].includes(r.phase);
  const camReady = !!r.localStream && r.localStream.getVideoTracks().some((t) => t.readyState === 'live');
  const micReady = !!r.localStream && r.localStream.getAudioTracks().some((t) => t.readyState === 'live');

  if (r.phase === 'media-error' && r.mediaProblem) {
    return (
      <div className="card-soft p-5 rounded-2xl border border-[#E1447A]/30" role="alert" data-testid="room-media-error">
        <p className="flex items-center gap-2 font-semibold text-text-primary"><AlertTriangle className="w-5 h-5 text-[#E1447A]" aria-hidden="true" /> {r.mediaProblem.device === 'camera' ? 'Camera needed' : r.mediaProblem.device === 'microphone' ? 'Microphone needed' : 'Camera / microphone needed'}</p>
        <p className="text-sm text-text-secondary mt-2">{mediaProblemMessage(r.mediaProblem)}</p>
        <button type="button" onClick={r.retry} className="btn-primary mt-4 min-h-[44px] px-4 rounded-xl text-sm font-bold inline-flex items-center gap-2"><RefreshCw className="w-4 h-4" /> Try again</button>
      </div>
    );
  }
  if (r.phase === 'error') {
    return (
      <div className="card-soft p-5 rounded-2xl border border-[#E1447A]/30" role="alert" data-testid="room-error">
        <p className="flex items-center gap-2 font-semibold text-text-primary"><WifiOff className="w-5 h-5 text-[#E1447A]" aria-hidden="true" /> Could not join</p>
        <p className="text-sm text-text-secondary mt-2">{r.error || 'Something went wrong while joining.'}</p>
        <button type="button" onClick={r.retry} className="btn-primary mt-4 min-h-[44px] px-4 rounded-xl text-sm font-bold inline-flex items-center gap-2"><RefreshCw className="w-4 h-4" /> Try again</button>
      </div>
    );
  }

  const text = PHASE_TEXT[r.phase];
  return (
    <div className="space-y-3" data-testid="interview-room" data-phase={r.phase}>
      <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
        <div className="relative">
          <Video_ stream={r.remoteStream} label={peerLabel} off={!!r.remoteStream && !r.peerMedia.camera} testId="remote-video"
            placeholder={r.phase === 'waiting-peer' ? `Waiting for ${peerLabel} to join…` : !r.remoteStream || r.phase === 'connecting' || r.phase === 'joining' || busy ? 'Video will appear here once connected' : 'Camera off'} />
          {(busy || r.phase !== 'connected') && text && (
            <div className="absolute inset-x-0 top-3 mx-auto w-fit max-w-[90%] px-3 py-1.5 rounded-full bg-black/65 text-white text-xs flex items-center gap-2" role="status" aria-live="polite">
              {r.phase !== 'ended' && r.phase !== 'replaced' && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />} {text}
            </div>
          )}
          {r.phase === 'connected' && !r.peerMedia.mic && <span className="absolute right-2 top-2 text-[11px] px-2 py-0.5 rounded-full bg-black/60 text-white flex items-center gap-1"><MicOff className="w-3 h-3" /> Muted</span>}
        </div>
        <Video_ stream={r.localStream} muted mirror={r.facing !== 'environment'} label="You" off={!r.camOn} testId="local-video" placeholder={r.localStream ? 'Camera off' : 'Starting your camera…'} />
      </div>
      <p className="text-xs text-text-secondary flex flex-wrap gap-x-4 gap-y-1" data-testid="device-status" role="status">
        <span data-testid="camera-status">Camera: {camReady ? (r.camOn ? 'ready' : 'turned off') : busy ? 'starting…' : 'not available'}</span>
        <span data-testid="mic-status">Microphone: {micReady ? (r.micOn ? 'ready' : 'muted') : busy ? 'starting…' : 'not available'}</span>
        <span data-testid="connection-status">Connection: {{ connected: 'connected', reconnecting: 'reconnecting…', connecting: 'connecting…', 'waiting-peer': 'waiting for the other person', joining: 'joining…', ended: 'ended' }[r.phase as string] || 'getting ready…'}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={r.toggleMic} disabled={!r.localStream} aria-pressed={!r.micOn} aria-label={r.micOn ? 'Mute microphone' : 'Unmute microphone'}
          className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-surface-alt border border-border-subtle text-text-primary text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
          {r.micOn ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4 text-[#E1447A]" />} {!r.localStream ? 'Mic not ready' : r.micOn ? 'Mic on' : 'Mic off'}
        </button>
        <button type="button" onClick={r.toggleCam} disabled={!r.localStream} aria-pressed={!r.camOn} aria-label={r.camOn ? 'Turn camera off' : 'Turn camera on'}
          className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-surface-alt border border-border-subtle text-text-primary text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
          {r.camOn ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4 text-[#E1447A]" />} {!r.localStream ? 'Camera not ready' : r.camOn ? 'Camera on' : 'Camera off'}
        </button>
        {(() => {
          const why = !r.localStream ? 'Your camera is not ready yet.' : !r.camOn ? 'Turn your camera on to switch cameras.' : !r.canSwitchCamera ? 'No other camera was found on this device.' : r.switching ? 'Switching camera…' : '';
          const disabled = !!why || r.phase === 'ended' || r.phase === 'replaced';
          return (
            <button type="button" onClick={() => { void r.switchCamera(); }} disabled={disabled} aria-busy={r.switching} title={why || 'Switch between your front and rear camera'} data-testid="switch-camera"
              className="min-h-[44px] min-w-[44px] px-3 rounded-xl bg-surface-alt border border-border-subtle text-text-primary text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50">
              {r.switching ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : <SwitchCamera className="w-4 h-4" aria-hidden="true" />} {r.switching ? 'Switching…' : 'Switch Camera'}
            </button>
          );
        })()}
        {actions}
      </div>
      {r.switchMessage && <p className="text-xs text-[#E1447A]" role="alert" data-testid="switch-camera-message">{r.switchMessage}</p>}
      {r.localStream && r.camOn && !r.canSwitchCamera && !busy && <p className="text-[11px] text-text-muted" data-testid="switch-camera-hint">Only one camera was found on this device, so Switch Camera is unavailable.</p>}
      <p className="text-[11px] text-text-muted">Video and audio go directly between you and {role === 'teacher' ? 'the student' : 'your teacher'}. LearnIQ does not record this interview.</p>
    </div>
  );
};

export default InterviewRoomView;

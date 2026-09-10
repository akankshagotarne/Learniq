import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Mic, MicOff, Video, VideoOff, MessageSquare, Users, X, Send, PhoneOff,
  Trophy, Clock, CheckCircle, Crown, Monitor, MonitorOff, Square, Sparkles, Copy,
  BarChart2, HelpCircle, Bell, UserCheck, UserX, Maximize2, Minimize2, Loader,
  Pin, PinOff,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getSocket } from '../../services/socket';
import api from '../../services/api';
import {
  LiveSession, ChatMessage, Participant, LeaderboardEntry, Quiz, Question,
  LiveMcq, McqResultEntry, ScoreboardEntry, PodiumEntry,
} from '../../types';
import toast from 'react-hot-toast';

// ======================= TYPES =======================

type LiveView = 'session' | 'quiz' | 'leaderboard';

interface WaitingEntry {
  socketId: string;
  name: string;
  userId: string;
}

// ======================= CONSTANTS =======================

// STUN servers alone are not enough once participants are on different
// networks (school WiFi vs. mobile data/hotspot, symmetric NAT, campus
// firewalls that block UDP). Without a TURN relay, those specific peer
// pairs silently fail to connect while others succeed -- which looks
// exactly like a "some people can see each other, some can't" bug even
// though the signaling/offer-answer code is correct. Adding a TURN
// server (including a TCP/443 option, which gets through almost any
// firewall) fixes that class of failure.
const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun.services.mozilla.com' },
  // Free public TURN relay (Open Relay Project / Metered.ca) - fine for
  // testing and small live classes. For production at scale, replace
  // with a paid TURN provider (Twilio, Xirsys, metered.ca paid tier) and
  // move the credentials to environment variables instead of hardcoding.
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
];

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

const AVATAR_COLORS = [
  'bg-[#6C63F2]/30 text-[#6C63F2] border-[#6C63F2]/40',
  'bg-[#16A34A]/30 text-[#16A34A] border-[#16A34A]/40',
  'bg-[#E1447A]/30 text-[#E1447A] border-[#E1447A]/40',
  'bg-[#F59E0B]/30 text-[#F59E0B] border-[#F59E0B]/40',
  'bg-[#0EA5E9]/30 text-[#0EA5E9] border-[#0EA5E9]/40',
  'bg-[#8B5CF6]/30 text-[#8B5CF6] border-[#8B5CF6]/40',
];

const getAvatarColor = (name: string) =>
  AVATAR_COLORS[(name.charCodeAt(0) || 0) % AVATAR_COLORS.length];

// ======================= StreamVideo =======================

const StreamVideo: React.FC<{
  stream: MediaStream | null;
  muted?: boolean;
  className?: string;
}> = ({ stream, muted = true, className = 'w-full h-full object-cover' }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (stream) {
      video.srcObject = stream;
      video.play().catch(err => {
        console.warn('[StreamVideo] Autoplay blocked:', err);
      });
    } else {
      video.srcObject = null;
    }
  }, [stream]);

  return <video ref={videoRef} autoPlay playsInline muted={muted} className={className} />;
};

// ======================= RemoteAudioPool =======================

const SingleRemoteAudio: React.FC<{ socketId: string; stream: MediaStream }> = ({ socketId, stream }) => {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.srcObject = stream;

    let onUserInteraction: (() => void) | null = null;

    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch(err => {
        console.warn(`[Audio] Autoplay blocked for ${socketId}:`, err);
        onUserInteraction = () => {
          audio.play().catch(() => {});
          if (onUserInteraction) {
            window.removeEventListener('click', onUserInteraction);
            window.removeEventListener('keydown', onUserInteraction);
          }
        };
        window.addEventListener('click', onUserInteraction);
        window.addEventListener('keydown', onUserInteraction);
      });
    }

    return () => {
      if (onUserInteraction) {
        window.removeEventListener('click', onUserInteraction);
        window.removeEventListener('keydown', onUserInteraction);
      }
    };
  }, [stream, socketId]);

  return <audio ref={audioRef} autoPlay playsInline />;
};

const RemoteAudioPool: React.FC<{
  remoteStreams: Record<string, MediaStream>;
  mySocketId: string;
}> = ({ remoteStreams, mySocketId }) => {
  return (
    <div style={{ display: 'none' }} aria-hidden="true">
      {Object.entries(remoteStreams).map(([socketId, stream]) => {
        if (socketId === mySocketId) return null;
        return <SingleRemoteAudio key={socketId} socketId={socketId} stream={stream} />;
      })}
    </div>
  );
};

// ======================= ParticipantTile =======================

const ParticipantTile: React.FC<{
  participant: Participant;
  stream: MediaStream | null;
  isLocal: boolean;
  isPinned: boolean;
  size: 'large' | 'small';
  onPin: () => void;
  onUnpin?: () => void;
  isViewerTeacher: boolean;
  onRequestMedia?: (type: 'camera' | 'mic') => void;
  /** Override isCameraOn for local tile */
  localCamOn?: boolean;
  localMicOn?: boolean;
}> = ({
  participant, stream, isLocal, isPinned, size, onPin, onUnpin,
  isViewerTeacher, onRequestMedia, localCamOn, localMicOn,
}) => {
  const isCamEffective = isLocal ? (localCamOn ?? false) : participant.isCameraOn;
  const isMicEffective = isLocal ? (localMicOn ?? false) : participant.isMicOn;
  
  // Video is only shown if the participant has actively turned their camera on.
  // When camera is off, avatar is displayed even though a placeholder track keeps the WebRTC pipeline active.
  const showVideo = isLocal ? (localCamOn && !!stream) : (participant.isCameraOn && !!stream);
  const avatarColor = getAvatarColor(participant.name || 'U');

  const sizeClasses = size === 'small'
    ? 'h-full aspect-video flex-shrink-0 min-w-[160px] w-[160px]'
    : 'w-full h-full';

  return (
    <div
      className={`relative bg-[#0D0E1A] rounded-xl overflow-hidden group cursor-pointer
        ${sizeClasses}
        ${isPinned ? 'ring-2 ring-brand-primary ring-offset-2 ring-offset-[#0D0E1A]' : ''}
      `}
      onClick={isPinned && onUnpin ? onUnpin : onPin}
    >
      {/* Video or Avatar */}
      {showVideo ? (
        <StreamVideo stream={stream} muted={true} className="w-full h-full object-cover" />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center gap-2">
          <div className={`rounded-full flex items-center justify-center font-bold border-2 ${avatarColor}
            ${size === 'small' ? 'w-10 h-10 text-base' : 'w-16 h-16 text-2xl'}
          `}>
            {(participant.name?.[0] || '?').toUpperCase()}
          </div>
          {size === 'large' && (
            <p className="text-white/60 text-xs font-medium">Camera off</p>
          )}
        </div>
      )}

      {/* Gradient overlay at bottom */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent px-2 py-2">
        <div className="flex items-center gap-1.5">
          <span className={`font-semibold text-white truncate ${size === 'small' ? 'text-[10px]' : 'text-xs'}`}>
            {participant.name}
            {isLocal && <span className="text-white/60 ml-1">(You)</span>}
          </span>
          {participant.isTeacher && (
            <Crown className={`text-accent-amber flex-shrink-0 ${size === 'small' ? 'w-2.5 h-2.5' : 'w-3 h-3'}`} />
          )}
          {!isMicEffective && (
            <MicOff className={`text-red-400 flex-shrink-0 ml-auto ${size === 'small' ? 'w-2.5 h-2.5' : 'w-3 h-3'}`} />
          )}
        </div>
      </div>

      {/* Pinned badge */}
      {isPinned && size === 'large' && (
        <div className="absolute top-2 left-2 flex items-center gap-1 bg-brand-primary/80 text-white text-[9px] px-1.5 py-0.5 rounded-md font-semibold">
          <Pin className="w-2.5 h-2.5" />
          PINNED
        </div>
      )}

      {/* Hover controls — large tiles only */}
      {size === 'large' && !isLocal && (
        <>
          {/* Pin / unpin */}
          <button
            onClick={(e) => { e.stopPropagation(); isPinned ? onUnpin?.() : onPin(); }}
            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-all bg-black/70 text-white p-1.5 rounded-lg hover:bg-black/90"
            title={isPinned ? 'Unpin' : 'Pin to spotlight'}
          >
            {isPinned ? <PinOff className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>

          {/* Teacher: request camera/mic buttons */}
          {isViewerTeacher && onRequestMedia && (
            <div className="absolute top-2 left-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
              {!participant.isCameraOn && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRequestMedia('camera'); }}
                  className="bg-black/70 text-white p-1.5 rounded-lg hover:bg-brand-primary/80 transition-all"
                  title="Request student to turn on camera"
                >
                  <Video className="w-3.5 h-3.5" />
                </button>
              )}
              {!participant.isMicOn && (
                <button
                  onClick={(e) => { e.stopPropagation(); onRequestMedia('mic'); }}
                  className="bg-black/70 text-white p-1.5 rounded-lg hover:bg-brand-primary/80 transition-all"
                  title="Request student to unmute"
                >
                  <Mic className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ======================= VideoGrid =======================

const VideoGrid: React.FC<{
  participants: Participant[];
  remoteStreams: Record<string, MediaStream>;
  localStream: MediaStream | null;
  mySocketId: string;
  isLocalParticipant: (p: Participant) => boolean;
  pinnedSocketId: string | null;
  onPin: (socketId: string | null) => void;
  isViewerTeacher: boolean;
  onRequestMedia: (targetSocketId: string, type: 'camera' | 'mic') => void;
  isCamOn: boolean;
  isMicOn: boolean;
}> = ({
  participants, remoteStreams, localStream, mySocketId, isLocalParticipant,
  pinnedSocketId, onPin, isViewerTeacher, onRequestMedia, isCamOn, isMicOn,
}) => {
  const pinnedP = participants.find(p => p.socketId === pinnedSocketId);
  const others = participants.filter(p => p.socketId !== pinnedSocketId);
  const count = participants.length;

  const getStream = (p: Participant) =>
    isLocalParticipant(p) ? localStream : (remoteStreams[p.socketId] || null);

  // ── Spotlight layout (a tile is pinned) ────────────────────────────────
  if (pinnedSocketId && pinnedP) {
    return (
      <div className="flex flex-col h-full gap-2">
        {/* Large spotlight */}
        <div className="flex-1 min-h-0">
          <ParticipantTile
            participant={pinnedP}
            stream={getStream(pinnedP)}
            isLocal={isLocalParticipant(pinnedP)}
            isPinned
            size="large"
            onPin={() => onPin(pinnedP.socketId)}
            onUnpin={() => onPin(null)}
            isViewerTeacher={isViewerTeacher}
            onRequestMedia={(type) => onRequestMedia(pinnedP.socketId, type)}
            localCamOn={isCamOn}
            localMicOn={isMicOn}
          />
        </div>
        {/* Filmstrip */}
        {others.length > 0 && (
          <div className="h-28 flex-shrink-0 flex gap-2 overflow-x-auto pb-1">
            {others.map(p => (
              <ParticipantTile
                key={p.socketId}
                participant={p}
                stream={getStream(p)}
                isLocal={isLocalParticipant(p)}
                isPinned={false}
                size="small"
                onPin={() => onPin(p.socketId)}
                isViewerTeacher={isViewerTeacher}
                onRequestMedia={(type) => onRequestMedia(p.socketId, type)}
                localCamOn={isCamOn}
                localMicOn={isMicOn}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  // ── No pin: auto grid layout ────────────────────────────────────────────
  const cols = count === 1 ? 1 : count <= 4 ? 2 : 3;
  const gridStyle: React.CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(${cols}, 1fr)`,
    gap: '8px',
    width: '100%',
    height: '100%',
  };

  return (
    <div style={gridStyle}>
      {participants.map(p => (
        <ParticipantTile
          key={p.socketId}
          participant={p}
          stream={getStream(p)}
          isLocal={isLocalParticipant(p)}
          isPinned={false}
          size="large"
          onPin={() => onPin(p.socketId)}
          isViewerTeacher={isViewerTeacher}
          onRequestMedia={(type) => onRequestMedia(p.socketId, type)}
          localCamOn={isCamOn}
          localMicOn={isMicOn}
        />
      ))}
    </div>
  );
};

// ======================= WaitingScreen (student) =======================

const WaitingScreen: React.FC<{
  sessionTitle?: string;
  onLeave: () => void;
}> = ({ sessionTitle, onLeave }) => (
  <div className="min-h-screen bg-page flex items-center justify-center p-4 relative overflow-hidden">
    <div className="absolute top-20 left-10 w-64 h-64 bg-brand-primary/10 rounded-full blur-3xl pointer-events-none" />
    <div className="absolute bottom-20 right-10 w-64 h-64 bg-[#FF8FA3]/10 rounded-full blur-3xl pointer-events-none" />

    <div className="relative z-10 card-soft p-10 rounded-2xl border border-border-subtle shadow-soft text-center max-w-md w-full">
      {/* Pulsing ring animation */}
      <div className="relative w-20 h-20 mx-auto mb-6">
        <div className="absolute inset-0 rounded-full border-4 border-brand-primary/20 animate-ping" />
        <div className="absolute inset-2 rounded-full border-4 border-brand-primary/40 animate-ping" style={{ animationDelay: '0.3s' }} />
        <div className="w-20 h-20 rounded-full bg-brand-primary/10 border-2 border-brand-primary flex items-center justify-center">
          <Loader className="w-8 h-8 text-brand-primary animate-spin" />
        </div>
      </div>

      <h2 className="font-heading font-black text-text-primary text-xl mb-2">
        Waiting for Approval
      </h2>
      <p className="text-text-secondary text-sm mb-1">
        The teacher will let you in shortly.
      </p>
      {sessionTitle && (
        <p className="text-text-muted text-xs mb-6 mt-2 px-3 py-1.5 bg-surface-alt rounded-xl inline-block">
          🎓 {sessionTitle}
        </p>
      )}
      {!sessionTitle && <div className="mb-6" />}

      <div className="flex justify-center gap-1 mb-8">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className="w-2 h-2 rounded-full bg-brand-primary animate-bounce"
            style={{ animationDelay: `${i * 0.15}s` }}
          />
        ))}
      </div>

      <button
        onClick={onLeave}
        className="px-5 py-2.5 bg-surface-alt border border-border-subtle text-text-secondary text-sm rounded-xl hover:text-text-primary hover:border-[#FF8FA3]/50 transition-all"
      >
        Leave Session
      </button>
    </div>
  </div>
);

// ======================= DeniedScreen =======================

const DeniedScreen: React.FC<{ onLeave: () => void }> = ({ onLeave }) => (
  <div className="min-h-screen bg-page flex items-center justify-center p-4">
    <div className="card-soft p-10 rounded-2xl border border-[#FF8FA3]/30 shadow-soft text-center max-w-sm w-full">
      <div className="w-16 h-16 rounded-full bg-[#FFE4EC] flex items-center justify-center mx-auto mb-5">
        <UserX className="w-8 h-8 text-[#E1447A]" />
      </div>
      <h2 className="font-heading font-black text-text-primary text-xl mb-2">Request Declined</h2>
      <p className="text-text-secondary text-sm mb-6">
        The teacher has declined your request to join this session.
      </p>
      <button onClick={onLeave} className="btn-primary w-full py-2.5 text-sm">
        Back to Live Sessions
      </button>
    </div>
  </div>
);

// ======================= MCQ FORM MODAL (Teacher) =======================

const McqFormModal: React.FC<{
  onClose: () => void;
  onLaunch: (question: string, options: string[], correctIndex: number) => void;
}> = ({ onClose, onLaunch }) => {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correctIndex, setCorrectIndex] = useState<number | null>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { questionRef.current?.focus(); }, []);

  const canLaunch = question.trim().length > 0 && options.every(o => o.trim().length > 0) && correctIndex !== null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
      <div className="bg-surface border border-border-subtle rounded-2xl shadow-2xl w-full max-w-lg animate-slide-up">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-brand-primary/10 rounded-lg">
              <HelpCircle className="w-4 h-4 text-brand-primary" />
            </div>
            <h2 className="font-heading font-bold text-text-primary text-sm">Raise MCQ Question</h2>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-text-secondary text-xs font-semibold mb-1.5 block">Question</label>
            <textarea
              ref={questionRef}
              value={question}
              onChange={e => setQuestion(e.target.value)}
              placeholder="Type your question here..."
              rows={3}
              className="w-full bg-surface-alt border border-border-subtle rounded-xl px-3.5 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-primary/30 resize-none"
            />
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-text-secondary text-xs font-semibold">Options</label>
              <span className="text-text-muted text-[11px]">Select the correct answer →</span>
            </div>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all ${correctIndex === i ? 'bg-brand-primary text-white' : 'bg-surface-alt border border-border-subtle text-text-muted'}`}>
                    {OPTION_LABELS[i]}
                  </div>
                  <input
                    type="text"
                    value={opt}
                    onChange={e => setOptions(prev => prev.map((o, idx) => idx === i ? e.target.value : o))}
                    placeholder={`Option ${OPTION_LABELS[i]}`}
                    className="flex-1 bg-surface-alt border border-border-subtle rounded-xl px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
                  />
                  <button
                    type="button"
                    onClick={() => setCorrectIndex(i)}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all flex-shrink-0 border ${correctIndex === i ? 'bg-accent-mint/20 text-accent-mint border-accent-mint/40' : 'bg-surface-alt border-border-subtle text-text-muted hover:border-accent-mint/30 hover:text-accent-mint'}`}
                  >
                    {correctIndex === i ? '✓ Correct' : 'Correct?'}
                  </button>
                </div>
              ))}
            </div>
          </div>
          {correctIndex !== null && (
            <div className="flex items-center gap-1.5 text-accent-mint text-xs bg-accent-mint/10 rounded-xl px-3 py-2">
              <CheckCircle className="w-3.5 h-3.5" />
              <span>Option <strong>{OPTION_LABELS[correctIndex]}</strong> marked as correct</span>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2.5 px-5 py-4 border-t border-border-subtle">
          <button onClick={onClose} className="px-4 py-2 text-text-secondary text-sm rounded-xl border border-border-subtle hover:bg-surface-alt transition-all">Cancel</button>
          <button
            onClick={() => { if (canLaunch) { onLaunch(question.trim(), options.map(o => o.trim()), correctIndex!); onClose(); } }}
            disabled={!canLaunch}
            className="px-5 py-2 bg-gradient-to-r from-brand-primary to-brand-secondary text-white rounded-xl text-sm font-semibold shadow-xs hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" /> Launch — 15s
          </button>
        </div>
      </div>
    </div>
  );
};

// ======================= MCQ OVERLAY =======================

const McqOverlay: React.FC<{
  mcq: LiveMcq;
  isTeacher: boolean;
  teacherCorrectIndex: number | null;
  timeLeft: number;
  selectedOption: number | null;
  isLocked: boolean;
  onSelect: (i: number) => void;
  onSubmit: () => void;
}> = ({ mcq, isTeacher, teacherCorrectIndex, timeLeft, selectedOption, isLocked, onSelect, onSubmit }) => {
  const isUrgent = timeLeft <= 5;
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fade-in">
      <div className="bg-surface border border-border-subtle rounded-2xl shadow-2xl w-full max-w-xl animate-slide-up">
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <div className="live-dot" />
            <span className="text-text-secondary text-xs font-semibold uppercase tracking-wide">Live MCQ</span>
          </div>
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono font-bold text-sm transition-all ${isUrgent ? 'bg-[#FFE4EC] text-[#E1447A] animate-pulse' : 'bg-brand-primary/10 text-brand-primary'}`}>
            <Clock className="w-4 h-4" />{timeLeft}s
          </div>
        </div>
        <div className="px-5 py-4">
          <p className="text-text-primary font-semibold text-base leading-relaxed">{mcq.question}</p>
          {isTeacher && <p className="text-text-muted text-xs mt-1.5 flex items-center gap-1"><Crown className="w-3 h-3 text-accent-amber" />Teacher view — correct answer highlighted</p>}
        </div>
        <div className="px-5 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {mcq.options.map((opt, i) => {
            const isSelected = selectedOption === i;
            const isCorrectOption = isTeacher && teacherCorrectIndex === i;
            let cls = 'bg-surface-alt border-border-subtle text-text-secondary hover:bg-surface hover:text-text-primary';
            if (isLocked && isSelected) cls = 'bg-brand-primary/10 border-brand-primary text-brand-primary font-semibold';
            else if (!isLocked && isSelected) cls = 'bg-brand-primary/10 border-brand-primary text-brand-primary font-semibold shadow-xs';
            if (isCorrectOption) cls = 'bg-accent-mint/15 border-accent-mint text-accent-mint font-semibold';
            return (
              <button key={i} onClick={() => !isLocked && !isTeacher && onSelect(i)} disabled={isLocked || isTeacher}
                className={`p-3.5 rounded-xl border text-left text-sm transition-all ${cls} ${isLocked || isTeacher ? 'cursor-default' : 'cursor-pointer'}`}>
                <span className="font-bold text-brand-primary mr-2">{OPTION_LABELS[i]}.</span>{opt}
                {isCorrectOption && <span className="ml-1 text-accent-mint text-xs">✓</span>}
              </button>
            );
          })}
        </div>
        {!isTeacher && (
          <div className="px-5 pb-5">
            {isLocked ? (
              <div className="flex items-center gap-2 justify-center py-3 bg-surface-alt border border-border-subtle rounded-xl text-text-secondary text-sm">
                <CheckCircle className="w-4 h-4 text-brand-primary" />
                {selectedOption !== null ? 'Answer locked in!' : "Time's up — no answer recorded"}
              </div>
            ) : (
              <button onClick={onSubmit} disabled={selectedOption === null} className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed">
                <CheckCircle className="w-4 h-4" /> Lock in Answer
              </button>
            )}
          </div>
        )}
        {isTeacher && <div className="px-5 pb-5 text-center text-text-muted text-xs">Auto-closes in {timeLeft}s</div>}
      </div>
    </div>
  );
};

// ======================= MCQ RESULTS POPUP =======================

const McqResultsPopup: React.FC<{
  results: McqResultEntry[];
  correctIndex: number;
  options: string[];
  currentUserId?: string;
  onClose: () => void;
}> = ({ results, correctIndex, options, currentUserId, onClose }) => {
  const correct = results.filter(r => r.isCorrect);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
      <div className="bg-surface border border-border-subtle rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col animate-slide-up">
        <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="font-heading font-black text-text-primary text-base">📊 MCQ Results</h2>
            <p className="text-text-muted text-xs mt-0.5">Correct: <strong className="text-accent-mint">{OPTION_LABELS[correctIndex]}. {options[correctIndex] || '...'}</strong></p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {correct.length > 0 ? (
            <>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">✅ Correct — ranked by speed</p>
              {correct.map((r, i) => (
                <div key={r.studentId} className={`flex items-center gap-3 p-3 rounded-xl border ${r.studentId === currentUserId ? 'bg-brand-primary/10 border-brand-primary/30' : 'bg-surface-alt border-border-subtle'}`}>
                  <span className={`w-7 h-7 flex items-center justify-center rounded-lg text-sm font-black flex-shrink-0 ${i === 0 ? 'bg-[#FEF3C7] text-yellow-600' : i === 1 ? 'bg-surface border border-border-subtle text-text-muted' : i === 2 ? 'bg-[#FFE4EC] text-[#E1447A]' : 'bg-surface-alt text-text-muted text-xs'}`}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                  </span>
                  <p className={`text-sm font-semibold flex-1 truncate ${r.studentId === currentUserId ? 'text-brand-primary' : 'text-text-primary'}`}>{r.studentName} {r.studentId === currentUserId && '(You)'}</p>
                  <p className="text-xs font-mono text-accent-mint font-semibold flex-shrink-0">{r.responseTimeSec !== null ? `${r.responseTimeSec}s` : '—'}</p>
                </div>
              ))}
            </>
          ) : (
            <p className="text-text-muted text-center py-8 text-sm">No correct answers for this question.</p>
          )}
        </div>
        <div className="px-5 py-3 border-t border-border-subtle flex-shrink-0">
          <button onClick={onClose} className="btn-primary w-full py-2.5 text-sm">Close Results</button>
        </div>
      </div>
    </div>
  );
};

// ======================= PARTICIPANTS DRAWER =======================

const ParticipantsDrawer: React.FC<{
  participants: Participant[];
  mySocketId: string;
  isViewerTeacher: boolean;
  isLocalParticipant: (p: Participant) => boolean;
  onRequestMedia: (targetSocketId: string, type: 'camera' | 'mic') => void;
  onClose: () => void;
}> = ({ participants, mySocketId, isViewerTeacher, isLocalParticipant, onRequestMedia, onClose }) => {
  return (
    <div className="w-72 sm:w-80 bg-surface border-l border-border-subtle flex flex-col flex-shrink-0 z-10 animate-slide-left">
      <div className="p-3.5 border-b border-border-subtle flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-brand-primary" />
          <span className="font-heading text-text-primary text-sm font-bold">
            Participants ({participants.length})
          </span>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1 rounded-lg">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {participants.map(p => {
          const isLocal = isLocalParticipant(p);
          const isStudent = !p.isTeacher;
          const avatarColor = getAvatarColor(p.name || 'U');

          return (
            <div
              key={p.socketId || p.userId}
              className="flex items-center justify-between p-2.5 rounded-xl bg-surface-alt/70 border border-border-subtle/80 hover:bg-surface-alt transition-all gap-2"
            >
              {/* Avatar + Info */}
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs border ${avatarColor} flex-shrink-0`}>
                  {(p.name?.[0] || '?').toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-semibold text-text-primary truncate">
                      {p.name}
                    </p>
                    {isLocal && <span className="text-[10px] text-text-muted font-normal">(You)</span>}
                  </div>
                  <div className="flex items-center gap-1 mt-0.5">
                    {p.isTeacher ? (
                      <span className="inline-flex items-center gap-0.5 text-[10px] text-accent-amber font-semibold">
                        <Crown className="w-2.5 h-2.5" /> Host
                      </span>
                    ) : (
                      <span className="text-[10px] text-text-muted capitalize">Student</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Status Icons & Host Request Actions */}
              <div className="flex items-center gap-1.5 flex-shrink-0">
                {/* Camera Status & Request Button */}
                {p.isCameraOn ? (
                  <div
                    title="Camera is on"
                    className="w-7 h-7 rounded-lg bg-accent-mint/10 text-accent-mint flex items-center justify-center"
                  >
                    <Video className="w-3.5 h-3.5" />
                  </div>
                ) : (
                  <div className="flex items-center">
                    {isViewerTeacher && isStudent && !isLocal ? (
                      <button
                        onClick={() => onRequestMedia(p.socketId, 'camera')}
                        title={`Ask ${p.name} to turn on camera`}
                        className="px-2 py-1 bg-brand-primary/10 hover:bg-brand-primary/20 text-brand-primary border border-brand-primary/20 rounded-lg text-[10px] font-semibold flex items-center gap-1 transition-all"
                      >
                        <Video className="w-3 h-3" />
                        <span>Ask Cam</span>
                      </button>
                    ) : (
                      <div
                        title="Camera is off"
                        className="w-7 h-7 rounded-lg bg-surface border border-border-subtle text-text-muted flex items-center justify-center"
                      >
                        <VideoOff className="w-3.5 h-3.5 text-text-muted/60" />
                      </div>
                    )}
                  </div>
                )}

                {/* Mic Status & Request Button */}
                {p.isMicOn ? (
                  <div
                    title="Microphone is on"
                    className="w-7 h-7 rounded-lg bg-accent-mint/10 text-accent-mint flex items-center justify-center"
                  >
                    <Mic className="w-3.5 h-3.5" />
                  </div>
                ) : (
                  <div className="flex items-center">
                    {isViewerTeacher && isStudent && !isLocal ? (
                      <button
                        onClick={() => onRequestMedia(p.socketId, 'mic')}
                        title={`Ask ${p.name} to unmute`}
                        className="px-2 py-1 bg-[#FEF3C7] hover:bg-[#FDE68A] text-[#92400E] border border-[#FDE68A] rounded-lg text-[10px] font-semibold flex items-center gap-1 transition-all"
                      >
                        <Mic className="w-3 h-3" />
                        <span>Ask Mic</span>
                      </button>
                    ) : (
                      <div
                        title="Microphone is muted"
                        className="w-7 h-7 rounded-lg bg-[#FFE4EC]/40 border border-[#FFE4EC] text-[#E1447A] flex items-center justify-center"
                      >
                        <MicOff className="w-3.5 h-3.5 text-[#E1447A]" />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

// ======================= SCOREBOARD MODAL =======================

const ScoreboardModal: React.FC<{
  scoreboard: ScoreboardEntry[];
  currentUserId?: string;
  onClose: () => void;
}> = ({ scoreboard, currentUserId, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
    <div className="bg-surface border border-border-subtle rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col animate-slide-up">
      <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5"><BarChart2 className="w-4 h-4 text-brand-primary" /><h2 className="font-heading font-bold text-text-primary text-sm">Session Scoreboard</h2></div>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {scoreboard.length === 0 && <p className="text-text-muted text-center py-8 text-sm">No MCQs asked yet.</p>}
        {scoreboard.map((entry, i) => (
          <div key={entry.userId} className={`flex items-center gap-3 p-3.5 rounded-xl border ${entry.userId === currentUserId ? 'bg-brand-primary/10 border-brand-primary/30' : i === 0 ? 'bg-[#FEF3C7]/30 border-[#FDE68A]/50' : 'bg-surface-alt border-border-subtle'}`}>
            <span className={`text-lg font-black w-8 text-center flex-shrink-0 ${i === 0 ? 'text-yellow-500' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-amber-600' : 'text-text-muted text-sm'}`}>
              {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
            </span>
            <p className={`font-semibold text-sm flex-1 truncate ${entry.userId === currentUserId ? 'text-brand-primary' : 'text-text-primary'}`}>{entry.name} {entry.userId === currentUserId && '(You)'}</p>
            <div className="flex items-center gap-3 flex-shrink-0 text-xs">
              <span className="text-accent-mint font-bold">✓{entry.correct}</span>
              <span className="text-[#E1447A] font-semibold">✗{entry.wrong}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="px-5 py-3 border-t border-border-subtle flex-shrink-0">
        <p className="text-text-muted text-[11px] text-center">Ranked by: most correct · fastest response time (tiebreaker)</p>
      </div>
    </div>
  </div>
);

// ======================= PODIUM SCREEN =======================

const PodiumScreen: React.FC<{
  podium: PodiumEntry[];
  currentUserId?: string;
  onDismiss: () => void;
}> = ({ podium, currentUserId, onDismiss }) => {
  const [countdown, setCountdown] = useState(10);
  useEffect(() => {
    const t = setInterval(() => {
      setCountdown(c => { if (c <= 1) { clearInterval(t); onDismiss(); return 0; } return c - 1; });
    }, 1000);
    return () => clearInterval(t);
  }, [onDismiss]);

  const place1 = podium.find(p => p.place === 1);
  const place2 = podium.find(p => p.place === 2);
  const place3 = podium.find(p => p.place === 3);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-[#0D0E1A] via-[#1a1b35] to-[#0D0E1A] animate-fade-in px-4">
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(30)].map((_, i) => (
          <div key={i} className="absolute w-1 h-1 bg-white rounded-full opacity-30 animate-pulse" style={{ left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`, animationDelay: `${Math.random() * 3}s`, animationDuration: `${2 + Math.random() * 3}s` }} />
        ))}
      </div>
      <div className="relative z-10 text-center mb-10"><p className="text-4xl mb-3">🏆</p><h1 className="font-heading font-black text-3xl text-white mb-1">Final Results</h1><p className="text-white/50 text-sm">Session has ended</p></div>
      <div className="relative z-10 flex items-end justify-center gap-4 mb-12 w-full max-w-lg">
        <div className="flex flex-col items-center">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center text-xl font-black mb-3 border-2 ${place2?.userId === currentUserId ? 'bg-brand-primary/30 border-brand-primary text-white' : 'bg-white/10 border-white/20 text-white'}`}>{place2?.name?.[0] || '?'}</div>
          <p className={`text-sm font-semibold mb-1 max-w-[90px] text-center truncate ${place2?.userId === currentUserId ? 'text-brand-primary' : 'text-white/80'}`}>{place2?.name || '—'}</p>
          {place2 && <p className="text-white/50 text-xs">✓{place2.correct}</p>}
          <div className="w-20 h-20 bg-slate-400/30 border-2 border-slate-400/50 rounded-t-xl flex items-end justify-center pb-2 mt-2"><span className="text-3xl">🥈</span></div>
        </div>
        <div className="flex flex-col items-center mb-8">
          <Crown className="w-6 h-6 text-accent-amber mb-1" />
          <div className={`w-20 h-20 rounded-full flex items-center justify-center text-2xl font-black mb-3 border-4 shadow-xl ${place1?.userId === currentUserId ? 'bg-brand-primary/30 border-brand-primary text-white' : 'bg-white/15 border-yellow-400/70 text-white'}`}>{place1?.name?.[0] || '?'}</div>
          <p className={`text-base font-bold mb-1 max-w-[110px] text-center truncate ${place1?.userId === currentUserId ? 'text-brand-primary' : 'text-white'}`}>{place1?.name || '—'}</p>
          {place1 && <p className="text-yellow-400 text-xs font-semibold">✓{place1.correct}</p>}
          <div className="w-24 h-28 bg-yellow-400/20 border-2 border-yellow-400/60 rounded-t-xl flex items-end justify-center pb-2 mt-2"><span className="text-4xl">🥇</span></div>
        </div>
        <div className="flex flex-col items-center">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center text-xl font-black mb-3 border-2 ${place3?.userId === currentUserId ? 'bg-brand-primary/30 border-brand-primary text-white' : 'bg-white/10 border-white/20 text-white'}`}>{place3?.name?.[0] || '?'}</div>
          <p className={`text-sm font-semibold mb-1 max-w-[90px] text-center truncate ${place3?.userId === currentUserId ? 'text-brand-primary' : 'text-white/80'}`}>{place3?.name || '—'}</p>
          {place3 && <p className="text-white/50 text-xs">✓{place3.correct}</p>}
          <div className="w-20 h-14 bg-amber-700/30 border-2 border-amber-600/50 rounded-t-xl flex items-end justify-center pb-2 mt-2"><span className="text-3xl">🥉</span></div>
        </div>
      </div>
      {podium.length === 0 && <p className="text-white/40 text-sm relative z-10 mb-8">No MCQ answers recorded this session.</p>}
      <button onClick={onDismiss} className="relative z-10 px-6 py-2.5 bg-white/10 border border-white/20 text-white rounded-xl text-sm hover:bg-white/15 transition-all">Continue ({countdown}s)</button>
    </div>
  );
};

// ======================= WEBRTC PLACEHOLDER TRACK GENERATORS =======================

function createBlankVideoTrack(): MediaStreamTrack | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#05060f';
      ctx.fillRect(0, 0, 16, 16);
    }
    const stream = (canvas as any).captureStream ? (canvas as any).captureStream(10) : null;
    if (stream && stream.getVideoTracks().length > 0) {
      const track = stream.getVideoTracks()[0];
      const interval = setInterval(() => {
        if (track.readyState === 'ended') {
          clearInterval(interval);
          return;
        }
        if (ctx) {
          ctx.fillStyle = '#05060f';
          ctx.fillRect(0, 0, 16, 16);
        }
      }, 1000);
      return track;
    }
  } catch (err) {
    console.warn('[WebRTC] Could not create blank video track:', err);
  }
  return null;
}

function createSilentAudioTrack(): MediaStreamTrack | null {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return null;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    gain.gain.value = 0; // 0 volume = completely silent
    const dst = ctx.createMediaStreamDestination();
    osc.connect(gain);
    gain.connect(dst);
    osc.start();
    const track = dst.stream.getAudioTracks()[0];
    track.enabled = true;
    return track;
  } catch (err) {
    console.warn('[WebRTC] Could not create silent audio track:', err);
  }
  return null;
}

// ======================= MAIN COMPONENT =======================

const LiveSessionPage: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [session, setSession] = useState<LiveSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<LiveView>('session');

  // Waiting room state
  const [isWaitingApproval, setIsWaitingApproval] = useState(false);
  const [joinDenied, setJoinDenied] = useState(false);
  const [waitingRoom, setWaitingRoom] = useState<WaitingEntry[]>([]);
  const [showWaitingRoomPanel, setShowWaitingRoomPanel] = useState(false);

  // Chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [showChat, setShowChat] = useState(true);
  const [showParticipants, setShowParticipants] = useState(false);

  // Media states
  const [isCamOn, setIsCamOn] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

  // Video grid state
  const [pinnedSocketId, setPinnedSocketId] = useState<string | null>(null);

  // Permission request (student receives from teacher)
  const [permRequest, setPermRequest] = useState<{ type: string; from: string; fromSocketId: string } | null>(null);

  // Legacy quiz state
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizResult, setQuizResult] = useState<{ score: number; totalMarks: number; percentage: number } | null>(null);
  const [quizTimeLeft, setQuizTimeLeft] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [quizStartTime, setQuizStartTime] = useState<number>(0);

  // MCQ state
  const [activeMcq, setActiveMcq] = useState<LiveMcq | null>(null);
  const [teacherCorrectIndex, setTeacherCorrectIndex] = useState<number | null>(null);
  const [mcqSelectedOption, setMcqSelectedOption] = useState<number | null>(null);
  const [mcqAnswerLocked, setMcqAnswerLocked] = useState(false);
  const [mcqTimeLeft, setMcqTimeLeft] = useState(0);
  const mcqTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [mcqClosedResults, setMcqClosedResults] = useState<{ results: McqResultEntry[]; correctIndex: number; options: string[] } | null>(null);
  const [showMcqResults, setShowMcqResults] = useState(false);
  const [showMcqForm, setShowMcqForm] = useState(false);
  const [showScoreboard, setShowScoreboard] = useState(false);
  const [scoreboard, setScoreboard] = useState<ScoreboardEntry[]>([]);
  const [showPodium, setShowPodium] = useState(false);
  const [podium, setPodium] = useState<PodiumEntry[]>([]);

  // WebRTC refs
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  const pendingCandidatesRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const chatEndRef = useRef<HTMLDivElement>(null);
  const blankVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const silentAudioTrackRef = useRef<MediaStreamTrack | null>(null);

  const getOrCreateBlankVideoTrack = useCallback((): MediaStreamTrack | null => {
    if (blankVideoTrackRef.current && blankVideoTrackRef.current.readyState === 'live') {
      return blankVideoTrackRef.current;
    }
    const track = createBlankVideoTrack();
    blankVideoTrackRef.current = track;
    return track;
  }, []);

  const getOrCreateSilentAudioTrack = useCallback((): MediaStreamTrack | null => {
    if (silentAudioTrackRef.current && silentAudioTrackRef.current.readyState === 'live') {
      return silentAudioTrackRef.current;
    }
    const track = createSilentAudioTrack();
    silentAudioTrackRef.current = track;
    return track;
  }, []);

  const socket = getSocket();
  const isTeacher = user?.role === 'teacher' || user?.role === 'admin';

  // ── MCQ server-authoritative countdown ─────────────────────────────────
  useEffect(() => {
    if (activeMcq) {
      if (mcqTimerRef.current) clearInterval(mcqTimerRef.current);
      mcqTimerRef.current = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((activeMcq.startTimestamp + activeMcq.durationMs - Date.now()) / 1000));
        setMcqTimeLeft(remaining);
        if (remaining <= 0) {
          if (mcqTimerRef.current) clearInterval(mcqTimerRef.current);
          setMcqAnswerLocked(true);
        }
      }, 250);
      return () => { if (mcqTimerRef.current) clearInterval(mcqTimerRef.current); };
    } else {
      if (mcqTimerRef.current) clearInterval(mcqTimerRef.current);
      setMcqTimeLeft(0);
    }
  }, [activeMcq]);

  // ── Mount / Join ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    let isMounted = true;

    const init = async () => {
      try {
        const res = await api.post(`/live-sessions/${code}/join`);
        if (!isMounted) return;
        setSession(res.data.session);
        setMessages(res.data.chatHistory || []);
        setLoading(false);
        socket.emit('join-live-session', { sessionCode: code });
      } catch (err: any) {
        if (!isMounted) return;
        toast.error(err.response?.data?.message || 'Failed to join session');
        navigate('/live-sessions');
      }
    };

    setupSocketListeners();
    init();

    return () => { isMounted = false; cleanup(); };
  }, [code, user]);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  // Legacy quiz timer
  useEffect(() => {
    if (!activeQuiz || quizSubmitted || quizTimeLeft <= 0) return;
    const timer = setInterval(() => {
      setQuizTimeLeft(t => {
        if (t <= 1) { clearInterval(timer); if (!quizSubmitted) handleSubmitQuiz(true); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [activeQuiz, quizSubmitted, quizTimeLeft]);

  // ── Cleanup ──────────────────────────────────────────────────────────────
  const cleanup = useCallback(() => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    screenStreamRef.current = null;
    blankVideoTrackRef.current?.stop();
    silentAudioTrackRef.current?.stop();
    blankVideoTrackRef.current = null;
    silentAudioTrackRef.current = null;
    Object.values(peerConnectionsRef.current).forEach(pc => { try { pc.close(); } catch {} });
    peerConnectionsRef.current = {};
    pendingCandidatesRef.current = {};
    setRemoteStreams({});

    const evts = [
      'existing-participants', 'teacher-joined',
      'participant-joined', 'participant-left', 'participant-camera', 'participant-mic',
      'webrtc-offer', 'webrtc-answer', 'webrtc-ice-candidate',
      'chat-message', 'chat-deleted',
      'quiz-started', 'quiz-result', 'leaderboard-update', 'quiz-ended',
      'session-ended', 'permission-request', 'permission-response', 'error',
      'waiting-for-approval', 'join-approved', 'join-denied', 'join-request', 'waiting-room-update',
      'mcq-raised', 'mcq-teacher-info', 'mcq-closed', 'mcq-results', 'mcq-answer-locked',
      'mcq-error', 'scoreboard-update',
    ];
    evts.forEach(e => socket.off(e));
  }, [socket]);

  // ── WebRTC: Get or Create Peer Connection ─────────────────────────────
  const getOrCreatePeerConnection = useCallback((targetSocketId: string): RTCPeerConnection => {
    const existingPc = peerConnectionsRef.current[targetSocketId];
    if (existingPc && existingPc.signalingState !== 'closed') {
      return existingPc;
    }

    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-ice-candidate', { targetSocketId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      console.log(`[WebRTC] ontrack from ${targetSocketId}:`, event.track.kind, event.track.id);
      setRemoteStreams(prev => {
        const existing = prev[targetSocketId];
        let stream: MediaStream;
        if (existing) {
          existing.getTracks().forEach(t => {
            if (t.kind === event.track.kind && t.id !== event.track.id) {
              existing.removeTrack(t);
            }
          });
          existing.addTrack(event.track);
          stream = new MediaStream(existing.getTracks());
        } else if (event.streams && event.streams[0]) {
          stream = new MediaStream(event.streams[0].getTracks());
        } else {
          stream = new MediaStream([event.track]);
        }
        return { ...prev, [targetSocketId]: stream };
      });

      event.track.onunmute = () => {
        setRemoteStreams(prev => {
          const s = prev[targetSocketId];
          return s ? { ...prev, [targetSocketId]: new MediaStream(s.getTracks()) } : prev;
        });
      };
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] ${targetSocketId} connectionState:`, pc.connectionState);
      if (pc.connectionState === 'failed') {
        try { pc.restartIce(); } catch {}
      }
    };

    // Pre-allocate transceivers with sendrecv and initial tracks (real or placeholder).
    // This is CRUCIAL: it guarantees both sides negotiate sendrecv in both directions
    // and neither browser ever defaults to recvonly.
    const activeStream = screenStreamRef.current || localStreamRef.current;
    const activeVideo = activeStream?.getVideoTracks()[0] || null;
    const activeAudio = activeStream?.getAudioTracks()[0] || null;

    const initialVideoTrack = activeVideo || getOrCreateBlankVideoTrack();
    const initialAudioTrack = activeAudio || getOrCreateSilentAudioTrack();

    try {
      if (initialAudioTrack) {
        pc.addTransceiver(initialAudioTrack, { direction: 'sendrecv' });
      } else {
        pc.addTransceiver('audio', { direction: 'sendrecv' });
      }
    } catch (e) {
      console.warn('[WebRTC] addTransceiver audio error:', e);
    }

    try {
      if (initialVideoTrack) {
        pc.addTransceiver(initialVideoTrack, { direction: 'sendrecv' });
      } else {
        pc.addTransceiver('video', { direction: 'sendrecv' });
      }
    } catch (e) {
      console.warn('[WebRTC] addTransceiver video error:', e);
    }

    peerConnectionsRef.current[targetSocketId] = pc;
    return pc;
  }, [socket, getOrCreateBlankVideoTrack, getOrCreateSilentAudioTrack]);

  const createOffer = useCallback(async (targetSocketId: string) => {
    try {
      const pc = getOrCreatePeerConnection(targetSocketId);
      if (pc.signalingState !== 'stable') {
        console.warn(`[WebRTC] Cannot create offer for ${targetSocketId} in state: ${pc.signalingState}`);
        return;
      }
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socket.emit('webrtc-offer', { targetSocketId, offer });
    } catch (err) {
      console.error(`[WebRTC] createOffer error for ${targetSocketId}:`, err);
    }
  }, [getOrCreatePeerConnection, socket]);

  const handleOffer = useCallback(async (fromSocketId: string, offer: RTCSessionDescriptionInit) => {
    try {
      const pc = getOrCreatePeerConnection(fromSocketId);

      // Handle glare (simultaneous offers)
      if (pc.signalingState !== 'stable') {
        if (pc.signalingState === 'have-local-offer') {
          try {
            await pc.setLocalDescription({ type: 'rollback' });
          } catch {}
        }
      }

      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Flush queued candidates
      const pending = pendingCandidatesRef.current[fromSocketId] || [];
      for (const c of pending) {
        try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
      }
      pendingCandidatesRef.current[fromSocketId] = [];

      // Ensure any active local tracks (or placeholder tracks) are attached to answerer's senders
      const activeStream = screenStreamRef.current || localStreamRef.current;
      const activeVideo = activeStream?.getVideoTracks()[0] || null;
      const activeAudio = activeStream?.getAudioTracks()[0] || null;
      const videoToSend = activeVideo || getOrCreateBlankVideoTrack();
      const audioToSend = activeAudio || getOrCreateSilentAudioTrack();

      const transceivers = pc.getTransceivers ? pc.getTransceivers() : [];
      let vTransceiver = transceivers.find(t => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video');
      let aTransceiver = transceivers.find(t => t.receiver?.track?.kind === 'audio' || t.sender?.track?.kind === 'audio');

      console.log('[WebRTC][handleOffer]', fromSocketId, 'transceivers after setRemoteDescription:',
        transceivers.map(t => ({ mid: t.mid, kind: t.receiver?.track?.kind, direction: t.direction, currentDirection: t.currentDirection, hasSenderTrack: !!t.sender.track })));

      // DEFENSIVE FIX: whatever direction was negotiated/inherited, force this
      // answerer's transceivers back to sendrecv before creating the answer.
      // Root cause this guards against: if the pre-created (addTransceiver)
      // local transceiver did NOT get reused/matched against the incoming
      // offer's m-line the way JSEP normally guarantees, the browser can end
      // up with a transceiver whose direction resolves to recvonly -- the
      // answer would then be technically valid but would never actually send
      // our video/audio back to the offerer, even though ICE/DTLS connects
      // fine and the offerer's track flows to us perfectly. That exactly
      // matches "the newcomer/offerer never sees the existing participant".
      try { if (vTransceiver) vTransceiver.direction = 'sendrecv'; } catch (e) { console.warn('[WebRTC] force video direction failed:', e); }
      try { if (aTransceiver) aTransceiver.direction = 'sendrecv'; } catch (e) { console.warn('[WebRTC] force audio direction failed:', e); }

      // If, after setRemoteDescription, we somehow still can't find a
      // transceiver for a kind (should not normally happen), fall back to
      // explicitly adding one so the answer still offers to send media.
      if (!vTransceiver) {
        try { vTransceiver = pc.addTransceiver(videoToSend || 'video', { direction: 'sendrecv' }); } catch (e) { console.warn('[WebRTC] fallback addTransceiver video failed:', e); }
      }
      if (!aTransceiver) {
        try { aTransceiver = pc.addTransceiver(audioToSend || 'audio', { direction: 'sendrecv' }); } catch (e) { console.warn('[WebRTC] fallback addTransceiver audio failed:', e); }
      }

      const replacePromises: Promise<void>[] = [];
      if (vTransceiver && videoToSend && vTransceiver.sender.track !== videoToSend) {
        replacePromises.push(vTransceiver.sender.replaceTrack(videoToSend).catch((e) => { console.warn('[WebRTC] replaceTrack video (answer) failed:', e); }));
      }
      if (aTransceiver && audioToSend && aTransceiver.sender.track !== audioToSend) {
        replacePromises.push(aTransceiver.sender.replaceTrack(audioToSend).catch((e) => { console.warn('[WebRTC] replaceTrack audio (answer) failed:', e); }));
      }
      // Wait for tracks to actually be attached before generating the SDP
      // answer, instead of firing-and-forgetting (avoids a race where the
      // answer is sent before the sender has a track).
      await Promise.all(replacePromises);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      console.log('[WebRTC][handleOffer]', fromSocketId, 'transceivers after setLocalDescription(answer):',
        pc.getTransceivers().map(t => ({ mid: t.mid, kind: t.receiver?.track?.kind, direction: t.direction, currentDirection: t.currentDirection, hasSenderTrack: !!t.sender.track })));

      socket.emit('webrtc-answer', { targetSocketId: fromSocketId, answer });
    } catch (err) {
      console.error(`[WebRTC] handleOffer error from ${fromSocketId}:`, err);
    }
  }, [getOrCreatePeerConnection, getOrCreateBlankVideoTrack, getOrCreateSilentAudioTrack, socket]);

  const handleAnswer = useCallback(async (fromSocketId: string, answer: RTCSessionDescriptionInit) => {
    try {
      const pc = peerConnectionsRef.current[fromSocketId];
      if (pc && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        const pending = pendingCandidatesRef.current[fromSocketId] || [];
        for (const c of pending) {
          try { await pc.addIceCandidate(new RTCIceCandidate(c)); } catch {}
        }
        pendingCandidatesRef.current[fromSocketId] = [];

        console.log('[WebRTC][handleAnswer]', fromSocketId, 'transceivers after setRemoteDescription(answer):',
          pc.getTransceivers().map(t => ({ mid: t.mid, kind: t.receiver?.track?.kind, direction: t.direction, currentDirection: t.currentDirection, hasSenderTrack: !!t.sender.track })));
      } else {
        console.warn(`[WebRTC] handleAnswer: unexpected state for ${fromSocketId}`, pc?.signalingState);
      }
    } catch (err) {
      console.error(`[WebRTC] handleAnswer error from ${fromSocketId}:`, err);
    }
  }, []);

  const handleIceCandidate = useCallback(async (fromSocketId: string, candidate: RTCIceCandidateInit) => {
    const pc = peerConnectionsRef.current[fromSocketId];
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    } else {
      pendingCandidatesRef.current[fromSocketId] = pendingCandidatesRef.current[fromSocketId] || [];
      pendingCandidatesRef.current[fromSocketId].push(candidate);
    }
  }, []);

  // ── Socket listeners ──────────────────────────────────────────────────
  const setupSocketListeners = useCallback(() => {

    // ── WebRTC Mesh Join Protocol ──
    // 1. Newcomer receives list of already-connected participants:
    socket.on('existing-participants', ({ existingParticipants }: { existingParticipants: Participant[] }) => {
      console.log('[WebRTC] existing-participants received:', existingParticipants);
      if (Array.isArray(existingParticipants)) {
        existingParticipants.forEach(peer => {
          if (peer.socketId && peer.socketId !== socket.id) {
            console.log(`[WebRTC] Newcomer initiating offer to existing peer: ${peer.socketId} (${peer.name})`);
            createOffer(peer.socketId);
          }
        });
      }
    });

    socket.on('teacher-joined', ({ existingParticipants: ep }: { existingParticipants?: Participant[] }) => {
      console.log('[WebRTC] teacher-joined received:', ep);
      if (Array.isArray(ep)) {
        ep.forEach(peer => {
          if (peer.socketId && peer.socketId !== socket.id) {
            console.log(`[WebRTC] Teacher initiating offer to existing peer: ${peer.socketId} (${peer.name})`);
            createOffer(peer.socketId);
          }
        });
      }
    });

    // Waiting room — student side
    socket.on('waiting-for-approval', () => {
      setIsWaitingApproval(true);
      setLoading(false);
    });

    socket.on('join-approved', ({ participants: p, existingParticipants: ep, scoreboard: sb, activeMcq: mcq }: any) => {
      setIsWaitingApproval(false);
      setParticipants(p);
      if (sb) setScoreboard(sb);
      if (mcq) {
        setActiveMcq(mcq);
        setMcqSelectedOption(null);
        setMcqAnswerLocked(false);
      }
      if (Array.isArray(ep)) {
        ep.forEach(peer => {
          if (peer.socketId && peer.socketId !== socket.id) {
            console.log(`[WebRTC] Approved student initiating offer to existing peer: ${peer.socketId} (${peer.name})`);
            createOffer(peer.socketId);
          }
        });
      }
    });

    socket.on('join-denied', ({ message }: { message: string }) => {
      setIsWaitingApproval(false);
      setJoinDenied(true);
      toast.error(message || 'Your join request was denied.');
    });

    // Waiting room — teacher side
    socket.on('join-request', ({ socketId, name, userId }: WaitingEntry) => {
      setWaitingRoom(prev => {
        if (prev.find(w => w.socketId === socketId)) return prev;
        return [...prev, { socketId, name, userId }];
      });
      toast(`🔔 ${name} wants to join`, { duration: 8000 });
      setShowWaitingRoomPanel(true);
    });

    socket.on('waiting-room-update', ({ waitingRoom: wr }: { waitingRoom: WaitingEntry[] }) => {
      setWaitingRoom(wr);
      if (wr.length === 0) setShowWaitingRoomPanel(false);
    });

    // 2. Existing participants are notified of newcomer:
    socket.on('participant-joined', ({ participant, participants: p }: { participant: Participant; participants: Participant[] }) => {
      setParticipants(p);
      if (participant && participant.socketId && participant.socketId !== socket.id) {
        console.log(`[WebRTC] Existing participant notified of newcomer: ${participant.socketId} (${participant.name}). Preparing connection...`);
        // Prepare RTCPeerConnection for newcomer B so it is ready to receive & answer B's incoming offer
        getOrCreatePeerConnection(participant.socketId);
      }
    });

    socket.on('participant-left', ({ socketId: leftId, participants: p }: { socketId: string; participants: Participant[] }) => {
      setParticipants(p);
      if (peerConnectionsRef.current[leftId]) {
        try { peerConnectionsRef.current[leftId].close(); } catch {}
        delete peerConnectionsRef.current[leftId];
      }
      delete pendingCandidatesRef.current[leftId];
      setRemoteStreams(prev => { const n = { ...prev }; delete n[leftId]; return n; });
      setPinnedSocketId(prev => prev === leftId ? null : prev);
    });

    socket.on('participant-camera', ({ socketId: sid, isOn }: { socketId: string; isOn: boolean }) => {
      setParticipants(prev => prev.map(p => p.socketId === sid ? { ...p, isCameraOn: isOn } : p));
    });

    socket.on('participant-mic', ({ socketId: sid, isOn }: { socketId: string; isOn: boolean }) => {
      setParticipants(prev => prev.map(p => p.socketId === sid ? { ...p, isMicOn: isOn } : p));
    });

    // WebRTC signaling
    socket.on('webrtc-offer', ({ fromSocketId, offer }: { fromSocketId: string; offer: RTCSessionDescriptionInit }) => {
      handleOffer(fromSocketId, offer);
    });
    socket.on('webrtc-answer', ({ fromSocketId, answer }: { fromSocketId: string; answer: RTCSessionDescriptionInit }) => {
      handleAnswer(fromSocketId, answer);
    });
    socket.on('webrtc-ice-candidate', ({ fromSocketId, candidate }: { fromSocketId: string; candidate: RTCIceCandidateInit }) => {
      handleIceCandidate(fromSocketId, candidate);
    });

    // Chat
    socket.on('chat-message', (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
    });
    socket.on('chat-deleted', ({ messageId }: { messageId: string }) => {
      setMessages(prev => prev.filter(m => m._id !== messageId));
    });

    // Legacy quiz
    socket.on('quiz-started', ({ quiz, timeLimit }: { quiz: Quiz; timeLimit: number }) => {
      setActiveQuiz(quiz); setSelectedAnswers({}); setQuizSubmitted(false); setQuizResult(null);
      setQuizTimeLeft((timeLimit || 20) * 60); setQuizStartTime(Date.now()); setView('quiz');
      toast('📝 New quiz started!', { icon: '🎯', duration: 5000 });
    });
    socket.on('quiz-result', (result) => { setQuizResult(result); setQuizSubmitted(true); });
    socket.on('leaderboard-update', ({ leaderboard: lb }: { leaderboard: LeaderboardEntry[] }) => { setLeaderboard(lb); });
    socket.on('quiz-ended', ({ leaderboard: lb }: { leaderboard: LeaderboardEntry[] }) => {
      setLeaderboard(lb); setView('leaderboard'); setActiveQuiz(null);
      setTimeout(() => setView('session'), 30000);
    });

    // Session ended
    socket.on('session-ended', ({ message, podium: p }: { message?: string; podium?: PodiumEntry[] }) => {
      toast(message || 'The teacher has ended the session.', { icon: '📚' });
      if (p && p.length > 0) { setPodium(p); setShowPodium(true); }
      else { cleanup(); navigate('/live-sessions'); }
    });

    // Permission request (Part 3)
    socket.on('permission-request', (req) => { setPermRequest(req); });
    socket.on('permission-response', ({ type, granted, from }: { type: string; granted: boolean; from?: string }) => {
      const mediaName = type === 'camera' ? 'camera' : 'microphone';
      if (granted) {
        toast.success(`${from || 'Student'} accepted your request to turn on their ${mediaName}.`);
      } else {
        toast(`${from || 'Student'} declined your request to turn on their ${mediaName}.`, { icon: 'ℹ️' });
      }
    });

    socket.on('error', ({ message }) => { toast.error(message); });

    // MCQ
    socket.on('mcq-raised', ({ mcq }: { mcq: LiveMcq }) => {
      setActiveMcq(mcq); setMcqSelectedOption(null); setMcqAnswerLocked(false); setTeacherCorrectIndex(null);
      toast('❓ MCQ Question raised!', { duration: 3000 });
    });
    socket.on('mcq-teacher-info', ({ correctIndex }: { correctIndex: number }) => { setTeacherCorrectIndex(correctIndex); });
    socket.on('mcq-closed', ({ mcqId, correctIndex, results }: { mcqId: string; correctIndex: number; results: McqResultEntry[] }) => {
      setActiveMcq(prev => {
        if (prev?.mcqId === mcqId) {
          setMcqClosedResults({ results, correctIndex, options: prev.options });
          return null;
        }
        setMcqClosedResults({ results, correctIndex, options: [] });
        return prev;
      });
      setMcqAnswerLocked(true);
    });
    socket.on('mcq-results', ({ correctIndex, results }: { mcqId: string; correctIndex: number; results: McqResultEntry[] }) => {
      setMcqClosedResults(prev => prev ? { ...prev, correctIndex, results } : { results, correctIndex, options: [] });
      setShowMcqResults(true);
    });
    socket.on('mcq-answer-locked', ({ selectedOption }: { selectedOption: number }) => {
      setMcqAnswerLocked(true); setMcqSelectedOption(selectedOption);
    });
    socket.on('mcq-error', ({ message }: { message: string }) => { toast.error(message); });
    socket.on('scoreboard-update', ({ scoreboard: sb }: { scoreboard: ScoreboardEntry[] }) => { setScoreboard(sb); });

  }, [socket, createOffer, getOrCreatePeerConnection, handleOffer, handleAnswer, handleIceCandidate, cleanup, navigate]);

  // ── broadcastLocalTracks: push active tracks to all open peer connections without renegotiation ──
  const broadcastLocalTracks = useCallback(() => {
    const stream = screenStreamRef.current || localStreamRef.current;
    const realVideo = stream?.getVideoTracks()[0] || null;
    const realAudio = stream?.getAudioTracks()[0] || null;

    const videoTrackToSend = realVideo || getOrCreateBlankVideoTrack();
    const audioTrackToSend = realAudio || getOrCreateSilentAudioTrack();

    Object.entries(peerConnectionsRef.current).forEach(([targetSocketId, pc]) => {
      if (pc.signalingState === 'closed') return;

      const transceivers = pc.getTransceivers ? pc.getTransceivers() : [];
      const videoTransceiver = transceivers.find(t => 
        t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video'
      );
      const audioTransceiver = transceivers.find(t => 
        t.receiver?.track?.kind === 'audio' || t.sender?.track?.kind === 'audio'
      );

      const videoSender = videoTransceiver?.sender || pc.getSenders().find(s => s.track?.kind === 'video');
      const audioSender = audioTransceiver?.sender || pc.getSenders().find(s => s.track?.kind === 'audio');

      if (videoSender && videoTrackToSend) {
        videoSender.replaceTrack(videoTrackToSend).catch(err => {
          console.warn(`[WebRTC] replaceTrack video error to ${targetSocketId}:`, err);
        });
      }

      if (audioSender && audioTrackToSend) {
        audioSender.replaceTrack(audioTrackToSend).catch(err => {
          console.warn(`[WebRTC] replaceTrack audio error to ${targetSocketId}:`, err);
        });
      }
    });
  }, [getOrCreateBlankVideoTrack, getOrCreateSilentAudioTrack]);

  // ── toggleCamera: cleanly acquire/release video without double-offers ─────
  const toggleCamera = async (force?: boolean) => {
    if (isCamOn && !force) {
      const videoTrack = localStreamRef.current?.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.stop();
        localStreamRef.current?.removeTrack(videoTrack);
      }
      setIsCamOn(false);
      broadcastLocalTracks();
      socket.emit('camera-state', { sessionCode: code, isOn: false });
      setParticipants(prev => prev.map(p => (p.socketId === socket.id || p.userId === user?._id) ? { ...p, isCameraOn: false } : p));
      toast('Camera turned off', { icon: '📷' });
      return;
    }

    try {
      const hasAudioAlready = !!localStreamRef.current?.getAudioTracks().length;
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: !hasAudioAlready,
      });

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      if (!localStreamRef.current) {
        localStreamRef.current = new MediaStream();
      }

      const oldVideo = localStreamRef.current.getVideoTracks()[0];
      if (oldVideo) {
        oldVideo.stop();
        localStreamRef.current.removeTrack(oldVideo);
      }
      localStreamRef.current.addTrack(videoTrack);

      if (audioTrack) {
        audioTrack.enabled = isMicOn;
        localStreamRef.current.addTrack(audioTrack);
      }

      setIsCamOn(true);
      broadcastLocalTracks();
      socket.emit('camera-state', { sessionCode: code, isOn: true });
      setParticipants(prev => prev.map(p => (p.socketId === socket.id || p.userId === user?._id) ? { ...p, isCameraOn: true } : p));
      toast.success('Camera turned on');
    } catch (err) {
      console.error('Camera access error:', err);
      toast.error('Could not access camera. Please allow camera permissions.');
    }
  };

  // ── toggleMic: cleanly enable/disable audio without renegotiation glare ───
  const toggleMic = async (force?: boolean) => {
    if (isMicOn && !force) {
      localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });
      setIsMicOn(false);
      broadcastLocalTracks();
      socket.emit('mic-state', { sessionCode: code, isOn: false });
      setParticipants(prev => prev.map(p => (p.socketId === socket.id || p.userId === user?._id) ? { ...p, isMicOn: false } : p));
      toast('Microphone muted', { icon: '🔇' });
      return;
    }

    const existingAudio = localStreamRef.current?.getAudioTracks()[0];
    if (existingAudio) {
      existingAudio.enabled = true;
      setIsMicOn(true);
      broadcastLocalTracks();
      socket.emit('mic-state', { sessionCode: code, isOn: true });
      setParticipants(prev => prev.map(p => (p.socketId === socket.id || p.userId === user?._id) ? { ...p, isMicOn: true } : p));
      toast.success('Microphone unmuted');
      return;
    }

    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const audioTrack = audioStream.getAudioTracks()[0];
      if (!localStreamRef.current) {
        localStreamRef.current = new MediaStream();
      }
      localStreamRef.current.addTrack(audioTrack);
      setIsMicOn(true);
      broadcastLocalTracks();
      socket.emit('mic-state', { sessionCode: code, isOn: true });
      setParticipants(prev => prev.map(p => (p.socketId === socket.id || p.userId === user?._id) ? { ...p, isMicOn: true } : p));
      toast.success('Microphone unmuted');
    } catch (err) {
      console.error('Mic access error:', err);
      toast.error('Could not access microphone. Please allow microphone permissions.');
    }
  };

  // ── Screen share ──────────────────────────────────────────────────────────
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
      setIsScreenSharing(false);
      broadcastLocalTracks();
      toast('Screen sharing stopped', { icon: '🖥️' });
      return;
    }
    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
      screenStreamRef.current = displayStream;
      const screenTrack = displayStream.getVideoTracks()[0];
      screenTrack.onended = () => {
        screenStreamRef.current = null;
        setIsScreenSharing(false);
        broadcastLocalTracks();
      };
      broadcastLocalTracks();
      setIsScreenSharing(true);
      toast.success('Screen sharing started');
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') toast.error('Failed to start screen sharing.');
    }
  };

  // ── Session control ───────────────────────────────────────────────────────
  const handleTeacherEndSession = () => {
    if (!window.confirm('End this live class for all participants?')) return;
    socket.emit('end-session', { sessionCode: code });
  };

  const approveJoin = (targetSocketId: string) => {
    socket.emit('approve-join', { sessionCode: code, targetSocketId });
    setWaitingRoom(prev => prev.filter(w => w.socketId !== targetSocketId));
    toast.success('Student admitted to class');
  };

  const denyJoin = (targetSocketId: string) => {
    socket.emit('deny-join', { sessionCode: code, targetSocketId });
    setWaitingRoom(prev => prev.filter(w => w.socketId !== targetSocketId));
  };

  const requestMedia = (targetSocketId: string, type: 'camera' | 'mic') => {
    const target = participants.find(p => p.socketId === targetSocketId);
    const targetName = target?.name || 'student';
    socket.emit('request-permission', { sessionCode: code, targetSocketId, type });
    toast(`Requested ${targetName} to turn on ${type === 'camera' ? 'camera' : 'microphone'}`, { icon: '📡' });
  };

  const sendChat = () => {
    if (!chatInput.trim()) return;
    socket.emit('send-chat', { sessionCode: code, message: chatInput.trim() });
    setChatInput('');
  };

  const handleSubmitQuiz = (autoSubmit = false) => {
    if (quizSubmitted) return;
    const timeTaken = Math.floor((Date.now() - quizStartTime) / 1000);
    const answers = Object.entries(selectedAnswers).map(([qi, opt]) => ({ questionIndex: parseInt(qi), selectedOption: opt }));
    socket.emit('submit-live-quiz', { sessionCode: code, answers, timeTaken });
    setQuizSubmitted(true);
    if (autoSubmit) toast('⏰ Time up! Quiz auto-submitted.', { icon: '⏰' });
    else toast.success('Quiz submitted!');
  };

  const handleOpenScoreboard = () => {
    socket.emit('get-scoreboard', { sessionCode: code });
    setShowScoreboard(true);
  };

  const copySessionCode = () => {
    if (code) { navigator.clipboard.writeText(code); toast.success(`Code ${code} copied!`); }
  };

  const formatTime = (sec: number) => `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;

  const activeLocalStream = screenStreamRef.current || localStreamRef.current;

  // Build local participant entry for VideoGrid
  const mySocketId = socket.id || '';
  const isLocalParticipant = useCallback((p: Participant) => {
    if (p.socketId && socket.id && p.socketId === socket.id) return true;
    if (p.userId && user?._id && p.userId.toString() === user._id.toString()) return true;
    return false;
  }, [socket.id, user?._id]);

  const localParticipant: Participant = participants.find(p => isLocalParticipant(p)) || {
    userId: user?._id || '',
    name: user?.name || 'You',
    role: user?.role || 'student',
    isTeacher,
    isCameraOn: isCamOn || isScreenSharing,
    isMicOn,
    socketId: mySocketId,
  };

  // Ensure local participant entry accurately reflects current live state in grid
  const allParticipantsForGrid: Participant[] = participants.map(p => {
    if (isLocalParticipant(p)) {
      return {
        ...p,
        isCameraOn: isCamOn || isScreenSharing,
        isMicOn,
      };
    }
    return p;
  });

  if (!allParticipantsForGrid.some(p => isLocalParticipant(p))) {
    allParticipantsForGrid.unshift(localParticipant);
  }

  // ── Render guards ─────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="h-screen bg-page flex items-center justify-center">
        <div className="text-center">
          <div className="w-14 h-14 border-4 border-brand-primary/30 border-t-brand-primary rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-secondary text-sm font-medium">Connecting to live classroom...</p>
        </div>
      </div>
    );
  }

  if (isWaitingApproval) {
    return (
      <WaitingScreen
        sessionTitle={session?.title}
        onLeave={() => { cleanup(); navigate('/live-sessions'); }}
      />
    );
  }

  if (joinDenied) {
    return <DeniedScreen onLeave={() => { cleanup(); navigate('/live-sessions'); }} />;
  }

  if (showPodium) {
    return (
      <PodiumScreen
        podium={podium}
        currentUserId={user?._id}
        onDismiss={() => { setShowPodium(false); cleanup(); navigate('/live-sessions'); }}
      />
    );
  }

  // ── Main session UI ───────────────────────────────────────────────────────
  return (
    <div className="h-screen max-h-screen overflow-hidden bg-page text-text-primary flex flex-col select-none">

      {/* ── Modals & Overlays ── */}

      {showMcqForm && (
        <McqFormModal onClose={() => setShowMcqForm(false)} onLaunch={(q, o, c) => socket.emit('raise-mcq', { sessionCode: code, question: q, options: o, correctIndex: c })} />
      )}
      {activeMcq && (
        <McqOverlay mcq={activeMcq} isTeacher={isTeacher} teacherCorrectIndex={teacherCorrectIndex}
          timeLeft={mcqTimeLeft} selectedOption={mcqSelectedOption} isLocked={mcqAnswerLocked}
          onSelect={i => { if (!mcqAnswerLocked) setMcqSelectedOption(i); }}
          onSubmit={() => { if (!mcqAnswerLocked && mcqSelectedOption !== null) { socket.emit('submit-mcq-answer', { sessionCode: code, selectedOption: mcqSelectedOption }); setMcqAnswerLocked(true); } }}
        />
      )}
      {showMcqResults && mcqClosedResults && (
        <McqResultsPopup results={mcqClosedResults.results} correctIndex={mcqClosedResults.correctIndex}
          options={mcqClosedResults.options.length > 0 ? mcqClosedResults.options : Array(4).fill('')}
          currentUserId={user?._id} onClose={() => setShowMcqResults(false)} />
      )}
      {showScoreboard && (
        <ScoreboardModal scoreboard={scoreboard} currentUserId={user?._id} onClose={() => setShowScoreboard(false)} />
      )}

      {/* Permission request — full modal for students */}
      {permRequest && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
          <div className="bg-surface border border-border-subtle rounded-2xl shadow-2xl w-full max-w-sm p-6 animate-slide-up">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-brand-primary/10 flex items-center justify-center">
                {permRequest.type === 'camera' ? <Video className="w-5 h-5 text-brand-primary" /> : <Mic className="w-5 h-5 text-brand-primary" />}
              </div>
              <div>
                <h3 className="font-heading font-bold text-text-primary text-sm">Teacher Request</h3>
                <p className="text-text-muted text-xs">{permRequest.from}</p>
              </div>
            </div>
            <p className="text-text-secondary text-sm mb-5">
              <strong className="text-text-primary">{permRequest.from}</strong> is asking you to turn on your{' '}
              <strong className="text-brand-primary">{permRequest.type}</strong>.
            </p>
            <div className="flex gap-2.5">
              <button
                onClick={() => {
                  socket.emit('permission-response', { sessionCode: code, targetSocketId: permRequest.fromSocketId, type: permRequest.type, granted: true });
                  if (permRequest.type === 'camera') toggleCamera(true);
                  else toggleMic(true);
                  setPermRequest(null);
                }}
                className="btn-primary flex-1 py-2.5 text-sm flex items-center justify-center gap-2"
              >
                <UserCheck className="w-4 h-4" /> Allow
              </button>
              <button
                onClick={() => {
                  socket.emit('permission-response', { sessionCode: code, targetSocketId: permRequest.fromSocketId, type: permRequest.type, granted: false });
                  setPermRequest(null);
                }}
                className="flex-1 py-2.5 bg-surface-alt border border-border-subtle text-text-secondary text-sm rounded-xl hover:bg-surface transition-all flex items-center justify-center gap-2"
              >
                <UserX className="w-4 h-4" /> Decline
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="flex-shrink-0 bg-surface border-b border-border-subtle px-4 py-2.5 flex items-center justify-between z-20">
        <div className="flex items-center gap-3">
          <div className="live-dot" />
          <div>
            <h1 className="font-heading text-text-primary font-semibold text-sm truncate max-w-xs sm:max-w-md">
              {session?.title || 'Live Class'}
            </h1>
            <div className="flex items-center gap-2 text-text-muted text-xs">
              <span>{session?.subject} • Std {session?.standard}</span>
              <span>•</span>
              <button onClick={copySessionCode} className="flex items-center gap-1 font-mono text-brand-primary hover:underline" title="Copy code">
                Code: {code} <Copy className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {/* Participants toggle button */}
          <button
            onClick={() => setShowParticipants(v => !v)}
            title="Toggle participants list"
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
              showParticipants
                ? 'bg-brand-primary/15 text-brand-primary border-brand-primary/30 shadow-xs ring-2 ring-brand-primary/20'
                : 'bg-surface-alt text-text-secondary border-border-subtle hover:bg-surface hover:text-text-primary'
            }`}
          >
            <Users className="w-3.5 h-3.5 text-brand-primary" />
            <span>{participants.length}</span>
          </button>

          {/* Waiting room badge — teacher only */}
          {isTeacher && waitingRoom.length > 0 && (
            <button
              onClick={() => setShowWaitingRoomPanel(v => !v)}
              className="relative flex items-center gap-1.5 px-3 py-1.5 bg-[#FEF3C7] text-[#92400E] border border-[#FDE68A] rounded-xl text-xs font-semibold hover:bg-[#FDE68A] transition-all"
              title={`${waitingRoom.length} student(s) waiting`}
            >
              <Bell className="w-3.5 h-3.5" />
              <span>{waitingRoom.length} waiting</span>
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-black rounded-full flex items-center justify-center animate-bounce">
                {waitingRoom.length}
              </span>
            </button>
          )}

          <button
            onClick={() => { cleanup(); navigate('/live-sessions'); }}
            className="px-3 py-1.5 bg-[#FFE4EC] text-[#E1447A] hover:bg-[#FFE4EC]/80 rounded-xl transition-all text-xs font-semibold flex items-center gap-1.5"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Leave</span>
          </button>
        </div>
      </div>

      {/* ── Waiting Room Panel (teacher) ── */}
      {isTeacher && showWaitingRoomPanel && waitingRoom.length > 0 && (
        <div className="flex-shrink-0 bg-[#FFFBEB] border-b border-[#FDE68A] px-4 py-3 z-20 animate-slide-down">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[#92400E] text-xs font-bold flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5" /> Students waiting to join
            </p>
            <button onClick={() => setShowWaitingRoomPanel(false)} className="text-[#92400E]/60 hover:text-[#92400E] p-0.5">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {waitingRoom.map(entry => (
              <div key={entry.socketId} className="flex items-center gap-2 bg-white border border-[#FDE68A] rounded-xl px-3 py-2 shadow-xs">
                <div className="w-6 h-6 rounded-full bg-brand-primary/20 text-brand-primary flex items-center justify-center text-xs font-bold flex-shrink-0">
                  {entry.name?.[0]?.toUpperCase() || '?'}
                </div>
                <span className="text-text-primary text-xs font-semibold">{entry.name}</span>
                <button
                  onClick={() => approveJoin(entry.socketId)}
                  className="ml-1 p-1.5 bg-[#DCFCE7] text-[#16A34A] rounded-lg hover:bg-[#16A34A] hover:text-white transition-all"
                  title="Admit"
                >
                  <UserCheck className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => denyJoin(entry.socketId)}
                  className="p-1.5 bg-[#FFE4EC] text-[#E1447A] rounded-lg hover:bg-[#E1447A] hover:text-white transition-all"
                  title="Deny"
                >
                  <UserX className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Main Content: VideoGrid + Chat ── */}
      <div className="flex-1 min-h-0 flex overflow-hidden">

        {/* Stage */}
        <div className="flex-1 min-h-0 p-2 sm:p-3 flex flex-col overflow-hidden">

          {view === 'session' && (
            <div className="flex-1 min-h-0 flex flex-col gap-2">
              {/* Dedicated Remote Audio Elements so remote audio always plays regardless of tile state */}
              <RemoteAudioPool remoteStreams={remoteStreams} mySocketId={mySocketId} />

              {/* VideoGrid */}
              <div className="flex-1 min-h-0">
                <VideoGrid
                  participants={allParticipantsForGrid}
                  remoteStreams={remoteStreams}
                  localStream={activeLocalStream}
                  mySocketId={mySocketId}
                  isLocalParticipant={isLocalParticipant}
                  pinnedSocketId={pinnedSocketId}
                  onPin={setPinnedSocketId}
                  isViewerTeacher={isTeacher}
                  onRequestMedia={requestMedia}
                  isCamOn={isCamOn || isScreenSharing}
                  isMicOn={isMicOn}
                />
              </div>

              {/* Session info bar */}
              <div className="flex-shrink-0 flex items-center justify-between gap-2 flex-wrap px-1">
                <div className="flex items-center gap-2 flex-wrap">
                  {participants.length <= 1 && (
                    <p className="text-text-muted text-xs">
                      🎓 Waiting for students to join · Code:{' '}
                      <strong className="text-brand-primary font-mono">{code}</strong>
                    </p>
                  )}
                  {pinnedSocketId && (
                    <button
                      onClick={() => setPinnedSocketId(null)}
                      className="flex items-center gap-1 text-xs text-brand-primary bg-brand-primary/10 border border-brand-primary/20 rounded-xl px-2.5 py-1 hover:bg-brand-primary/15"
                    >
                      <PinOff className="w-3 h-3" /> Exit spotlight
                    </button>
                  )}
                </div>
                <p className="text-text-muted text-xs hidden sm:block">
                  Click any tile to pin it to spotlight
                </p>
              </div>
            </div>
          )}

          {/* Legacy Quiz View */}
          {view === 'quiz' && activeQuiz && (
            <div className="max-w-2xl mx-auto w-full my-auto animate-slide-up">
              <div className="card-soft p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-heading text-text-primary font-bold text-lg">📝 {activeQuiz.title}</h2>
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl font-mono font-bold text-sm ${quizTimeLeft < 60 ? 'bg-[#FFE4EC] text-[#E1447A]' : 'bg-brand-primary/10 text-brand-primary'}`}>
                    <Clock className="w-4 h-4" />{formatTime(quizTimeLeft)}
                  </div>
                </div>
                {quizSubmitted && quizResult ? (
                  <div className="text-center py-8">
                    <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 text-4xl ${quizResult.percentage >= 60 ? 'bg-accent-mint/20' : 'bg-[#FFE4EC]'}`}>
                      {quizResult.percentage >= 60 ? '🎉' : '📚'}
                    </div>
                    <p className="text-3xl font-heading font-bold text-text-primary mb-2">{quizResult.score}/{quizResult.totalMarks}</p>
                    <p className={`text-xl font-semibold ${quizResult.percentage >= 60 ? 'text-[#16A34A]' : 'text-[#E1447A]'}`}>{quizResult.percentage}%</p>
                    <p className="text-text-muted text-xs mt-3">Waiting for leaderboard...</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {(activeQuiz.questions as Question[]).map((q, qi) => (
                      <div key={qi}>
                        <p className="text-text-primary font-medium mb-3"><span className="text-brand-primary font-bold mr-2">Q{qi + 1}.</span>{q.question}<span className="text-text-muted text-xs ml-2">({q.marks} mark{q.marks > 1 ? 's' : ''})</span></p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {q.options.map((opt, oi) => (
                            <button key={oi} onClick={() => setSelectedAnswers(prev => ({ ...prev, [qi]: oi }))}
                              className={`p-3 rounded-xl border text-left text-xs font-medium transition-all ${selectedAnswers[qi] === oi ? 'bg-brand-primary/10 border-brand-primary text-brand-primary font-semibold shadow-xs' : 'bg-surface-alt border-border-subtle text-text-secondary hover:bg-surface'}`}>
                              <span className="font-bold text-brand-primary mr-2">{['A', 'B', 'C', 'D'][oi]}.</span>{opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                    <button onClick={() => handleSubmitQuiz()} disabled={quizSubmitted} className="btn-primary w-full py-3 mt-4 flex items-center justify-center gap-2">
                      <CheckCircle className="w-5 h-5" /> Submit Quiz
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Legacy Leaderboard View */}
          {view === 'leaderboard' && (
            <div className="max-w-xl mx-auto w-full my-auto animate-slide-up">
              <div className="card-soft p-6 shadow-soft">
                <div className="text-center mb-6"><div className="text-4xl mb-2">🏆</div><h2 className="font-heading font-black text-2xl text-text-primary">Quiz Results!</h2><p className="text-text-secondary text-sm">Final Leaderboard</p></div>
                <div className="space-y-3">
                  {leaderboard.map((entry, i) => (
                    <div key={entry.studentId} className={`flex items-center gap-3.5 p-4 rounded-xl border transition-all ${i === 0 ? 'bg-[#FEF3C7]/40 border-[#FDE68A]' : i === 1 ? 'bg-surface-alt border-border-subtle' : 'bg-surface border-border-subtle'}`}>
                      <span className={`text-2xl font-black w-8 text-center ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-gray-300' : i === 2 ? 'text-amber-600' : 'text-text-muted text-sm'}`}>{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}</span>
                      <div className="w-8 h-8 rounded-full bg-brand-primary/20 text-brand-primary flex items-center justify-center text-sm font-bold flex-shrink-0">{entry.studentName?.[0] || '?'}</div>
                      <p className={`font-semibold text-sm flex-1 ${entry.studentId === user?._id ? 'text-brand-primary font-bold' : 'text-text-primary'}`}>{entry.studentName} {entry.studentId === user?._id && '(You)'}</p>
                      <div className="text-right"><p className="font-heading font-bold text-base text-text-primary">{entry.score}/{entry.totalMarks}</p><p className="text-text-muted text-xs">{entry.percentage}%</p></div>
                    </div>
                  ))}
                  {leaderboard.length === 0 && <p className="text-text-muted text-center py-8 text-sm">No submissions.</p>}
                </div>
                <p className="text-text-muted text-xs text-center mt-4">Returning to class in 30s...</p>
              </div>
            </div>
          )}
        </div>

        {/* Chat Drawer */}
        {showChat && (
          <div className="w-72 sm:w-80 bg-surface border-l border-border-subtle flex flex-col flex-shrink-0 z-10">
            <div className="p-3 border-b border-border-subtle flex items-center justify-between">
              <div className="flex items-center gap-2"><MessageSquare className="w-4 h-4 text-brand-primary" /><span className="font-heading text-text-primary text-sm font-semibold">Class Chat</span></div>
              <button onClick={() => setShowChat(false)} className="text-text-muted hover:text-text-primary p-1"><X className="w-4 h-4" /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {messages.map((msg, i) => (
                <div key={i} className={`${msg.senderRole === 'teacher' ? 'bg-brand-primary/10 border border-brand-primary/20' : 'bg-surface-alt border border-border-subtle'} rounded-xl p-2.5`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`text-xs font-semibold ${msg.senderRole === 'teacher' ? 'text-brand-primary' : 'text-text-primary'}`}>{msg.senderName}</span>
                    {msg.senderRole === 'teacher' && <Crown className="w-3 h-3 text-accent-amber" />}
                    <span className="text-text-muted text-[10px] ml-auto font-mono">{new Date(msg.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</span>
                  </div>
                  <p className="text-text-secondary text-xs leading-relaxed break-words">{msg.message}</p>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="p-3 border-t border-border-subtle">
              <div className="flex gap-2">
                <input value={chatInput} onChange={e => setChatInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') sendChat(); }} placeholder="Type a message..." className="flex-1 bg-surface-alt border border-border-subtle rounded-xl px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-primary/30" />
                <button onClick={sendChat} className="p-2 bg-brand-primary hover:bg-brand-primary-hover text-white rounded-xl transition-all shadow-xs"><Send className="w-4 h-4" /></button>
              </div>
            </div>
          </div>
        )}

        {/* Participants Drawer */}
        {showParticipants && (
          <ParticipantsDrawer
            participants={allParticipantsForGrid}
            mySocketId={mySocketId}
            isViewerTeacher={isTeacher}
            isLocalParticipant={isLocalParticipant}
            onRequestMedia={requestMedia}
            onClose={() => setShowParticipants(false)}
          />
        )}
      </div>

      {/* ── Controls Bar ── */}
      <div className="flex-shrink-0 bg-surface border-t border-border-subtle px-4 py-3 z-30">
        <div className="flex items-center justify-center gap-2.5 sm:gap-3.5 flex-wrap">

          {/* Mic */}
          <button onClick={() => toggleMic()} title={isMicOn ? 'Mute' : 'Unmute'}
            className={`p-3 rounded-xl transition-all shadow-xs ${isMicOn ? 'bg-brand-primary text-white shadow-md' : 'bg-surface-alt text-text-muted border border-border-subtle hover:text-text-primary'}`}>
            {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5 text-red-500" />}
          </button>

          {/* Camera */}
          <button onClick={() => toggleCamera()} title={isCamOn ? 'Camera off' : 'Camera on'}
            className={`p-3 rounded-xl transition-all shadow-xs ${isCamOn ? 'bg-brand-primary text-white shadow-md' : 'bg-surface-alt text-text-muted border border-border-subtle hover:text-text-primary'}`}>
            {isCamOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5 text-red-500" />}
          </button>

          {/* Screen share */}
          <button onClick={toggleScreenShare} title={isScreenSharing ? 'Stop sharing' : 'Share screen'}
            className={`p-3 rounded-xl transition-all shadow-xs ${isScreenSharing ? 'bg-accent-mint text-slate-900 shadow-md' : 'bg-surface-alt text-text-muted border border-border-subtle hover:text-text-primary'}`}>
            {isScreenSharing ? <MonitorOff className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
          </button>

          {/* Chat */}
          <button onClick={() => setShowChat(!showChat)} title="Toggle chat"
            className={`p-3 rounded-xl transition-all shadow-xs ${showChat ? 'bg-brand-primary/15 text-brand-primary border border-brand-primary/30' : 'bg-surface-alt text-text-muted border border-border-subtle hover:text-text-primary'}`}>
            <MessageSquare className="w-5 h-5" />
          </button>

          {/* Participants */}
          <button onClick={() => setShowParticipants(!showParticipants)} title="Toggle participants list"
            className={`p-3 rounded-xl transition-all shadow-xs ${showParticipants ? 'bg-brand-primary/15 text-brand-primary border border-brand-primary/30' : 'bg-surface-alt text-text-muted border border-border-subtle hover:text-text-primary'}`}>
            <Users className="w-5 h-5" />
          </button>

          {/* Scoreboard */}
          <button onClick={handleOpenScoreboard} title="Session scoreboard"
            className="p-3 bg-surface-alt text-text-muted border border-border-subtle hover:text-brand-primary hover:border-brand-primary/30 rounded-xl transition-all shadow-xs">
            <BarChart2 className="w-5 h-5" />
          </button>

          {/* Teacher: Raise MCQ */}
          {isTeacher && (
            <button onClick={() => setShowMcqForm(true)} disabled={!!activeMcq} title={activeMcq ? 'MCQ active' : 'Raise MCQ'}
              className="px-3.5 py-2.5 bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white rounded-xl text-xs font-semibold shadow-xs hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-all">
              <HelpCircle className="w-4 h-4" /><span className="hidden sm:inline">{activeMcq ? 'MCQ Active...' : 'Raise MCQ'}</span>
            </button>
          )}

          {/* Teacher: Launch Quiz */}
          {isTeacher && (
            <button
              onClick={() => { if (activeQuiz) socket.emit('launch-quiz', { sessionCode: code, quizId: activeQuiz._id }); else toast('No quiz assigned to this session'); }}
              className="px-3.5 py-2.5 bg-gradient-to-r from-brand-primary to-brand-secondary text-white rounded-xl text-xs font-semibold shadow-xs hover:opacity-95 flex items-center gap-1.5">
              <Trophy className="w-4 h-4" /><span className="hidden sm:inline">Launch Quiz</span>
            </button>
          )}

          {/* Teacher: End class */}
          {isTeacher && (
            <button onClick={handleTeacherEndSession}
              className="px-3.5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all">
              <Square className="w-4 h-4" /><span className="hidden sm:inline">End Class</span>
            </button>
          )}

          {/* Leave */}
          <button onClick={() => { cleanup(); navigate('/live-sessions'); }} title="Leave call"
            className="p-3 bg-[#FFE4EC] text-[#E1447A] hover:bg-[#FFE4EC]/80 border border-[#FFE4EC] rounded-xl transition-all">
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>

        <p className="text-center text-text-muted text-[11px] mt-1.5">
          {isCamOn || isMicOn || isScreenSharing ? 'Broadcast active • Your audio/video is shared' : 'Camera and mic are off'}
        </p>
      </div>
    </div>
  );
};

export default LiveSessionPage;

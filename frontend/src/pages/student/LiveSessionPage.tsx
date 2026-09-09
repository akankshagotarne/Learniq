import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Mic, MicOff, Video, VideoOff, MessageSquare, Users, X, Send, PhoneOff,
  Trophy, Clock, CheckCircle, Crown, Monitor, MonitorOff, Square, Sparkles, Copy
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getSocket } from '../../services/socket';
import api from '../../services/api';
import { LiveSession, ChatMessage, Participant, LeaderboardEntry, Quiz, Question } from '../../types';
import toast from 'react-hot-toast';

type LiveView = 'session' | 'quiz' | 'leaderboard';

const ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'stun:stun4.l.google.com:19302' },
  { urls: 'stun:stun.services.mozilla.com' },
];

// Reusable Video Player Element for Local & Remote Streams
const StreamVideo: React.FC<{
  stream: MediaStream | null;
  muted?: boolean;
  className?: string;
}> = ({ stream, muted = false, className = 'w-full h-full object-cover' }) => {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (video) {
      if (stream) {
        video.srcObject = stream;
        video.play().catch(err => {
          // Autoplay policy fallback
          console.warn('[WebRTC] Auto-play prevented or stream paused:', err.message);
        });
      } else {
        video.srcObject = null;
      }
    }
  }, [stream]);

  return (
    <video
      ref={videoRef}
      autoPlay
      playsInline
      muted={muted}
      className={className}
    />
  );
};

const LiveSessionPage: React.FC = () => {
  const { code } = useParams<{ code: string }>();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [session, setSession] = useState<LiveSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<LiveView>('session');

  // Chat
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [showChat, setShowChat] = useState(true);

  // Media states
  const [isCamOn, setIsCamOn] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [remoteStreams, setRemoteStreams] = useState<Record<string, MediaStream>>({});

  // Quiz state
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizResult, setQuizResult] = useState<{ score: number; totalMarks: number; percentage: number } | null>(null);
  const [quizTimeLeft, setQuizTimeLeft] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [quizStartTime, setQuizStartTime] = useState<number>(0);

  // Permission request
  const [permRequest, setPermRequest] = useState<{ type: string; from: string; fromSocketId: string } | null>(null);

  // WebRTC Refs
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  const pendingCandidatesRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const chatEndRef = useRef<HTMLDivElement>(null);

  const socket = getSocket();
  const isTeacher = user?.role === 'teacher' || user?.role === 'admin';

  // Join Session on Mount
  useEffect(() => {
    if (!user) {
      navigate('/login');
      return;
    }

    let isMounted = true;

    const init = async () => {
      try {
        const res = await api.post(`/live-sessions/${code}/join`);
        if (!isMounted) return;
        setSession(res.data.session);
        setMessages(res.data.chatHistory || []);
        setLoading(false);

        // Emit room join to Socket.IO
        console.log(`[LiveSession] Joining room for code: ${code}`);
        socket.emit('join-live-session', { sessionCode: code });
      } catch (err: any) {
        if (!isMounted) return;
        toast.error(err.response?.data?.message || 'Failed to join session');
        navigate('/live-sessions');
      }
    };

    init();
    setupSocketListeners();

    return () => {
      isMounted = false;
      cleanup();
    };
  }, [code, user]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Quiz timer
  useEffect(() => {
    if (!activeQuiz || quizSubmitted || quizTimeLeft <= 0) return;
    const timer = setInterval(() => {
      setQuizTimeLeft(t => {
        if (t <= 1) {
          clearInterval(timer);
          if (!quizSubmitted) handleSubmitQuiz(true);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [activeQuiz, quizSubmitted, quizTimeLeft]);

  // Cleanup all media and connections on unmount
  const cleanup = useCallback(() => {
    console.log('[WebRTC] Cleaning up streams and connections...');
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    screenStreamRef.current?.getTracks().forEach(t => t.stop());
    localStreamRef.current = null;
    screenStreamRef.current = null;

    Object.values(peerConnectionsRef.current).forEach(pc => {
      try {
        pc.close();
      } catch {}
    });
    peerConnectionsRef.current = {};
    pendingCandidatesRef.current = {};
    setRemoteStreams({});

    socket.off('participant-joined');
    socket.off('participant-left');
    socket.off('participant-camera');
    socket.off('participant-mic');
    socket.off('webrtc-offer');
    socket.off('webrtc-answer');
    socket.off('webrtc-ice-candidate');
    socket.off('chat-message');
    socket.off('chat-deleted');
    socket.off('quiz-started');
    socket.off('quiz-result');
    socket.off('leaderboard-update');
    socket.off('quiz-ended');
    socket.off('session-ended');
    socket.off('permission-request');
    socket.off('permission-response');
    socket.off('error');
  }, [socket]);

  // Create Peer Connection with STUN, ICE queue, and stream listener
  const createPeerConnection = useCallback((targetSocketId: string): RTCPeerConnection => {
    // If existing, close and recreate cleanly
    if (peerConnectionsRef.current[targetSocketId]) {
      try {
        peerConnectionsRef.current[targetSocketId].close();
      } catch {}
    }

    console.log(`[WebRTC] Creating RTCPeerConnection for ${targetSocketId}`);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-ice-candidate', {
          targetSocketId,
          candidate: event.candidate,
        });
      }
    };

    pc.ontrack = (event) => {
      console.log(`[WebRTC] Remote track received from ${targetSocketId}:`, event.track.kind);
      const stream = event.streams[0] || new MediaStream([event.track]);
      setRemoteStreams(prev => ({
        ...prev,
        [targetSocketId]: stream,
      }));
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection state with ${targetSocketId}: ${pc.connectionState}`);
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        console.warn(`[WebRTC] Connection ${pc.connectionState} with ${targetSocketId}`);
      }
    };

    // Attach local media tracks if available
    const activeStream = screenStreamRef.current || localStreamRef.current;
    if (activeStream) {
      activeStream.getTracks().forEach(track => {
        pc.addTrack(track, activeStream);
      });
    }

    peerConnectionsRef.current[targetSocketId] = pc;
    return pc;
  }, [socket]);

  // Create and Send Offer
  const createOffer = useCallback(async (targetSocketId: string) => {
    try {
      console.log(`[WebRTC] Generating offer for ${targetSocketId}`);
      const pc = createPeerConnection(targetSocketId);
      const offer = await pc.createOffer({
        offerToReceiveAudio: true,
        offerToReceiveVideo: true,
      });
      await pc.setLocalDescription(offer);
      console.log(`[WebRTC] Emitting webrtc-offer to ${targetSocketId}`);
      socket.emit('webrtc-offer', { targetSocketId, offer });
    } catch (err) {
      console.error(`[WebRTC] Error creating offer for ${targetSocketId}:`, err);
    }
  }, [createPeerConnection, socket]);

  // Handle Incoming Offer and Send Answer
  const handleOffer = useCallback(async (fromSocketId: string, offer: RTCSessionDescriptionInit) => {
    try {
      console.log(`[WebRTC] Handling incoming offer from ${fromSocketId}`);
      const pc = createPeerConnection(fromSocketId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      // Flush any queued ICE candidates that arrived early
      if (pendingCandidatesRef.current[fromSocketId]?.length) {
        console.log(`[WebRTC] Flushing ${pendingCandidatesRef.current[fromSocketId].length} queued ICE candidates for ${fromSocketId}`);
        for (const candidate of pendingCandidatesRef.current[fromSocketId]) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.warn('[WebRTC] Queued candidate error:', e);
          }
        }
        pendingCandidatesRef.current[fromSocketId] = [];
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      console.log(`[WebRTC] Emitting webrtc-answer to ${fromSocketId}`);
      socket.emit('webrtc-answer', { targetSocketId: fromSocketId, answer });
    } catch (err) {
      console.error(`[WebRTC] Error handling offer from ${fromSocketId}:`, err);
    }
  }, [createPeerConnection, socket]);

  // Handle Incoming Answer
  const handleAnswer = useCallback(async (fromSocketId: string, answer: RTCSessionDescriptionInit) => {
    try {
      console.log(`[WebRTC] Handling incoming answer from ${fromSocketId}`);
      const pc = peerConnectionsRef.current[fromSocketId];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));

        // Flush queued ICE candidates
        if (pendingCandidatesRef.current[fromSocketId]?.length) {
          for (const candidate of pendingCandidatesRef.current[fromSocketId]) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(candidate));
            } catch (e) {
              console.warn('[WebRTC] Queued candidate error on answer:', e);
            }
          }
          pendingCandidatesRef.current[fromSocketId] = [];
        }
      }
    } catch (err) {
      console.error(`[WebRTC] Error setting remote description from ${fromSocketId}:`, err);
    }
  }, []);

  // Handle Incoming ICE Candidate with Queue Fallback
  const handleIceCandidate = useCallback(async (fromSocketId: string, candidate: RTCIceCandidateInit) => {
    const pc = peerConnectionsRef.current[fromSocketId];
    if (pc && pc.remoteDescription && pc.remoteDescription.type) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (err) {
        console.warn('[WebRTC] Error adding ICE candidate:', err);
      }
    } else {
      // Queue until remoteDescription is set
      if (!pendingCandidatesRef.current[fromSocketId]) {
        pendingCandidatesRef.current[fromSocketId] = [];
      }
      pendingCandidatesRef.current[fromSocketId].push(candidate);
    }
  }, []);

  // Setup Socket Events
  const setupSocketListeners = useCallback(() => {
    // Room participants
    socket.on('participant-joined', ({ participant, participants: p }: { participant: Participant; participants: Participant[] }) => {
      console.log(`[Socket] Participant joined: ${participant?.name} (${participant?.socketId})`);
      setParticipants(p);

      // If another participant joined, initiate WebRTC offer to them
      if (participant && participant.socketId !== socket.id) {
        createOffer(participant.socketId);
      }
    });

    socket.on('participant-left', ({ socketId: leftId, participants: p }: { socketId: string; participants: Participant[] }) => {
      console.log(`[Socket] Participant left: ${leftId}`);
      setParticipants(p);

      if (peerConnectionsRef.current[leftId]) {
        try {
          peerConnectionsRef.current[leftId].close();
        } catch {}
        delete peerConnectionsRef.current[leftId];
      }
      delete pendingCandidatesRef.current[leftId];

      setRemoteStreams(prev => {
        const next = { ...prev };
        delete next[leftId];
        return next;
      });
    });

    // Real-time Camera & Mic State Indicators
    socket.on('participant-camera', ({ socketId: sid, isOn }: { socketId: string; isOn: boolean }) => {
      console.log(`[Socket] Participant camera changed: ${sid} -> ${isOn}`);
      setParticipants(prev => prev.map(p => p.socketId === sid ? { ...p, isCameraOn: isOn } : p));
    });

    socket.on('participant-mic', ({ socketId: sid, isOn }: { socketId: string; isOn: boolean }) => {
      setParticipants(prev => prev.map(p => p.socketId === sid ? { ...p, isMicOn: isOn } : p));
    });

    // WebRTC Signaling
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

    // Quiz events
    socket.on('quiz-started', ({ quiz, timeLimit }: { quiz: Quiz; timeLimit: number }) => {
      setActiveQuiz(quiz);
      setSelectedAnswers({});
      setQuizSubmitted(false);
      setQuizResult(null);
      setQuizTimeLeft((timeLimit || 20) * 60);
      setQuizStartTime(Date.now());
      setView('quiz');
      toast('📝 New quiz started! Answer quickly!', { icon: '🎯', duration: 5000 });
    });

    socket.on('quiz-result', (result) => {
      setQuizResult(result);
      setQuizSubmitted(true);
    });

    socket.on('leaderboard-update', ({ leaderboard: lb }: { leaderboard: LeaderboardEntry[] }) => {
      setLeaderboard(lb);
    });

    socket.on('quiz-ended', ({ leaderboard: lb }: { leaderboard: LeaderboardEntry[] }) => {
      setLeaderboard(lb);
      setView('leaderboard');
      setActiveQuiz(null);
      setTimeout(() => setView('session'), 30000);
    });

    socket.on('session-ended', ({ message }: { message?: string }) => {
      toast(message || 'The teacher has ended the session.', { icon: '📚' });
      cleanup();
      navigate('/live-sessions');
    });

    // Permission requests
    socket.on('permission-request', (req) => {
      setPermRequest(req);
    });

    socket.on('permission-response', ({ type, granted }) => {
      if (granted) {
        if (type === 'mic') toggleMic(true);
        if (type === 'camera') toggleCamera(true);
      }
    });

    socket.on('error', ({ message }) => {
      toast.error(message);
    });
  }, [socket, createOffer, handleOffer, handleAnswer, handleIceCandidate, cleanup, navigate]);

  // Synchronize Tracks Across All Active Peer Connections
  const broadcastTrack = (newTrack: MediaStreamTrack, oldTrackKind: 'audio' | 'video') => {
    Object.entries(peerConnectionsRef.current).forEach(([targetSocketId, pc]) => {
      const senders = pc.getSenders();
      const sender = senders.find(s => s.track && s.track.kind === oldTrackKind);
      if (sender) {
        sender.replaceTrack(newTrack).catch(err => {
          console.warn(`[WebRTC] Failed to replaceTrack with ${targetSocketId}:`, err);
        });
      } else if (localStreamRef.current) {
        pc.addTrack(newTrack, localStreamRef.current);
        // Renegotiate with target peer
        createOffer(targetSocketId);
      }
    });
  };

  // Toggle Camera
  const toggleCamera = async (force?: boolean) => {
    if (isCamOn && !force) {
      // Turn off camera
      const videoTrack = localStreamRef.current?.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.stop();
        localStreamRef.current?.removeTrack(videoTrack);
      }
      setIsCamOn(false);
      socket.emit('camera-state', { sessionCode: code, isOn: false });
      toast('Camera turned off', { icon: '📷' });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: isMicOn,
      });

      const videoTrack = stream.getVideoTracks()[0];

      if (!localStreamRef.current) {
        localStreamRef.current = stream;
      } else {
        const oldVideo = localStreamRef.current.getVideoTracks()[0];
        if (oldVideo) {
          oldVideo.stop();
          localStreamRef.current.removeTrack(oldVideo);
        }
        localStreamRef.current.addTrack(videoTrack);
      }

      broadcastTrack(videoTrack, 'video');
      setIsCamOn(true);
      socket.emit('camera-state', { sessionCode: code, isOn: true });
      toast.success('Camera turned on');
    } catch (err: any) {
      console.error('[Media] Camera access error:', err);
      toast.error('Could not access camera. Please allow camera permissions in your browser settings.');
    }
  };

  // Toggle Microphone
  const toggleMic = async (force?: boolean) => {
    if (isMicOn && !force) {
      // Turn off mic
      localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });
      setIsMicOn(false);
      socket.emit('mic-state', { sessionCode: code, isOn: false });
      toast('Microphone muted', { icon: '🔇' });
      return;
    }

    try {
      if (localStreamRef.current && localStreamRef.current.getAudioTracks().length > 0) {
        localStreamRef.current.getAudioTracks().forEach(t => { t.enabled = true; });
      } else {
        const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const audioTrack = audioStream.getAudioTracks()[0];

        if (!localStreamRef.current) {
          localStreamRef.current = audioStream;
        } else {
          localStreamRef.current.addTrack(audioTrack);
        }

        broadcastTrack(audioTrack, 'audio');
      }

      setIsMicOn(true);
      socket.emit('mic-state', { sessionCode: code, isOn: true });
      toast.success('Microphone unmuted');
    } catch (err: any) {
      console.error('[Media] Microphone access error:', err);
      toast.error('Could not access microphone. Please allow microphone permissions in your browser.');
    }
  };

  // Toggle Screen Sharing
  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      // Stop screen share
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
      setIsScreenSharing(false);

      // Revert to camera if was on
      const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
      if (cameraTrack) {
        broadcastTrack(cameraTrack, 'video');
      }
      toast('Screen sharing stopped', { icon: '🖥️' });
      return;
    }

    try {
      const displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      screenStreamRef.current = displayStream;
      const screenTrack = displayStream.getVideoTracks()[0];

      // Handle user stopping share from browser floating toolbar
      screenTrack.onended = () => {
        screenStreamRef.current = null;
        setIsScreenSharing(false);
        const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
        if (cameraTrack) {
          broadcastTrack(cameraTrack, 'video');
        }
      };

      broadcastTrack(screenTrack, 'video');
      setIsScreenSharing(true);
      toast.success('Screen sharing started');
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') {
        console.error('[Media] Screen share error:', err);
        toast.error('Failed to start screen sharing.');
      }
    }
  };

  // Teacher End Session for All
  const handleTeacherEndSession = () => {
    if (!window.confirm('Are you sure you want to end this live class for all participants?')) {
      return;
    }
    socket.emit('end-session', { sessionCode: code });
    cleanup();
    navigate('/live-sessions');
  };

  // Chat sender
  const sendChat = () => {
    if (!chatInput.trim()) return;
    socket.emit('send-chat', { sessionCode: code, message: chatInput.trim() });
    setChatInput('');
  };

  // Quiz submission
  const handleSubmitQuiz = (autoSubmit = false) => {
    if (quizSubmitted) return;
    const timeTaken = Math.floor((Date.now() - quizStartTime) / 1000);
    const answers = Object.entries(selectedAnswers).map(([qi, opt]) => ({
      questionIndex: parseInt(qi),
      selectedOption: opt,
    }));
    socket.emit('submit-live-quiz', { sessionCode: code, answers, timeTaken });
    setQuizSubmitted(true);
    if (autoSubmit) toast('⏰ Time up! Quiz auto-submitted.', { icon: '⏰' });
    else toast.success('Quiz submitted!');
  };

  const copySessionCode = () => {
    if (code) {
      navigator.clipboard.writeText(code);
      toast.success(`Session code ${code} copied!`);
    }
  };

  const formatTime = (sec: number) => `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;

  const getMedalColor = (pos: number) => {
    if (pos === 0) return 'text-yellow-400';
    if (pos === 1) return 'text-gray-300';
    if (pos === 2) return 'text-amber-600';
    return 'text-text-muted';
  };

  // Identify remote participants and streams
  const otherParticipants = participants.filter(p => p.socketId !== socket.id);
  const primaryRemoteParticipant = otherParticipants[0] || null;
  const primaryRemoteStream = primaryRemoteParticipant ? remoteStreams[primaryRemoteParticipant.socketId] || null : null;
  const activeLocalStream = screenStreamRef.current || localStreamRef.current;

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

  return (
    <div className="h-screen max-h-screen overflow-hidden bg-page text-text-primary flex flex-col select-none">
      {/* 1. Header (Fixed Height) */}
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
              <button
                onClick={copySessionCode}
                className="flex items-center gap-1 font-mono text-brand-primary hover:underline"
                title="Click to copy session code"
              >
                <span>Code: {code}</span>
                <Copy className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-surface-alt border border-border-subtle rounded-xl text-xs font-semibold">
            <Users className="w-3.5 h-3.5 text-brand-primary" />
            <span>{participants.length}</span>
          </div>

          <button
            onClick={() => { cleanup(); navigate('/live-sessions'); }}
            className="px-3 py-1.5 bg-[#FFE4EC] text-[#E1447A] hover:bg-[#FFE4EC]/80 rounded-xl transition-all text-xs font-semibold flex items-center gap-1.5"
            title="Leave Session"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Leave</span>
          </button>
        </div>
      </div>

      {/* Permission Request Banner */}
      {permRequest && (
        <div className="flex-shrink-0 bg-brand-primary/10 border-b border-brand-primary/20 px-4 py-2 flex items-center justify-between text-xs animate-slide-down z-20">
          <p className="text-text-primary">
            <strong className="text-brand-primary">{permRequest.from}</strong> requested to enable your <strong>{permRequest.type}</strong>.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => {
                socket.emit('permission-response', { sessionCode: code, targetSocketId: permRequest.fromSocketId, type: permRequest.type, granted: true });
                setPermRequest(null);
              }}
              className="btn-primary px-3 py-1 text-xs"
            >
              Allow
            </button>
            <button
              onClick={() => {
                socket.emit('permission-response', { sessionCode: code, targetSocketId: permRequest.fromSocketId, type: permRequest.type, granted: false });
                setPermRequest(null);
              }}
              className="px-3 py-1 bg-surface-alt border border-border-subtle text-text-secondary text-xs rounded-xl hover:bg-surface"
            >
              Decline
            </button>
          </div>
        </div>
      )}

      {/* 2. Main Content Stage + Chat (Takes Remaining Height) */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Stage Area */}
        <div className="flex-1 min-h-0 p-3 sm:p-4 flex flex-col overflow-y-auto">
          {view === 'session' && (
            <div className="flex-1 flex flex-col justify-center items-center relative w-full h-full max-w-5xl mx-auto">
              {/* Main Stage Video Container */}
              <div className="relative w-full h-full max-h-[75vh] aspect-video bg-[#0D0E1A] rounded-2xl overflow-hidden shadow-soft flex items-center justify-center border border-border-subtle">
                {/* Condition A: Remote participant has stream */}
                {primaryRemoteParticipant && primaryRemoteStream && (primaryRemoteParticipant.isCameraOn || primaryRemoteStream.getVideoTracks().length > 0) ? (
                  <StreamVideo
                    stream={primaryRemoteStream}
                    className="w-full h-full object-cover"
                  />
                ) : primaryRemoteParticipant ? (
                  /* Remote participant camera is off */
                  <div className="flex flex-col items-center justify-center p-6 text-center">
                    <div className="w-20 h-20 rounded-full bg-brand-primary/20 text-brand-primary flex items-center justify-center text-2xl font-bold mb-3 border border-brand-primary/30">
                      {primaryRemoteParticipant.name?.[0] || 'U'}
                    </div>
                    <p className="text-white text-base font-semibold font-heading">{primaryRemoteParticipant.name}</p>
                    <p className="text-white/50 text-xs mt-1">Camera is off</p>
                    {primaryRemoteParticipant.isMicOn ? (
                      <span className="mt-2 inline-flex items-center gap-1 text-[11px] text-accent-mint font-medium">
                        <Mic className="w-3 h-3" /> Speaking
                      </span>
                    ) : (
                      <span className="mt-2 inline-flex items-center gap-1 text-[11px] text-white/40 font-medium">
                        <MicOff className="w-3 h-3" /> Muted
                      </span>
                    )}
                  </div>
                ) : isCamOn || isScreenSharing ? (
                  /* Waiting for others, but local camera is on */
                  <StreamVideo
                    stream={activeLocalStream}
                    muted
                    className="w-full h-full object-cover"
                  />
                ) : (
                  /* No remote participant and local camera is off */
                  <div className="flex flex-col items-center justify-center p-6 text-center">
                    <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center mb-3">
                      <VideoOff className="w-8 h-8 text-white/40" />
                    </div>
                    <p className="text-white/80 text-sm font-medium">Camera is off</p>
                    <p className="text-white/40 text-xs mt-1 max-w-xs">
                      Click the camera button below to start your video stream.
                    </p>
                    <div className="mt-4 px-3.5 py-1.5 bg-white/5 border border-white/10 rounded-xl text-xs text-white/70">
                      Waiting for others to join • Session code: <strong className="text-brand-primary">{code}</strong>
                    </div>
                  </div>
                )}

                {/* Primary Stream Label Overlay */}
                {primaryRemoteParticipant && (
                  <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-white text-xs z-10">
                    <span className="font-semibold">{primaryRemoteParticipant.name}</span>
                    {primaryRemoteParticipant.isTeacher && <Crown className="w-3.5 h-3.5 text-accent-amber" />}
                    {!primaryRemoteParticipant.isMicOn && <MicOff className="w-3 h-3 text-red-400" />}
                  </div>
                )}

                {/* Picture-in-Picture / Floating Local Self Video */}
                {primaryRemoteParticipant && (
                  <div className="absolute bottom-3 right-3 w-36 sm:w-48 aspect-video bg-[#1B1C2E] rounded-xl overflow-hidden shadow-lg border-2 border-white/20 z-20 flex items-center justify-center">
                    {isCamOn || isScreenSharing ? (
                      <StreamVideo
                        stream={activeLocalStream}
                        muted
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="flex flex-col items-center justify-center p-2 text-center">
                        <VideoOff className="w-5 h-5 text-white/40 mb-1" />
                        <span className="text-white/60 text-[10px]">Your camera is off</span>
                      </div>
                    )}
                    <div className="absolute bottom-1.5 left-1.5 px-2 py-0.5 bg-black/70 rounded-md text-[10px] text-white font-medium flex items-center gap-1">
                      <span>You</span>
                      {!isMicOn && <MicOff className="w-2.5 h-2.5 text-red-400" />}
                    </div>
                  </div>
                )}
              </div>

              {/* Participants Roster Chips */}
              <div className="w-full mt-3 flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-text-secondary text-xs font-semibold">Active in class:</span>
                  {participants.map(p => (
                    <div
                      key={p.socketId}
                      className="flex items-center gap-1.5 px-2.5 py-1 bg-surface border border-border-subtle rounded-xl text-xs shadow-xs"
                    >
                      <div className="w-5 h-5 rounded-full bg-brand-primary/20 text-brand-primary flex items-center justify-center text-[10px] font-bold">
                        {p.name?.[0] || '?'}
                      </div>
                      <span className="text-text-primary text-xs font-medium">
                        {p.name} {p.socketId === socket.id && '(You)'}
                      </span>
                      {p.isTeacher && <Crown className="w-3 h-3 text-accent-amber" />}
                      {p.isMicOn ? <Mic className="w-3 h-3 text-accent-mint" /> : <MicOff className="w-3 h-3 text-text-muted" />}
                      {p.isCameraOn ? <Video className="w-3 h-3 text-brand-primary" /> : <VideoOff className="w-3 h-3 text-text-muted" />}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Quiz View */}
          {view === 'quiz' && activeQuiz && (
            <div className="max-w-2xl mx-auto w-full my-auto animate-slide-up">
              <div className="card-soft p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="font-heading text-text-primary font-bold text-lg">📝 {activeQuiz.title}</h2>
                  <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl font-mono font-bold text-sm ${quizTimeLeft < 60 ? 'bg-[#FFE4EC] text-[#E1447A]' : 'bg-brand-primary/10 text-brand-primary'}`}>
                    <Clock className="w-4 h-4" />
                    {formatTime(quizTimeLeft)}
                  </div>
                </div>

                {quizSubmitted && quizResult ? (
                  <div className="text-center py-8 animate-bounce-in">
                    <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 text-4xl ${quizResult.percentage >= 60 ? 'bg-accent-mint/20' : 'bg-[#FFE4EC]'}`}>
                      {quizResult.percentage >= 60 ? '🎉' : '📚'}
                    </div>
                    <p className="text-3xl font-heading font-bold text-text-primary mb-2">{quizResult.score}/{quizResult.totalMarks}</p>
                    <p className={`text-xl font-semibold mb-2 ${quizResult.percentage >= 60 ? 'text-[#16A34A]' : 'text-[#E1447A]'}`}>
                      {quizResult.percentage}%
                    </p>
                    <p className="text-text-secondary text-sm font-medium">
                      {quizResult.percentage >= 80 ? 'Excellent! 🏆' : quizResult.percentage >= 60 ? 'Good job! 👍' : 'Keep practicing! 💪'}
                    </p>
                    <p className="text-text-muted text-xs mt-3">Waiting for quiz to end and leaderboard...</p>
                  </div>
                ) : (
                  <div className="space-y-6">
                    {(activeQuiz.questions as Question[]).map((q, qi) => (
                      <div key={qi} className="animate-slide-up" style={{ animationDelay: `${qi * 0.1}s` }}>
                        <p className="text-text-primary font-medium mb-3">
                          <span className="text-brand-primary font-bold mr-2">Q{qi + 1}.</span>{q.question}
                          <span className="text-text-muted text-xs ml-2 font-normal">({q.marks} mark{q.marks > 1 ? 's' : ''})</span>
                        </p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                          {q.options.map((opt, oi) => (
                            <button
                              key={oi}
                              onClick={() => setSelectedAnswers(prev => ({ ...prev, [qi]: oi }))}
                              className={`p-3 rounded-xl border text-left text-xs font-medium transition-all ${
                                selectedAnswers[qi] === oi
                                  ? 'bg-brand-primary/10 border-brand-primary text-brand-primary font-semibold shadow-xs'
                                  : 'bg-surface-alt border-border-subtle text-text-secondary hover:bg-surface hover:text-text-primary'
                              }`}
                            >
                              <span className="font-bold text-brand-primary mr-2">{['A', 'B', 'C', 'D'][oi]}.</span>
                              {opt}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}

                    <button
                      onClick={() => handleSubmitQuiz()}
                      disabled={quizSubmitted}
                      className="btn-primary w-full py-3 mt-4 flex items-center justify-center gap-2"
                    >
                      <CheckCircle className="w-5 h-5" /> Submit Quiz
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Leaderboard View */}
          {view === 'leaderboard' && (
            <div className="max-w-xl mx-auto w-full my-auto animate-slide-up">
              <div className="card-soft p-6 shadow-soft">
                <div className="text-center mb-6">
                  <div className="text-4xl mb-2">🏆</div>
                  <h2 className="font-heading font-black text-2xl text-text-primary">Live Quiz Results!</h2>
                  <p className="text-text-secondary text-sm">Final Session Leaderboard</p>
                </div>

                <div className="space-y-3">
                  {leaderboard.map((entry, i) => (
                    <div
                      key={entry.studentId}
                      className={`flex items-center gap-3.5 p-4 rounded-xl border transition-all ${
                        i === 0 ? 'bg-[#FEF3C7]/40 border-[#FDE68A]' :
                        i === 1 ? 'bg-surface-alt border-border-subtle' :
                        i === 2 ? 'bg-[#FFE4EC]/40 border-[#FF8FA3]/30' :
                        'bg-surface border-border-subtle'
                      }`}
                    >
                      <span className={`text-2xl font-black ${getMedalColor(i)} w-8 text-center`}>
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                      </span>
                      <div className="w-8 h-8 rounded-full bg-brand-primary/20 text-brand-primary flex items-center justify-center text-sm font-bold flex-shrink-0">
                        {entry.studentName?.[0] || '?'}
                      </div>
                      <div className="flex-1">
                        <p className={`font-semibold text-sm ${entry.studentId === user?._id ? 'text-brand-primary font-bold' : 'text-text-primary'}`}>
                          {entry.studentName} {entry.studentId === user?._id && '(You)'}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-heading font-bold text-base text-text-primary">
                          {entry.score}/{entry.totalMarks}
                        </p>
                        <p className="text-text-muted text-xs font-medium">{entry.percentage}%</p>
                      </div>
                    </div>
                  ))}
                  {leaderboard.length === 0 && (
                    <p className="text-text-muted text-center py-8 text-sm">No submissions recorded yet.</p>
                  )}
                </div>

                <p className="text-text-muted text-xs text-center mt-4">Returning to live class in 30 seconds...</p>
              </div>
            </div>
          )}
        </div>

        {/* Chat Drawer */}
        {showChat && (
          <div className="w-72 sm:w-80 bg-surface border-l border-border-subtle flex flex-col flex-shrink-0 z-10 transition-colors">
            <div className="p-3 border-b border-border-subtle flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-brand-primary" />
                <span className="font-heading text-text-primary text-sm font-semibold">Class Chat</span>
              </div>
              <button
                onClick={() => setShowChat(false)}
                className="text-text-muted hover:text-text-primary p-1 transition-all"
                title="Close chat"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
              {messages.map((msg, i) => (
                <div
                  key={i}
                  className={`${msg.senderRole === 'teacher' ? 'bg-brand-primary/10 border border-brand-primary/20' : 'bg-surface-alt border border-border-subtle'} rounded-xl p-2.5`}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`text-xs font-semibold ${msg.senderRole === 'teacher' ? 'text-brand-primary' : 'text-text-primary'}`}>
                      {msg.senderName}
                    </span>
                    {msg.senderRole === 'teacher' && <Crown className="w-3 h-3 text-accent-amber" />}
                    <span className="text-text-muted text-[10px] ml-auto font-mono">
                      {new Date(msg.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-text-secondary text-xs leading-relaxed break-words">{msg.message}</p>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            <div className="p-3 border-t border-border-subtle">
              <div className="flex gap-2">
                <input
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') sendChat(); }}
                  placeholder="Type a message..."
                  className="flex-1 bg-surface-alt border border-border-subtle rounded-xl px-3 py-2 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
                />
                <button
                  onClick={sendChat}
                  className="p-2 bg-brand-primary hover:bg-brand-primary-hover text-white rounded-xl transition-all shadow-xs"
                  title="Send message"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 3. Call Controls Bar — 100% Pinned at Bottom, Never Disappears */}
      <div className="flex-shrink-0 bg-surface border-t border-border-subtle px-4 py-3 z-30 transition-colors">
        <div className="flex items-center justify-center gap-3 sm:gap-4 flex-wrap">
          {/* Microphone Toggle */}
          <button
            onClick={() => toggleMic()}
            className={`p-3 rounded-xl transition-all shadow-xs flex items-center justify-center ${
              isMicOn
                ? 'bg-brand-primary text-white shadow-md'
                : 'bg-surface-alt text-text-muted border border-border-subtle hover:text-text-primary'
            }`}
            title={isMicOn ? 'Mute Microphone' : 'Unmute Microphone'}
          >
            {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5 text-red-500" />}
          </button>

          {/* Camera Toggle */}
          <button
            onClick={() => toggleCamera()}
            className={`p-3 rounded-xl transition-all shadow-xs flex items-center justify-center ${
              isCamOn
                ? 'bg-brand-primary text-white shadow-md'
                : 'bg-surface-alt text-text-muted border border-border-subtle hover:text-text-primary'
            }`}
            title={isCamOn ? 'Turn Off Camera' : 'Turn On Camera'}
          >
            {isCamOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5 text-red-500" />}
          </button>

          {/* Screen Sharing Toggle */}
          <button
            onClick={toggleScreenShare}
            className={`p-3 rounded-xl transition-all shadow-xs flex items-center justify-center ${
              isScreenSharing
                ? 'bg-accent-mint text-slate-900 font-bold shadow-md'
                : 'bg-surface-alt text-text-muted border border-border-subtle hover:text-text-primary'
            }`}
            title={isScreenSharing ? 'Stop Screen Sharing' : 'Share Screen'}
          >
            {isScreenSharing ? <MonitorOff className="w-5 h-5" /> : <Monitor className="w-5 h-5" />}
          </button>

          {/* Toggle Chat Drawer */}
          <button
            onClick={() => setShowChat(!showChat)}
            className={`p-3 rounded-xl transition-all shadow-xs flex items-center justify-center ${
              showChat
                ? 'bg-brand-primary/15 text-brand-primary border border-brand-primary/30'
                : 'bg-surface-alt text-text-muted border border-border-subtle hover:text-text-primary'
            }`}
            title="Toggle Live Chat"
          >
            <MessageSquare className="w-5 h-5" />
          </button>

          {/* Teacher Action: Launch Quiz */}
          {isTeacher && (
            <button
              onClick={() => {
                if (activeQuiz) socket.emit('launch-quiz', { sessionCode: code, quizId: activeQuiz._id, durationSeconds: 60 });
                else toast('No active quiz selected for this course');
              }}
              className="px-3.5 py-2.5 bg-gradient-to-r from-brand-primary to-brand-secondary text-white rounded-xl text-xs font-semibold shadow-xs hover:opacity-95 flex items-center gap-1.5"
              title="Launch Quiz to All Students"
            >
              <Trophy className="w-4 h-4" />
              <span className="hidden sm:inline">Launch Quiz</span>
            </button>
          )}

          {/* Teacher Action: End Session for Everyone */}
          {isTeacher && (
            <button
              onClick={handleTeacherEndSession}
              className="px-3.5 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl text-xs font-semibold shadow-xs flex items-center gap-1.5 transition-all"
              title="End Live Class for Everyone"
            >
              <Square className="w-4 h-4" />
              <span className="hidden sm:inline">End Class</span>
            </button>
          )}

          {/* Leave Session */}
          <button
            onClick={() => { cleanup(); navigate('/live-sessions'); }}
            className="p-3 bg-[#FFE4EC] text-[#E1447A] hover:bg-[#FFE4EC]/80 border border-[#FFE4EC] rounded-xl transition-all"
            title="Leave Call"
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>

        <p className="text-center text-text-muted text-[11px] mt-1.5">
          {isCamOn || isMicOn || isScreenSharing
            ? 'Broadcast active • Your audio/video is shared with class'
            : 'Camera and microphone are currently off'}
        </p>
      </div>
    </div>
  );
};

export default LiveSessionPage;

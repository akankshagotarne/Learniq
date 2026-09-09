import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Mic, MicOff, Video, VideoOff, MessageSquare, Users, X, Send, PhoneOff,
  Trophy, Clock, CheckCircle, AlertTriangle, Crown, Maximize2, Minimize2
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getSocket } from '../../services/socket';
import api from '../../services/api';
import { LiveSession, ChatMessage, Participant, LeaderboardEntry, Quiz, Question } from '../../types';
import toast from 'react-hot-toast';

type LiveView = 'session' | 'quiz' | 'leaderboard';

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

  // Media
  const [isCamOn, setIsCamOn] = useState(false);
  const [isMicOn, setIsMicOn] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);

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

  // WebRTC
  const localVideoRef = useRef<HTMLVideoElement>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  const chatEndRef = useRef<HTMLDivElement>(null);

  const socket = getSocket();
  const isTeacher = user?.role === 'teacher' || user?.role === 'admin';

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    joinSession();
    setupSocketListeners();

    return () => {
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

  const joinSession = async () => {
    try {
      const res = await api.post(`/live-sessions/${code}/join`);
      setSession(res.data.session);
      setMessages(res.data.chatHistory || []);
      setLoading(false);

      socket.emit('join-live-session', { sessionCode: code });
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to join session');
      navigate('/live-sessions');
    }
  };

  const setupSocketListeners = () => {
    socket.on('participant-joined', ({ participants: p }) => setParticipants(p));
    socket.on('participant-left', ({ participants: p }) => setParticipants(p));

    socket.on('chat-message', (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
    });

    socket.on('chat-deleted', ({ messageId }: { messageId: string }) => {
      setMessages(prev => prev.filter(m => m._id !== messageId));
    });

    // WebRTC signaling
    socket.on('participant-joined', async ({ participant }) => {
      if (participant.socketId !== socket.id && isCamOn) {
        await createOffer(participant.socketId);
      }
    });

    socket.on('webrtc-offer', async ({ fromSocketId, offer }) => {
      await handleOffer(fromSocketId, offer);
    });

    socket.on('webrtc-answer', async ({ fromSocketId, answer }) => {
      const pc = peerConnectionsRef.current[fromSocketId];
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(answer));
    });

    socket.on('webrtc-ice-candidate', async ({ fromSocketId, candidate }) => {
      const pc = peerConnectionsRef.current[fromSocketId];
      if (pc) await pc.addIceCandidate(new RTCIceCandidate(candidate));
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

    socket.on('session-ended', () => {
      toast('The session has ended.', { icon: '📚' });
      cleanup();
      navigate('/live-sessions');
    });

    // Permission requests
    socket.on('permission-request', (req) => {
      setPermRequest(req);
    });

    socket.on('permission-response', ({ type, granted, fromSocketId }) => {
      if (granted) {
        if (type === 'mic') toggleMic(true);
        if (type === 'camera') toggleCamera(true);
      }
    });

    socket.on('error', ({ message }) => {
      toast.error(message);
    });
  };

  const cleanup = () => {
    localStreamRef.current?.getTracks().forEach(t => t.stop());
    Object.values(peerConnectionsRef.current).forEach(pc => pc.close());
    peerConnectionsRef.current = {};
    socket.off('participant-joined');
    socket.off('participant-left');
    socket.off('chat-message');
    socket.off('webrtc-offer');
    socket.off('webrtc-answer');
    socket.off('webrtc-ice-candidate');
    socket.off('quiz-started');
    socket.off('quiz-result');
    socket.off('leaderboard-update');
    socket.off('quiz-ended');
    socket.off('session-ended');
    socket.off('permission-request');
    socket.off('error');
  };

  const createPeerConnection = (targetSocketId: string) => {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
    });

    pc.onicecandidate = e => {
      if (e.candidate) {
        socket.emit('webrtc-ice-candidate', { targetSocketId, candidate: e.candidate });
      }
    };

    pc.ontrack = e => {
      // Attach remote stream to video element
      const vid = document.getElementById(`video-${targetSocketId}`) as HTMLVideoElement;
      if (vid && e.streams[0]) vid.srcObject = e.streams[0];
    };

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current!);
      });
    }

    peerConnectionsRef.current[targetSocketId] = pc;
    return pc;
  };

  const createOffer = async (targetSocketId: string) => {
    const pc = createPeerConnection(targetSocketId);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('webrtc-offer', { targetSocketId, offer });
  };

  const handleOffer = async (fromSocketId: string, offer: RTCSessionDescriptionInit) => {
    const pc = createPeerConnection(fromSocketId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    socket.emit('webrtc-answer', { targetSocketId: fromSocketId, answer });
  };

  const toggleCamera = async (force?: boolean) => {
    if (isCamOn && !force) {
      localStreamRef.current?.getVideoTracks().forEach(t => { t.enabled = false; t.stop(); });
      setIsCamOn(false);
      socket.emit('camera-state', { sessionCode: code, isOn: false });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: isMicOn });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      setIsCamOn(true);
      socket.emit('camera-state', { sessionCode: code, isOn: true });
    } catch {
      toast.error('Camera permission denied. Please allow camera access in your browser.');
    }
  };

  const toggleMic = async (force?: boolean) => {
    if (isMicOn && !force) {
      localStreamRef.current?.getAudioTracks().forEach(t => { t.enabled = false; });
      setIsMicOn(false);
      socket.emit('mic-state', { sessionCode: code, isOn: false });
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      setIsMicOn(true);
      socket.emit('mic-state', { sessionCode: code, isOn: true });
    } catch {
      toast.error('Microphone permission denied. Please allow microphone access in your browser.');
    }
  };

  const sendChat = () => {
    if (!chatInput.trim()) return;
    socket.emit('send-chat', { sessionCode: code, message: chatInput.trim() });
    setChatInput('');
  };

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

  const formatTime = (sec: number) => `${Math.floor(sec / 60).toString().padStart(2, '0')}:${(sec % 60).toString().padStart(2, '0')}`;

  const getMedalColor = (pos: number) => {
    if (pos === 0) return 'text-yellow-400';
    if (pos === 1) return 'text-gray-300';
    if (pos === 2) return 'text-amber-600';
    return 'text-text-muted';
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-brand-primary/30 border-t-brand-primary rounded-full animate-spin mx-auto mb-4" />
          <p className="text-text-secondary text-sm font-medium">Joining live session...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-page text-text-primary flex flex-col transition-colors">
      {/* Header */}
      <div className="bg-surface border-b border-border-subtle px-4 py-3 flex items-center justify-between transition-colors">
        <div className="flex items-center gap-3">
          <div className="live-dot" />
          <div>
            <h1 className="font-heading text-text-primary font-semibold text-sm">{session?.title}</h1>
            <p className="text-text-muted text-xs">{session?.subject} • Std {session?.standard}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-surface-alt border border-border-subtle rounded-xl">
            <Users className="w-3.5 h-3.5 text-brand-primary" />
            <span className="text-text-secondary text-xs font-semibold">{participants.length}</span>
          </div>
          <button onClick={() => { cleanup(); navigate('/live-sessions'); }}
            className="p-2 bg-[#FFE4EC] text-[#E1447A] hover:bg-[#FFD1DC] rounded-xl transition-all shadow-xs"
            title="Leave Session">
            <PhoneOff className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Permission Request Banner */}
      {permRequest && (
        <div className="bg-brand-primary/10 border-b border-brand-primary/20 px-4 py-3 flex items-center justify-between animate-slide-down">
          <p className="text-text-primary text-sm">
            <strong className="text-brand-primary">{permRequest.from}</strong> is requesting to enable your <strong>{permRequest.type}</strong>.
          </p>
          <div className="flex gap-2">
            <button onClick={() => {
              socket.emit('permission-response', { sessionCode: code, targetSocketId: permRequest.fromSocketId, type: permRequest.type, granted: true });
              setPermRequest(null);
            }} className="btn-primary px-3 py-1 text-xs">Allow</button>
            <button onClick={() => {
              socket.emit('permission-response', { sessionCode: code, targetSocketId: permRequest.fromSocketId, type: permRequest.type, granted: false });
              setPermRequest(null);
            }} className="px-3 py-1 bg-surface-alt border border-border-subtle text-text-secondary text-xs rounded-xl hover:bg-surface">Decline</button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Video/Quiz Area */}
        <div className="flex-1 flex flex-col p-4 gap-4 overflow-y-auto">
          {view === 'session' && (
            <>
              {/* Main Video */}
              <div className="video-container w-full max-w-3xl mx-auto shadow-soft">
                {!isCamOn && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0D0E1A]">
                    <div className="w-20 h-20 bg-white/10 rounded-full flex items-center justify-center mb-3">
                      <VideoOff className="w-8 h-8 text-white/40" />
                    </div>
                    <p className="text-white/70 text-sm font-medium">Camera is off</p>
                    <p className="text-white/40 text-xs mt-1">Click the camera button below to enable</p>
                  </div>
                )}
                <video ref={localVideoRef} autoPlay muted playsInline
                  className={`w-full h-full object-cover rounded-2xl ${!isCamOn ? 'hidden' : ''}`} />

                {/* Teacher info overlay */}
                {session?.teacher && (
                  <div className="absolute bottom-4 left-4 flex items-center gap-2 bg-black/70 backdrop-blur-md px-3 py-2 rounded-xl border border-white/10">
                    <img
                      src={(session.teacher as any).avatar || `https://ui-avatars.com/api/?name=T&background=6C63F2&color=fff&size=32`}
                      alt="Teacher"
                      className="w-7 h-7 rounded-full object-cover border border-white/20"
                    />
                    <div>
                      <p className="text-white text-xs font-semibold">{(session.teacher as any).name}</p>
                      <p className="text-white/60 text-[10px]">Instructor</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Participants */}
              {participants.length > 0 && (
                <div className="max-w-3xl mx-auto w-full">
                  <p className="text-text-secondary text-xs font-semibold uppercase tracking-wider mb-2">Participants ({participants.length})</p>
                  <div className="flex gap-2 flex-wrap">
                    {participants.map(p => (
                      <div key={p.socketId} className="flex items-center gap-1.5 px-2.5 py-1.5 bg-surface border border-border-subtle rounded-xl shadow-xs">
                        <div className="w-6 h-6 rounded-full bg-brand-primary/20 text-brand-primary flex items-center justify-center text-xs font-bold">
                          {p.name?.[0] || '?'}
                        </div>
                        <span className="text-text-primary text-xs font-medium">{p.name}</span>
                        {p.isMicOn && <Mic className="w-3 h-3 text-accent-mint" />}
                        {p.isCameraOn && <Video className="w-3 h-3 text-brand-primary" />}
                        {p.isTeacher && <Crown className="w-3 h-3 text-accent-amber" />}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Quiz View */}
          {view === 'quiz' && activeQuiz && (
            <div className="max-w-2xl mx-auto w-full animate-slide-up">
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
                    <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto mb-4 text-4xl
                      ${quizResult.percentage >= 60 ? 'bg-accent-mint/20' : 'bg-[#FFE4EC]'}`}>
                      {quizResult.percentage >= 60 ? '🎉' : '📚'}
                    </div>
                    <p className="text-3xl font-heading font-bold text-text-primary mb-2">{quizResult.score}/{quizResult.totalMarks}</p>
                    <p className={`text-xl font-semibold mb-2 ${quizResult.percentage >= 60 ? 'text-[#16A34A] dark:text-[#4ADE9A]' : 'text-[#E1447A]'}`}>
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
            <div className="max-w-xl mx-auto w-full animate-slide-up">
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
                      className={`leaderboard-item flex items-center gap-3.5 p-4 rounded-xl border transition-all ${
                        i === 0 ? 'bg-[#FEF3C7]/40 dark:bg-[#3D2C0C]/30 border-[#FDE68A]' :
                        i === 1 ? 'bg-surface-alt border-border-subtle' :
                        i === 2 ? 'bg-[#FFE4EC]/40 dark:bg-[#3D1825]/30 border-[#FF8FA3]/30' :
                        'bg-surface border-border-subtle'
                      }`}
                      style={{ animationDelay: `${i * 0.15}s` }}
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
                      <div className="text-right score-count" style={{ animationDelay: `${i * 0.15 + 0.3}s` }}>
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

        {/* Chat Panel */}
        {showChat && (
          <div className="w-72 bg-surface border-l border-border-subtle flex flex-col flex-shrink-0 transition-colors">
            <div className="p-3 border-b border-border-subtle flex items-center justify-between">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-brand-primary" />
                <span className="font-heading text-text-primary text-sm font-semibold">Live Chat</span>
              </div>
              <button onClick={() => setShowChat(false)} className="text-text-muted hover:text-text-primary transition-all">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {messages.map((msg, i) => (
                <div key={i} className={`${msg.senderRole === 'teacher' ? 'bg-brand-primary/10 border border-brand-primary/20' : 'bg-surface-alt border border-border-subtle'} rounded-xl p-2.5`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className={`text-xs font-semibold ${msg.senderRole === 'teacher' ? 'text-brand-primary' : 'text-text-primary'}`}>
                      {msg.senderName}
                    </span>
                    {msg.senderRole === 'teacher' && <Crown className="w-3 h-3 text-accent-amber" />}
                    <span className="text-text-muted text-[10px] ml-auto font-mono">
                      {new Date(msg.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="text-text-secondary text-xs leading-relaxed">{msg.message}</p>
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
                <button onClick={sendChat} className="p-2 bg-brand-primary hover:bg-brand-primary-hover text-white rounded-xl transition-all shadow-xs">
                  <Send className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="bg-surface border-t border-border-subtle px-4 py-3 transition-colors">
        <div className="flex items-center justify-center gap-4">
          <button
            onClick={() => toggleMic()}
            className={`p-3 rounded-xl transition-all shadow-xs ${isMicOn ? 'bg-brand-primary/15 text-brand-primary border border-brand-primary/30' : 'bg-surface-alt text-text-muted border border-border-subtle hover:text-text-primary'}`}
            title={isMicOn ? 'Mute microphone' : 'Enable microphone'}
          >
            {isMicOn ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
          </button>

          <button
            onClick={() => toggleCamera()}
            className={`p-3 rounded-xl transition-all shadow-xs ${isCamOn ? 'bg-brand-primary/15 text-brand-primary border border-brand-primary/30' : 'bg-surface-alt text-text-muted border border-border-subtle hover:text-text-primary'}`}
            title={isCamOn ? 'Turn off camera' : 'Enable camera'}
          >
            {isCamOn ? <Video className="w-5 h-5" /> : <VideoOff className="w-5 h-5" />}
          </button>

          <button
            onClick={() => setShowChat(!showChat)}
            className={`p-3 rounded-xl transition-all shadow-xs ${showChat ? 'bg-brand-primary/15 text-brand-primary border border-brand-primary/30' : 'bg-surface-alt text-text-muted border border-border-subtle hover:text-text-primary'}`}
            title="Toggle Live Chat"
          >
            <MessageSquare className="w-5 h-5" />
          </button>

          {isTeacher && (
            <button
              onClick={() => {
                if (activeQuiz) socket.emit('launch-quiz', { sessionCode: code, quizId: activeQuiz._id, durationSeconds: 60 });
                else toast('Select a quiz first');
              }}
              className="px-4 py-2.5 bg-gradient-to-r from-brand-primary to-brand-secondary text-white rounded-xl text-xs font-semibold shadow-xs hover:opacity-95 flex items-center gap-1.5"
            >
              <Trophy className="w-4 h-4" />
              <span>Launch Quiz</span>
            </button>
          )}
          <button
            onClick={() => { cleanup(); navigate('/live-sessions'); }}
            className="p-3 bg-red-500 hover:bg-red-400 text-white rounded-xl transition-all ml-4"
            title="Leave session"
          >
            <PhoneOff className="w-5 h-5" />
          </button>
        </div>

        <p className="text-center text-text-muted text-xs mt-2">
          {isCamOn || isMicOn ? 'Camera/mic active — visible to all participants' : 'Camera and mic are off'}
        </p>
      </div>
    </div>
  );
};

export default LiveSessionPage;

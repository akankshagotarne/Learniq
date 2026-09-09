import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Mic, MicOff, Video, VideoOff, MessageSquare, Users, X, Send, PhoneOff,
  Trophy, Clock, CheckCircle, Crown, Monitor, MonitorOff, Square, Sparkles, Copy,
  BarChart2, HelpCircle, AlertCircle
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { getSocket } from '../../services/socket';
import api from '../../services/api';
import {
  LiveSession, ChatMessage, Participant, LeaderboardEntry, Quiz, Question,
  LiveMcq, McqResultEntry, ScoreboardEntry, PodiumEntry
} from '../../types';
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

const OPTION_LABELS = ['A', 'B', 'C', 'D'];

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

// ==================== MCQ FORM MODAL (Teacher) ====================
const McqFormModal: React.FC<{
  onClose: () => void;
  onLaunch: (question: string, options: string[], correctIndex: number) => void;
}> = ({ onClose, onLaunch }) => {
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '', '', '']);
  const [correctIndex, setCorrectIndex] = useState<number | null>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    questionRef.current?.focus();
  }, []);

  const canLaunch = question.trim().length > 0
    && options.every(o => o.trim().length > 0)
    && correctIndex !== null;

  const handleOptionChange = (i: number, val: string) => {
    setOptions(prev => prev.map((o, idx) => idx === i ? val : o));
  };

  const handleLaunch = () => {
    if (!canLaunch) return;
    onLaunch(question.trim(), options.map(o => o.trim()), correctIndex!);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
      <div className="bg-surface border border-border-subtle rounded-2xl shadow-2xl w-full max-w-lg animate-slide-up">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border-subtle">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-brand-primary/10 rounded-lg">
              <HelpCircle className="w-4 h-4 text-brand-primary" />
            </div>
            <h2 className="font-heading font-bold text-text-primary text-sm">Raise MCQ Question</h2>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-all p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Question */}
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

          {/* Options */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-text-secondary text-xs font-semibold">Options</label>
              <span className="text-text-muted text-[11px]">Select the correct answer →</span>
            </div>
            <div className="space-y-2">
              {options.map((opt, i) => (
                <div key={i} className="flex items-center gap-2.5">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 transition-all ${
                    correctIndex === i
                      ? 'bg-brand-primary text-white'
                      : 'bg-surface-alt border border-border-subtle text-text-muted'
                  }`}>
                    {OPTION_LABELS[i]}
                  </div>
                  <input
                    type="text"
                    value={opt}
                    onChange={e => handleOptionChange(i, e.target.value)}
                    placeholder={`Option ${OPTION_LABELS[i]}`}
                    className="flex-1 bg-surface-alt border border-border-subtle rounded-xl px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-primary/30"
                  />
                  <button
                    type="button"
                    onClick={() => setCorrectIndex(i)}
                    className={`px-3 py-2 rounded-xl text-xs font-semibold transition-all flex-shrink-0 border ${
                      correctIndex === i
                        ? 'bg-accent-mint/20 text-accent-mint border-accent-mint/40'
                        : 'bg-surface-alt border-border-subtle text-text-muted hover:border-accent-mint/30 hover:text-accent-mint'
                    }`}
                    title={`Mark Option ${OPTION_LABELS[i]} as correct`}
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

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 py-4 border-t border-border-subtle">
          <button
            onClick={onClose}
            className="px-4 py-2 text-text-secondary text-sm rounded-xl border border-border-subtle hover:bg-surface-alt transition-all"
          >
            Cancel
          </button>
          <button
            onClick={handleLaunch}
            disabled={!canLaunch}
            className="px-5 py-2 bg-gradient-to-r from-brand-primary to-brand-secondary text-white rounded-xl text-sm font-semibold shadow-xs hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            Launch — 15s
          </button>
        </div>
      </div>
    </div>
  );
};

// ==================== MCQ OVERLAY (Everyone) ====================
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
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-border-subtle">
          <div className="flex items-center gap-2">
            <div className="live-dot" />
            <span className="text-text-secondary text-xs font-semibold uppercase tracking-wide">Live MCQ</span>
          </div>
          {/* Server-authoritative countdown */}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-mono font-bold text-sm transition-all ${
            isUrgent
              ? 'bg-[#FFE4EC] text-[#E1447A] animate-pulse'
              : 'bg-brand-primary/10 text-brand-primary'
          }`}>
            <Clock className="w-4 h-4" />
            {timeLeft}s
          </div>
        </div>

        {/* Question */}
        <div className="px-5 py-4">
          <p className="text-text-primary font-semibold text-base leading-relaxed">{mcq.question}</p>
          {isTeacher && (
            <p className="text-text-muted text-xs mt-1.5 flex items-center gap-1">
              <Crown className="w-3 h-3 text-accent-amber" />
              Teacher view — correct answer highlighted
            </p>
          )}
        </div>

        {/* Options */}
        <div className="px-5 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {mcq.options.map((opt, i) => {
            const isSelected = selectedOption === i;
            const isCorrectOption = isTeacher && teacherCorrectIndex === i;

            let optClass = 'bg-surface-alt border-border-subtle text-text-secondary hover:bg-surface hover:text-text-primary';
            if (isLocked && isSelected) optClass = 'bg-brand-primary/10 border-brand-primary text-brand-primary font-semibold';
            if (!isLocked && isSelected) optClass = 'bg-brand-primary/10 border-brand-primary text-brand-primary font-semibold shadow-xs';
            if (isCorrectOption) optClass = 'bg-accent-mint/15 border-accent-mint text-accent-mint font-semibold';

            return (
              <button
                key={i}
                onClick={() => !isLocked && !isTeacher && onSelect(i)}
                disabled={isLocked || isTeacher}
                className={`p-3.5 rounded-xl border text-left text-sm transition-all ${optClass} ${
                  isLocked || isTeacher ? 'cursor-default' : 'cursor-pointer'
                }`}
              >
                <span className="font-bold text-brand-primary mr-2">{OPTION_LABELS[i]}.</span>
                {opt}
                {isCorrectOption && <span className="ml-1 text-accent-mint text-xs">✓</span>}
              </button>
            );
          })}
        </div>

        {/* Submit (students only, not locked) */}
        {!isTeacher && (
          <div className="px-5 pb-5">
            {isLocked ? (
              <div className="flex items-center gap-2 justify-center py-3 bg-surface-alt border border-border-subtle rounded-xl text-text-secondary text-sm">
                <CheckCircle className="w-4 h-4 text-brand-primary" />
                {selectedOption !== null ? 'Answer locked in!' : 'Time\'s up — no answer recorded'}
              </div>
            ) : (
              <button
                onClick={onSubmit}
                disabled={selectedOption === null}
                className="btn-primary w-full py-3 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <CheckCircle className="w-4 h-4" />
                Lock in Answer
              </button>
            )}
          </div>
        )}

        {isTeacher && (
          <div className="px-5 pb-5">
            <div className="text-center text-text-muted text-xs py-2">
              Waiting for students to answer... Question auto-closes in {timeLeft}s
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

// ==================== MCQ RESULTS POPUP ====================
const McqResultsPopup: React.FC<{
  results: McqResultEntry[];
  correctIndex: number;
  options: string[];
  currentUserId?: string;
  onClose: () => void;
}> = ({ results, correctIndex, options, currentUserId, onClose }) => {
  const correct = results.filter(r => r.isCorrect);
  const incorrect = results.filter(r => !r.isCorrect);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
      <div className="bg-surface border border-border-subtle rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col animate-slide-up">
        {/* Header */}
        <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between flex-shrink-0">
          <div>
            <h2 className="font-heading font-black text-text-primary text-base">📊 MCQ Results</h2>
            <p className="text-text-muted text-xs mt-0.5">
              Correct answer: <strong className="text-accent-mint">{OPTION_LABELS[correctIndex]}. {options[correctIndex]}</strong>
            </p>
          </div>
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-all p-1">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Results list */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {correct.length > 0 && (
            <>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
                ✅ Correct — ranked by speed
              </p>
              {correct.map((r, i) => (
                <div
                  key={r.studentId}
                  className={`flex items-center gap-3 p-3 rounded-xl border ${
                    r.studentId === currentUserId
                      ? 'bg-brand-primary/10 border-brand-primary/30'
                      : 'bg-surface-alt border-border-subtle'
                  }`}
                >
                  <span className={`w-7 h-7 flex items-center justify-center rounded-lg text-sm font-black flex-shrink-0 ${
                    i === 0 ? 'bg-[#FEF3C7] text-yellow-600' :
                    i === 1 ? 'bg-surface border border-border-subtle text-text-muted' :
                    i === 2 ? 'bg-[#FFE4EC] text-[#E1447A]' : 'bg-surface-alt text-text-muted text-xs'
                  }`}>
                    {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold truncate ${r.studentId === currentUserId ? 'text-brand-primary' : 'text-text-primary'}`}>
                      {r.studentName} {r.studentId === currentUserId && '(You)'}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-xs font-mono text-accent-mint font-semibold">
                      {r.responseTimeSec !== null ? `${r.responseTimeSec}s` : '—'}
                    </p>
                  </div>
                </div>
              ))}
            </>
          )}

          {incorrect.length > 0 && (
            <>
              <p className="text-xs font-semibold text-text-muted uppercase tracking-wide mt-4 mb-2">
                ❌ Wrong / No answer
              </p>
              {incorrect.map(r => (
                <div
                  key={r.studentId}
                  className={`flex items-center gap-3 p-3 rounded-xl border ${
                    r.studentId === currentUserId
                      ? 'bg-brand-primary/10 border-brand-primary/30'
                      : 'bg-surface border-border-subtle'
                  }`}
                >
                  <div className="w-7 h-7 rounded-lg bg-[#FFE4EC] flex items-center justify-center flex-shrink-0">
                    <span className="text-[#E1447A] text-xs font-bold">✗</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold truncate ${r.studentId === currentUserId ? 'text-brand-primary' : 'text-text-primary'}`}>
                      {r.studentName} {r.studentId === currentUserId && '(You)'}
                    </p>
                    <p className="text-text-muted text-xs">
                      {r.selectedOption !== null ? `Chose ${OPTION_LABELS[r.selectedOption]}` : 'No answer'}
                    </p>
                  </div>
                  <p className="text-xs font-mono text-text-muted flex-shrink-0">
                    {r.responseTimeSec !== null ? `${r.responseTimeSec}s` : '—'}
                  </p>
                </div>
              ))}
            </>
          )}

          {results.length === 0 && (
            <p className="text-text-muted text-center py-8 text-sm">No responses recorded.</p>
          )}
        </div>

        <div className="px-5 py-3 border-t border-border-subtle flex-shrink-0">
          <button onClick={onClose} className="btn-primary w-full py-2.5 text-sm">
            Close Results
          </button>
        </div>
      </div>
    </div>
  );
};

// ==================== SCOREBOARD MODAL ====================
const ScoreboardModal: React.FC<{
  scoreboard: ScoreboardEntry[];
  currentUserId?: string;
  onClose: () => void;
}> = ({ scoreboard, currentUserId, onClose }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-fade-in">
    <div className="bg-surface border border-border-subtle rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col animate-slide-up">
      <div className="px-5 py-4 border-b border-border-subtle flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-2.5">
          <BarChart2 className="w-4 h-4 text-brand-primary" />
          <h2 className="font-heading font-bold text-text-primary text-sm">Session Scoreboard</h2>
        </div>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary p-1">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {scoreboard.length === 0 && (
          <p className="text-text-muted text-center py-8 text-sm">No MCQs asked yet this session.</p>
        )}
        {scoreboard.map((entry, i) => (
          <div
            key={entry.userId}
            className={`flex items-center gap-3 p-3.5 rounded-xl border transition-all ${
              entry.userId === currentUserId
                ? 'bg-brand-primary/10 border-brand-primary/30'
                : i === 0 ? 'bg-[#FEF3C7]/30 border-[#FDE68A]/50'
                : 'bg-surface-alt border-border-subtle'
            }`}
          >
            <span className={`text-lg font-black w-8 text-center flex-shrink-0 ${
              i === 0 ? 'text-yellow-500' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-amber-600' : 'text-text-muted text-sm'
            }`}>
              {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`}
            </span>
            <div className="flex-1 min-w-0">
              <p className={`font-semibold text-sm truncate ${entry.userId === currentUserId ? 'text-brand-primary' : 'text-text-primary'}`}>
                {entry.name} {entry.userId === currentUserId && '(You)'}
              </p>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0 text-xs">
              <span className="text-accent-mint font-bold">✓{entry.correct}</span>
              <span className="text-[#E1447A] font-semibold">✗{entry.wrong}</span>
              {entry.correct > 0 && (
                <span className="text-text-muted font-mono">
                  {(entry.totalResponseTimeSec / entry.correct).toFixed(1)}s avg
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="px-5 py-3 border-t border-border-subtle flex-shrink-0">
        <p className="text-text-muted text-[11px] text-center">
          Ranked by: most correct answers · fastest response time (tiebreaker)
        </p>
      </div>
    </div>
  </div>
);

// ==================== TOP-3 PODIUM SCREEN ====================
const PodiumScreen: React.FC<{
  podium: PodiumEntry[];
  currentUserId?: string;
  onDismiss: () => void;
}> = ({ podium, currentUserId, onDismiss }) => {
  const [countdown, setCountdown] = useState(10);

  useEffect(() => {
    const t = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { clearInterval(t); onDismiss(); return 0; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [onDismiss]);

  const place1 = podium.find(p => p.place === 1);
  const place2 = podium.find(p => p.place === 2);
  const place3 = podium.find(p => p.place === 3);

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-[#0D0E1A] via-[#1a1b35] to-[#0D0E1A] animate-fade-in px-4">
      {/* Stars / sparkles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {[...Array(30)].map((_, i) => (
          <div
            key={i}
            className="absolute w-1 h-1 bg-white rounded-full opacity-30 animate-pulse"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 3}s`,
              animationDuration: `${2 + Math.random() * 3}s`,
            }}
          />
        ))}
      </div>

      <div className="relative z-10 text-center mb-10">
        <p className="text-4xl mb-3">🏆</p>
        <h1 className="font-heading font-black text-3xl text-white mb-1">Final Results</h1>
        <p className="text-white/50 text-sm">Session has ended</p>
      </div>

      {/* Podium visual: 2nd | 1st | 3rd */}
      <div className="relative z-10 flex items-end justify-center gap-4 mb-12 w-full max-w-lg">
        {/* 2nd Place */}
        <div className="flex flex-col items-center">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center text-xl font-black mb-3 border-2 ${
            place2?.userId === currentUserId
              ? 'bg-brand-primary/30 border-brand-primary text-white'
              : 'bg-white/10 border-white/20 text-white'
          }`}>
            {place2?.name?.[0] || '?'}
          </div>
          <p className={`text-sm font-semibold mb-1 max-w-[90px] text-center truncate ${
            place2?.userId === currentUserId ? 'text-brand-primary' : 'text-white/80'
          }`}>
            {place2?.name || '—'}
          </p>
          {place2 && (
            <p className="text-white/50 text-xs">✓{place2.correct}</p>
          )}
          <div className="w-20 h-20 bg-slate-400/30 border-2 border-slate-400/50 rounded-t-xl flex items-end justify-center pb-2 mt-2">
            <span className="text-3xl">🥈</span>
          </div>
        </div>

        {/* 1st Place */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-6 h-6 mb-1">
            <Crown className="w-6 h-6 text-accent-amber" />
          </div>
          <div className={`w-20 h-20 rounded-full flex items-center justify-center text-2xl font-black mb-3 border-4 shadow-xl ${
            place1?.userId === currentUserId
              ? 'bg-brand-primary/30 border-brand-primary text-white'
              : 'bg-white/15 border-yellow-400/70 text-white'
          }`}>
            {place1?.name?.[0] || '?'}
          </div>
          <p className={`text-base font-bold mb-1 max-w-[110px] text-center truncate ${
            place1?.userId === currentUserId ? 'text-brand-primary' : 'text-white'
          }`}>
            {place1?.name || '—'}
          </p>
          {place1 && (
            <p className="text-yellow-400 text-xs font-semibold">✓{place1.correct}</p>
          )}
          <div className="w-24 h-28 bg-yellow-400/20 border-2 border-yellow-400/60 rounded-t-xl flex items-end justify-center pb-2 mt-2">
            <span className="text-4xl">🥇</span>
          </div>
        </div>

        {/* 3rd Place */}
        <div className="flex flex-col items-center">
          <div className={`w-16 h-16 rounded-full flex items-center justify-center text-xl font-black mb-3 border-2 ${
            place3?.userId === currentUserId
              ? 'bg-brand-primary/30 border-brand-primary text-white'
              : 'bg-white/10 border-white/20 text-white'
          }`}>
            {place3?.name?.[0] || '?'}
          </div>
          <p className={`text-sm font-semibold mb-1 max-w-[90px] text-center truncate ${
            place3?.userId === currentUserId ? 'text-brand-primary' : 'text-white/80'
          }`}>
            {place3?.name || '—'}
          </p>
          {place3 && (
            <p className="text-white/50 text-xs">✓{place3.correct}</p>
          )}
          <div className="w-20 h-14 bg-amber-700/30 border-2 border-amber-600/50 rounded-t-xl flex items-end justify-center pb-2 mt-2">
            <span className="text-3xl">🥉</span>
          </div>
        </div>
      </div>

      {podium.length === 0 && (
        <p className="text-white/40 text-sm relative z-10 mb-8">No MCQ answers recorded this session.</p>
      )}

      <button
        onClick={onDismiss}
        className="relative z-10 px-6 py-2.5 bg-white/10 border border-white/20 text-white rounded-xl text-sm hover:bg-white/15 transition-all"
      >
        Continue ({countdown}s)
      </button>
    </div>
  );
};

// ==================== MAIN COMPONENT ====================

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

  // Legacy quiz state
  const [activeQuiz, setActiveQuiz] = useState<Quiz | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizResult, setQuizResult] = useState<{ score: number; totalMarks: number; percentage: number } | null>(null);
  const [quizTimeLeft, setQuizTimeLeft] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [quizStartTime, setQuizStartTime] = useState<number>(0);

  // Permission request
  const [permRequest, setPermRequest] = useState<{ type: string; from: string; fromSocketId: string } | null>(null);

  // ---- Live MCQ state ----
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

  // WebRTC Refs
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Record<string, RTCPeerConnection>>({});
  const pendingCandidatesRef = useRef<Record<string, RTCIceCandidateInit[]>>({});
  const chatEndRef = useRef<HTMLDivElement>(null);

  const socket = getSocket();
  const isTeacher = user?.role === 'teacher' || user?.role === 'admin';

  // ---- Server-authoritative MCQ countdown ----
  useEffect(() => {
    if (activeMcq) {
      // Start interval that syncs to server startTimestamp
      if (mcqTimerRef.current) clearInterval(mcqTimerRef.current);
      mcqTimerRef.current = setInterval(() => {
        const remaining = Math.max(0, Math.ceil((activeMcq.startTimestamp + activeMcq.durationMs - Date.now()) / 1000));
        setMcqTimeLeft(remaining);
        if (remaining <= 0) {
          if (mcqTimerRef.current) clearInterval(mcqTimerRef.current);
          // Auto-lock if not already submitted
          setMcqAnswerLocked(true);
        }
      }, 250); // Update 4x/sec for smooth countdown
      return () => { if (mcqTimerRef.current) clearInterval(mcqTimerRef.current); };
    } else {
      if (mcqTimerRef.current) clearInterval(mcqTimerRef.current);
      setMcqTimeLeft(0);
    }
  }, [activeMcq]);

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

  // Legacy quiz timer
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
      try { pc.close(); } catch {}
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
    // MCQ events
    socket.off('mcq-raised');
    socket.off('mcq-teacher-info');
    socket.off('mcq-closed');
    socket.off('mcq-results');
    socket.off('mcq-answer-locked');
    socket.off('mcq-error');
    socket.off('scoreboard-update');
  }, [socket]);

  // Create Peer Connection with STUN, ICE queue, and stream listener
  const createPeerConnection = useCallback((targetSocketId: string): RTCPeerConnection => {
    if (peerConnectionsRef.current[targetSocketId]) {
      try { peerConnectionsRef.current[targetSocketId].close(); } catch {}
    }

    console.log(`[WebRTC] Creating RTCPeerConnection for ${targetSocketId}`);
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('webrtc-ice-candidate', { targetSocketId, candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      console.log(`[WebRTC] Remote track received from ${targetSocketId}:`, event.track.kind);
      const stream = event.streams[0] || new MediaStream([event.track]);
      setRemoteStreams(prev => ({ ...prev, [targetSocketId]: stream }));
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Connection state with ${targetSocketId}: ${pc.connectionState}`);
    };

    const activeStream = screenStreamRef.current || localStreamRef.current;
    if (activeStream) {
      activeStream.getTracks().forEach(track => pc.addTrack(track, activeStream));
    }

    peerConnectionsRef.current[targetSocketId] = pc;
    return pc;
  }, [socket]);

  const createOffer = useCallback(async (targetSocketId: string) => {
    try {
      const pc = createPeerConnection(targetSocketId);
      const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
      await pc.setLocalDescription(offer);
      socket.emit('webrtc-offer', { targetSocketId, offer });
    } catch (err) {
      console.error(`[WebRTC] Error creating offer for ${targetSocketId}:`, err);
    }
  }, [createPeerConnection, socket]);

  const handleOffer = useCallback(async (fromSocketId: string, offer: RTCSessionDescriptionInit) => {
    try {
      const pc = createPeerConnection(fromSocketId);
      await pc.setRemoteDescription(new RTCSessionDescription(offer));

      if (pendingCandidatesRef.current[fromSocketId]?.length) {
        for (const candidate of pendingCandidatesRef.current[fromSocketId]) {
          try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
        }
        pendingCandidatesRef.current[fromSocketId] = [];
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc-answer', { targetSocketId: fromSocketId, answer });
    } catch (err) {
      console.error(`[WebRTC] Error handling offer from ${fromSocketId}:`, err);
    }
  }, [createPeerConnection, socket]);

  const handleAnswer = useCallback(async (fromSocketId: string, answer: RTCSessionDescriptionInit) => {
    try {
      const pc = peerConnectionsRef.current[fromSocketId];
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        if (pendingCandidatesRef.current[fromSocketId]?.length) {
          for (const candidate of pendingCandidatesRef.current[fromSocketId]) {
            try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
          }
          pendingCandidatesRef.current[fromSocketId] = [];
        }
      }
    } catch (err) {
      console.error(`[WebRTC] Error setting remote description from ${fromSocketId}:`, err);
    }
  }, []);

  const handleIceCandidate = useCallback(async (fromSocketId: string, candidate: RTCIceCandidateInit) => {
    const pc = peerConnectionsRef.current[fromSocketId];
    if (pc && pc.remoteDescription?.type) {
      try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch {}
    } else {
      if (!pendingCandidatesRef.current[fromSocketId]) {
        pendingCandidatesRef.current[fromSocketId] = [];
      }
      pendingCandidatesRef.current[fromSocketId].push(candidate);
    }
  }, []);

  // Setup Socket Events
  const setupSocketListeners = useCallback(() => {
    socket.on('participant-joined', ({ participant, participants: p }: { participant: Participant; participants: Participant[] }) => {
      setParticipants(p);
      if (participant && participant.socketId !== socket.id) {
        createOffer(participant.socketId);
      }
    });

    socket.on('participant-left', ({ socketId: leftId, participants: p }: { socketId: string; participants: Participant[] }) => {
      setParticipants(p);
      if (peerConnectionsRef.current[leftId]) {
        try { peerConnectionsRef.current[leftId].close(); } catch {}
        delete peerConnectionsRef.current[leftId];
      }
      delete pendingCandidatesRef.current[leftId];
      setRemoteStreams(prev => { const next = { ...prev }; delete next[leftId]; return next; });
    });

    socket.on('participant-camera', ({ socketId: sid, isOn }: { socketId: string; isOn: boolean }) => {
      setParticipants(prev => prev.map(p => p.socketId === sid ? { ...p, isCameraOn: isOn } : p));
    });

    socket.on('participant-mic', ({ socketId: sid, isOn }: { socketId: string; isOn: boolean }) => {
      setParticipants(prev => prev.map(p => p.socketId === sid ? { ...p, isMicOn: isOn } : p));
    });

    socket.on('webrtc-offer', ({ fromSocketId, offer }: { fromSocketId: string; offer: RTCSessionDescriptionInit }) => {
      handleOffer(fromSocketId, offer);
    });

    socket.on('webrtc-answer', ({ fromSocketId, answer }: { fromSocketId: string; answer: RTCSessionDescriptionInit }) => {
      handleAnswer(fromSocketId, answer);
    });

    socket.on('webrtc-ice-candidate', ({ fromSocketId, candidate }: { fromSocketId: string; candidate: RTCIceCandidateInit }) => {
      handleIceCandidate(fromSocketId, candidate);
    });

    socket.on('chat-message', (msg: ChatMessage) => {
      setMessages(prev => [...prev, msg]);
    });

    socket.on('chat-deleted', ({ messageId }: { messageId: string }) => {
      setMessages(prev => prev.filter(m => m._id !== messageId));
    });

    // Legacy quiz events
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

    // Session ended — now includes podium
    socket.on('session-ended', ({ message, podium: p }: { message?: string; podium?: PodiumEntry[] }) => {
      toast(message || 'The teacher has ended the session.', { icon: '📚' });
      if (p && p.length > 0) {
        setPodium(p);
        setShowPodium(true);
        // cleanup happens when user dismisses podium
      } else {
        cleanup();
        navigate('/live-sessions');
      }
    });

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

    // ---- MCQ socket listeners ----

    socket.on('mcq-raised', ({ mcq }: { mcq: LiveMcq }) => {
      setActiveMcq(mcq);
      setMcqSelectedOption(null);
      setMcqAnswerLocked(false);
      setTeacherCorrectIndex(null); // reset until mcq-teacher-info arrives
      toast('❓ MCQ Question raised!', { duration: 3000 });
    });

    // Teacher-only event with correct index
    socket.on('mcq-teacher-info', ({ correctIndex }: { correctIndex: number }) => {
      setTeacherCorrectIndex(correctIndex);
    });

    socket.on('mcq-closed', ({ mcqId, correctIndex, results }: { mcqId: string; correctIndex: number; results: McqResultEntry[] }) => {
      // Capture options from activeMcq BEFORE clearing it
      setActiveMcq(prev => {
        if (prev?.mcqId === mcqId) {
          // Store options while we still have them
          setMcqClosedResults({ results, correctIndex, options: prev.options });
          return null;
        }
        setMcqClosedResults({ results, correctIndex, options: [] });
        return prev;
      });
      setMcqAnswerLocked(true);
    });

    socket.on('mcq-results', ({ mcqId, correctIndex, results }: { mcqId: string; correctIndex: number; results: McqResultEntry[] }) => {
      // Merge updated results (5s after close), preserve options already stored
      setMcqClosedResults(prev => prev ? { ...prev, correctIndex, results } : { results, correctIndex, options: [] });
      setShowMcqResults(true);
    });

    socket.on('mcq-answer-locked', ({ selectedOption }: { selectedOption: number }) => {
      setMcqAnswerLocked(true);
      setMcqSelectedOption(selectedOption);
    });

    socket.on('mcq-error', ({ message }: { message: string }) => {
      toast.error(message);
    });

    socket.on('scoreboard-update', ({ scoreboard: sb }: { scoreboard: ScoreboardEntry[] }) => {
      setScoreboard(sb);
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
        createOffer(targetSocketId);
      }
    });
  };

  const toggleCamera = async (force?: boolean) => {
    if (isCamOn && !force) {
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
        if (oldVideo) { oldVideo.stop(); localStreamRef.current.removeTrack(oldVideo); }
        localStreamRef.current.addTrack(videoTrack);
      }

      broadcastTrack(videoTrack, 'video');
      setIsCamOn(true);
      socket.emit('camera-state', { sessionCode: code, isOn: true });
      toast.success('Camera turned on');
    } catch (err: any) {
      toast.error('Could not access camera. Please allow camera permissions in your browser settings.');
    }
  };

  const toggleMic = async (force?: boolean) => {
    if (isMicOn && !force) {
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
      toast.error('Could not access microphone. Please allow microphone permissions in your browser.');
    }
  };

  const toggleScreenShare = async () => {
    if (isScreenSharing) {
      screenStreamRef.current?.getTracks().forEach(t => t.stop());
      screenStreamRef.current = null;
      setIsScreenSharing(false);
      const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
      if (cameraTrack) broadcastTrack(cameraTrack, 'video');
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
        const cameraTrack = localStreamRef.current?.getVideoTracks()[0];
        if (cameraTrack) broadcastTrack(cameraTrack, 'video');
      };

      broadcastTrack(screenTrack, 'video');
      setIsScreenSharing(true);
      toast.success('Screen sharing started');
    } catch (err: any) {
      if (err.name !== 'NotAllowedError') {
        toast.error('Failed to start screen sharing.');
      }
    }
  };

  const handleTeacherEndSession = () => {
    if (!window.confirm('Are you sure you want to end this live class for all participants?')) return;
    socket.emit('end-session', { sessionCode: code });
    // Don't cleanup yet — wait for session-ended event to show podium first
  };

  const sendChat = () => {
    if (!chatInput.trim()) return;
    socket.emit('send-chat', { sessionCode: code, message: chatInput.trim() });
    setChatInput('');
  };

  // Legacy quiz submission
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

  // MCQ handlers
  const handleRaiseMcq = (question: string, options: string[], correctIndex: number) => {
    socket.emit('raise-mcq', { sessionCode: code, question, options, correctIndex });
  };

  const handleSelectMcqOption = (i: number) => {
    if (mcqAnswerLocked) return;
    setMcqSelectedOption(i);
  };

  const handleSubmitMcqAnswer = () => {
    if (mcqAnswerLocked || mcqSelectedOption === null) return;
    socket.emit('submit-mcq-answer', { sessionCode: code, selectedOption: mcqSelectedOption });
    setMcqAnswerLocked(true);
  };

  const handleOpenScoreboard = () => {
    socket.emit('get-scoreboard', { sessionCode: code });
    setShowScoreboard(true);
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

  // ---- Podium screen (full-page takeover) ----
  if (showPodium) {
    return (
      <PodiumScreen
        podium={podium}
        currentUserId={user?._id}
        onDismiss={() => {
          setShowPodium(false);
          cleanup();
          navigate('/live-sessions');
        }}
      />
    );
  }

  return (
    <div className="h-screen max-h-screen overflow-hidden bg-page text-text-primary flex flex-col select-none">

      {/* ---- MODALS & OVERLAYS (rendered above everything) ---- */}

      {/* MCQ Form Modal (teacher) */}
      {showMcqForm && (
        <McqFormModal
          onClose={() => setShowMcqForm(false)}
          onLaunch={handleRaiseMcq}
        />
      )}

      {/* MCQ Live Overlay (everyone, while question is active) */}
      {activeMcq && (
        <McqOverlay
          mcq={activeMcq}
          isTeacher={isTeacher}
          teacherCorrectIndex={teacherCorrectIndex}
          timeLeft={mcqTimeLeft}
          selectedOption={mcqSelectedOption}
          isLocked={mcqAnswerLocked}
          onSelect={handleSelectMcqOption}
          onSubmit={handleSubmitMcqAnswer}
        />
      )}

      {/* MCQ Results Popup */}
      {showMcqResults && mcqClosedResults && (
        <McqResultsPopup
          results={mcqClosedResults.results}
          correctIndex={mcqClosedResults.correctIndex}
          options={mcqClosedResults.options.length > 0
            ? mcqClosedResults.options
            : mcqClosedResults.results.length > 0
              ? Array(4).fill('') // fallback — options stored in activeMcq before close
              : []}
          currentUserId={user?._id}
          onClose={() => setShowMcqResults(false)}
        />
      )}

      {/* Scoreboard Modal */}
      {showScoreboard && (
        <ScoreboardModal
          scoreboard={scoreboard}
          currentUserId={user?._id}
          onClose={() => setShowScoreboard(false)}
        />
      )}

      {/* 1. Header */}
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

      {/* 2. Main Content Stage + Chat */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Stage Area */}
        <div className="flex-1 min-h-0 p-3 sm:p-4 flex flex-col overflow-y-auto">
          {view === 'session' && (
            <div className="flex-1 flex flex-col justify-center items-center relative w-full h-full max-w-5xl mx-auto">
              {/* Main Stage Video Container */}
              <div className="relative w-full h-full max-h-[75vh] aspect-video bg-[#0D0E1A] rounded-2xl overflow-hidden shadow-soft flex items-center justify-center border border-border-subtle">
                {primaryRemoteParticipant && primaryRemoteStream && (primaryRemoteParticipant.isCameraOn || primaryRemoteStream.getVideoTracks().length > 0) ? (
                  <StreamVideo stream={primaryRemoteStream} className="w-full h-full object-cover" />
                ) : primaryRemoteParticipant ? (
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
                  <StreamVideo stream={activeLocalStream} muted className="w-full h-full object-cover" />
                ) : (
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

                {primaryRemoteParticipant && (
                  <div className="absolute bottom-3 left-3 flex items-center gap-2 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-xl border border-white/10 text-white text-xs z-10">
                    <span className="font-semibold">{primaryRemoteParticipant.name}</span>
                    {primaryRemoteParticipant.isTeacher && <Crown className="w-3.5 h-3.5 text-accent-amber" />}
                    {!primaryRemoteParticipant.isMicOn && <MicOff className="w-3 h-3 text-red-400" />}
                  </div>
                )}

                {primaryRemoteParticipant && (
                  <div className="absolute bottom-3 right-3 w-36 sm:w-48 aspect-video bg-[#1B1C2E] rounded-xl overflow-hidden shadow-lg border-2 border-white/20 z-20 flex items-center justify-center">
                    {isCamOn || isScreenSharing ? (
                      <StreamVideo stream={activeLocalStream} muted className="w-full h-full object-cover" />
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

          {/* Legacy Quiz View */}
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

          {/* Legacy Leaderboard View */}
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
                        <p className="font-heading font-bold text-base text-text-primary">{entry.score}/{entry.totalMarks}</p>
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

      {/* 3. Call Controls Bar */}
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

          {/* Scoreboard — visible to everyone */}
          <button
            onClick={handleOpenScoreboard}
            className="p-3 bg-surface-alt text-text-muted border border-border-subtle hover:text-brand-primary hover:border-brand-primary/30 rounded-xl transition-all shadow-xs flex items-center justify-center"
            title="Show Session Scoreboard"
          >
            <BarChart2 className="w-5 h-5" />
          </button>

          {/* Teacher: Raise MCQ */}
          {isTeacher && (
            <button
              onClick={() => setShowMcqForm(true)}
              disabled={!!activeMcq}
              className="px-3.5 py-2.5 bg-gradient-to-r from-[#6366F1] to-[#8B5CF6] text-white rounded-xl text-xs font-semibold shadow-xs hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-all"
              title={activeMcq ? 'MCQ already active' : 'Raise MCQ Question'}
            >
              <HelpCircle className="w-4 h-4" />
              <span className="hidden sm:inline">{activeMcq ? 'MCQ Active...' : 'Raise MCQ'}</span>
            </button>
          )}

          {/* Teacher: Launch Legacy Quiz */}
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

          {/* Teacher: End Session */}
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

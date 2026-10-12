import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import {
  Clock,
  ChevronLeft,
  ChevronRight,
  Bookmark,
  Eraser,
  Send,
  LayoutGrid,
  X,
  AlertTriangle,
  Loader2,
  CheckCircle2,
  CloudOff,
  Cloud,
  ShieldCheck,
  FileText,
  AlertCircle,
  HelpCircle,
  Check,
} from 'lucide-react';
import { engineeringApi } from '../../services/engineering';
import { EngineeringExam, EngineeringQuestion } from '../../services/engineering';

type SaveState = 'saved' | 'saving' | 'error';
const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export const EngineeringTakerPage: React.FC = () => {
  const navigate = useNavigate();

  // Loading & Exam Data
  const [loading, setLoading] = useState(true);
  const [exam, setExam] = useState<EngineeringExam | null>(null);
  const [questions, setQuestions] = useState<EngineeringQuestion[]>([]);
  const [responses, setResponses] = useState<Record<string, { selectedOption: number | null; marked: boolean }>>({});
  const [currentIdx, setCurrentIdx] = useState(0);

  // Attempt & Timing
  const [attemptId, setAttemptId] = useState<string>('');
  const [remainingSeconds, setRemainingSeconds] = useState<number>(0);
  const syncRef = useRef<{ base: number; at: number }>({ base: 0, at: performance.now() });
  const timerIntervalRef = useRef<any>(null);

  // Instructions gate
  const [hasStarted, setHasStarted] = useState(false);
  const [instructionsAccepted, setInstructionsAccepted] = useState(false);
  const [starting, setStarting] = useState(false);

  // Saving state
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const pendingUpdatesRef = useRef<Map<string, { selectedOption: number | null; marked: boolean }>>(new Map());
  const debounceTimerRef = useRef<any>(null);

  // UI state
  const [showPalette, setShowPalette] = useState(false);
  const [showSubmitModal, setShowSubmitModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [selectedSection, setSelectedSection] = useState<string>('ALL');
  const isTerminatedRef = useRef(false);

  // Format seconds to mm:ss
  const formatTimer = (totalSec: number) => {
    const s = Math.max(0, Math.floor(totalSec));
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  // 1. Initial State Loading
  useEffect(() => {
    let mounted = true;

    async function checkState() {
      try {
        setLoading(true);
        // First check student request status
        const myStatus = await engineeringApi.getMyStatus();
        if (myStatus.status !== 'APPROVED') {
          toast.error('You must be an approved engineering student to access this exam.');
          navigate('/student/engineering', { replace: true });
          return;
        }

        // Check if an attempt is already in progress or completed
        try {
          const attemptState = await engineeringApi.getAttemptState();
          if (!mounted) return;

          if (attemptState.isFinished) {
            navigate('/student/engineering/result', { replace: true });
            return;
          }

          // Resume existing attempt
          setAttemptId(attemptState.attemptId);
          setQuestions(attemptState.questions);
          setExam(attemptState.exam);
          setResponses(attemptState.responses || {});
          syncRef.current = { base: attemptState.remainingSeconds, at: performance.now() };
          setRemainingSeconds(attemptState.remainingSeconds);
          setHasStarted(true);
        } catch (err: any) {
          // If no attempt exists (404), fetch public exam metadata for instructions screen
          const examData = await engineeringApi.getExamInfo();
          if (!mounted) return;
          setExam(examData.exam);
          setHasStarted(false);
        }
      } catch (err: any) {
        console.error('Failed to load engineering exam state:', err);
        toast.error('Failed to load examination. Please try again.');
        navigate('/student/engineering', { replace: true });
      } finally {
        if (mounted) setLoading(false);
      }
    }

    checkState();
    return () => {
      mounted = false;
    };
  }, [navigate]);

  // 2. Monotonic Countdown Timer
  useEffect(() => {
    if (!hasStarted || remainingSeconds <= 0) return;

    timerIntervalRef.current = setInterval(() => {
      const elapsed = (performance.now() - syncRef.current.at) / 1000;
      const currentRemaining = Math.max(0, Math.floor(syncRef.current.base - elapsed));
      setRemainingSeconds(currentRemaining);

      if (currentRemaining <= 0 && !isTerminatedRef.current) {
        clearInterval(timerIntervalRef.current);
        handleAutoSubmit();
      }
    }, 1000);

    return () => {
      if (timerIntervalRef.current) clearInterval(timerIntervalRef.current);
    };
  }, [hasStarted]);

  // 3. Start Exam Action
  const handleStartExam = async () => {
    if (!instructionsAccepted) {
      toast.error('Please confirm that you have read and understood the examination rules.');
      return;
    }

    try {
      setStarting(true);
      const startRes = await engineeringApi.startAttempt();
      setAttemptId(startRes.attemptId);

      // Now fetch state with questions
      const attemptState = await engineeringApi.getAttemptState();
      setQuestions(attemptState.questions);
      setExam(attemptState.exam);
      setResponses(attemptState.responses || {});
      syncRef.current = { base: attemptState.remainingSeconds, at: performance.now() };
      setRemainingSeconds(attemptState.remainingSeconds);
      setHasStarted(true);
      toast.success('Examination started! Best of luck!');
    } catch (err: any) {
      console.error('Failed to start attempt:', err);
      toast.error(err.response?.data?.message || 'Unable to start examination. Please contact support.');
    } finally {
      setStarting(false);
    }
  };

  // 4. Autosave Logic
  const flushPendingUpdates = useCallback(async () => {
    if (pendingUpdatesRef.current.size === 0 || isTerminatedRef.current) return;

    const updates = Array.from(pendingUpdatesRef.current.entries()).map(([questionId, data]) => ({
      questionId,
      selectedOption: data.selectedOption,
      marked: data.marked,
    }));

    setSaveState('saving');
    try {
      await engineeringApi.saveAnswers(updates);
      // Clear flushed items
      updates.forEach((u) => pendingUpdatesRef.current.delete(u.questionId));
      setSaveState(pendingUpdatesRef.current.size > 0 ? 'saving' : 'saved');
    } catch (err: any) {
      console.error('Failed to autosave answers:', err);
      setSaveState('error');
      // If time up was returned from backend, finalize
      if (err.response?.data?.code === 'DEADLINE_EXCEEDED' || err.response?.data?.code === 'ALREADY_SUBMITTED') {
        handleAutoSubmit();
      }
    }
  }, []);

  const queueSave = useCallback(
    (questionId: string, selectedOption: number | null, marked: boolean) => {
      pendingUpdatesRef.current.set(questionId, { selectedOption, marked });
      setSaveState('saving');

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        flushPendingUpdates();
      }, 800);
    },
    [flushPendingUpdates]
  );

  // 5. Answer Selection Handlers
  const handleSelectOption = (optionIndex: number) => {
    if (!questions[currentIdx] || isTerminatedRef.current) return;
    const q = questions[currentIdx];
    const qid = String(q._id);
    const existing = responses[qid] || { selectedOption: null, marked: false };

    const newResponse = {
      selectedOption: existing.selectedOption === optionIndex ? null : optionIndex,
      marked: existing.marked,
    };

    setResponses((prev) => ({ ...prev, [qid]: newResponse }));
    queueSave(qid, newResponse.selectedOption, newResponse.marked);
  };

  const handleToggleMark = () => {
    if (!questions[currentIdx] || isTerminatedRef.current) return;
    const q = questions[currentIdx];
    const qid = String(q._id);
    const existing = responses[qid] || { selectedOption: null, marked: false };

    const newResponse = {
      selectedOption: existing.selectedOption,
      marked: !existing.marked,
    };

    setResponses((prev) => ({ ...prev, [qid]: newResponse }));
    queueSave(qid, newResponse.selectedOption, newResponse.marked);
  };

  const handleClearResponse = () => {
    if (!questions[currentIdx] || isTerminatedRef.current) return;
    const q = questions[currentIdx];
    const qid = String(q._id);
    const existing = responses[qid] || { selectedOption: null, marked: false };

    const newResponse = {
      selectedOption: null,
      marked: existing.marked,
    };

    setResponses((prev) => ({ ...prev, [qid]: newResponse }));
    queueSave(qid, null, newResponse.marked);
  };

  // 6. Submission Handlers
  const handleAutoSubmit = async () => {
    if (isTerminatedRef.current) return;
    isTerminatedRef.current = true;
    toast('Time has expired! Submitting your examination answers...', { icon: '⏰' });

    try {
      await flushPendingUpdates();
      await engineeringApi.submitAttempt('TIMER');
    } catch (err) {
      console.error('Auto-submit completed with notice:', err);
    } finally {
      navigate('/student/engineering/result', { replace: true });
    }
  };

  const handleManualSubmit = async () => {
    if (isTerminatedRef.current) return;
    setSubmitting(true);
    try {
      await flushPendingUpdates();
      const res = await engineeringApi.submitAttempt('MANUAL');
      isTerminatedRef.current = true;
      toast.success('Examination submitted successfully!');
      navigate('/student/engineering/result', { replace: true });
    } catch (err: any) {
      console.error('Submit error:', err);
      toast.error(err.response?.data?.message || 'Failed to submit examination. Please retry.');
      setSubmitting(false);
    }
  };

  // Statistics for Palette and Modal
  const stats = useMemo(() => {
    let answered = 0;
    let marked = 0;
    let unanswered = 0;

    questions.forEach((q) => {
      const resp = responses[String(q._id)];
      if (resp && resp.selectedOption != null) {
        answered++;
      } else {
        unanswered++;
      }
      if (resp?.marked) marked++;
    });

    return { answered, marked, unanswered };
  }, [questions, responses]);

  // Section Filters
  const sections = useMemo(() => {
    const list: { code: string; name: string; count: number }[] = [];
    const map = new Map<string, { name: string; count: number }>();

    questions.forEach((q) => {
      const code = q.sectionCode || 'A';
      const existing = map.get(code) || { name: q.sectionName || code, count: 0 };
      existing.count++;
      map.set(code, existing);
    });

    map.forEach((val, code) => {
      list.push({ code, name: val.name, count: val.count });
    });

    return list;
  }, [questions]);

  // Filtered Questions by Section
  const filteredQuestionIndices = useMemo(() => {
    if (selectedSection === 'ALL') return questions.map((_, i) => i);
    return questions.map((q, i) => (q.sectionCode === selectedSection ? i : -1)).filter((i) => i !== -1);
  }, [questions, selectedSection]);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0E0F1E] flex items-center justify-center text-white">
        <div className="text-center space-y-4">
          <Loader2 className="w-10 h-10 animate-spin text-[#6C63F2] mx-auto" />
          <p className="text-gray-300 font-medium text-sm">Preparing your Engineering Mock Exam...</p>
        </div>
      </div>
    );
  }

  // ==========================================
  // INSTRUCTIONS SCREEN
  // ==========================================
  if (!hasStarted) {
    return (
      <div className="min-h-screen bg-[#0E0F1E] text-white flex flex-col justify-between p-4 sm:p-8">
        <div className="max-w-4xl mx-auto w-full pt-4 pb-12">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-gray-800 pb-6 mb-8">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#6C63F2] to-[#2563EB] flex items-center justify-center shadow-lg shadow-[#6C63F2]/20">
                <span className="font-bold text-lg text-white">IQ</span>
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold font-display text-white">LearnIQ Assessment Engine</h1>
                <p className="text-xs text-gray-400">BE Engineering Students Assessment</p>
              </div>
            </div>
            <div className="bg-[#1C1D33] px-3 py-1.5 rounded-lg border border-gray-700 text-xs font-medium text-emerald-400 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" /> Eligible & Approved
            </div>
          </div>

          {/* Title Card */}
          <div className="bg-[#18192E] border border-gray-800 rounded-2xl p-6 sm:p-8 mb-8 shadow-xl relative overflow-hidden">
            <div className="absolute top-0 right-0 w-64 h-64 bg-[#6C63F2]/10 rounded-full blur-3xl pointer-events-none" />
            <div className="relative z-10">
              <span className="inline-block bg-[#6C63F2]/20 border border-[#6C63F2]/40 text-[#A5B4FC] text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wider mb-3">
                Official Examination
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-2">{exam?.title || 'LearnIQ BE Engineering Mock Test 2026'}</h2>
              <p className="text-sm text-gray-300 mb-6">{exam?.subtitle || 'BE Engineering Students Assessment — LearnIQ'}</p>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-4 border-t border-gray-800/80">
                <div className="bg-[#20223E] p-3.5 rounded-xl border border-gray-700/50">
                  <span className="text-[11px] text-gray-400 uppercase font-semibold block">Questions</span>
                  <span className="text-xl font-bold text-white mt-0.5 block">{exam?.totalQuestions || 40} MCQs</span>
                </div>
                <div className="bg-[#20223E] p-3.5 rounded-xl border border-gray-700/50">
                  <span className="text-[11px] text-gray-400 uppercase font-semibold block">Total Marks</span>
                  <span className="text-xl font-bold text-white mt-0.5 block">{exam?.totalMarks || 40} Marks</span>
                </div>
                <div className="bg-[#20223E] p-3.5 rounded-xl border border-gray-700/50">
                  <span className="text-[11px] text-gray-400 uppercase font-semibold block">Duration</span>
                  <span className="text-xl font-bold text-white mt-0.5 block">{exam?.durationMinutes || 45} Minutes</span>
                </div>
                <div className="bg-[#20223E] p-3.5 rounded-xl border border-gray-700/50">
                  <span className="text-[11px] text-gray-400 uppercase font-semibold block">Marking</span>
                  <span className="text-xl font-bold text-emerald-400 mt-0.5 block">+1 / No -ve</span>
                </div>
              </div>
            </div>
          </div>

          {/* Instructions Box */}
          <div className="bg-[#18192E] border border-gray-800 rounded-2xl p-6 sm:p-8 mb-8 space-y-5">
            <h3 className="text-base font-bold text-white flex items-center gap-2 border-b border-gray-800 pb-3">
              <FileText className="w-5 h-5 text-[#6C63F2]" /> Examination Instructions & Rules
            </h3>

            <div className="space-y-3.5 text-xs sm:text-sm text-gray-300">
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-[#6C63F2]/20 text-[#A5B4FC] flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5">1</span>
                <p>The examination contains <strong className="text-white">40 multiple-choice questions</strong> spanning Java, Python, C++, Operating Systems, DBMS, Aptitude, OOP, and DSA Theory.</p>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-[#6C63F2]/20 text-[#A5B4FC] flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5">2</span>
                <p>Each question carries <strong className="text-white">1 mark</strong> for a correct answer. There is <strong className="text-emerald-400">no negative marking</strong> for incorrect or unattempted questions.</p>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-[#6C63F2]/20 text-[#A5B4FC] flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5">3</span>
                <p>The authoritative test duration is <strong className="text-white">45 minutes</strong> from the moment you click Start. Answers are <strong className="text-white">automatically synchronized</strong> to the cloud server continuously.</p>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-[#6C63F2]/20 text-[#A5B4FC] flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5">4</span>
                <p>The authoritative global examination closure is <strong className="text-white">13 October 2026 at 6:00 PM IST</strong>. The earlier of your 45-minute countdown and the global closure will conclude your attempt.</p>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-[#6C63F2]/20 text-[#A5B4FC] flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5">5</span>
                <p>If your timer expires, your test will be <strong className="text-amber-400">automatically submitted</strong> with whatever answers have been saved to that point.</p>
              </div>

              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-[#6C63F2]/20 text-[#A5B4FC] flex items-center justify-center flex-shrink-0 text-xs font-bold mt-0.5">6</span>
                <p><strong className="text-white">Only one attempt</strong> is allowed per student. Once finalized, responses cannot be modified.</p>
              </div>
            </div>

            {/* Checkbox */}
            <div className="pt-4 border-t border-gray-800">
              <label className="flex items-start gap-3 cursor-pointer select-none group">
                <input
                  type="checkbox"
                  checked={instructionsAccepted}
                  onChange={(e) => setInstructionsAccepted(e.target.checked)}
                  className="mt-1 w-4 h-4 text-[#6C63F2] rounded border-gray-600 bg-[#20223E] focus:ring-[#6C63F2]"
                />
                <span className="text-xs sm:text-sm text-gray-300 group-hover:text-white transition-colors">
                  I have read and agree to all examination rules. I understand that my attempt will be timed authoritative by server time, and I am ready to begin.
                </span>
              </label>
            </div>
          </div>

          {/* Action Button */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <button
              type="button"
              onClick={() => navigate('/student/engineering')}
              className="text-xs sm:text-sm text-gray-400 hover:text-white transition-colors py-2 px-4"
            >
              ← Back to Portal
            </button>

            <button
              type="button"
              onClick={handleStartExam}
              disabled={!instructionsAccepted || starting}
              className={`w-full sm:w-auto px-8 py-3.5 rounded-xl font-bold text-sm tracking-wide shadow-lg transition-all flex items-center justify-center gap-2 ${
                instructionsAccepted && !starting
                  ? 'bg-gradient-to-r from-[#6C63F2] to-[#4F46E5] text-white hover:opacity-95 shadow-[#6C63F2]/30 hover:scale-[1.01]'
                  : 'bg-gray-800 text-gray-500 cursor-not-allowed'
              }`}
            >
              {starting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Initializing Attempt...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" /> START EXAMINATION NOW
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ==========================================
  // ACTIVE EXAMINATION INTERFACE
  // ==========================================
  const currentQ = questions[currentIdx];
  const currentQId = currentQ ? String(currentQ._id) : '';
  const currentResp = responses[currentQId] || { selectedOption: null, marked: false };

  const isLowTime = remainingSeconds < 300; // < 5 mins
  const isCriticalTime = remainingSeconds < 60; // < 1 min

  return (
    <div className="min-h-screen bg-[#0E0F1E] text-white flex flex-col justify-between selection:bg-[#6C63F2] selection:text-white">
      {/* 1. Header Bar */}
      <header className="sticky top-0 z-30 bg-[#121324]/95 backdrop-blur-md border-b border-gray-800 px-4 sm:px-6 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
          {/* Logo & Title */}
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-[#6C63F2] to-[#2563EB] flex items-center justify-center flex-shrink-0">
              <span className="font-bold text-sm text-white">IQ</span>
            </div>
            <div className="min-w-0">
              <h1 className="text-sm sm:text-base font-bold text-white truncate">{exam?.title || 'LearnIQ BE Engineering Mock Test 2026'}</h1>
              <p className="text-[11px] text-gray-400 hidden sm:block">40 Questions • Max Marks: 40</p>
            </div>
          </div>

          {/* Timer & Actions */}
          <div className="flex items-center gap-2 sm:gap-4 flex-shrink-0">
            {/* Cloud Sync State */}
            <div className="hidden md:flex items-center gap-1.5 text-xs text-gray-400 bg-[#1A1C30] px-2.5 py-1.5 rounded-lg border border-gray-800">
              {saveState === 'saved' && (
                <>
                  <Cloud className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400 text-[11px]">Saved</span>
                </>
              )}
              {saveState === 'saving' && (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#6C63F2]" />
                  <span className="text-gray-300 text-[11px]">Syncing...</span>
                </>
              )}
              {saveState === 'error' && (
                <>
                  <CloudOff className="w-3.5 h-3.5 text-rose-400" />
                  <span className="text-rose-400 text-[11px]">Sync error</span>
                </>
              )}
            </div>

            {/* Countdown Timer */}
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-sm font-mono font-bold tracking-wider ${
                isCriticalTime
                  ? 'bg-rose-500/20 border-rose-500/50 text-rose-400 animate-pulse'
                  : isLowTime
                  ? 'bg-amber-500/20 border-amber-500/40 text-amber-300'
                  : 'bg-[#1C1D33] border-gray-700 text-white'
              }`}
            >
              <Clock className="w-4 h-4" />
              <span>{formatTimer(remainingSeconds)}</span>
            </div>

            {/* Mobile Palette Toggle */}
            <button
              type="button"
              onClick={() => setShowPalette(!showPalette)}
              className="lg:hidden p-2 rounded-xl bg-[#1C1D33] border border-gray-700 text-gray-300 hover:text-white"
              title="Toggle Questions Palette"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>

            {/* Submit Button */}
            <button
              type="button"
              onClick={() => setShowSubmitModal(true)}
              className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-bold text-xs sm:text-sm shadow-md shadow-emerald-900/30 transition-all flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" /> Submit
            </button>
          </div>
        </div>
      </header>

      {/* 2. Main Workspace */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-4 sm:p-6 lg:p-8 flex gap-6 min-w-0">
        {/* Left: Question Box */}
        <div className="flex-1 min-w-0 flex flex-col justify-between bg-[#15162B] border border-gray-800 rounded-2xl shadow-xl overflow-hidden">
          {/* Top Bar of Question */}
          <div className="bg-[#1C1D33] px-5 py-3 border-b border-gray-800 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="bg-[#6C63F2] text-white text-xs font-bold px-2.5 py-1 rounded-md">
                Q {currentIdx + 1}
              </span>
              <span className="text-xs font-medium text-gray-300">
                {currentQ?.sectionName || `Section ${currentQ?.sectionCode}`}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span className="bg-[#252844] px-2 py-0.5 rounded text-[11px] text-emerald-400 font-semibold">+1 Mark</span>
              <span className="bg-[#252844] px-2 py-0.5 rounded text-[11px] text-gray-400 font-medium">0 Negative</span>
            </div>
          </div>

          {/* Question Content */}
          <div className="p-5 sm:p-8 space-y-6 flex-1 overflow-y-auto">
            {/* Question Text */}
            <div className="text-sm sm:text-base font-medium text-gray-100 leading-relaxed font-sans whitespace-pre-wrap select-text">
              {currentQ?.questionText}
            </div>

            {/* Answer Options */}
            <div className="space-y-3 pt-2">
              {currentQ?.options?.map((opt, optIdx) => {
                const isSelected = currentResp.selectedOption === optIdx;
                const letter = LETTERS[optIdx] || String(optIdx + 1);

                return (
                  <button
                    key={optIdx}
                    type="button"
                    onClick={() => handleSelectOption(optIdx)}
                    className={`w-full text-left p-4 rounded-xl border transition-all flex items-start gap-3.5 group cursor-pointer ${
                      isSelected
                        ? 'bg-[#6C63F2]/20 border-[#6C63F2] text-white shadow-md shadow-[#6C63F2]/10'
                        : 'bg-[#1C1D33]/60 border-gray-800 hover:border-gray-700 hover:bg-[#1C1D33] text-gray-200'
                    }`}
                  >
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold transition-colors ${
                        isSelected
                          ? 'bg-[#6C63F2] text-white'
                          : 'bg-[#252844] text-gray-400 group-hover:text-gray-200'
                      }`}
                    >
                      {letter}
                    </div>
                    <div className="text-xs sm:text-sm font-normal pt-0.5 select-text flex-1">
                      {opt}
                    </div>
                    {isSelected && (
                      <Check className="w-4 h-4 text-[#6C63F2] flex-shrink-0 mt-0.5" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Bottom Action Bar */}
          <div className="bg-[#1C1D33] px-5 py-3.5 border-t border-gray-800 flex flex-wrap items-center justify-between gap-3">
            {/* Mark for review & Clear */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleMark}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border flex items-center gap-1.5 transition-colors ${
                  currentResp.marked
                    ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                    : 'bg-[#252844] border-gray-700 text-gray-300 hover:text-white'
                }`}
              >
                <Bookmark className="w-3.5 h-3.5" />
                {currentResp.marked ? 'Marked for Review' : 'Mark for Review'}
              </button>

              {currentResp.selectedOption != null && (
                <button
                  type="button"
                  onClick={handleClearResponse}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium bg-[#252844] border border-gray-700 text-gray-400 hover:text-rose-400 transition-colors flex items-center gap-1.5"
                >
                  <Eraser className="w-3.5 h-3.5" /> Clear
                </button>
              )}
            </div>

            {/* Prev / Next */}
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={currentIdx === 0}
                onClick={() => setCurrentIdx((prev) => Math.max(0, prev - 1))}
                className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 border transition-colors ${
                  currentIdx === 0
                    ? 'bg-gray-800/40 border-gray-800 text-gray-600 cursor-not-allowed'
                    : 'bg-[#252844] border-gray-700 text-gray-200 hover:bg-[#2C3052]'
                }`}
              >
                <ChevronLeft className="w-4 h-4" /> Previous
              </button>

              <button
                type="button"
                disabled={currentIdx === questions.length - 1}
                onClick={() => setCurrentIdx((prev) => Math.min(questions.length - 1, prev + 1))}
                className={`px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 border transition-colors ${
                  currentIdx === questions.length - 1
                    ? 'bg-gray-800/40 border-gray-800 text-gray-600 cursor-not-allowed'
                    : 'bg-[#6C63F2] border-[#6C63F2] text-white hover:bg-[#5B52E0]'
                }`}
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Right: Question Palette (Desktop side panel, mobile overlay) */}
        <aside
          className={`fixed inset-y-0 right-0 z-40 w-80 bg-[#15162B] border-l border-gray-800 p-5 transform transition-transform duration-300 lg:static lg:transform-none lg:w-80 lg:rounded-2xl lg:border lg:flex lg:flex-col ${
            showPalette ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'
          }`}
        >
          {/* Palette Header */}
          <div className="flex items-center justify-between pb-3 border-b border-gray-800 mb-4">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <LayoutGrid className="w-4 h-4 text-[#6C63F2]" /> Question Palette
            </h2>
            <button
              type="button"
              onClick={() => setShowPalette(false)}
              className="lg:hidden p-1 text-gray-400 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Section Filter Pills */}
          <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3 scrollbar-none text-[11px]">
            <button
              type="button"
              onClick={() => setSelectedSection('ALL')}
              className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition-colors ${
                selectedSection === 'ALL'
                  ? 'bg-[#6C63F2] text-white'
                  : 'bg-[#1C1D33] text-gray-400 hover:text-white'
              }`}
            >
              All (40)
            </button>
            {sections.map((s) => (
              <button
                key={s.code}
                type="button"
                onClick={() => setSelectedSection(s.code)}
                className={`px-2.5 py-1 rounded-md font-medium whitespace-nowrap transition-colors ${
                  selectedSection === s.code
                    ? 'bg-[#6C63F2] text-white'
                    : 'bg-[#1C1D33] text-gray-400 hover:text-white'
                }`}
              >
                Sec {s.code} ({s.count})
              </button>
            ))}
          </div>

          {/* Quick Counter Summary */}
          <div className="grid grid-cols-3 gap-2 bg-[#1C1D33] p-2.5 rounded-xl border border-gray-800 mb-4 text-center">
            <div>
              <span className="block text-emerald-400 font-bold text-base">{stats.answered}</span>
              <span className="text-[10px] text-gray-400 uppercase font-semibold">Answered</span>
            </div>
            <div>
              <span className="block text-purple-400 font-bold text-base">{stats.marked}</span>
              <span className="text-[10px] text-gray-400 uppercase font-semibold">Marked</span>
            </div>
            <div>
              <span className="block text-gray-400 font-bold text-base">{stats.unanswered}</span>
              <span className="text-[10px] text-gray-500 uppercase font-semibold">Pending</span>
            </div>
          </div>

          {/* Question Grid */}
          <div className="flex-1 overflow-y-auto pr-1">
            <div className="grid grid-cols-5 gap-2">
              {filteredQuestionIndices.map((idx) => {
                const q = questions[idx];
                const qid = String(q._id);
                const resp = responses[qid];
                const isAnswered = resp && resp.selectedOption != null;
                const isMarked = resp?.marked;
                const isCurrent = idx === currentIdx;

                let btnClass = 'bg-[#1C1D33] text-gray-300 border-gray-800 hover:border-gray-600';
                if (isCurrent) {
                  btnClass = 'ring-2 ring-[#6C63F2] bg-[#2A2B4A] text-white font-bold border-transparent';
                } else if (isAnswered && isMarked) {
                  btnClass = 'bg-purple-600/40 border-purple-500 text-purple-200 font-semibold';
                } else if (isAnswered) {
                  btnClass = 'bg-emerald-600/30 border-emerald-500 text-emerald-300 font-semibold';
                } else if (isMarked) {
                  btnClass = 'bg-purple-900/30 border-purple-500/60 text-purple-300';
                }

                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => {
                      setCurrentIdx(idx);
                      setShowPalette(false);
                    }}
                    className={`h-9 rounded-lg border text-xs flex items-center justify-center relative transition-all ${btnClass}`}
                  >
                    {idx + 1}
                    {isMarked && (
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-400 absolute top-1 right-1" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="pt-3 border-t border-gray-800 mt-3 grid grid-cols-2 gap-2 text-[11px] text-gray-400">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Answered
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-purple-400" /> Marked
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[#1C1D33] border border-gray-700" /> Unanswered
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full ring-2 ring-[#6C63F2]" /> Current
            </div>
          </div>
        </aside>
      </main>

      {/* 3. Final Submission Confirmation Modal */}
      {showSubmitModal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#18192E] border border-gray-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-5 animate-in fade-in zoom-in-95">
            <div className="text-center">
              <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mx-auto mb-3">
                <Send className="w-6 h-6" />
              </div>
              <h3 className="text-lg font-bold text-white">Submit Examination?</h3>
              <p className="text-xs text-gray-400 mt-1">
                Please review your answer summary before confirming final submission.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2 bg-[#20223E] p-3.5 rounded-xl border border-gray-700/60 text-center">
              <div>
                <span className="block text-emerald-400 font-bold text-lg">{stats.answered}</span>
                <span className="text-[10px] text-gray-400 uppercase font-semibold">Answered</span>
              </div>
              <div>
                <span className="block text-amber-400 font-bold text-lg">{stats.unanswered}</span>
                <span className="text-[10px] text-gray-400 uppercase font-semibold">Unanswered</span>
              </div>
              <div>
                <span className="block text-purple-400 font-bold text-lg">{stats.marked}</span>
                <span className="text-[10px] text-gray-400 uppercase font-semibold">Marked</span>
              </div>
            </div>

            {stats.unanswered > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-start gap-2.5 text-xs text-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                <span>
                  You still have <strong>{stats.unanswered} unanswered</strong> questions. Are you sure you wish to submit now?
                </span>
              </div>
            )}

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowSubmitModal(false)}
                disabled={submitting}
                className="flex-1 py-2.5 rounded-xl border border-gray-700 text-gray-300 hover:text-white font-medium text-xs transition-colors"
              >
                Return to Test
              </button>
              <button
                type="button"
                onClick={handleManualSubmit}
                disabled={submitting}
                className="flex-1 py-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs shadow-lg shadow-emerald-900/30 transition-all flex items-center justify-center gap-1.5"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" /> Submitting...
                  </>
                ) : (
                  'Confirm & Submit'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default EngineeringTakerPage;

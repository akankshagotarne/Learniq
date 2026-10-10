import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Clock, AlertTriangle, CheckCircle, XCircle, HelpCircle,
  Award, ShieldAlert, Maximize2, ArrowLeft, ArrowRight,
  Send, RefreshCw, ChevronLeft, ChevronRight, Check, Sparkles,
  RotateCcw, BookOpen, AlertCircle
} from 'lucide-react';
import api from '../../services/api';
import { Exam, ExamQuestion, ExamResult, ExamQuestionReview } from '../../types';
import toast from 'react-hot-toast';
import ProctoringGate, { GateResult } from '../../proctoring/ProctoringGate';
import ProctoringMonitor from '../../proctoring/ProctoringMonitor';
import { useProctoring } from '../../proctoring/useProctoring';
import { DEFAULT_PROCTORING_POLICY, ProctoringPolicy } from '../../proctoring/types';

const DRAFT_DEBOUNCE_MS = 1500;
/** The submit endpoint has always accepted [{ questionId, selectedOption }] - keep that shape so old and new servers both work. */
const toAnswerList = (map: Record<string, number | null>) => Object.entries(map).map(([questionId, selectedOption]) => ({ questionId, selectedOption }));

const ExamTakerPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  // State
  const [exam, setExam] = useState<Exam | null>(null);
  const [loading, setLoading] = useState(true);
  const [step, setStep] = useState<'instructions' | 'taking' | 'submitted'>('instructions');

  // Attempt & Answers
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [currentQIndex, setCurrentQIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number | null>>({}); // questionId -> optionIndex
  const [timeLeftSec, setTimeLeftSec] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [resumeAttempt, setResumeAttempt] = useState(false);

  // Result & Review
  const [examResult, setExamResult] = useState<ExamResult | null>(null);
  const [reviewQuestions, setReviewQuestions] = useState<ExamQuestionReview[]>([]);
  const [autoSubmitReason, setAutoSubmitReason] = useState<string | null>(null);

  // Integrity violation count (non-proctored exams: legacy fullscreen / tab notice)
  const [integrityViolations, setIntegrityViolations] = useState(0);

  // References
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const draftSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const draftDebounceRef = useRef<NodeJS.Timeout | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const attemptIdRef = useRef<string | null>(null);
  attemptIdRef.current = attemptId;
  // Monotonic timer baseline from the SERVER's remaining time (the device clock cannot extend the exam)
  const syncRef = useRef({ base: 0, at: 0 });
  const finishedRef = useRef(false);

  const policy: ProctoringPolicy = exam?.proctoring?.enabled ? { ...DEFAULT_PROCTORING_POLICY, ...exam.proctoring } : DEFAULT_PROCTORING_POLICY;
  const proctored = !!exam?.proctoring?.enabled;

  const setServerTime = (remainingSeconds: number) => {
    syncRef.current = { base: remainingSeconds, at: performance.now() };
    setTimeLeftSec(Math.max(0, Math.ceil(remainingSeconds)));
  };

  // Load Exam details
  useEffect(() => {
    fetchExam();
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (draftSaveTimerRef.current) clearInterval(draftSaveTimerRef.current);
      if (draftDebounceRef.current) clearTimeout(draftDebounceRef.current);
    };
  }, [id]);

  const restoreAnswers = (examData: Exam, attempt: any): Record<string, number | null> => {
    const initial: Record<string, number | null> = {};
    examData.questions.forEach(q => { if (q._id) initial[q._id] = null; });
    let restored: Record<string, number | null> = { ...initial };
    try {
      const localDraft = localStorage.getItem(`learniq_exam_draft_${id}`);
      if (localDraft) restored = { ...restored, ...JSON.parse(localDraft) };
    } catch { /* ignore corrupt backup */ }
    if (attempt?.draftAnswers && Object.keys(attempt.draftAnswers).length > 0) {
      restored = { ...restored, ...attempt.draftAnswers };
    }
    // keep only questions that are in this exam (the server rejects anything else)
    return Object.fromEntries(Object.entries(restored).filter(([k]) => k in initial));
  };

  const fetchExam = async () => {
    setLoading(true);
    try {
      const res = await api.get(`/exams/${id}`);
      const data: Exam = res.data.exam;
      setExam(data);

      // Check if there is an in-progress attempt
      if (res.data.inProgressAttempt) {
        const attempt = res.data.inProgressAttempt;
        if (data.proctoring?.enabled) {
          // proctored: the camera / fullscreen checks run again before the attempt continues
          setResumeAttempt(true);
        } else {
          setAttemptId(attempt._id);
          setAnswers(restoreAnswers(data, attempt));
          setServerTime(attempt.remainingSeconds ?? data.durationMinutes * 60);
          setStep('taking');
          toast('Resuming your in-progress exam attempt.', { icon: '🔄' });
        }
      }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to load exam');
      navigate('/student/exams');
    } finally {
      setLoading(false);
    }
  };

  /** Show the stored result (submit is idempotent, so this also works after an automatic submission). */
  const showFinalResult = useCallback(async (reason?: string | null) => {
    const aid = attemptIdRef.current;
    if (!aid) return;
    finishedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    if (draftSaveTimerRef.current) clearInterval(draftSaveTimerRef.current);
    try {
      const res = await api.post(`/exams/${id}/submit`, { attemptId: aid, answers: toAnswerList(answersRef.current) });
      setExamResult(res.data.result);
      setReviewQuestions(res.data.review || []);
      if (reason) setAutoSubmitReason(reason);
      setStep('submitted');
      localStorage.removeItem(`learniq_exam_draft_${id}`);
      if (document.fullscreenElement && document.exitFullscreen) { try { await document.exitFullscreen(); } catch { /* ignore */ } }
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Could not load your result. Please refresh the page.');
    }
  }, [id]);

  const proctor = useProctoring({
    kind: 'exam',
    examId: id || '',
    policy,
    getAnswersSnapshot: () => answersRef.current,
    onTerminated: (state) => {
      if (state.autoSubmitted) toast.error('Your examination has been submitted automatically.', { duration: 6000 });
      void showFinalResult(state.autoSubmitted ? (state.terminationText || 'Examination rule violation.') : null);
    },
  });

  const proctorStopRef = useRef(proctor.stop);
  proctorStopRef.current = proctor.stop;

  /** Starts (or resumes) the attempt on the server and returns its data. */
  const startOrResume = async (examData: Exam) => {
    const res = await api.post(`/exams/${id}/start`);
    const attempt = res.data.attempt;
    setAttemptId(attempt._id);
    attemptIdRef.current = attempt._id;
    setAnswers(res.data.resumed ? restoreAnswers(examData, attempt) : restoreAnswers(examData, null));
    setServerTime(attempt.remainingSeconds ?? examData.durationMinutes * 60);
    return attempt;
  };

  // Start Exam (exams without proctoring)
  const handleStartExam = async () => {
    if (!exam) return;

    // Request fullscreen
    try {
      if (document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
    } catch (e) {
      console.warn('Fullscreen request bypassed', e);
    }

    try {
      await startOrResume(exam);
      setStep('taking');
    } catch (err: any) {
      toast.error(err.response?.data?.message || 'Failed to start exam');
    }
  };

  // Proctored exams: called by the pre-exam check after fullscreen was entered
  const handleProctoredReady = async ({ precheck, stream, detector }: GateResult) => {
    if (!exam) return;
    let attempt;
    try {
      attempt = await startOrResume(exam);
    } catch (err: any) {
      throw new Error(err.response?.data?.message || 'The exam could not be started.');
    }
    const state = await proctor.start(attempt._id, precheck, stream, detector);
    if (!state.terminated) setStep('taking');
  };

  // Submit Exam
  const handleSubmitExam = useCallback(
    async (isAuto = false) => {
      if (!exam || !attemptId || isSubmitting || finishedRef.current) return;
      setIsSubmitting(true);

      if (timerRef.current) clearInterval(timerRef.current);
      if (draftSaveTimerRef.current) clearInterval(draftSaveTimerRef.current);

      try {
        const res = await api.post(`/exams/${id}/submit`, {
          attemptId,
          answers: toAnswerList(answers),
          autoSubmit: isAuto,
        });

        finishedRef.current = true;
        proctorStopRef.current(); // camera off, monitoring ends
        setExamResult(res.data.result);
        setReviewQuestions(res.data.review || []);
        setStep('submitted');

        // Clear local storage draft
        localStorage.removeItem(`learniq_exam_draft_${id}`);

        // Exit fullscreen if active
        if (document.fullscreenElement && document.exitFullscreen) {
          try {
            await document.exitFullscreen();
          } catch {}
        }

        if (res.data.result?.status === 'auto-submitted' || isAuto) {
          toast('Time has run out! Your exam was automatically submitted.', { icon: '⏰' });
        } else {
          toast.success('Exam submitted successfully!');
        }
      } catch (err: any) {
        toast.error(err.response?.data?.message || 'Submission failed. Please check your connection and press Submit again.');
      } finally {
        setIsSubmitting(false);
        setShowSubmitConfirm(false);
      }
    },
    [exam, attemptId, isSubmitting, answers, id]
  );

  // Countdown timer (display only - the server enforces the deadline)
  useEffect(() => {
    if (step !== 'taking') return;
    let fired = false;
    timerRef.current = setInterval(() => {
      const left = Math.max(0, syncRef.current.base - (performance.now() - syncRef.current.at) / 1000);
      setTimeLeftSec(Math.ceil(left));
      if (left <= 0 && !fired) {
        fired = true;
        clearInterval(timerRef.current!);
        handleSubmitExam(true);
      }
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [step, handleSubmitExam]);

  const saveDraftNow = useCallback(() => {
    const aid = attemptIdRef.current;
    if (!aid || finishedRef.current) return;
    api.put(`/exams/${id}/draft`, { attemptId: aid, draftAnswers: answersRef.current })
      .then((res) => { if (typeof res.data.remainingSeconds === 'number') setServerTime(res.data.remainingSeconds); })
      .catch((err) => {
        const code = err?.response?.data?.code;
        if (code === 'TIME_UP' || code === 'ALREADY_COMPLETED') void showFinalResult(null);
      });
  }, [id, showFinalResult]);

  // Autosave to backend periodically (and shortly after every change - see handleSelectOption)
  useEffect(() => {
    if (step !== 'taking' || !attemptId) return;
    draftSaveTimerRef.current = setInterval(saveDraftNow, 15000);
    return () => {
      if (draftSaveTimerRef.current) clearInterval(draftSaveTimerRef.current);
    };
  }, [step, attemptId, saveDraftNow]);

  // Save to LocalStorage immediately on change, and to the server shortly after
  const handleSelectOption = (questionId: string, optionIndex: number | null) => {
    setAnswers(prev => {
      const updated = { ...prev, [questionId]: optionIndex };
      answersRef.current = updated;
      localStorage.setItem(`learniq_exam_draft_${id}`, JSON.stringify(updated));
      return updated;
    });
    if (draftDebounceRef.current) clearTimeout(draftDebounceRef.current);
    draftDebounceRef.current = setTimeout(saveDraftNow, DRAFT_DEBOUNCE_MS);
  };

  // Integrity tracking for exams WITHOUT proctoring (proctored exams: useProctoring handles every signal)
  useEffect(() => {
    if (step !== 'taking' || !attemptId || proctored) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        setIntegrityViolations(v => v + 1);
        toast.error('⚠️ Warning: Tab switch detected! This event has been logged.', { duration: 4000 });
        api.post(`/exams/${id}/integrity`, {
          attemptId,
          type: 'tab-switch',
        }).catch(() => {});
      }
    };

    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        setIntegrityViolations(v => v + 1);
        toast('⚠️ You exited fullscreen mode. Please return to fullscreen.', { icon: '🛡️', duration: 4000 });
        api.post(`/exams/${id}/integrity`, {
          attemptId,
          type: 'fullscreen-exit',
        }).catch(() => {});
      }
    };

    const handleCopyPaste = (e: ClipboardEvent) => {
      e.preventDefault();
      toast.error('Copy/Paste is disabled during this examination.');
      api.post(`/exams/${id}/integrity`, {
        attemptId,
        type: 'copy-paste',
      }).catch(() => {});
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('copy', handleCopyPaste);
    document.addEventListener('paste', handleCopyPaste);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('copy', handleCopyPaste);
      document.removeEventListener('paste', handleCopyPaste);
    };
  }, [step, attemptId, id, proctored]);

  // Format Time
  const formatTime = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const s = sec % 60;
    return `${mins.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  if (loading || !exam) {
    return (
      <div className="min-h-screen bg-page flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-3 border-brand-primary/30 border-t-brand-primary rounded-full animate-spin mx-auto mb-3" />
          <p className="text-text-muted text-sm">Preparing exam environment...</p>
        </div>
      </div>
    );
  }

  const questions = exam.questions || [];
  const currentQ: ExamQuestion | undefined = questions[currentQIndex];
  const currentQId = currentQ?._id || '';
  const currentAnswer = answers[currentQId];
  const answeredCount = Object.values(answers).filter(v => v !== null && v !== undefined).length;
  const isTimeCritical = timeLeftSec <= 180; // 3 minutes warning

  // ─────────────────────────────────────────────
  // 1. INSTRUCTIONS SCREEN
  // ─────────────────────────────────────────────
  if (step === 'instructions' && proctored) {
    return (
      <ProctoringGate
        kind="exam"
        examId={id || ''}
        examTitle={exam.title}
        durationMinutes={exam.durationMinutes}
        policy={policy}
        resume={resumeAttempt}
        backTo="/student/exams"
        onReady={handleProctoredReady}
      />
    );
  }

  if (step === 'instructions') {
    return (
      <div className="min-h-screen bg-page py-6 sm:py-10 px-3 sm:px-4 flex items-center justify-center">
        <div className="max-w-2xl w-full card-soft p-5 sm:p-8 rounded-2xl shadow-xl border border-border-subtle">
          <Link
            to="/student/exams"
            className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary mb-6 transition-colors"
          >
            <ChevronLeft className="w-4 h-4" /> Back to Exams
          </Link>

          <div className="flex flex-col items-start gap-3 mb-4 sm:flex-row sm:items-center">
            <span className="p-2.5 rounded-2xl bg-[#6C63F2]/15 text-brand-primary flex-shrink-0">
              <BookOpen className="w-6 h-6" />
            </span>
            <div className="min-w-0">
              <span className="badge-primary text-[10px] py-0 px-2 uppercase tracking-wide">
                Standard {exam.standard} • {exam.subject}
              </span>
              <h1 className="font-heading font-bold text-xl sm:text-2xl leading-snug text-text-primary mt-1 break-words">
                {exam.title}
              </h1>
            </div>
          </div>

          {exam.description && (
            <p className="text-sm text-text-secondary mb-6 leading-relaxed">
              {exam.description}
            </p>
          )}

          {/* Exam Specs Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
            <div className="p-3.5 rounded-xl bg-surface-alt border border-border-subtle text-center">
              <Clock className="w-4 h-4 text-brand-primary mx-auto mb-1" />
              <p className="text-base font-bold text-text-primary">{exam.durationMinutes} Mins</p>
              <p className="text-[10px] text-text-muted">Total Time</p>
            </div>

            <div className="p-3.5 rounded-xl bg-surface-alt border border-border-subtle text-center">
              <HelpCircle className="w-4 h-4 text-[#5AC8FA] mx-auto mb-1" />
              <p className="text-base font-bold text-text-primary">{questions.length}</p>
              <p className="text-[10px] text-text-muted">Questions</p>
            </div>

            <div className="p-3.5 rounded-xl bg-surface-alt border border-border-subtle text-center">
              <Award className="w-4 h-4 text-[#FFC24B] mx-auto mb-1" />
              <p className="text-base font-bold text-text-primary">{exam.totalMarks}</p>
              <p className="text-[10px] text-text-muted">Total Marks</p>
            </div>

            <div className="p-3.5 rounded-xl bg-surface-alt border border-border-subtle text-center">
              <AlertCircle className={`w-4 h-4 ${exam.negativeMarking ? 'text-[#E1447A]' : 'text-[#4ADE9A]'} mx-auto mb-1`} />
              <p className="text-base font-bold text-text-primary">
                {exam.negativeMarking ? `-${exam.negativeMarkValue}` : 'None'}
              </p>
              <p className="text-[10px] text-text-muted">Neg. Marking</p>
            </div>
          </div>

          {/* Instructions Box */}
          <div className="p-4 rounded-xl bg-surface-alt border border-border-subtle mb-6 text-xs space-y-2 text-text-secondary">
            <h4 className="font-bold text-text-primary text-xs uppercase tracking-wide">
              Examination Instructions:
            </h4>
            <ul className="list-disc pl-4 space-y-1">
              <li>Each question has 4 options. Choose the most appropriate answer.</li>
              {exam.negativeMarking ? (
                <li className="text-[#E1447A] font-semibold">
                  Negative marking is enabled: Wrong answers will deduct {exam.negativeMarkValue} marks. Unanswered questions do not deduct marks.
                </li>
              ) : (
                <li>There is no negative marking for incorrect answers.</li>
              )}
              <li>Answers are automatically drafted continuously so you don't lose progress.</li>
              <li>When the timer reaches zero, your exam will be automatically submitted.</li>
            </ul>
          </div>

          {/* Security & Integrity Warning */}
          <div className="p-4 rounded-xl bg-[#FFC24B]/10 border border-[#FFC24B]/30 flex items-start gap-3 mb-8">
            <ShieldAlert className="w-5 h-5 text-[#FFC24B] flex-shrink-0 mt-0.5" />
            <div className="text-xs">
              <p className="font-bold text-text-primary mb-0.5">Integrity & Proctoring Notice</p>
              <p className="text-text-secondary leading-relaxed">
                This examination will launch in full screen. Tab switches, window minimization, or exiting fullscreen are recorded and made visible on your teacher's grading dashboard.
              </p>
            </div>
          </div>

          {/* Start CTA */}
          <button
            onClick={handleStartExam}
            className="btn-primary w-full py-3.5 rounded-xl font-bold text-sm flex items-center justify-center gap-2 shadow-lg shadow-brand-primary/20"
          >
            <Maximize2 className="w-4 h-4" /> Enter Fullscreen & Begin Exam
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // 3. POST-EXAM REVIEW & SCORECARD SCREEN
  // ─────────────────────────────────────────────
  if (step === 'submitted' && examResult) {
    return (
      <div className="min-h-screen bg-page py-6 sm:py-10 px-3 sm:px-4">
        <div className="max-w-4xl mx-auto space-y-5 sm:space-y-6">
          {/* Header Scorecard Card */}
          <div className="card-soft p-5 sm:p-8 rounded-2xl shadow-xl border border-border-subtle text-center relative overflow-hidden bg-surface">
            <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-brand-primary via-[#5AC8FA] to-[#4ADE9A]" />

            <div className="w-16 h-16 mx-auto rounded-3xl bg-[#4ADE9A]/15 text-[#4ADE9A] flex items-center justify-center mb-3">
              <Award className="w-8 h-8" />
            </div>

            {autoSubmitReason && (
              <div role="alert" className="mb-4 text-left p-3 rounded-xl border border-[#E1447A]/40 bg-[#FFE4EC] dark:bg-[#3D1825] text-sm text-[#9F1D4F] dark:text-[#FF8FA3]" data-testid="auto-submit-reason">
                <p className="font-bold">Your examination has been submitted automatically.</p>
                <p>Reason: {autoSubmitReason}</p>
                <p className="text-xs mt-1 opacity-80">Your saved answers were graded. Your teacher can review what was recorded.</p>
              </div>
            )}
            <span className={`badge text-xs px-3 py-1 font-bold ${examResult.passed ? 'badge-success' : 'badge-warning'}`}>
              {examResult.passed ? 'Passed Examination' : 'Attempt Completed'}
            </span>

            <h1 className="font-heading font-black text-3xl sm:text-4xl text-text-primary mt-2">
              {examResult.score} / {examResult.totalMarks}
            </h1>
            <p className="text-sm font-semibold text-text-secondary mt-1">
              Final Score • {examResult.percentage}%
            </p>

            {/* Metrics Ribbon */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-2xl mx-auto mt-6">
              <div className="p-3 rounded-xl bg-surface-alt border border-border-subtle">
                <p className="text-xs text-text-muted">Rank</p>
                <p className="text-lg font-bold text-text-primary">
                  #{examResult.rank} <span className="text-xs font-normal text-text-muted">of {examResult.totalAttemptees}</span>
                </p>
              </div>

              <div className="p-3 rounded-xl bg-surface-alt border border-border-subtle">
                <p className="text-xs text-text-muted">Percentile</p>
                <p className="text-lg font-bold text-[#6C63F2]">{examResult.percentile}th</p>
              </div>

              <div className="p-3 rounded-xl bg-surface-alt border border-border-subtle">
                <p className="text-xs text-text-muted">Time Taken</p>
                <p className="text-lg font-bold text-text-primary">{formatTime(examResult.timeTaken)}</p>
              </div>

              <div className="p-3 rounded-xl bg-surface-alt border border-border-subtle">
                <p className="text-xs text-text-muted">Integrity Events</p>
                <p className={`text-lg font-bold ${integrityViolations > 0 ? 'text-[#E1447A]' : 'text-[#4ADE9A]'}`}>
                  {integrityViolations}
                </p>
              </div>
            </div>

            <div className="mt-8 flex justify-center gap-3">
              <Link to="/student/exams" className="btn-secondary text-xs py-2.5 px-5">
                Back to All Exams
              </Link>
            </div>
          </div>

          {/* Detailed Question Review */}
          <div className="card-soft p-5 sm:p-8 rounded-2xl border border-border-subtle bg-surface space-y-6">
            <div className="border-b border-border-subtle pb-4">
              <h2 className="font-heading font-bold text-xl text-text-primary">
                Detailed Question Review
              </h2>
              <p className="text-xs text-text-secondary mt-0.5">
                Review your submitted answers alongside the correct answers and teacher explanations.
              </p>
            </div>

            <div className="space-y-6">
              {reviewQuestions.map((q, idx) => {
                const isSkipped = q.selectedOption === null || q.selectedOption === undefined;

                return (
                  <div
                    key={q.questionId || idx}
                    className={`p-5 rounded-2xl border ${
                      q.isCorrect
                        ? 'border-[#4ADE9A]/30 bg-[#4ADE9A]/5'
                        : isSkipped
                        ? 'border-border-subtle bg-surface-alt'
                        : 'border-[#E1447A]/30 bg-[#E1447A]/5'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold px-2 py-0.5 rounded-md bg-surface border border-border-subtle text-text-primary">
                          Q{idx + 1}
                        </span>
                        <span className="text-xs text-text-muted">({q.marks} {q.marks === 1 ? 'Mark' : 'Marks'})</span>
                      </div>

                      {q.isCorrect ? (
                        <span className="badge-success text-[11px] py-0.5 px-2.5 flex items-center gap-1 font-semibold">
                          <CheckCircle className="w-3.5 h-3.5" /> Correct (+{q.marks})
                        </span>
                      ) : isSkipped ? (
                        <span className="badge-warning text-[11px] py-0.5 px-2.5 flex items-center gap-1 font-semibold">
                          <AlertCircle className="w-3.5 h-3.5" /> Unanswered (0)
                        </span>
                      ) : (
                        <span className="badge-error text-[11px] py-0.5 px-2.5 flex items-center gap-1 font-semibold">
                          <XCircle className="w-3.5 h-3.5" /> Incorrect {exam.negativeMarking ? `(-${exam.negativeMarkValue})` : '(0)'}
                        </span>
                      )}
                    </div>

                    <p className="font-semibold text-sm text-text-primary mb-4">
                      {q.question}
                    </p>

                    {/* Options list */}
                    <div className="space-y-2 mb-4">
                      {q.options.map((opt, optIdx) => {
                        const isStudentChoice = q.selectedOption === optIdx;
                        const isTheCorrectAnswer = q.correctAnswer === optIdx;

                        let styleClass = 'border-border-subtle bg-surface text-text-primary';
                        if (isTheCorrectAnswer) {
                          styleClass = 'border-[#4ADE9A] bg-[#4ADE9A]/15 text-[#16A34A] dark:text-[#4ADE9A] font-semibold';
                        } else if (isStudentChoice && !q.isCorrect) {
                          styleClass = 'border-[#E1447A] bg-[#E1447A]/15 text-[#E1447A] font-semibold';
                        }

                        return (
                          <div
                            key={optIdx}
                            className={`p-3 rounded-xl border flex items-center justify-between text-xs transition-all ${styleClass}`}
                          >
                            <div className="flex items-center gap-2.5">
                              <span className="w-5 h-5 rounded-full border border-current flex items-center justify-center font-bold text-[10px]">
                                {String.fromCharCode(65 + optIdx)}
                              </span>
                              <span>{opt}</span>
                            </div>

                            <div className="flex items-center gap-1.5">
                              {isStudentChoice && (
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface text-text-secondary border border-border-subtle">
                                  Your Choice
                                </span>
                              )}
                              {isTheCorrectAnswer && (
                                <span className="text-[10px] font-bold text-[#16A34A] dark:text-[#4ADE9A] flex items-center gap-0.5">
                                  <Check className="w-3.5 h-3.5" /> Correct Answer
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Explanation */}
                    {q.explanation && (
                      <div className="p-3 rounded-xl bg-surface border border-border-subtle text-xs text-text-secondary">
                        <span className="font-bold text-text-primary block mb-0.5">Explanation:</span>
                        {q.explanation}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────
  // 2. LIVE EXAM-TAKING SCREEN
  // ─────────────────────────────────────────────
  return (
    <div
      ref={containerRef}
      className="min-h-screen bg-page flex flex-col select-none transition-colors"
    >
      {/* Top Bar: Title, Timer, Submitting, Answer count */}
      <header className="h-16 border-b border-border-subtle bg-surface sticky top-0 z-30 px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-3 shadow-sm">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <span className="hidden sm:flex w-9 h-9 flex-shrink-0 rounded-xl bg-[#6C63F2]/10 text-brand-primary items-center justify-center font-bold">
            Q
          </span>
          <div className="min-w-0">
            <h2 className="font-heading font-bold text-sm sm:text-base text-text-primary truncate sm:max-w-md">
              {exam.title}
            </h2>
            <p className="text-[10px] text-text-muted">
              {answeredCount} of {questions.length} Answered
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
          {/* Countdown Clock */}
          <div
            aria-label="Time remaining"
            className={`flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3.5 py-1.5 rounded-xl border font-mono font-bold text-sm tabular-nums ${
              isTimeCritical
                ? 'bg-[#E1447A]/15 border-[#E1447A] text-[#E1447A] animate-pulse'
                : 'bg-surface-alt border-border-subtle text-text-primary'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>{formatTime(timeLeftSec)}</span>
          </div>

          {/* Submit Exam Button */}
          <button
            onClick={() => setShowSubmitConfirm(true)}
            className="btn-primary text-xs min-h-[40px] py-2 px-3 sm:px-4 rounded-xl flex items-center gap-1.5 font-bold shadow-sm"
          >
            <Send className="w-3.5 h-3.5" /> Submit
          </button>
        </div>
      </header>

      {/* Main Content: Question Navigator & Question Card */}
      <div className="flex-1 max-w-6xl w-full mx-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left / Center 3 Columns: Current Question */}
        <div className="lg:col-span-3 space-y-4">
          {currentQ ? (
            <div className="card-soft p-4 sm:p-8 rounded-2xl border border-border-subtle bg-surface flex flex-col justify-between sm:min-h-[460px] shadow-sm">
              <div>
                {/* Question metadata header */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle pb-4 mb-5 sm:mb-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-3 py-1 rounded-xl bg-brand-primary/10 text-brand-primary text-xs font-bold">
                      Question {currentQIndex + 1} of {questions.length}
                    </span>
                    <span className="text-xs text-text-muted">
                      ({currentQ.marks} {currentQ.marks === 1 ? 'Mark' : 'Marks'})
                    </span>
                  </div>

                  {currentAnswer !== null && currentAnswer !== undefined ? (
                    <button
                      onClick={() => handleSelectOption(currentQId, null)}
                      className="min-h-[36px] px-2 -mr-2 text-[11px] text-text-muted hover:text-[#E1447A] transition-colors"
                    >
                      Clear Selection
                    </button>
                  ) : null}
                </div>

                {/* Question prompt */}
                <p className="font-heading font-medium text-base sm:text-lg text-text-primary leading-relaxed mb-5 sm:mb-6 whitespace-pre-wrap break-words">
                  {currentQ.question}
                </p>

                {/* Options (MCQ / TrueFalse) */}
                <div className="space-y-3">
                  {currentQ.options.map((opt, optIndex) => {
                    const isSelected = currentAnswer === optIndex;

                    return (
                      <button
                        key={optIndex}
                        onClick={() => handleSelectOption(currentQId, optIndex)}
                        className={`w-full p-3.5 sm:p-4 rounded-2xl border text-left flex items-center justify-between gap-2 text-sm transition-all ${
                          isSelected
                            ? 'border-brand-primary bg-brand-primary/10 text-text-primary shadow-sm ring-1 ring-brand-primary'
                            : 'border-border-subtle bg-surface hover:bg-surface-alt text-text-primary'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className={`w-7 h-7 flex-shrink-0 rounded-xl flex items-center justify-center font-bold text-xs transition-colors ${
                              isSelected
                                ? 'bg-brand-primary text-white'
                                : 'bg-surface-alt text-text-secondary border border-border-subtle'
                            }`}
                          >
                            {String.fromCharCode(65 + optIndex)}
                          </span>
                          <span className="font-medium min-w-0 break-words">{opt}</span>
                        </div>

                        {isSelected && (
                          <div className="w-5 h-5 flex-shrink-0 rounded-full bg-brand-primary text-white flex items-center justify-center">
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Bottom Nav: Previous / Next */}
              <div className="flex items-center justify-between gap-2 border-t border-border-subtle pt-5 sm:pt-6 mt-6 sm:mt-8">
                <button
                  onClick={() => setCurrentQIndex(prev => Math.max(0, prev - 1))}
                  disabled={currentQIndex === 0}
                  className="btn-secondary text-xs min-h-[44px] py-2.5 px-4 rounded-xl flex items-center gap-1.5 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <ArrowLeft className="w-4 h-4" /> Previous
                </button>

                {currentQIndex < questions.length - 1 ? (
                  <button
                    onClick={() => setCurrentQIndex(prev => Math.min(questions.length - 1, prev + 1))}
                    className="btn-primary text-xs min-h-[44px] py-2.5 px-5 rounded-xl flex items-center gap-1.5 font-bold"
                  >
                    Next <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={() => setShowSubmitConfirm(true)}
                    className="btn-primary text-xs min-h-[44px] py-2.5 px-5 rounded-xl flex items-center gap-1.5 font-bold shadow-md shadow-brand-primary/20"
                  >
                    <Send className="w-4 h-4" /> Review & Submit
                  </button>
                )}
              </div>
            </div>
          ) : null}
        </div>

        {/* Right 1 Column: Question Grid Palette */}
        <div className="space-y-4">
          <div className="card-soft p-5 rounded-2xl border border-border-subtle bg-surface">
            <h3 className="font-heading font-bold text-sm text-text-primary mb-3">
              Question Navigator
            </h3>

            {/* Status Legend */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-text-muted mb-4 pb-3 border-b border-border-subtle">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-md bg-brand-primary" /> Answered
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-md bg-surface-alt border border-border-subtle" /> Unanswered
              </div>
            </div>

            {/* Grid of question buttons */}
            <div className="grid grid-cols-5 sm:grid-cols-6 lg:grid-cols-4 gap-2">
              {questions.map((q, idx) => {
                const qId = q._id || '';
                const isAnswered = answers[qId] !== null && answers[qId] !== undefined;
                const isCurrent = currentQIndex === idx;

                let btnStyle = 'bg-surface-alt text-text-secondary border-border-subtle';
                if (isAnswered) {
                  btnStyle = 'bg-brand-primary text-white font-bold border-brand-primary';
                }
                if (isCurrent) {
                  btnStyle += ' ring-2 ring-brand-primary ring-offset-2 dark:ring-offset-[#1B1C2E]';
                }

                return (
                  <button
                    key={qId || idx}
                    onClick={() => setCurrentQIndex(idx)}
                    className={`h-9 rounded-xl border text-xs font-semibold flex items-center justify-center transition-all ${btnStyle}`}
                  >
                    {idx + 1}
                  </button>
                );
              })}
            </div>

            {/* Summary counters */}
            <div className="mt-6 pt-4 border-t border-border-subtle space-y-2 text-xs">
              <div className="flex justify-between text-text-secondary">
                <span>Answered:</span>
                <span className="font-bold text-brand-primary">{answeredCount}</span>
              </div>
              <div className="flex justify-between text-text-secondary">
                <span>Remaining:</span>
                <span className="font-bold text-text-muted">{questions.length - answeredCount}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Submit Confirmation Modal */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div role="dialog" aria-modal="true" className="card-soft p-5 sm:p-6 max-w-md w-full max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl border border-border-subtle bg-surface shadow-2xl animate-in fade-in zoom-in-95">
            <h3 className="font-heading font-bold text-lg text-text-primary mb-2">
              Submit Your Examination?
            </h3>
            <p className="text-xs text-text-secondary mb-4">
              Are you sure you want to finish and submit your exam? Once submitted, you cannot change your answers.
            </p>

            <div className="p-3.5 rounded-xl bg-surface-alt border border-border-subtle space-y-2 text-xs mb-6">
              <div className="flex justify-between">
                <span className="text-text-muted">Total Questions:</span>
                <span className="font-bold text-text-primary">{questions.length}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Answered:</span>
                <span className="font-bold text-[#4ADE9A]">{answeredCount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-text-muted">Unanswered:</span>
                <span className={`font-bold ${questions.length - answeredCount > 0 ? 'text-[#E1447A]' : 'text-text-muted'}`}>
                  {questions.length - answeredCount}
                </span>
              </div>
              {exam.negativeMarking && questions.length - answeredCount > 0 && (
                <p className="text-[11px] text-[#4ADE9A] pt-1 border-t border-border-subtle">
                  ✓ Unanswered questions will not carry negative marking penalties.
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2 sm:gap-3">
              <button
                onClick={() => setShowSubmitConfirm(false)}
                disabled={isSubmitting}
                className="btn-secondary text-xs min-h-[44px] py-2 px-4 rounded-xl"
              >
                Return to Exam
              </button>
              <button
                onClick={() => handleSubmitExam(false)}
                disabled={isSubmitting}
                className="btn-primary text-xs min-h-[44px] py-2 px-5 rounded-xl font-bold flex items-center justify-center gap-1.5"
              >
                {isSubmitting ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Submitting...
                  </>
                ) : (
                  <>
                    <Check className="w-4 h-4" /> Yes, Submit Now
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {proctored && <ProctoringMonitor ctl={proctor} policy={policy} />}
    </div>
  );
};

export default ExamTakerPage;

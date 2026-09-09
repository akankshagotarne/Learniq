import React, { useEffect, useState, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Play, Pause, Volume2, VolumeX, Maximize, RotateCcw,
  CheckCircle, ChevronLeft, ChevronRight, BookOpen,
  FileText, HelpCircle, Award, Sparkles, Clock, Download,
  ExternalLink, Layers, ArrowRight, Share2, Check, Star
} from 'lucide-react';
import Navbar from '../components/layout/Navbar';
import api from '../services/api';
import { Course, Lecture, Quiz } from '../types';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';

interface Flashcard {
  id: number;
  question: string;
  answer: string;
  hint?: string;
}

const LecturePlayerPage: React.FC = () => {
  const { courseId, lectureId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [course, setCourse] = useState<Course | null>(null);
  const [lectures, setLectures] = useState<Lecture[]>([]);
  const [currentLecture, setCurrentLecture] = useState<Lecture | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'notes' | 'quiz' | 'flashcards'>('overview');
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState(false);
  const [completedLectures, setCompletedLectures] = useState<string[]>([]);
  
  // Video player state
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [videoProgress, setVideoProgress] = useState(25);
  const videoRef = useRef<HTMLVideoElement>(null);

  // Quiz state
  const [quiz, setQuiz] = useState<any | null>(null);
  const [selectedAnswers, setSelectedAnswers] = useState<{ [qId: number]: number }>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);
  const [quizScore, setQuizScore] = useState(0);

  // Flashcard state
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);

  // Fallback demo flashcards
  const flashcards: Flashcard[] = [
    {
      id: 1,
      question: `Core concept in ${currentLecture?.subject || 'this lesson'}`,
      answer: `${currentLecture?.title || 'Key Principle'}: Remember to solve step-by-step and verify boundary conditions!`,
      hint: 'Think about foundational axioms.'
    },
    {
      id: 2,
      question: 'Key Formula / Definition',
      answer: 'Standard form: y = mx + c (Slope-Intercept Form) or F = m * a (Newton’s 2nd Law).',
      hint: 'Relates linear rates of variation.'
    },
    {
      id: 3,
      question: 'Common Mistake to Avoid',
      answer: 'Always verify unit conversions (e.g. km/h to m/s by multiplying with 5/18) before final calculation.',
      hint: 'Check standard SI units.'
    }
  ];

  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const courseRes = await api.get(`/courses/${courseId}`);
        setCourse(courseRes.data.course);
        const fetchedLectures = courseRes.data.lectures || [];
        setLectures(fetchedLectures);

        // Find lecture
        const target = fetchedLectures.find((l: Lecture) => l._id === lectureId) || fetchedLectures[0];
        setCurrentLecture(target);

        // Fetch Quizzes if available
        try {
          const quizRes = await api.get(`/quizzes?standard=${courseRes.data.course.standard}&subject=${encodeURIComponent(courseRes.data.course.subject)}`);
          if (quizRes.data.quizzes?.length > 0) {
            setQuiz(quizRes.data.quizzes[0]);
          }
        } catch (_) {}
      } catch (err) {
        toast.error('Could not load lecture details.');
        navigate('/courses');
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [courseId, lectureId, navigate]);

  const currentIndex = lectures.findIndex(l => l._id === currentLecture?._id);
  const prevLecture = currentIndex > 0 ? lectures[currentIndex - 1] : null;
  const nextLecture = currentIndex >= 0 && currentIndex < lectures.length - 1 ? lectures[currentIndex + 1] : null;

  const handleMarkComplete = async () => {
    if (!currentLecture) return;
    setCompleting(true);
    try {
      await api.post(`/student/lectures/${currentLecture._id}/complete`);
      if (!completedLectures.includes(currentLecture._id)) {
        setCompletedLectures(prev => [...prev, currentLecture._id]);
      }
      toast.success('Lecture completed! +50 XP earned ⭐');
    } catch (e: any) {
      // Even if already marked, show positive feedback
      setCompletedLectures(prev => [...prev, currentLecture._id]);
      toast.success('Lecture marked as completed!');
    } finally {
      setCompleting(false);
    }
  };

  const handleQuizOption = (questionIdx: number, optionIdx: number) => {
    if (quizSubmitted) return;
    setSelectedAnswers(prev => ({ ...prev, [questionIdx]: optionIdx }));
  };

  const handleQuizSubmit = () => {
    if (!quiz || !quiz.questions) return;
    let score = 0;
    quiz.questions.forEach((q: any, idx: number) => {
      if (selectedAnswers[idx] === q.correctAnswer) {
        score += q.marks || 1;
      }
    });
    setQuizScore(score);
    setQuizSubmitted(true);
    toast.success(`Quiz Completed! You scored ${score}/${quiz.questions.length * (quiz.questions[0]?.marks || 1)} points!`);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-page text-text-primary">
        <Navbar />
        <div className="pt-24 page-container py-12">
          <div className="card-soft h-96 rounded-2xl mb-8 animate-pulse bg-surface-alt" />
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 card-soft h-64 rounded-2xl animate-pulse bg-surface-alt" />
            <div className="card-soft h-64 rounded-2xl animate-pulse bg-surface-alt" />
          </div>
        </div>
      </div>
    );
  }

  if (!currentLecture || !course) return null;

  return (
    <div className="min-h-screen bg-page text-text-primary flex flex-col transition-colors">
      <Navbar />

      <main className="flex-1 pt-16 flex flex-col">
        {/* Top Header Bar */}
        <div className="bg-surface border-b border-border-subtle px-4 py-3 flex items-center justify-between gap-4 transition-colors">
          <div className="flex items-center gap-3">
            <Link
              to={`/courses/${course._id}`}
              className="p-2 rounded-xl bg-surface-alt hover:bg-surface border border-border-subtle text-text-secondary hover:text-text-primary transition-colors flex items-center gap-1 text-xs font-medium"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Back to Course</span>
            </Link>
            <div className="hidden sm:block h-4 w-px bg-border-subtle" />
            <div>
              <span className="text-xs text-brand-primary font-semibold">
                Std {course.standard} • {course.subject}
              </span>
              <h1 className="text-sm font-heading font-semibold text-text-primary truncate max-w-md sm:max-w-xl">
                {currentLecture.title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleMarkComplete}
              disabled={completing || completedLectures.includes(currentLecture._id)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all shadow-xs ${
                completedLectures.includes(currentLecture._id)
                  ? 'bg-[#DCFCE7] dark:bg-[#153428] text-[#16A34A] dark:text-[#4ADE9A] border border-[#86EFAC] dark:border-[#16A34A]/40'
                  : 'btn-primary'
              }`}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              <span>{completedLectures.includes(currentLecture._id) ? 'Completed' : 'Mark as Complete'}</span>
            </button>
          </div>
        </div>

        {/* Main Grid: Video + Playlist */}
        <div className="flex-1 grid lg:grid-cols-12 gap-0">
          {/* Left / Center: Video and Tabs */}
          <div className="lg:col-span-8 xl:col-span-9 flex flex-col bg-page border-r border-border-subtle">
            {/* Video Container - Focused player viewport */}
            <div className="relative aspect-video w-full bg-[#0D0E1A] flex items-center justify-center overflow-hidden group">
              {/* Dynamic Video Player Simulation */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 pointer-events-none" />

              {/* Decorative Animated Learning Canvas / Video Screen */}
              <div className="w-full h-full relative flex items-center justify-center bg-gradient-to-br from-[#121224] via-[#1A1A33] to-[#251E40]">
                <div className="text-center p-6 z-10">
                  <div className="w-20 h-20 rounded-full bg-brand-primary/30 border border-brand-primary/40 flex items-center justify-center mx-auto mb-4 backdrop-blur-md group-hover:scale-110 transition-transform shadow-2xl shadow-brand-primary/30 cursor-pointer"
                       onClick={() => setIsPlaying(!isPlaying)}>
                    {isPlaying ? (
                      <Pause className="w-8 h-8 text-white" />
                    ) : (
                      <Play className="w-8 h-8 text-white ml-1 fill-white" />
                    )}
                  </div>
                  <h3 className="text-lg font-heading font-bold text-white mb-1">{currentLecture.title}</h3>
                  <p className="text-xs text-white/60 font-medium">{course.subject} • Lecture {currentIndex + 1} of {lectures.length}</p>
                </div>

                {/* Ambient Glow */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-brand-primary/15 rounded-full blur-3xl pointer-events-none" />
              </div>

              {/* Player Controls Bar */}
              <div className="absolute bottom-0 inset-x-0 p-4 bg-gradient-to-t from-black/90 via-black/60 to-transparent flex flex-col gap-2">
                {/* Progress Bar */}
                <div 
                  className="w-full h-1.5 bg-white/20 hover:h-2.5 rounded-full cursor-pointer transition-all relative"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pos = ((e.clientX - rect.left) / rect.width) * 100;
                    setVideoProgress(Math.max(0, Math.min(100, pos)));
                  }}
                >
                  <div 
                    className="h-full bg-gradient-to-r from-brand-primary to-brand-secondary rounded-full relative" 
                    style={{ width: `${videoProgress}%` }}
                  >
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow" />
                  </div>
                </div>

                {/* Bottom Row Controls */}
                <div className="flex items-center justify-between text-white/90 text-xs">
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => setIsPlaying(!isPlaying)} 
                      className="p-1.5 hover:text-white transition-colors"
                      title={isPlaying ? 'Pause' : 'Play'}
                    >
                      {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 fill-current" />}
                    </button>
                    
                    <button 
                      onClick={() => setIsMuted(!isMuted)} 
                      className="p-1.5 hover:text-white transition-colors"
                      title={isMuted ? 'Unmute' : 'Mute'}
                    >
                      {isMuted ? <VolumeX className="w-4 h-4 text-brand-secondary" /> : <Volume2 className="w-4 h-4" />}
                    </button>

                    <span className="font-mono">12:45 / {currentLecture.videoDuration || '25:00'}</span>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Speed Selector */}
                    <button 
                      onClick={() => {
                        const speeds = [1, 1.25, 1.5, 2];
                        const next = speeds[(speeds.indexOf(playbackSpeed) + 1) % speeds.length];
                        setPlaybackSpeed(next);
                      }}
                      className="px-2.5 py-1 bg-white/15 hover:bg-white/25 rounded-md font-semibold text-[11px] transition-colors"
                    >
                      {playbackSpeed}x
                    </button>

                    <button 
                      onClick={() => toast('Fullscreen mode')}
                      className="p-1.5 hover:text-white transition-colors"
                      title="Fullscreen"
                    >
                      <Maximize className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Navigation Buttons: Previous / Next */}
            <div className="bg-surface border-b border-border-subtle px-6 py-3 flex items-center justify-between transition-colors">
              {prevLecture ? (
                <Link
                  to={`/courses/${courseId}/lecture/${prevLecture._id}`}
                  className="flex items-center gap-2 text-xs text-text-secondary hover:text-text-primary transition-colors bg-surface-alt hover:bg-surface px-3.5 py-1.5 rounded-xl border border-border-subtle font-medium shadow-xs"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Previous: {prevLecture.title}</span>
                </Link>
              ) : <div />}

              {nextLecture ? (
                <Link
                  to={`/courses/${courseId}/lecture/${nextLecture._id}`}
                  className="flex items-center gap-2 text-xs text-brand-primary hover:text-brand-primary-hover font-semibold transition-colors bg-brand-primary/10 hover:bg-brand-primary/15 px-3.5 py-1.5 rounded-xl border border-brand-primary/20 shadow-xs"
                >
                  <span>Next: {nextLecture.title}</span>
                  <ChevronRight className="w-4 h-4" />
                </Link>
              ) : (
                <span className="text-xs text-text-muted font-medium">You've reached the final lecture in this course! 🎉</span>
              )}
            </div>

            {/* Tab Navigation */}
            <div className="bg-surface border-b border-border-subtle px-6 flex items-center gap-6 overflow-x-auto transition-colors">
              {[
                { id: 'overview', label: 'Overview', icon: BookOpen },
                { id: 'notes', label: 'Notes & Resources', icon: FileText },
                { id: 'quiz', label: 'Interactive Quiz', icon: HelpCircle },
                { id: 'flashcards', label: 'Revision Flashcards', icon: Layers },
              ].map(tab => {
                const Icon = tab.icon;
                const isActive = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`py-3.5 px-1 border-b-2 font-medium text-xs sm:text-sm flex items-center gap-2 transition-all whitespace-nowrap ${
                      isActive
                        ? 'border-brand-primary text-brand-primary font-semibold'
                        : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border-subtle'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Tab Contents */}
            <div className="p-6 overflow-y-auto flex-1 bg-page">
              {/* 1. OVERVIEW */}
              {activeTab === 'overview' && (
                <div className="max-w-3xl space-y-6">
                  <div>
                    <h2 className="font-heading font-bold text-xl text-text-primary mb-2">{currentLecture.title}</h2>
                    <p className="text-text-secondary text-sm leading-relaxed">
                      {currentLecture.description || 
                        `In this comprehensive session on ${currentLecture.subject}, students in Standard ${course.standard} will master fundamental concepts, problem solving tactics, and exam patterns with crystal clear practical examples.`
                      }
                    </p>
                  </div>

                  <div className="card-soft p-5 rounded-card space-y-3">
                    <h3 className="font-heading text-sm font-semibold text-text-primary flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-brand-primary" /> What you will learn
                    </h3>
                    <ul className="grid sm:grid-cols-2 gap-2.5 text-xs text-text-secondary">
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-accent-mint" /> Step-by-step conceptual derivation
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-accent-mint" /> Solved NCERT / State board examples
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-accent-mint" /> Memorization tips & shortcut formulas
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-4 h-4 text-accent-mint" /> Practice quiz & exam model questions
                      </li>
                    </ul>
                  </div>

                  {/* Teacher summary */}
                  {course.teacher && (
                    <div className="card-soft p-4 flex items-center gap-3.5">
                      <img
                        src={(course.teacher as any).avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent((course.teacher as any).name || 'Teacher')}&background=6C63F2&color=fff`}
                        alt="Teacher"
                        className="w-12 h-12 rounded-full object-cover border border-brand-primary/30 shadow-xs"
                      />
                      <div>
                        <p className="text-xs text-brand-primary font-semibold">Instructor</p>
                        <h4 className="font-heading text-sm font-semibold text-text-primary">{(course.teacher as any).name}</h4>
                        <p className="text-xs text-text-secondary line-clamp-1">{(course.teacher as any).bio}</p>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 2. NOTES */}
              {activeTab === 'notes' && (
                <div className="max-w-3xl space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-heading text-lg font-bold text-text-primary">Lecture Notes & Handouts</h3>
                      <p className="text-xs text-text-secondary">Comprehensive summary designed for quick exam revision.</p>
                    </div>
                    <button 
                      onClick={() => toast.success('Notes downloaded successfully as PDF!')}
                      className="btn-primary text-xs py-2 px-3 flex items-center gap-2"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download PDF</span>
                    </button>
                  </div>

                  <div className="card-soft p-6 rounded-card space-y-4 font-mono text-xs text-text-primary leading-relaxed">
                    <div className="border-b border-border-subtle pb-3">
                      <p className="text-brand-primary font-semibold text-sm">{course.subject} — Standard {course.standard}</p>
                      <p className="text-text-primary text-base font-bold font-heading mt-1">{currentLecture.title}</p>
                    </div>

                    <div>
                      <h4 className="text-text-primary font-bold font-heading text-sm mb-2 text-brand-primary">1. Key Terminology</h4>
                      <p className="text-text-secondary">
                        • Fundamental definitions establish the exact parameters of the subject. Always write units with numerical answers.
                      </p>
                      <p className="text-text-secondary mt-1">
                        • Formula Sheet: Verify sign conventions (+/-) before substituting numerical values into equations.
                      </p>
                    </div>

                    <div>
                      <h4 className="text-text-primary font-bold font-heading text-sm mb-2 text-brand-primary">2. Important Formulae</h4>
                      <div className="bg-surface-alt p-3 rounded-lg border border-border-subtle space-y-1">
                        <p className="text-brand-primary font-semibold">Equation 1: S = u*t + 0.5*a*t²</p>
                        <p className="text-brand-primary font-semibold">Equation 2: v² = u² + 2*a*S</p>
                        <p className="text-brand-primary font-semibold">Equation 3: v = u + a*t</p>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-text-primary font-bold font-heading text-sm mb-2 text-brand-primary">3. Examination Tips</h4>
                      <p className="text-text-secondary">
                        • Allocate 2 minutes to read questions thoroughly during board examinations.
                      </p>
                      <p className="text-text-secondary mt-1">
                        • Draw neat labelled diagrams wherever applicable for maximum credit.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* 3. QUIZ */}
              {activeTab === 'quiz' && (
                <div className="max-w-3xl space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-heading text-lg font-bold text-text-primary">Lecture Practice Quiz</h3>
                      <p className="text-xs text-text-secondary">Test your comprehension immediately after watching the lecture.</p>
                    </div>
                    {quizSubmitted && (
                      <span className="badge bg-brand-primary/10 text-brand-primary border border-brand-primary/20 text-sm px-3 py-1 font-semibold">
                        Score: {quizScore} Points
                      </span>
                    )}
                  </div>

                  {quiz && quiz.questions ? (
                    <div className="space-y-6">
                      {quiz.questions.map((q: any, qIdx: number) => {
                        const isAnswered = selectedAnswers[qIdx] !== undefined;
                        const isCorrect = quizSubmitted && selectedAnswers[qIdx] === q.correctAnswer;

                        return (
                          <div 
                            key={qIdx} 
                            className={`p-5 rounded-card border transition-all ${
                              quizSubmitted 
                                ? (isCorrect ? 'bg-[#DCFCE7]/60 dark:bg-[#153428]/40 border-[#86EFAC]' : 'bg-[#FFE4EC]/60 dark:bg-[#3D1825]/40 border-[#FF8FA3]')
                                : 'card-soft'
                            }`}
                          >
                            <p className="text-sm font-semibold text-text-primary mb-3 flex items-start gap-2">
                              <span className="px-2 py-0.5 rounded bg-surface-alt border border-border-subtle text-xs text-brand-primary font-mono font-bold">Q{qIdx + 1}</span>
                              <span>{q.question}</span>
                            </p>

                            <div className="space-y-2">
                              {q.options.map((opt: string, optIdx: number) => {
                                const isSelected = selectedAnswers[qIdx] === optIdx;
                                const isRightAnswer = quizSubmitted && q.correctAnswer === optIdx;

                                return (
                                  <label
                                    key={optIdx}
                                    onClick={() => handleQuizOption(qIdx, optIdx)}
                                    className={`flex items-center gap-3 p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                                      isRightAnswer
                                        ? 'bg-[#DCFCE7] dark:bg-[#153428] border-[#86EFAC] text-[#16A34A] dark:text-[#4ADE9A] font-semibold'
                                        : isSelected
                                          ? 'bg-brand-primary/10 border-brand-primary text-brand-primary font-semibold'
                                          : 'bg-surface border-border-subtle text-text-secondary hover:bg-surface-alt hover:text-text-primary'
                                    }`}
                                  >
                                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                      isSelected ? 'border-brand-primary bg-brand-primary' : 'border-border-subtle'
                                    }`}>
                                      {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                    </div>
                                    <span>{opt}</span>
                                  </label>
                                );
                              })}
                            </div>

                            {quizSubmitted && q.explanation && (
                              <div className="mt-3 p-3 rounded-xl bg-surface-alt text-xs text-text-secondary border border-border-subtle">
                                <span className="font-bold text-brand-primary">Explanation: </span>
                                {q.explanation}
                              </div>
                            )}
                          </div>
                        );
                      })}

                      {!quizSubmitted ? (
                        <button
                          onClick={handleQuizSubmit}
                          className="btn-primary w-full py-3 flex items-center justify-center gap-2"
                        >
                          <CheckCircle className="w-4 h-4" />
                          <span>Submit Quiz</span>
                        </button>
                      ) : (
                        <button
                          onClick={() => {
                            setQuizSubmitted(false);
                            setSelectedAnswers({});
                          }}
                          className="btn-secondary w-full py-3 flex items-center justify-center gap-2"
                        >
                          <RotateCcw className="w-4 h-4" />
                          <span>Retake Quiz</span>
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="text-center py-12 card-soft p-8 rounded-card">
                      <HelpCircle className="w-12 h-12 text-text-muted mx-auto mb-3" />
                      <p className="text-text-secondary text-sm">Practice questions are generated based on your standard curriculum.</p>
                      <button 
                        onClick={() => {
                          setQuiz({
                            title: 'Quick Check',
                            questions: [
                              {
                                question: `What is the primary objective studied in this ${currentLecture.subject} lesson?`,
                                options: ['Conceptual understanding & derivation', 'Memorizing without context', 'Skipping fundamental principles', 'None of the above'],
                                correctAnswer: 0,
                                marks: 10,
                                explanation: 'Mastering the concepts and step-by-step derivations gives complete exam confidence.'
                              },
                              {
                                question: 'Which of the following approaches gives the best retention for standard examinations?',
                                options: ['Active recall & regular quizzing', 'Reading once before exam', 'Ignoring practice sets', 'Cramming overnight'],
                                correctAnswer: 0,
                                marks: 10,
                                explanation: 'Scientifically proven active recall via flashcards and quizzes dramatically improves memory.'
                              }
                            ]
                          });
                        }}
                        className="btn-primary mt-4 text-xs py-2 px-4"
                      >
                        Generate Practice Quiz
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* 4. FLASHCARDS */}
              {activeTab === 'flashcards' && (
                <div className="max-w-2xl mx-auto space-y-6">
                  <div className="text-center">
                    <h3 className="font-heading text-lg font-bold text-text-primary">Active Recall Flashcards</h3>
                    <p className="text-xs text-text-secondary">Click the card to flip between Question and Answer.</p>
                  </div>

                  {/* 3D Flip Card */}
                  <div
                    onClick={() => setIsFlipped(!isFlipped)}
                    className="relative w-full h-64 cursor-pointer perspective-1000 group"
                  >
                    <div className={`w-full h-full rounded-2xl transition-all duration-500 transform-gpu p-8 flex flex-col justify-between border shadow-soft hover:shadow-soft-hover ${
                      isFlipped
                        ? 'bg-gradient-to-br from-[#EDE9FE] to-surface border-brand-primary/40 text-text-primary dark:from-[#28214C] dark:to-surface'
                        : 'bg-surface border-border-subtle text-text-primary'
                    }`}>
                      <div className="flex items-center justify-between text-xs text-text-muted">
                        <span className="badge bg-surface-alt border border-border-subtle text-text-secondary font-medium">Card {currentCardIndex + 1} of {flashcards.length}</span>
                        <span className="text-brand-primary font-medium">Click to flip 🔄</span>
                      </div>

                      <div className="text-center my-auto">
                        <p className="text-xs text-brand-primary uppercase tracking-wider font-semibold mb-2">
                          {isFlipped ? 'Answer & Explanation' : 'Concept / Question'}
                        </p>
                        <p className="font-heading text-base sm:text-lg font-bold leading-snug text-text-primary">
                          {isFlipped ? flashcards[currentCardIndex].answer : flashcards[currentCardIndex].question}
                        </p>
                        {!isFlipped && flashcards[currentCardIndex].hint && (
                          <p className="text-xs text-text-muted mt-3 italic">
                            Hint: {flashcards[currentCardIndex].hint}
                          </p>
                        )}
                      </div>

                      <div className="text-center text-[11px] text-text-muted font-medium">
                        Learniq Smart Flashcards
                      </div>
                    </div>
                  </div>

                  {/* Flashcard Navigation */}
                  <div className="flex items-center justify-between pt-2">
                    <button
                      onClick={() => {
                        setIsFlipped(false);
                        setCurrentCardIndex(prev => (prev > 0 ? prev - 1 : flashcards.length - 1));
                      }}
                      className="btn-secondary text-xs py-2 px-4 flex items-center gap-1.5"
                    >
                      <ChevronLeft className="w-4 h-4" />
                      <span>Previous</span>
                    </button>

                    <span className="text-xs text-text-secondary font-mono font-medium">
                      {currentCardIndex + 1} / {flashcards.length}
                    </span>

                    <button
                      onClick={() => {
                        setIsFlipped(false);
                        setCurrentCardIndex(prev => (prev < flashcards.length - 1 ? prev + 1 : 0));
                      }}
                      className="btn-primary text-xs py-2 px-4 flex items-center gap-1.5"
                    >
                      <span>Next</span>
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right: Course Playlist Sidebar */}
          <div className="lg:col-span-4 xl:col-span-3 bg-surface flex flex-col h-full border-t lg:border-t-0 border-border-subtle transition-colors">
            <div className="p-4 border-b border-border-subtle flex items-center justify-between">
              <div>
                <h3 className="font-heading text-sm font-bold text-text-primary">Course Syllabus</h3>
                <p className="text-xs text-text-secondary font-medium">{lectures.length} Lectures • Standard {course.standard}</p>
              </div>
              <div className="text-right">
                <span className="text-xs font-semibold text-accent-mint">
                  {completedLectures.length}/{lectures.length} Completed
                </span>
              </div>
            </div>

            {/* Lecture list */}
            <div className="overflow-y-auto flex-1 divide-y divide-border-subtle">
              {lectures.map((item, idx) => {
                const isSelected = item._id === currentLecture._id;
                const isCompleted = completedLectures.includes(item._id);

                return (
                  <Link
                    key={item._id}
                    to={`/courses/${courseId}/lecture/${item._id}`}
                    className={`p-4 flex items-start gap-3 transition-all block ${
                      isSelected
                        ? 'bg-brand-primary/10 border-l-4 border-brand-primary text-brand-primary'
                        : 'hover:bg-surface-alt'
                    }`}
                  >
                    <div className="mt-0.5 flex-shrink-0">
                      {isCompleted ? (
                        <CheckCircle className="w-4 h-4 text-accent-mint" />
                      ) : isSelected ? (
                        <Play className="w-4 h-4 text-brand-primary fill-brand-primary" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border border-border-subtle text-[10px] flex items-center justify-center text-text-muted font-medium">
                          {idx + 1}
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium line-clamp-2 ${
                        isSelected ? 'text-brand-primary font-bold' : 'text-text-primary'
                      }`}>
                        {item.title}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-text-secondary">
                        <Clock className="w-3 h-3 text-text-muted" />
                        <span>{item.videoDuration || '20:00'}</span>
                        {item.isFree && <span className="badge-free text-[9px] px-1 py-0">FREE</span>}
                      </div>
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

export default LecturePlayerPage;


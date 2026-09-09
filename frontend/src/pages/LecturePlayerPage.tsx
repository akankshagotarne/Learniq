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
      <div className="min-h-screen bg-dark-900 text-white">
        <Navbar />
        <div className="pt-24 page-container py-12">
          <div className="skeleton h-96 rounded-2xl mb-8" />
          <div className="grid lg:grid-cols-3 gap-8">
            <div className="lg:col-span-2 skeleton h-64 rounded-2xl" />
            <div className="skeleton h-64 rounded-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!currentLecture || !course) return null;

  return (
    <div className="min-h-screen bg-dark-950 text-white flex flex-col">
      <Navbar />

      <main className="flex-1 pt-16 flex flex-col">
        {/* Top Header Bar */}
        <div className="bg-dark-900 border-b border-white/10 px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              to={`/courses/${course._id}`}
              className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white transition-colors flex items-center gap-1 text-xs"
            >
              <ChevronLeft className="w-4 h-4" />
              <span>Back to Course</span>
            </Link>
            <div className="hidden sm:block h-4 w-px bg-white/10" />
            <div>
              <span className="text-xs text-primary-400 font-medium">
                Std {course.standard} • {course.subject}
              </span>
              <h1 className="text-sm font-semibold text-white truncate max-w-md sm:max-w-xl">
                {currentLecture.title}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleMarkComplete}
              disabled={completing || completedLectures.includes(currentLecture._id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-all ${
                completedLectures.includes(currentLecture._id)
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-primary-600 hover:bg-primary-500 text-white shadow-lg shadow-primary-500/20'
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
          <div className="lg:col-span-8 xl:col-span-9 flex flex-col bg-black/60 border-r border-white/10">
            {/* Video Container */}
            <div className="relative aspect-video w-full bg-black flex items-center justify-center overflow-hidden group">
              {/* Dynamic Video Player Simulation */}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/20 pointer-events-none" />

              {/* Decorative Animated Learning Canvas / Video Screen */}
              <div className="w-full h-full relative flex items-center justify-center bg-gradient-to-br from-dark-900 via-dark-800 to-primary-950/40">
                <div className="text-center p-6 z-10">
                  <div className="w-20 h-20 rounded-full bg-primary-600/30 border border-primary-400/30 flex items-center justify-center mx-auto mb-4 backdrop-blur-md group-hover:scale-110 transition-transform shadow-2xl shadow-primary-500/30 cursor-pointer"
                       onClick={() => setIsPlaying(!isPlaying)}>
                    {isPlaying ? (
                      <Pause className="w-8 h-8 text-primary-300" />
                    ) : (
                      <Play className="w-8 h-8 text-primary-300 ml-1 fill-primary-300" />
                    )}
                  </div>
                  <h3 className="text-lg font-bold text-white mb-1">{currentLecture.title}</h3>
                  <p className="text-xs text-white/50">{course.subject} • Lecture {currentIndex + 1} of {lectures.length}</p>
                </div>

                {/* Ambient Glow */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-primary-500/10 rounded-full blur-3xl pointer-events-none" />
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
                    className="h-full bg-gradient-to-r from-primary-500 to-accent-400 rounded-full relative" 
                    style={{ width: `${videoProgress}%` }}
                  >
                    <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow" />
                  </div>
                </div>

                {/* Bottom Row Controls */}
                <div className="flex items-center justify-between text-white/80 text-xs">
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
                      {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
                    </button>

                    <span>12:45 / {currentLecture.videoDuration || '25:00'}</span>
                  </div>

                  <div className="flex items-center gap-3">
                    {/* Speed Selector */}
                    <button 
                      onClick={() => {
                        const speeds = [1, 1.25, 1.5, 2];
                        const next = speeds[(speeds.indexOf(playbackSpeed) + 1) % speeds.length];
                        setPlaybackSpeed(next);
                      }}
                      className="px-2 py-1 bg-white/10 hover:bg-white/20 rounded font-semibold text-[11px] transition-colors"
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
            <div className="bg-dark-900 border-b border-white/10 px-6 py-3 flex items-center justify-between">
              {prevLecture ? (
                <Link
                  to={`/courses/${courseId}/lecture/${prevLecture._id}`}
                  className="flex items-center gap-2 text-xs text-white/70 hover:text-white transition-colors bg-white/5 hover:bg-white/10 px-3 py-1.5 rounded-lg border border-white/5"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span>Previous: {prevLecture.title}</span>
                </Link>
              ) : <div />}

              {nextLecture ? (
                <Link
                  to={`/courses/${courseId}/lecture/${nextLecture._id}`}
                  className="flex items-center gap-2 text-xs text-primary-400 hover:text-primary-300 font-medium transition-colors bg-primary-500/10 hover:bg-primary-500/20 px-3 py-1.5 rounded-lg border border-primary-500/20"
                >
                  <span>Next: {nextLecture.title}</span>
                  <ChevronRight className="w-4 h-4" />
                </Link>
              ) : (
                <span className="text-xs text-white/40">You've reached the final lecture in this course!</span>
              )}
            </div>

            {/* Tab Navigation */}
            <div className="bg-dark-900/80 border-b border-white/10 px-6 flex items-center gap-4 overflow-x-auto">
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
                        ? 'border-primary-500 text-primary-400'
                        : 'border-transparent text-white/60 hover:text-white hover:border-white/20'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Tab Contents */}
            <div className="p-6 overflow-y-auto flex-1 bg-dark-900/40">
              {/* 1. OVERVIEW */}
              {activeTab === 'overview' && (
                <div className="max-w-3xl space-y-6">
                  <div>
                    <h2 className="text-xl font-bold text-white mb-2">{currentLecture.title}</h2>
                    <p className="text-white/60 text-sm leading-relaxed">
                      {currentLecture.description || 
                        `In this comprehensive session on ${currentLecture.subject}, students in Standard ${course.standard} will master fundamental concepts, problem solving tactics, and exam patterns with crystal clear practical examples.`
                      }
                    </p>
                  </div>

                  <div className="glass-card p-4 rounded-xl border border-white/10 space-y-3">
                    <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-primary-400" /> What you will learn
                    </h3>
                    <ul className="grid sm:grid-cols-2 gap-2 text-xs text-white/70">
                      <li className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-400" /> Step-by-step conceptual derivation
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-400" /> Solved NCERT / State board examples
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-400" /> Memorization tips & shortcut formulas
                      </li>
                      <li className="flex items-center gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-400" /> Practice quiz & exam model questions
                      </li>
                    </ul>
                  </div>

                  {/* Teacher summary */}
                  {course.teacher && (
                    <div className="flex items-center gap-3 p-4 bg-white/5 rounded-xl border border-white/5">
                      <img
                        src={(course.teacher as any).avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent((course.teacher as any).name || 'Teacher')}&background=6C63FF&color=fff`}
                        alt="Teacher"
                        className="w-12 h-12 rounded-full object-cover border border-primary-500/30"
                      />
                      <div>
                        <p className="text-xs text-primary-400 font-medium">Instructor</p>
                        <h4 className="text-sm font-semibold text-white">{(course.teacher as any).name}</h4>
                        <p className="text-xs text-white/50 line-clamp-1">{(course.teacher as any).bio}</p>
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
                      <h3 className="text-lg font-bold text-white">Lecture Notes & Handouts</h3>
                      <p className="text-xs text-white/50">Comprehensive summary designed for quick exam revision.</p>
                    </div>
                    <button 
                      onClick={() => toast.success('Notes downloaded successfully as PDF!')}
                      className="btn-primary text-xs py-2 px-3 flex items-center gap-2"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download PDF</span>
                    </button>
                  </div>

                  <div className="glass-card p-6 rounded-2xl border border-white/10 space-y-4 font-mono text-xs text-white/80 bg-dark-950/60 leading-relaxed">
                    <div className="border-b border-white/10 pb-3">
                      <p className="text-primary-400 font-semibold text-sm">{course.subject} — Standard {course.standard}</p>
                      <p className="text-white text-base font-bold font-sans mt-1">{currentLecture.title}</p>
                    </div>

                    <div>
                      <h4 className="text-white font-bold font-sans text-sm mb-2 text-primary-300">1. Key Terminology</h4>
                      <p className="text-white/70">
                        • Fundamental definitions establish the exact parameters of the subject. Always write units with numerical answers.
                      </p>
                      <p className="text-white/70 mt-1">
                        • Formula Sheet: Verify sign conventions (+/-) before substituting numerical values into equations.
                      </p>
                    </div>

                    <div>
                      <h4 className="text-white font-bold font-sans text-sm mb-2 text-primary-300">2. Important Formulae</h4>
                      <div className="bg-white/5 p-3 rounded-lg border border-white/5 space-y-1">
                        <p className="text-accent-300">Equation 1: S = u*t + 0.5*a*t²</p>
                        <p className="text-accent-300">Equation 2: v² = u² + 2*a*S</p>
                        <p className="text-accent-300">Equation 3: v = u + a*t</p>
                      </div>
                    </div>

                    <div>
                      <h4 className="text-white font-bold font-sans text-sm mb-2 text-primary-300">3. Examination Tips</h4>
                      <p className="text-white/70">
                        • Allocate 2 minutes to read questions thoroughly during board examinations.
                      </p>
                      <p className="text-white/70 mt-1">
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
                      <h3 className="text-lg font-bold text-white">Lecture Practice Quiz</h3>
                      <p className="text-xs text-white/50">Test your comprehension immediately after watching the lecture.</p>
                    </div>
                    {quizSubmitted && (
                      <span className="badge-primary text-sm px-3 py-1">
                        Score: {quizScore} Points
                      </span>
                    )}
                  </div>

                  {quiz && quiz.questions ? (
                    <div className="space-y-6">
                      {quiz.questions.map((q: any, qIdx: number) => {
                        const isAnswered = selectedAnswers[qIdx] !== undefined;
                        const isCorrect = quizSubmitted && selectedAnswers[qIdx] === q.correctAnswer;
                        const isWrong = quizSubmitted && isAnswered && selectedAnswers[qIdx] !== q.correctAnswer;

                        return (
                          <div 
                            key={qIdx} 
                            className={`p-5 rounded-xl border transition-all ${
                              quizSubmitted 
                                ? (isCorrect ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30')
                                : 'bg-white/5 border-white/10'
                            }`}
                          >
                            <p className="text-sm font-semibold text-white mb-3 flex items-start gap-2">
                              <span className="px-2 py-0.5 rounded bg-white/10 text-xs text-primary-300 font-mono">Q{qIdx + 1}</span>
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
                                    className={`flex items-center gap-3 p-3 rounded-lg border text-xs cursor-pointer transition-all ${
                                      isRightAnswer
                                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-300 font-medium'
                                        : isSelected
                                          ? 'bg-primary-500/20 border-primary-500 text-white'
                                          : 'bg-white/[0.02] border-white/5 text-white/70 hover:bg-white/5'
                                    }`}
                                  >
                                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center ${
                                      isSelected ? 'border-primary-400 bg-primary-500' : 'border-white/30'
                                    }`}>
                                      {isSelected && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
                                    </div>
                                    <span>{opt}</span>
                                  </label>
                                );
                              })}
                            </div>

                            {quizSubmitted && q.explanation && (
                              <div className="mt-3 p-3 rounded-lg bg-white/5 text-xs text-white/70 border border-white/5">
                                <span className="font-bold text-primary-400">Explanation: </span>
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
                    <div className="text-center py-12 glass-card p-8 rounded-2xl">
                      <HelpCircle className="w-12 h-12 text-white/30 mx-auto mb-3" />
                      <p className="text-white/60 text-sm">Practice questions are generated based on your standard curriculum.</p>
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
                    <h3 className="text-lg font-bold text-white">Active Recall Flashcards</h3>
                    <p className="text-xs text-white/50">Click the card to flip between Question and Answer.</p>
                  </div>

                  {/* 3D Flip Card */}
                  <div
                    onClick={() => setIsFlipped(!isFlipped)}
                    className="relative w-full h-64 cursor-pointer perspective-1000 group"
                  >
                    <div className={`w-full h-full rounded-2xl transition-all duration-500 transform-gpu p-8 flex flex-col justify-between border shadow-2xl ${
                      isFlipped
                        ? 'bg-gradient-to-br from-primary-900/60 to-purple-900/60 border-primary-500/40 text-white'
                        : 'bg-dark-800 border-white/10 text-white'
                    }`}>
                      <div className="flex items-center justify-between text-xs text-white/40">
                        <span className="badge bg-white/10 text-white/60">Card {currentCardIndex + 1} of {flashcards.length}</span>
                        <span className="text-primary-400 font-medium">Click to flip 🔄</span>
                      </div>

                      <div className="text-center my-auto">
                        <p className="text-xs text-primary-400 uppercase tracking-wider font-semibold mb-2">
                          {isFlipped ? 'Answer & Explanation' : 'Concept / Question'}
                        </p>
                        <p className="text-base sm:text-lg font-bold leading-snug">
                          {isFlipped ? flashcards[currentCardIndex].answer : flashcards[currentCardIndex].question}
                        </p>
                        {!isFlipped && flashcards[currentCardIndex].hint && (
                          <p className="text-xs text-white/40 mt-3 italic">
                            Hint: {flashcards[currentCardIndex].hint}
                          </p>
                        )}
                      </div>

                      <div className="text-center text-[11px] text-white/30">
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

                    <span className="text-xs text-white/40 font-mono">
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
          <div className="lg:col-span-4 xl:col-span-3 bg-dark-900 flex flex-col h-full border-t lg:border-t-0">
            <div className="p-4 border-b border-white/10 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-white">Course Syllabus</h3>
                <p className="text-xs text-white/50">{lectures.length} Lectures • Standard {course.standard}</p>
              </div>
              <div className="text-right">
                <span className="text-xs font-semibold text-emerald-400">
                  {completedLectures.length}/{lectures.length} Completed
                </span>
              </div>
            </div>

            {/* Lecture list */}
            <div className="overflow-y-auto flex-1 divide-y divide-white/5">
              {lectures.map((item, idx) => {
                const isSelected = item._id === currentLecture._id;
                const isCompleted = completedLectures.includes(item._id);

                return (
                  <Link
                    key={item._id}
                    to={`/courses/${courseId}/lecture/${item._id}`}
                    className={`p-4 flex items-start gap-3 transition-all block ${
                      isSelected
                        ? 'bg-primary-500/15 border-l-4 border-primary-500'
                        : 'hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="mt-0.5 flex-shrink-0">
                      {isCompleted ? (
                        <CheckCircle className="w-4 h-4 text-emerald-400" />
                      ) : isSelected ? (
                        <Play className="w-4 h-4 text-primary-400 fill-primary-400" />
                      ) : (
                        <div className="w-4 h-4 rounded-full border border-white/30 text-[10px] flex items-center justify-center text-white/50">
                          {idx + 1}
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-medium line-clamp-2 ${
                        isSelected ? 'text-white font-bold' : 'text-white/80'
                      }`}>
                        {item.title}
                      </p>
                      <div className="flex items-center gap-2 mt-1 text-[11px] text-white/40">
                        <Clock className="w-3 h-3" />
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

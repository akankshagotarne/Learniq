export interface User {
  _id: string;
  name: string;
  email: string;
  role: 'student' | 'teacher' | 'admin';
  phone?: string;
  avatar?: string;
  isActive: boolean;
  isApproved: boolean;
  currentStandard?: number;
  subjects?: string[];
  standards?: number[];
  bio?: string;
  experience?: string;
  qualification?: string;
  points?: number;
  badges?: Badge[];
  streak?: number;
  lastLogin?: string;
  createdAt: string;
}

export interface Course {
  _id: string;
  title: string;
  description: string;
  subject: string;
  standard: number;
  teacher: User;
  thumbnail?: string;
  totalLectures: number;
  duration: string;
  rating: number;
  totalRatings: number;
  enrolledCount: number;
  isFree: boolean;
  price: number;
  isActive: boolean;
  tags: string[];
  language: string;
  level: string;
  syllabus?: string[];
  notesUrl?: string;
  isFlagged?: boolean;
  flagReason?: string;
  createdAt: string;
}

export interface Lecture {
  _id: string;
  title: string;
  description?: string;
  course: Course | string;
  teacher: User | string;
  standard: number;
  subject: string;
  order: number;
  videoUrl?: string;
  videoDuration: string;
  thumbnail?: string;
  isFree: boolean;
  price: number;
  hasNotes: boolean;
  isActive: boolean;
  views?: number;
  createdAt?: string;
}

export interface Question {
  _id?: string;
  question: string;
  options: string[];
  correctAnswer?: number;
  marks: number;
  explanation?: string;
}

export interface Quiz {
  _id: string;
  title: string;
  description?: string;
  course?: Course | string;
  teacher: User;
  standard: number;
  subject: string;
  questions: Question[];
  totalMarks: number;
  timeLimit: number;
  passingMarks: number;
  isActive: boolean;
  isLiveQuiz: boolean;
  attemptLimit: number;
  createdAt: string;
}

export interface QuizAttempt {
  _id: string;
  quiz: Quiz | string;
  student: User | string;
  score: number;
  totalMarks: number;
  percentage: number;
  timeTaken: number;
  isCompleted: boolean;
  submittedAt: string;
  createdAt: string;
}

export interface Assignment {
  _id: string;
  title: string;
  description: string;
  course?: Course | string;
  teacher: User;
  standard: number;
  subject: string;
  dueDate: string;
  totalMarks: number;
  filePath?: string;
  isActive: boolean;
  submissionCount?: number;
  createdAt: string;
}

export interface AssignmentSubmission {
  _id: string;
  assignment: Assignment | string;
  student: User;
  filePath?: string;
  note?: string;
  marksObtained?: number;
  feedback?: string;
  isGraded: boolean;
  submittedAt: string;
}

export interface LiveSession {
  _id: string;
  title: string;
  description?: string;
  teacher: User;
  course?: Course | string;
  standard: number;
  subject: string;
  sessionCode: string;
  joinUrl: string;
  scheduledAt?: string;
  startedAt?: string;
  endedAt?: string;
  status: 'scheduled' | 'live' | 'ended' | 'cancelled';
  currentParticipants: number;
  isChatEnabled: boolean;
  activeQuiz?: Quiz | string;
  totalParticipants?: number;
  createdAt: string;
}

export interface ChatMessage {
  _id?: string;
  senderName: string;
  senderRole: string;
  message: string;
  createdAt: string;
}

export interface Note {
  _id: string;
  title: string;
  lecture: Lecture | string;
  teacher: User;
  isFree: boolean;
  price: number;
  fileUrl?: string;
}

export interface Notification {
  _id: string;
  title: string;
  message: string;
  type: string;
  isRead: boolean;
  link?: string;
  createdAt: string;
}

export interface Enrollment {
  _id: string;
  student: User | string;
  course: Course;
  enrolledAt: string;
  completionPercentage: number;
  isCompleted: boolean;
}

export interface Payment {
  _id: string;
  student: User | string;
  course?: Course;
  lecture?: Lecture;
  amount: number;
  currency: string;
  status: string;
  type: string;
  createdAt: string;
}

export interface Badge {
  _id: string;
  name: string;
  description: string;
  emoji: string;
  points: number;
}

export interface Participant {
  userId: string;
  name: string;
  role: string;
  isTeacher: boolean;
  isCameraOn: boolean;
  isMicOn: boolean;
  socketId: string;
}

export interface LeaderboardEntry {
  studentId: string;
  studentName: string;
  score: number;
  totalMarks: number;
  percentage: number;
  submittedAt: string;
}

// ---- Live MCQ Feature ----

export interface LiveMcq {
  mcqId: string;
  question: string;
  options: string[];
  startTimestamp: number; // ms epoch from server
  durationMs: number;     // always 15000
}

export interface McqResultEntry {
  studentId: string;
  studentName: string;
  selectedOption: number | null;
  isCorrect: boolean;
  responseTimeSec: number | null;
  rank: number;
}

export interface ScoreboardEntry {
  userId: string;
  name: string;
  correct: number;
  wrong: number;
  totalResponseTimeSec: number;
  rank: number;
}

export interface PodiumEntry {
  userId: string;
  name: string;
  correct: number;
  wrong: number;
  totalResponseTimeSec: number;
  rank: number;
  place: number;
}

// ---- Exam Feature ----

export interface ExamQuestion {
  _id?: string;
  type: 'mcq' | 'truefalse' | 'fillblank';
  question: string;
  options: string[];
  correctAnswer?: number;
  marks: number;
  explanation?: string;
  order?: number;
}

export interface Exam {
  _id: string;
  title: string;
  description?: string;
  instructions?: string;
  teacher: User | { _id: string; name: string; avatar?: string };
  standard: number;
  subject: string;
  chapter?: string;
  questions: ExamQuestion[];
  totalMarks: number;
  durationMinutes: number;
  negativeMarking: boolean;
  negativeMarkValue: number;
  passingMarks: number;
  attemptLimit: number;
  scheduledStart?: string | null;
  scheduledEnd?: string | null;
  isPublished: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
  // Computed fields from listing
  questionCount?: number;
  attemptCount?: number;
  myBestAttempt?: ExamAttempt | null;
  myAttemptCount?: number;
  attemptsLeft?: number | null;
  canAttempt?: boolean;
  availability?: 'available' | 'upcoming' | 'expired';
}

export interface ExamAnswer {
  questionId: string;
  selectedOption: number | null;
  answeredAt?: string;
}

export interface IntegrityEvent {
  type: 'tab-switch' | 'fullscreen-exit' | 'copy-paste';
  timestamp: string;
}

export interface ExamAttempt {
  _id: string;
  exam: Exam | string;
  student: User | string;
  status: 'in-progress' | 'submitted' | 'auto-submitted';
  answers: ExamAnswer[];
  draftAnswers?: Record<string, number | null>;
  startedAt: string;
  submittedAt?: string;
  timeTaken: number;
  score: number;
  totalMarks: number;
  percentage: number;
  integrityEvents?: IntegrityEvent[];
  attemptNumber: number;
  rank?: number;
}

export interface ExamResult {
  score: number;
  totalMarks: number;
  percentage: number;
  timeTaken: number;
  rank: number;
  totalAttemptees: number;
  percentile: number;
  passed: boolean;
}

export interface ExamQuestionReview {
  questionId: string;
  question: string;
  type: string;
  options: string[];
  correctAnswer: number;
  selectedOption: number | null;
  isCorrect: boolean;
  marks: number;
  explanation?: string;
}

export interface SupportMessage {
  _id?: string;
  sender: string;
  senderName: string;
  senderRole: 'student' | 'teacher' | 'admin';
  message: string;
  attachmentUrl?: string | null;
  createdAt: string;
}

export interface SupportTicket {
  _id: string;
  user: string;
  userName: string;
  userRole: 'student' | 'teacher';
  subject: string;
  category: 'bug' | 'glitch' | 'live-class' | 'payment' | 'course-content' | 'account' | 'other';
  status: 'open' | 'in-progress' | 'resolved';
  messages: SupportMessage[];
  lastMessageAt: string;
  firstRespondedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

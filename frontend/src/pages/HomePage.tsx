import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Play, Radio, BookOpen, Award, Users, CheckCircle, ArrowRight,
  Star, Sparkles, TrendingUp, ShieldCheck, Heart
} from 'lucide-react';
import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';
import api from '../services/api';
import { Course, LiveSession } from '../types';
import { getCourseThumbnail } from '../utils/courseImage';

const getSubjectBadgeClass = (subject: string) => {
  const s = subject.toLowerCase();
  if (s.includes('math')) return 'badge-subject-math';
  if (s.includes('science') || s.includes('evs')) return 'badge-subject-science';
  if (s.includes('marathi') || s.includes('english') || s.includes('language')) return 'badge-subject-languages';
  return 'badge-primary';
};

const HomePage: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);
  const [liveSessions, setLiveSessions] = useState<LiveSession[]>([]);

  useEffect(() => {
    api.get('/courses?limit=6').then(r => setCourses(r.data.courses || [])).catch(() => {});
    api.get('/live-sessions?status=live').then(r => setLiveSessions(r.data.sessions || [])).catch(() => {});
  }, []);

  const standards = [
    { std: 1, label: 'Early Foundations', subjects: ['Math', 'English', 'EVS'], color: 'from-[#6C63F2] to-[#B69CF2]' },
    { std: 2, label: 'Core Skills', subjects: ['Math', 'English', 'EVS'], color: 'from-[#5AC8FA] to-[#6C63F2]' },
    { std: 3, label: 'Concepts Building', subjects: ['Math', 'English', 'Science'], color: 'from-[#4ADE9A] to-[#5AC8FA]' },
    { std: 4, label: 'Primary Mastery', subjects: ['Math', 'English', 'Science'], color: 'from-[#FFC24B] to-[#FF8FA3]' },
    { std: 5, label: 'Middle School Entry', subjects: ['Math', 'English', 'Science', 'Social Sci'], color: 'from-[#FF8FA3] to-[#6C63F2]' },
    { std: 6, label: 'Curriculum Depth', subjects: ['Math', 'Science', 'Social', 'Languages'], color: 'from-[#6C63F2] to-[#4ADE9A]' },
    { std: 7, label: 'Advanced Logic', subjects: ['Math', 'Science', 'Social', 'Languages'], color: 'from-[#5AC8FA] to-[#B69CF2]' },
    { std: 8, label: 'High School Prep', subjects: ['Math', 'Science', 'Social', 'Languages'], color: 'from-[#FFC24B] to-[#4ADE9A]' },
    { std: 9, label: 'Board Pre-Foundation', subjects: ['Math', 'Science', 'Social', 'Languages'], color: 'from-[#FF8FA3] to-[#B69CF2]' },
    { std: 10, label: 'Board Exam Excellence', subjects: ['Math', 'Science', 'Social', 'Languages'], color: 'from-[#6C63F2] to-[#FF8FA3]' },
  ];

  const stats = [
    { label: 'Enrolled Students', value: '10,000+' },
    { label: 'Interactive Lectures', value: '500+' },
    { label: 'Certified Teachers', value: '50+' },
    { label: 'Board Exam Pass Rate', value: '98.5%' },
  ];

  const features = [
    { icon: Radio, title: 'Interactive Live Classes', desc: 'Real-time two-way audio & video sessions with expert teachers, live polls, and instant doubt resolution.', bg: 'bg-[#FFE4EC] text-[#E1447A]' },
    { icon: Play, title: 'Bite-Sized Lectures', desc: 'Chapter-by-chapter recorded video lessons mapped accurately to CBSE, ICSE, and Maharashtra State Board.', bg: 'bg-[#EDE9FE] text-[#6C63F2]' },
    { icon: Award, title: 'Interactive Quizzes & XP', desc: 'Active recall practice quizzes, instant leaderboard rankings, daily streaks, and collectible skill badges.', bg: 'bg-[#FEF3C7] text-[#D97706]' },
    { icon: BookOpen, title: 'Downloadable Notes', desc: 'Crisp handwritten summaries, formula cheat sheets, and solved previous year board questions.', bg: 'bg-[#DCFCE7] text-[#16A34A]' },
    { icon: Users, title: 'Small Interactive Batches', desc: 'Focused batches ensure individual student attention so no child is left behind.', bg: 'bg-[#E0F2FE] text-[#0284C7]' },
    { icon: TrendingUp, title: 'Visual Progress Tracking', desc: 'Detailed parent & student analytics dashboard tracking study hours, quiz averages, and topic mastery.', bg: 'bg-[#F3E8FF] text-[#9333EA]' },
  ];

  const testimonials = [
    { name: 'Aarav Sharma', std: 'Standard 10 (CBSE)', text: 'The live doubt solving for SSC Mathematics helped me score 96% in my term exams. The teacher explained every trigonometry theorem with amazing clarity!', avatar: 'https://ui-avatars.com/api/?name=Aarav+Sharma&background=6C63F2&color=fff' },
    { name: 'Ananya Deshmukh', std: 'Standard 8 (State Board)', text: 'Learniq makes Science so much fun! The flashcards and practice quizzes help me revise chapters before unit tests in just 15 minutes.', avatar: 'https://ui-avatars.com/api/?name=Ananya+Deshmukh&background=FF8FA3&color=fff' },
    { name: 'Dr. Ramesh Kulkarni', std: 'Parent of Std 5 Student', text: 'As a parent, I love the progress dashboard. I can see what my daughter studied today and how she performed in live quizzes without any stress.', avatar: 'https://ui-avatars.com/api/?name=Ramesh+Kulkarni&background=4ADE9A&color=fff' },
  ];

  return (
    <div className="min-h-screen bg-[#F8F8FC] dark:bg-[#12121F] text-[#22243A] dark:text-[#F4F4FA]">
      <Navbar />

      {/* Section 6.6 Hero Section */}
      <section className="relative min-h-[90vh] flex items-center pt-24 pb-16 overflow-hidden bg-[#F8F8FC] dark:bg-[#12121F]">
        {/* Soft pastel blur blobs */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute -top-12 left-10 w-96 h-96 bg-[#6C63F2]/10 dark:bg-[#8B82FF]/15 rounded-full blur-3xl animate-pulse-slow" />
          <div className="absolute bottom-10 right-10 w-[450px] h-[450px] bg-[#FF8FA3]/15 dark:bg-[#FF8FA3]/10 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '1.5s' }} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[#B69CF2]/10 rounded-full blur-3xl" />
        </div>

        <div className="page-container relative z-10 py-12">
          <div className="grid lg:grid-cols-12 gap-12 lg:gap-8 items-center">
            {/* Left Col */}
            <div className="lg:col-span-7 animate-slide-up space-y-6">
              {/* Pill Tag */}
              <div className="inline-flex items-center gap-2 px-3.5 py-1.5 bg-[#EDE9FE] dark:bg-[#6C63F2]/20 border border-[#B69CF2]/40 rounded-full">
                <span className="w-2 h-2 rounded-full bg-[#6C63F2] animate-pulse" />
                <span className="text-[#6C63F2] dark:text-[#C4ADFF] text-xs sm:text-sm font-semibold">
                  India's Friendly School EdTech Platform • Standards 1–10
                </span>
              </div>

              <h1 className="font-display font-black text-4xl sm:text-6xl lg:text-7xl leading-[1.1] text-[#22243A] dark:text-[#F4F4FA]">
                Learn <span className="gradient-text">Smarter.</span><br />
                Grow <span className="gradient-text">Better.</span>
              </h1>

              <p className="text-[#6B6E8C] dark:text-[#A6A8C4] text-base sm:text-lg leading-relaxed max-w-xl">
                Connect with expert teachers for interactive live classes, crystal-clear recorded lectures, active recall flashcards, and gamified quizzes designed for school champions.
              </p>

              {/* CTAs */}
              <div className="flex flex-wrap items-center gap-4 pt-2">
                <Link
                  to="/register"
                  className="btn-primary rounded-full px-8 py-4 text-base font-bold shadow-[0_6px_20px_rgba(108,99,242,0.3)] hover:shadow-[0_8px_25px_rgba(108,99,242,0.45)]"
                >
                  <span>Start Learning Free</span>
                  <ArrowRight className="w-4 h-4 ml-2" />
                </Link>

                <Link
                  to="/live-sessions"
                  className="btn-secondary rounded-full px-8 py-4 text-base font-semibold border-[#E7E7F2] dark:border-[#2E2F4A] hover:border-[#6C63F2]/40 text-[#6C63F2] dark:text-[#8B82FF] flex items-center gap-2"
                >
                  <Radio className="w-4 h-4 text-[#E1447A] animate-pulse" />
                  <span>Join Live Class</span>
                </Link>
              </div>

              {/* Section 6.6 Stats row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 pt-6 border-t border-[#E7E7F2] dark:border-[#2E2F4A]/60">
                {stats.map(({ label, value }) => (
                  <div key={label}>
                    <p className="font-display font-bold text-2xl sm:text-3xl text-[#6C63F2] dark:text-[#8B82FF]">{value}</p>
                    <p className="text-xs text-[#6B6E8C] dark:text-[#A6A8C4] mt-1 font-medium">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Col: Hero Card & Floating Modules */}
            <div className="lg:col-span-5 relative animate-fade-in">
              <div className="relative mx-auto max-w-md">
                {/* Main Mockup Card */}
                <div className="bg-white dark:bg-[#1B1C2E] border border-[#E7E7F2] dark:border-[#2E2F4A] rounded-2xl p-5 shadow-[0_8px_30px_rgba(34,36,58,0.08)]">
                  <div className="flex items-center justify-between mb-3.5 pb-2.5 border-b border-[#E7E7F2] dark:border-[#2E2F4A]">
                    <div className="flex items-center gap-2">
                      <div className="w-2.5 h-2.5 rounded-full bg-[#E1447A]" />
                      <div className="w-2.5 h-2.5 rounded-full bg-[#FFC24B]" />
                      <div className="w-2.5 h-2.5 rounded-full bg-[#4ADE9A]" />
                      <span className="text-xs text-[#6B6E8C] dark:text-[#A6A8C4] font-medium ml-1">Live Demo Class</span>
                    </div>
                    <span className="badge-live text-[10px]">LIVE NOW</span>
                  </div>

                  <div className="bg-[#F1F1FA] dark:bg-[#242540] rounded-xl p-4 aspect-video flex flex-col items-center justify-center text-center relative overflow-hidden group">
                    <div className="w-14 h-14 bg-[#6C63F2]/15 text-[#6C63F2] rounded-full flex items-center justify-center mb-2.5 group-hover:scale-110 transition-transform shadow-md">
                      <Play className="w-6 h-6 ml-1 fill-current" />
                    </div>
                    <p className="font-display font-bold text-sm text-[#22243A] dark:text-[#F4F4FA]">Trigonometry Masterclass</p>
                    <p className="text-[11px] text-[#6B6E8C] dark:text-[#A6A8C4] mt-0.5">Standard 10 • SSC Board</p>
                  </div>

                  <div className="flex items-center justify-between mt-4 pt-3 border-t border-[#E7E7F2] dark:border-[#2E2F4A]">
                    <div className="flex items-center gap-2">
                      <div className="flex -space-x-2">
                        {['#6C63F2', '#FF8FA3', '#4ADE9A', '#FFC24B'].map((c, i) => (
                          <div key={i} className="w-6 h-6 rounded-full border-2 border-white dark:border-[#1B1C2E]" style={{ backgroundColor: c }} />
                        ))}
                      </div>
                      <span className="text-xs text-[#6B6E8C] dark:text-[#A6A8C4] font-medium">+38 students</span>
                    </div>
                    <span className="text-xs font-semibold text-[#6C63F2] dark:text-[#8B82FF]">Rajesh Sharma, IIT-B</span>
                  </div>
                </div>

                {/* Floating Quiz Leaderboard Card */}
                <div className="absolute -bottom-6 -left-6 bg-white dark:bg-[#1B1C2E] border border-[#E7E7F2] dark:border-[#2E2F4A] rounded-2xl p-4 w-52 shadow-[0_8px_25px_rgba(34,36,58,0.10)] animate-float hidden sm:block">
                  <p className="text-xs font-bold text-[#22243A] dark:text-[#F4F4FA] mb-2 flex items-center gap-1.5">
                    <span>🏆</span> Live Quiz Rankers
                  </p>
                  {[
                    { name: 'Aryan S.', score: '10/10', rank: 1 },
                    { name: 'Priya M.', score: '9/10', rank: 2 },
                    { name: 'Rohan K.', score: '9/10', rank: 3 },
                  ].map(r => (
                    <div key={r.name} className="flex items-center justify-between py-1 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="w-4 text-[11px] font-bold text-[#FFC24B]">#{r.rank}</span>
                        <span className="text-[#22243A] dark:text-[#F4F4FA] font-medium">{r.name}</span>
                      </div>
                      <span className="badge-free text-[10px] py-0 px-1.5">{r.score}</span>
                    </div>
                  ))}
                </div>

                {/* Floating Quiz Master Badge Card */}
                <div className="absolute -top-5 -right-5 bg-white dark:bg-[#1B1C2E] border border-[#E7E7F2] dark:border-[#2E2F4A] rounded-2xl p-3 shadow-[0_8px_25px_rgba(34,36,58,0.10)] animate-bounce-in hidden sm:block">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-[#FEF3C7] text-[#D97706] flex items-center justify-center text-lg font-bold">
                      ⭐
                    </div>
                    <div>
                      <p className="text-xs font-bold text-[#22243A] dark:text-[#F4F4FA]">Quiz Master</p>
                      <p className="text-[10px] text-[#4ADE9A] font-semibold">+50 XP Earned</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Standards Selection Section */}
      <section className="section bg-white dark:bg-[#1B1C2E] border-t border-b border-[#E7E7F2] dark:border-[#2E2F4A]">
        <div className="page-container">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="badge-primary text-xs mb-2 inline-block">Curriculum Standards 1–10</span>
            <h2 className="font-display font-bold text-3xl sm:text-4xl text-[#22243A] dark:text-[#F4F4FA] mb-3">
              Explore Learning for Your <span className="gradient-text">Grade</span>
            </h2>
            <p className="text-[#6B6E8C] dark:text-[#A6A8C4] text-sm">
              Tailored lessons, board-specific textbooks, and practice quizzes for every stage of schooling.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-4">
            {standards.map(({ std, label, subjects, color }) => (
              <Link
                key={std}
                to={`/courses?standard=${std}`}
                className="bg-[#F8F8FC] dark:bg-[#242540] border border-[#E7E7F2] dark:border-[#2E2F4A] rounded-2xl p-5 text-center group hover:bg-white dark:hover:bg-[#1B1C2E] hover:border-[#6C63F2]/40 shadow-sm hover:shadow-[0_8px_28px_rgba(34,36,58,0.08)] hover:-translate-y-1 transition-all duration-200"
              >
                <div className={`w-12 h-12 bg-gradient-to-br ${color} rounded-2xl flex items-center justify-center text-white font-display font-black text-xl mx-auto mb-3 shadow-md group-hover:scale-110 transition-transform`}>
                  {std}
                </div>
                <h3 className="font-display font-semibold text-sm text-[#22243A] dark:text-[#F4F4FA]">Standard {std}</h3>
                <p className="text-[#6B6E8C] dark:text-[#A6A8C4] text-[11px] mt-0.5">{label}</p>
                <span className="badge bg-white dark:bg-[#1B1C2E] border border-[#E7E7F2] dark:border-[#2E2F4A] text-[10px] text-[#6C63F2] dark:text-[#8B82FF] mt-2.5">
                  {subjects.length} Subjects
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Featured Courses Section */}
      {courses.length > 0 && (
        <section className="section bg-[#F8F8FC] dark:bg-[#12121F]">
          <div className="page-container">
            <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 mb-10">
              <div>
                <span className="badge-primary text-xs mb-2 inline-block">Popular Courses</span>
                <h2 className="font-display font-bold text-3xl text-[#22243A] dark:text-[#F4F4FA]">
                  Top Courses to Boost Your <span className="gradient-text">Grades</span>
                </h2>
                <p className="text-[#6B6E8C] dark:text-[#A6A8C4] text-sm mt-1">
                  High-rated video tutorials, homework practice worksheets, and notes.
                </p>
              </div>
              <Link to="/courses" className="btn-secondary text-sm py-2 px-4 self-start sm:self-auto">
                Explore All Courses
              </Link>
            </div>

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {courses.map(course => (
                <Link
                  key={course._id}
                  to={`/courses/${course._id}`}
                  className="bg-white dark:bg-[#1B1C2E] border border-[#E7E7F2] dark:border-[#2E2F4A] rounded-2xl overflow-hidden shadow-[0_4px_20px_rgba(34,36,58,0.06)] hover:shadow-[0_8px_28px_rgba(34,36,58,0.10)] hover:-translate-y-1 transition-all duration-200 group flex flex-col"
                >
                  <div className="aspect-video w-full overflow-hidden relative bg-[#F1F1FA] dark:bg-[#242540]">
                    <img
                      src={getCourseThumbnail(course)}
                      alt={course.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      onError={e => { (e.target as HTMLImageElement).src = getCourseThumbnail(course); }}
                    />
                    <div className="absolute top-3 left-3">
                      <span className={`badge ${getSubjectBadgeClass(course.subject)} text-xs shadow-sm`}>
                        {course.subject}
                      </span>
                    </div>
                    <div className="absolute top-3 right-3">
                      {course.isFree ? (
                        <span className="badge-free text-xs shadow-sm">FREE</span>
                      ) : (
                        <span className="badge-paid text-xs shadow-sm">₹{course.price}</span>
                      )}
                    </div>
                  </div>

                  <div className="p-5 flex-1 flex flex-col justify-between">
                    <div>
                      <span className="text-[11px] font-semibold text-[#6C63F2] dark:text-[#8B82FF]">Std {course.standard}</span>
                      <h3 className="font-display font-semibold text-base text-[#22243A] dark:text-[#F4F4FA] leading-snug mt-1 line-clamp-2 group-hover:text-[#6C63F2] dark:group-hover:text-[#8B82FF] transition-colors">
                        {course.title}
                      </h3>
                    </div>

                    <div className="flex items-center justify-between text-xs text-[#6B6E8C] dark:text-[#A6A8C4] pt-4 mt-3 border-t border-[#E7E7F2] dark:border-[#2E2F4A]">
                      <div className="flex items-center gap-1">
                        <Star className="w-3.5 h-3.5 text-[#FFC24B] fill-[#FFC24B]" />
                        <span className="font-semibold text-[#22243A] dark:text-[#F4F4FA]">{course.rating}</span>
                        <span>({course.totalRatings || 24})</span>
                      </div>
                      <span>{course.totalLectures} lectures</span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Why Choose Learniq Features */}
      <section className="section bg-white dark:bg-[#1B1C2E] border-t border-[#E7E7F2] dark:border-[#2E2F4A]">
        <div className="page-container">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="badge-primary text-xs mb-2 inline-block">Built for School Learners</span>
            <h2 className="font-display font-bold text-3xl sm:text-4xl text-[#22243A] dark:text-[#F4F4FA] mb-3">
              Why Students & Parents Love <span className="gradient-text">Learniq</span>
            </h2>
            <p className="text-[#6B6E8C] dark:text-[#A6A8C4] text-sm">
              Pedagogically designed tools that turn passive reading into active, confident understanding.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map(({ icon: Icon, title, desc, bg }) => (
              <div
                key={title}
                className="bg-[#F8F8FC] dark:bg-[#242540] border border-[#E7E7F2] dark:border-[#2E2F4A] rounded-2xl p-6 hover:bg-white dark:hover:bg-[#1B1C2E] hover:border-[#6C63F2]/40 shadow-sm hover:shadow-[0_8px_28px_rgba(34,36,58,0.06)] hover:-translate-y-1 transition-all duration-200"
              >
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-4 ${bg} shadow-sm`}>
                  <Icon className="w-6 h-6" />
                </div>
                <h3 className="font-display font-bold text-lg text-[#22243A] dark:text-[#F4F4FA] mb-2">{title}</h3>
                <p className="text-sm text-[#6B6E8C] dark:text-[#A6A8C4] leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="section bg-[#F8F8FC] dark:bg-[#12121F] border-t border-[#E7E7F2] dark:border-[#2E2F4A]">
        <div className="page-container">
          <div className="text-center max-w-2xl mx-auto mb-12">
            <span className="badge-primary text-xs mb-2 inline-block">Real Feedback</span>
            <h2 className="font-display font-bold text-3xl text-[#22243A] dark:text-[#F4F4FA] mb-3">
              Stories from our <span className="gradient-text">Classrooms</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map(({ name, std, text, avatar }) => (
              <div
                key={name}
                className="bg-white dark:bg-[#1B1C2E] border border-[#E7E7F2] dark:border-[#2E2F4A] rounded-2xl p-6 shadow-[0_4px_20px_rgba(34,36,58,0.06)] flex flex-col justify-between"
              >
                <p className="text-sm text-[#6B6E8C] dark:text-[#A6A8C4] leading-relaxed mb-6 italic">"{text}"</p>
                <div className="flex items-center gap-3 pt-4 border-t border-[#E7E7F2] dark:border-[#2E2F4A]">
                  <img src={avatar} alt={name} className="w-10 h-10 rounded-full object-cover border border-[#E7E7F2]" />
                  <div>
                    <p className="text-sm font-display font-bold text-[#22243A] dark:text-[#F4F4FA]">{name}</p>
                    <p className="text-xs text-[#6B6E8C] dark:text-[#A6A8C4]">{std}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA Footer Banner */}
      <section className="section bg-white dark:bg-[#1B1C2E] border-t border-[#E7E7F2] dark:border-[#2E2F4A]">
        <div className="page-container text-center max-w-3xl mx-auto">
          <span className="badge-primary text-xs mb-3 inline-block">Get Started Today</span>
          <h2 className="font-display font-black text-3xl sm:text-5xl text-[#22243A] dark:text-[#F4F4FA] mb-4">
            Give Your Child the <span className="gradient-text">Learniq Advantage</span>
          </h2>
          <p className="text-base text-[#6B6E8C] dark:text-[#A6A8C4] mb-8 max-w-xl mx-auto">
            Join thousands of Indian school students preparing for exams with confidence.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Link to="/register" className="btn-primary rounded-full px-8 py-3.5 text-base font-bold shadow-lg">
              Enroll Free Now
            </Link>
            <Link to="/contact" className="btn-secondary rounded-full px-8 py-3.5 text-base font-semibold">
              Talk to an Academic Counselor
            </Link>
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default HomePage;

import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Play, BookOpen, Users, Star, ArrowRight, Zap, Award, TrendingUp, Clock, CheckCircle, Radio, Brain } from 'lucide-react';
import Navbar from '../components/layout/Navbar';
import Footer from '../components/layout/Footer';
import api from '../services/api';
import { Course } from '../types';

const stats = [
  { label: 'Students', value: '10,000+', icon: Users },
  { label: 'Live Sessions', value: '500+', icon: Radio },
  { label: 'Courses', value: '200+', icon: BookOpen },
  { label: 'Expert Teachers', value: '50+', icon: Award },
];

const features = [
  { icon: Radio, title: 'Live Interactive Classes', desc: 'Join real-time classes with your teacher. Ask questions, participate in polls, and learn together.', color: 'from-red-500 to-orange-500' },
  { icon: Brain, title: 'Smart Quizzes & Tests', desc: 'Live quiz battles with real-time scoreboards. See where you rank among classmates instantly!', color: 'from-primary-500 to-purple-500' },
  { icon: BookOpen, title: 'Standard-wise Content', desc: 'Perfectly organized content for Standards 1-10. Find exactly what you need for your grade.', color: 'from-accent-500 to-green-500' },
  { icon: TrendingUp, title: 'Progress Tracking', desc: 'Visual dashboards showing your learning journey, quiz scores, and course completions.', color: 'from-secondary-500 to-pink-500' },
  { icon: Zap, title: 'Instant Results', desc: 'Get quiz results the moment you submit. Detailed analysis shows what to improve.', color: 'from-yellow-500 to-orange-500' },
  { icon: Award, title: 'Badges & Points', desc: 'Earn badges and points as you learn. Gamified experience that keeps you motivated.', color: 'from-blue-500 to-cyan-500' },
];

const testimonials = [
  { name: 'Aryan Patel', std: 'Standard 10', text: 'The live quiz feature is amazing! I love competing with classmates and seeing the scoreboard appear after each quiz.', avatar: 'https://ui-avatars.com/api/?name=Aryan+Patel&background=6C63FF&color=fff' },
  { name: 'Priya Sharma', std: 'Standard 8', text: 'My math scores improved from 60% to 90% in just 2 months. The recorded lectures are so easy to understand.', avatar: 'https://ui-avatars.com/api/?name=Priya+Sharma&background=FF6584&color=fff' },
  { name: 'Rohan Kumar', std: 'Standard 5', text: 'I love how I can watch any lecture again if I miss something. The notes are also very helpful for revision.', avatar: 'https://ui-avatars.com/api/?name=Rohan+Kumar&background=43C6AC&color=fff' },
];

const standards = Array.from({ length: 10 }, (_, i) => ({
  std: i + 1,
  label: i + 1 <= 3 ? 'Primary' : i + 1 <= 7 ? 'Middle' : 'Secondary',
  subjects: i + 1 <= 4 ? ['Maths', 'English', 'EVS', 'Marathi'] : ['Maths', 'Science', 'English', 'SST', 'Marathi'],
  color: ['from-pink-500 to-rose-500', 'from-orange-500 to-amber-500', 'from-yellow-500 to-lime-500', 'from-green-500 to-emerald-500',
    'from-teal-500 to-cyan-500', 'from-blue-500 to-sky-500', 'from-indigo-500 to-violet-500', 'from-purple-500 to-fuchsia-500',
    'from-pink-600 to-rose-600', 'from-primary-500 to-secondary-500'][i],
}));

const HomePage: React.FC = () => {
  const [courses, setCourses] = useState<Course[]>([]);

  useEffect(() => {
    api.get('/courses?limit=6').then(r => setCourses(r.data.courses?.slice(0, 6) || [])).catch(() => {});
  }, []);

  return (
    <div className="min-h-screen">
      <Navbar />

      {/* Hero Section */}
      <section className="relative min-h-screen flex items-center bg-hero-gradient overflow-hidden">
        {/* Background effects */}
        <div className="absolute inset-0">
          <div className="absolute top-20 left-10 w-72 h-72 bg-primary-500/20 rounded-full blur-3xl animate-pulse-slow" />
          <div className="absolute bottom-20 right-10 w-96 h-96 bg-secondary-500/15 rounded-full blur-3xl animate-pulse-slow" style={{ animationDelay: '1s' }} />
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-primary-900/20 rounded-full blur-3xl" />
          {/* Grid pattern */}
          <div className="absolute inset-0 opacity-5"
            style={{ backgroundImage: 'linear-gradient(rgba(108,99,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(108,99,255,0.5) 1px, transparent 1px)', backgroundSize: '60px 60px' }} />
        </div>

        <div className="page-container relative z-10 pt-28 pb-20">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div className="animate-slide-up">
              {/* Tag */}
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary-500/10 border border-primary-500/30 rounded-full mb-6">
                <div className="w-2 h-2 rounded-full bg-primary-400 animate-pulse" />
                <span className="text-primary-300 text-sm font-medium">India's #1 School EdTech Platform</span>
              </div>

              <h1 className="font-display font-black text-5xl lg:text-7xl leading-none mb-6">
                <span className="text-white">Learn</span>
                <br />
                <span className="gradient-text">Smarter.</span>
                <br />
                <span className="text-white">Grow</span>
                <span className="text-white"> </span>
                <span className="gradient-text">Better.</span>
              </h1>

              <p className="text-white/60 text-lg leading-relaxed mb-8 max-w-lg">
                Join live classes, watch recorded lectures, compete in live quizzes, and track your progress.
                For students from <strong className="text-white">Standard 1 to 10</strong>.
              </p>

              <div className="flex flex-wrap gap-4 mb-12">
                <Link to="/register" className="btn-primary flex items-center gap-2 text-base px-8 py-4">
                  Start Learning Free <ArrowRight className="w-5 h-5" />
                </Link>
                <Link to="/live-sessions" className="flex items-center gap-2 px-8 py-4 border border-white/20 rounded-xl text-white/80 hover:bg-white/10 hover:text-white transition-all font-semibold">
                  <Radio className="w-5 h-5 text-red-400" /> Join Live Class
                </Link>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {stats.map(({ label, value, icon: Icon }) => (
                  <div key={label} className="text-center">
                    <p className="font-display font-bold text-2xl gradient-text">{value}</p>
                    <p className="text-white/40 text-xs mt-1">{label}</p>
                  </div>
                ))}
              </div>
            </div>

            {/* Hero Illustration */}
            <div className="hidden lg:block animate-fade-in">
              <div className="relative">
                {/* Main card */}
                <div className="glass-card p-6 glow-primary">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-3 h-3 rounded-full bg-red-500" />
                    <div className="w-3 h-3 rounded-full bg-yellow-500" />
                    <div className="w-3 h-3 rounded-full bg-green-500" />
                    <span className="ml-2 text-white/40 text-sm">Live Class - Trigonometry</span>
                  </div>
                  <div className="bg-gradient-to-br from-dark-700 to-dark-800 rounded-xl p-4 mb-4 aspect-video flex items-center justify-center">
                    <div className="text-center">
                      <div className="w-16 h-16 bg-primary-500/20 rounded-full flex items-center justify-center mx-auto mb-3">
                        <Play className="w-8 h-8 text-primary-400" />
                      </div>
                      <p className="text-white/60 text-sm">sin²θ + cos²θ = 1</p>
                      <p className="text-white/30 text-xs mt-1">Trigonometry - Standard 10</p>
                    </div>
                  </div>
                  {/* Live students */}
                  <div className="flex items-center justify-between">
                    <div className="flex -space-x-2">
                      {['#6C63FF','#FF6584','#43C6AC','#F39C12','#E74C3C'].map((c, i) => (
                        <div key={i} className="w-7 h-7 rounded-full border-2 border-dark-800" style={{ backgroundColor: c }} />
                      ))}
                      <div className="w-7 h-7 rounded-full border-2 border-dark-800 bg-white/10 flex items-center justify-center text-xs text-white/60">+42</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="live-dot" />
                      <span className="text-xs text-red-400 font-medium">LIVE</span>
                    </div>
                  </div>
                </div>

                {/* Floating quiz card */}
                <div className="absolute -bottom-8 -left-8 glass-card p-4 w-52 animate-float">
                  <p className="text-xs text-white/50 mb-2">🏆 Live Quiz Results</p>
                  {[
                    { name: 'Aryan S.', score: '9/10', pos: 1 },
                    { name: 'Priya M.', score: '8/10', pos: 2 },
                    { name: 'Rohan K.', score: '8/10', pos: 3 },
                  ].map(({ name, score, pos }) => (
                    <div key={pos} className="flex items-center gap-2 py-1">
                      <span className={`text-xs font-bold w-4 ${pos === 1 ? 'text-yellow-400' : pos === 2 ? 'text-gray-300' : 'text-amber-600'}`}>#{pos}</span>
                      <span className="text-xs text-white/80 flex-1">{name}</span>
                      <span className="text-xs font-semibold text-accent-400">{score}</span>
                    </div>
                  ))}
                </div>

                {/* Badge card */}
                <div className="absolute -top-6 -right-6 glass-card p-3 animate-bounce-in" style={{ animationDelay: '0.5s' }}>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🏆</span>
                    <div>
                      <p className="text-xs font-semibold text-white">Quiz Master</p>
                      <p className="text-xs text-white/40">+50 pts earned</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Wave */}
        <div className="absolute bottom-0 left-0 right-0">
          <svg viewBox="0 0 1440 80" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M0 80L48 74.7C96 69.3 192 58.7 288 53.3C384 48 480 48 576 53.3C672 58.7 768 69.3 864 69.3C960 69.3 1056 58.7 1152 53.3C1248 48 1344 48 1392 48H1440V80H1392C1344 80 1248 80 1152 80C1056 80 960 80 864 80C768 80 672 80 576 80C480 80 384 80 288 80C192 80 96 80 48 80H0Z" fill="#0a0a0f" />
          </svg>
        </div>
      </section>

      {/* Standards Section */}
      <section className="section bg-dark-900">
        <div className="page-container">
          <div className="text-center mb-12">
            <h2 className="font-display font-bold text-3xl md:text-4xl text-white mb-4">
              Choose Your <span className="gradient-text">Standard</span>
            </h2>
            <p className="text-white/50 max-w-lg mx-auto">
              From basic counting to board exam preparation — we have content for every grade.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
            {standards.map(({ std, label, subjects, color }) => (
              <Link
                key={std}
                to={`/courses?standard=${std}`}
                className="glass-card-hover p-5 text-center group"
              >
                <div className={`w-12 h-12 bg-gradient-to-br ${color} rounded-2xl flex items-center justify-center text-white font-display font-black text-xl mx-auto mb-3 group-hover:scale-110 transition-transform`}>
                  {std}
                </div>
                <p className="text-white font-semibold text-sm mb-1">Standard {std}</p>
                <p className="text-white/40 text-xs">{label}</p>
                <p className="text-white/30 text-xs mt-1">{subjects.length} subjects</p>
              </Link>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="section bg-dark-800">
        <div className="page-container">
          <div className="text-center mb-12">
            <h2 className="font-display font-bold text-3xl md:text-4xl text-white mb-4">
              Why Choose <span className="gradient-text">Learniq?</span>
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map(({ icon: Icon, title, desc, color }) => (
              <div key={title} className="glass-card-hover p-6 group">
                <div className={`w-12 h-12 bg-gradient-to-br ${color} rounded-2xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform shadow-lg`}>
                  <Icon className="w-6 h-6 text-white" />
                </div>
                <h3 className="font-semibold text-white text-lg mb-2">{title}</h3>
                <p className="text-white/50 text-sm leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Popular Courses */}
      {courses.length > 0 && (
        <section className="section bg-dark-900">
          <div className="page-container">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="font-display font-bold text-3xl text-white mb-2">Popular <span className="gradient-text">Courses</span></h2>
                <p className="text-white/50 text-sm">Explore our most loved courses</p>
              </div>
              <Link to="/courses" className="btn-outline text-sm py-2">View All</Link>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {courses.map(course => (
                <Link key={course._id} to={`/courses/${course._id}`} className="course-card group">
                  <div className="relative">
                    <img
                      src={course.thumbnail || `https://picsum.photos/seed/${course._id}/400/225`}
                      alt={course.title}
                      className="w-full aspect-video object-cover"
                      onError={e => { (e.target as HTMLImageElement).src = 'https://picsum.photos/400/225'; }}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-dark-900/80 to-transparent" />
                    <div className="absolute top-3 left-3">
                      {course.isFree ? (
                        <span className="badge-free">FREE</span>
                      ) : (
                        <span className="badge-paid">₹{course.price}</span>
                      )}
                    </div>
                    <div className="absolute bottom-3 right-3 flex items-center gap-1 text-white/80 text-xs">
                      <BookOpen className="w-3.5 h-3.5" /> {course.totalLectures} lectures
                    </div>
                  </div>
                  <div className="p-5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="badge-primary text-xs">{course.subject}</span>
                      <span className="text-white/30 text-xs">Std {course.standard}</span>
                    </div>
                    <h3 className="font-semibold text-white text-sm leading-snug mb-3 line-clamp-2 group-hover:text-primary-300 transition-colors">
                      {course.title}
                    </h3>
                    {course.teacher && (
                      <div className="flex items-center gap-2">
                        <img
                          src={(course.teacher as any).avatar || `https://ui-avatars.com/api/?name=${encodeURIComponent((course.teacher as any).name || '')}&background=6C63FF&color=fff&size=32`}
                          alt={(course.teacher as any).name}
                          className="w-6 h-6 rounded-full object-cover"
                        />
                        <span className="text-white/50 text-xs">{(course.teacher as any).name}</span>
                        <div className="ml-auto flex items-center gap-1">
                          <Star className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />
                          <span className="text-white/60 text-xs">{course.rating}</span>
                        </div>
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Live Learning CTA */}
      <section className="section bg-dark-800">
        <div className="page-container">
          <div className="glass-card p-8 md:p-12 relative overflow-hidden">
            <div className="absolute top-0 right-0 w-96 h-96 bg-primary-500/10 rounded-full blur-3xl" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-secondary-500/10 rounded-full blur-3xl" />
            <div className="relative z-10 flex flex-col md:flex-row items-center justify-between gap-8">
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <div className="live-dot" />
                  <span className="text-red-400 text-sm font-medium">LIVE NOW</span>
                </div>
                <h2 className="font-display font-bold text-3xl md:text-4xl text-white mb-3">
                  Join a Live Class <span className="gradient-text">Right Now</span>
                </h2>
                <p className="text-white/50 max-w-lg">
                  Experience interactive learning with real teachers. Ask questions, solve quizzes live, and compete with classmates!
                </p>
              </div>
              <div className="flex-shrink-0 flex gap-4">
                <Link to="/live-sessions" className="btn-secondary flex items-center gap-2">
                  <Radio className="w-5 h-5" /> Browse Live Classes
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section className="section bg-dark-900">
        <div className="page-container">
          <div className="text-center mb-12">
            <h2 className="font-display font-bold text-3xl md:text-4xl text-white mb-4">
              How <span className="gradient-text">It Works</span>
            </h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { step: '01', title: 'Register & Login', desc: 'Create your free account in seconds with just your email.', icon: Users },
              { step: '02', title: 'Choose Your Standard', desc: 'Select your grade from Standard 1 to 10.', icon: BookOpen },
              { step: '03', title: 'Browse & Learn', desc: 'Access courses, watch lectures, and join live classes.', icon: Play },
              { step: '04', title: 'Quiz & Track Progress', desc: 'Test your knowledge and track improvements on your dashboard.', icon: TrendingUp },
            ].map(({ step, title, desc, icon: Icon }) => (
              <div key={step} className="text-center group">
                <div className="relative inline-flex mb-5">
                  <div className="w-16 h-16 bg-gradient-to-br from-primary-500 to-secondary-500 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform shadow-lg shadow-primary-500/30">
                    <Icon className="w-7 h-7 text-white" />
                  </div>
                  <span className="absolute -top-2 -right-2 w-6 h-6 bg-dark-800 border border-primary-500/50 rounded-full text-xs font-bold text-primary-400 flex items-center justify-center">
                    {step.slice(1)}
                  </span>
                </div>
                <h3 className="font-semibold text-white mb-2">{title}</h3>
                <p className="text-white/50 text-sm">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Testimonials */}
      <section className="section bg-dark-800">
        <div className="page-container">
          <div className="text-center mb-12">
            <h2 className="font-display font-bold text-3xl md:text-4xl text-white mb-4">
              What Students <span className="gradient-text">Say</span>
            </h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {testimonials.map(({ name, std, text, avatar }) => (
              <div key={name} className="glass-card p-6">
                <div className="flex items-center gap-3 mb-4">
                  <img src={avatar} alt={name} className="w-10 h-10 rounded-full" />
                  <div>
                    <p className="text-white font-semibold text-sm">{name}</p>
                    <p className="text-white/40 text-xs">{std}</p>
                  </div>
                  <div className="ml-auto flex">
                    {[...Array(5)].map((_, i) => <Star key={i} className="w-3.5 h-3.5 text-yellow-400 fill-yellow-400" />)}
                  </div>
                </div>
                <p className="text-white/60 text-sm leading-relaxed">"{text}"</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="section bg-gradient-to-br from-primary-900/50 to-dark-900">
        <div className="page-container text-center">
          <h2 className="font-display font-black text-4xl md:text-5xl text-white mb-4">
            Start Your <span className="gradient-text">Learning Journey</span>
          </h2>
          <p className="text-white/50 text-lg mb-8 max-w-xl mx-auto">
            Join thousands of students learning with Learniq. Free to get started.
          </p>
          <div className="flex flex-wrap gap-4 justify-center">
            <Link to="/register" className="btn-primary text-base px-10 py-4 flex items-center gap-2">
              Get Started Free <ArrowRight className="w-5 h-5" />
            </Link>
            <Link to="/courses" className="btn-outline text-base px-10 py-4">
              Browse Courses
            </Link>
          </div>
          <div className="flex items-center justify-center gap-6 mt-8">
            {['Free to join', 'No credit card', 'Cancel anytime'].map(t => (
              <div key={t} className="flex items-center gap-1.5 text-white/40 text-sm">
                <CheckCircle className="w-4 h-4 text-accent-500" /> {t}
              </div>
            ))}
          </div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default HomePage;

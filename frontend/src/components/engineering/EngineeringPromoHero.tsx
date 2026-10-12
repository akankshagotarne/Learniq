import React from 'react';
import { Link } from 'react-router-dom';
import {
  CalendarDays,
  Clock,
  Award,
  CheckCircle2,
  ArrowRight,
  Laptop,
  Sparkles,
  Cpu,
  ShieldCheck,
  FileText,
  Code2,
} from 'lucide-react';

/**
 * EngineeringPromoHero
 *
 * Promotional hero banner for the LearnIQ Engineering Online Mock Test (13 October 2026).
 * Positioned on the landing page directly under the fixed navbar.
 *
 * Displays:
 *  - Left: Headline, supporting text, examination badges (Date, 40 MCQs, 40 Marks, 45 Mins, FREE, Online),
 *          syllabus category pills (Java, Python, C++, OOP, DBMS, OS, DSA, Aptitude),
 *          and prominent CTAs navigating to `/student/engineering`.
 *  - Right: Clean portrait container presenting the official LearnIQ Engineering Online Test poster
 *           with preserved aspect ratio, sharp rendering, and no distortion.
 */

const SYLLABUS_TOPICS = [
  { name: 'Java', badge: 'J', color: 'bg-[#6C63F2]/10 text-[#6C63F2] dark:bg-[#6C63F2]/20 dark:text-[#C4ADFF]' },
  { name: 'Python', badge: 'Py', color: 'bg-[#0284C7]/10 text-[#0284C7] dark:bg-[#0284C7]/20 dark:text-[#70D1FF]' },
  { name: 'C++', badge: 'C++', color: 'bg-[#059669]/10 text-[#059669] dark:bg-[#059669]/20 dark:text-[#5CE6A8]' },
  { name: 'OOP', badge: 'OOP', color: 'bg-[#7C3AED]/10 text-[#7C3AED] dark:bg-[#7C3AED]/20 dark:text-[#D8B4FE]' },
  { name: 'DBMS', badge: 'DB', color: 'bg-[#D97706]/10 text-[#D97706] dark:bg-[#D97706]/20 dark:text-[#FCD34D]' },
  { name: 'OS', badge: 'OS', color: 'bg-[#DC2626]/10 text-[#DC2626] dark:bg-[#DC2626]/20 dark:text-[#FCA5A5]' },
  { name: 'DSA', badge: 'DS', color: 'bg-[#2563EB]/10 text-[#2563EB] dark:bg-[#2563EB]/20 dark:text-[#93C5FD]' },
  { name: 'Aptitude', badge: '%', color: 'bg-[#E11D48]/10 text-[#E11D48] dark:bg-[#E11D48]/20 dark:text-[#FDA4AF]' },
];

const EXAM_CARDS = [
  {
    icon: CalendarDays,
    label: 'EXAM DATE',
    value: '13 October 2026',
    highlight: false,
  },
  {
    icon: FileText,
    label: 'QUESTIONS',
    value: '40 MCQs',
    highlight: false,
  },
  {
    icon: Award,
    label: 'MAXIMUM MARKS',
    value: '40 Marks',
    highlight: false,
  },
  {
    icon: Clock,
    label: 'DURATION',
    value: '45 Minutes',
    highlight: false,
  },
  {
    icon: Sparkles,
    label: 'EXAM FEE',
    value: 'FREE (₹0)',
    highlight: true,
  },
  {
    icon: Laptop,
    label: 'MODE',
    value: 'Online',
    highlight: false,
  },
];

export const EngineeringPromoHero: React.FC = () => {
  return (
    <section
      aria-label="Engineering Online Test Promotion"
      className="relative overflow-hidden bg-[#F8F8FC] dark:bg-[#12121F] text-[#22243A] dark:text-[#F4F4FA] transition-colors"
    >
      {/* Soft ambient background glows */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden="true">
        <div className="absolute -top-16 left-1/4 w-[500px] h-[500px] bg-[#6C63F2]/10 dark:bg-[#8B82FF]/15 rounded-full blur-3xl animate-pulse-slow" />
        <div
          className="absolute top-1/3 -right-20 w-[450px] h-[450px] bg-[#FF8FA3]/10 dark:bg-[#FF8FA3]/10 rounded-full blur-3xl animate-pulse-slow"
          style={{ animationDelay: '1.8s' }}
        />
        <div className="absolute -bottom-10 left-10 w-[400px] h-[400px] bg-[#5AC8FA]/10 dark:bg-[#5AC8FA]/10 rounded-full blur-3xl" />
      </div>

      {/* Main hero wrapper with fixed navbar clearance */}
      <div className="page-container relative z-10 pt-[80px] sm:pt-[92px] pb-8 sm:pb-12">
        {/* Outer card shell with subtle glassmorphic outline */}
        <div className="relative rounded-3xl sm:rounded-[32px] bg-white/70 dark:bg-[#1A1A2E]/70 backdrop-blur-md border border-[#E7E7F2] dark:border-[#2E2F4A] p-5 sm:p-8 lg:p-10 shadow-[0_12px_45px_rgba(108,99,242,0.08)] dark:shadow-[0_12px_45px_rgba(0,0,0,0.4)]">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
            {/* LEFT AREA: Engineering Test Details */}
            <div className="lg:col-span-7 flex flex-col justify-center space-y-6">
              {/* Category Pill Badges */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#EDE9FE] dark:bg-[#6C63F2]/20 border border-[#B69CF2]/40 text-[#6C63F2] dark:text-[#C4ADFF] text-xs font-bold uppercase tracking-wider">
                  <Cpu className="w-3.5 h-3.5" />
                  <span>LearnIQ Presents</span>
                  <span className="w-1.5 h-1.5 rounded-full bg-[#6C63F2] dark:bg-[#C4ADFF] animate-pulse" />
                  <span>For Engineering Students</span>
                </div>

                <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 text-xs font-bold">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>100% Free · No Charges</span>
                </span>
              </div>

              {/* Headline */}
              <div>
                <h1 className="font-display font-black text-3xl sm:text-5xl lg:text-[2.85rem] xl:text-[3.25rem] leading-[1.12] text-[#22243A] dark:text-[#F4F4FA] tracking-tight">
                  Online Test for{' '}
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#6C63F2] via-[#8B82FF] to-[#FF8FA3]">
                    Engineering Students
                  </span>
                </h1>
                <p className="mt-3 text-base sm:text-lg font-semibold text-[#6C63F2] dark:text-[#A6A8C4] tracking-wide">
                  Test Your Skills. Know Your Level. Boost Your Confidence.
                </p>
                <p className="mt-1 text-xs sm:text-sm text-[#6B6E8C] dark:text-[#8E90B0] max-w-xl leading-relaxed">
                  Comprehensive mock test designed for B.E. / B.Tech students. Practice industry-standard MCQs across core CS/IT & Engineering domains with instant results.
                </p>
              </div>

              {/* Information Badges / Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 pt-1">
                {EXAM_CARDS.map(({ icon: Icon, label, value, highlight }) => (
                  <div
                    key={label}
                    className={`rounded-2xl p-3 border transition-all ${
                      highlight
                        ? 'bg-gradient-to-br from-[#6C63F2]/10 to-[#8B82FF]/10 border-[#6C63F2]/30 dark:border-[#8B82FF]/40 shadow-sm'
                        : 'bg-white/90 dark:bg-[#202136]/90 border-[#E7E7F2] dark:border-[#2E2F4A]'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-[11px] font-bold tracking-wider text-[#6B6E8C] dark:text-[#8E90B0]">
                      <Icon className={`w-3.5 h-3.5 ${highlight ? 'text-[#6C63F2] dark:text-[#8B82FF]' : 'text-[#6C63F2]/80'}`} />
                      <span>{label}</span>
                    </div>
                    <p
                      className={`font-display font-black text-sm sm:text-base mt-1 ${
                        highlight
                          ? 'text-[#6C63F2] dark:text-[#A6A8C4]'
                          : 'text-[#22243A] dark:text-[#F4F4FA]'
                      }`}
                    >
                      {value}
                    </p>
                  </div>
                ))}
              </div>

              {/* Syllabus Overview */}
              <div className="pt-1">
                <div className="flex items-center gap-2 mb-2">
                  <Code2 className="w-4 h-4 text-[#6C63F2] dark:text-[#8B82FF]" />
                  <span className="text-xs font-bold tracking-wider uppercase text-[#6B6E8C] dark:text-[#8E90B0]">
                    Syllabus Covered:
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                  {SYLLABUS_TOPICS.map(topic => (
                    <span
                      key={topic.name}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl text-xs font-semibold border border-transparent dark:border-[#2E2F4A]/50 ${topic.color}`}
                    >
                      <span className="w-4 h-4 rounded-full bg-white/60 dark:bg-black/20 flex items-center justify-center text-[10px] font-bold">
                        {topic.badge}
                      </span>
                      <span>{topic.name}</span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Call-to-Action Buttons */}
              <div className="pt-2 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                <Link
                  to="/student/engineering"
                  className="btn-primary rounded-full px-7 py-3.5 sm:px-8 sm:py-4 text-sm sm:text-base font-bold shadow-[0_6px_22px_rgba(108,99,242,0.32)] hover:shadow-[0_10px_28px_rgba(108,99,242,0.45)] flex items-center justify-center gap-2 group transition-all"
                  aria-label="Explore Engineering Test - Register or start mock exam"
                >
                  <span>Explore Engineering Test</span>
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                </Link>

                <Link
                  to="/student/engineering"
                  className="btn-secondary rounded-full px-6 py-3.5 sm:px-7 sm:py-4 text-sm sm:text-base font-semibold border-[#E7E7F2] dark:border-[#2E2F4A] hover:border-[#6C63F2]/40 text-[#6C63F2] dark:text-[#8B82FF] flex items-center justify-center gap-2 transition-all"
                  aria-label="Request to Join Engineering Examination"
                >
                  <span>Request to Join</span>
                </Link>
              </div>

              {/* Trust & Policy Note */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[#6B6E8C] dark:text-[#8E90B0]">
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>No negative marking</span>
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Open to all engineering branches</span>
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span>Deadline: 13 Oct 2026, 6:00 PM IST</span>
                </span>
              </div>
            </div>

            {/* RIGHT AREA: Engineering Test Poster */}
            <div className="lg:col-span-5 flex justify-center items-center">
              <div className="relative group w-full max-w-[360px] sm:max-w-[400px] lg:max-w-[420px]">
                {/* Ambient glow behind poster */}
                <div
                  className="absolute -inset-2 rounded-[32px] bg-gradient-to-r from-[#6C63F2]/30 via-[#5AC8FA]/20 to-[#FF8FA3]/25 blur-xl opacity-75 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"
                  aria-hidden="true"
                />

                {/* Poster container with soft border & shadow */}
                <div className="relative rounded-2xl sm:rounded-3xl overflow-hidden bg-white dark:bg-[#1A1A2E] border border-[#E7E7F2] dark:border-[#2E2F4A] shadow-[0_12px_40px_rgba(34,36,58,0.12)] dark:shadow-[0_16px_50px_rgba(0,0,0,0.5)]">
                  <Link
                    to="/student/engineering"
                    className="block relative focus:outline-none focus:ring-4 focus:ring-[#6C63F2]/40 rounded-2xl sm:rounded-3xl overflow-hidden"
                    title="Click to explore the Engineering Test portal"
                    aria-label="LearnIQ Engineering Online Test poster for 13 October 2026. Click to enter Engineering Portal."
                  >
                    <img
                      src="/assets/brand/engineering-test-poster.png"
                      alt="LearnIQ Engineering Online Test poster for 13 October 2026."
                      width={682}
                      height={1024}
                      loading="eager"
                      fetchPriority="high"
                      decoding="async"
                      className="w-full h-auto object-contain transition-transform duration-300 group-hover:scale-[1.01]"
                    />

                    {/* Subtle interactive hover banner at bottom */}
                    <div className="absolute inset-x-0 bottom-0 py-2.5 px-4 bg-gradient-to-t from-[#12121F]/90 via-[#12121F]/60 to-transparent flex items-center justify-between opacity-95 group-hover:opacity-100 transition-opacity">
                      <span className="text-white text-xs font-semibold flex items-center gap-1.5">
                        <Sparkles className="w-3.5 h-3.5 text-[#FFC24B]" />
                        <span>Online Test · 13 Oct 2026</span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold text-white/90 bg-white/20 backdrop-blur-sm px-2 py-0.5 rounded-full">
                        <span>Enter Portal</span>
                        <ArrowRight className="w-3 h-3" />
                      </span>
                    </div>
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default EngineeringPromoHero;

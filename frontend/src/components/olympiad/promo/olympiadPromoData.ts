import type { LucideIcon } from 'lucide-react';
import { Atom, BookOpen, Brain, Calculator, FlaskConical, Globe, Leaf, Lightbulb, Trophy } from 'lucide-react';

import poster1 from '../../../assets/olympiad/test-1-std-1-3.webp';
import poster1Sm from '../../../assets/olympiad/test-1-std-1-3-640.webp';
import poster2 from '../../../assets/olympiad/test-2-std-4-6.webp';
import poster2Sm from '../../../assets/olympiad/test-2-std-4-6-640.webp';
import poster3 from '../../../assets/olympiad/test-3-std-7-8.webp';
import poster3Sm from '../../../assets/olympiad/test-3-std-7-8-640.webp';
import poster4 from '../../../assets/olympiad/test-4-std-9-10.webp';
import poster4Sm from '../../../assets/olympiad/test-4-std-9-10-640.webp';

export interface PromoSubject {
  name: string;
  icon: LucideIcon;
  /** icon tint — mirrors the subject colours used on the posters */
  tint: string;
}

export interface OlympiadPromoTest {
  id: number;
  label: string;
  /** e.g. "Standard 9th – 10th" */
  standards: string;
  /** e.g. "9th–10th" (selector shows "Std 9th–10th") */
  range: string;
  /** the standards this test is for — used to pick a logged-in student's own test */
  standardList: number[];
  tagline: string;
  motto: [string, string, string];
  subjects: PromoSubject[];
  /** number of MCQs in the paper(s) of this group (from the imported question papers) */
  questions: number;
  poster: { src: string; srcSmall: string; alt: string };
  /** dominant colour of the poster (sampled from the artwork) */
  accent: string;
  /** light background tint of the poster */
  soft: string;
}

const TINT = {
  math: '#E6399B',
  science: '#22A45D',
  english: '#F07C1B',
  reasoning: '#2F7BE5',
  achievers: '#7C3AED',
};

const commonAlt = 'Test link open on 1, 2, 3, 4 and 5 October 2026. Mode: Online. Fees: ₹20 only. Scan the QR code to register at learniq-livid.vercel.app.';

export const OLYMPIAD_PROMO_TESTS: OlympiadPromoTest[] = [
  {
    id: 1,
    label: 'Test 1',
    standards: 'Standard 1st – 3rd',
    range: '1st–3rd',
    standardList: [1, 2, 3],
    tagline: 'Little Minds… Big Dreams!',
    motto: ['Think', 'Explore', 'Achieve'],
    subjects: [
      { name: 'Mathematics', icon: Calculator, tint: TINT.math },
      { name: 'Science / EVS', icon: Leaf, tint: TINT.science },
      { name: 'English', icon: BookOpen, tint: TINT.english },
      { name: 'Logical Reasoning', icon: Brain, tint: TINT.reasoning },
      { name: 'Achievers / Higher-Order Thinking', icon: Trophy, tint: TINT.achievers },
    ],
    questions: 40,
    poster: {
      src: poster1,
      srcSmall: poster1Sm,
      alt: `LearnIQ All India Olympiad Test 2026 poster: Test 1 for Standard 1st to 3rd, "Little Minds… Big Dreams!". Subjects: Mathematics, Science / EVS, English, Logical Reasoning, Achievers / Higher-Order Thinking. ${commonAlt}`,
    },
    accent: '#00418F',
    soft: '#DDF3FB',
  },
  {
    id: 2,
    label: 'Test 2',
    standards: 'Standard 4th – 6th',
    range: '4th–6th',
    standardList: [4, 5, 6],
    tagline: 'Think Deeper… Reach Higher!',
    motto: ['Learn', 'Grow', 'Succeed'],
    subjects: [
      { name: 'Mathematics', icon: Calculator, tint: TINT.math },
      { name: 'Science', icon: FlaskConical, tint: TINT.science },
      { name: 'English', icon: BookOpen, tint: TINT.english },
      { name: 'Logical Reasoning / GK', icon: Lightbulb, tint: TINT.reasoning },
      { name: 'Achievers', icon: Trophy, tint: TINT.achievers },
    ],
    questions: 60,
    poster: {
      src: poster2,
      srcSmall: poster2Sm,
      alt: `LearnIQ All India Olympiad Test 2026 poster: Test 2 for Standard 4th to 6th, "Think Deeper… Reach Higher!". Subjects: Mathematics, Science, English, Logical Reasoning / GK, Achievers. ${commonAlt}`,
    },
    accent: '#D9490D',
    soft: '#FEF1CC',
  },
  {
    id: 3,
    label: 'Test 3',
    standards: 'Standard 7th – 8th',
    range: '7th–8th',
    standardList: [7, 8],
    tagline: 'More Knowledge… More Possibilities!',
    motto: ['Study', 'Solve', 'Excel'],
    subjects: [
      { name: 'Mathematics', icon: Calculator, tint: TINT.math },
      { name: 'Science', icon: Atom, tint: TINT.science },
      { name: 'English', icon: BookOpen, tint: TINT.english },
      { name: 'Social Science / Reasoning', icon: Globe, tint: TINT.reasoning },
      { name: 'Achievers', icon: Trophy, tint: TINT.achievers },
    ],
    questions: 60,
    poster: {
      src: poster3,
      srcSmall: poster3Sm,
      alt: `LearnIQ All India Olympiad Test 2026 poster: Test 3 for Standard 7th to 8th, "More Knowledge… More Possibilities!". Subjects: Mathematics, Science, English, Social Science / Reasoning, Achievers. ${commonAlt}`,
    },
    accent: '#591199',
    soft: '#EEE0FD',
  },
  {
    id: 4,
    label: 'Test 4',
    standards: 'Standard 9th – 10th',
    range: '9th–10th',
    standardList: [9, 10],
    tagline: 'Be Better… Be Stronger!',
    motto: ['Plan', 'Prepare', 'Perform'],
    subjects: [
      { name: 'Mathematics', icon: Calculator, tint: TINT.math },
      { name: 'Science', icon: FlaskConical, tint: TINT.science },
      { name: 'English', icon: BookOpen, tint: TINT.english },
      { name: 'Social Science / Reasoning', icon: Globe, tint: TINT.reasoning },
      { name: 'Achievers', icon: Trophy, tint: TINT.achievers },
    ],
    questions: 60,
    poster: {
      src: poster4,
      srcSmall: poster4Sm,
      alt: `LearnIQ All India Olympiad Test 2026 poster: Test 4 for Standard 9th to 10th, "Be Better… Be Stronger!". Subjects: Mathematics, Science, English, Social Science / Reasoning, Achievers. ${commonAlt}`,
    },
    accent: '#01473D',
    soft: '#DAF8DE',
  },
];

export const OLYMPIAD_PROMO = {
  fee: 20,
  dates: '1–5 October 2026',
  durationMinutes: 60,
  autoplayMs: 5000,
};

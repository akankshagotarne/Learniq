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

/**
 * One of the four official source posters. The UI never shows the artwork's
 * group — each of the 10 standards is its own campaign state (see OLYMPIAD_PROMO_STANDARDS).
 */
export interface OlympiadPromoArtwork {
  id: number;
  tagline: string;
  motto: [string, string, string];
  subjects: PromoSubject[];
  /** number of MCQs in this paper (from the imported question papers) */
  questions: number;
  poster: { src: string; srcSmall: string };
  /** dominant colour of the poster (sampled from the artwork) */
  accent: string;
  /** light background tint of the poster */
  soft: string;
}

export interface OlympiadPromoStandard {
  /** 1 … 10 */
  std: number;
  /** index into OLYMPIAD_PROMO_ARTWORKS */
  artwork: number;
}

const TINT = {
  math: '#E6399B',
  science: '#22A45D',
  english: '#F07C1B',
  reasoning: '#2F7BE5',
  achievers: '#7C3AED',
};

/** the four official posters: [0] Test 1 artwork, [1] Test 2, [2] Test 3, [3] Test 4 */
export const OLYMPIAD_PROMO_ARTWORKS: OlympiadPromoArtwork[] = [
  {
    id: 1,
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
    },
    accent: '#00418F',
    soft: '#DDF3FB',
  },
  {
    id: 2,
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
    },
    accent: '#D9490D',
    soft: '#FEF1CC',
  },
  {
    id: 3,
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
    },
    accent: '#591199',
    soft: '#EEE0FD',
  },
  {
    id: 4,
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
    },
    accent: '#01473D',
    soft: '#DAF8DE',
  },
];

/**
 * The 10 individually selectable standards and which source poster each one reuses:
 * Std 1–3 → Test 1 artwork, Std 4–6 → Test 2, Std 7–8 → Test 3, Std 9–10 → Test 4.
 */
export const OLYMPIAD_PROMO_STANDARDS: OlympiadPromoStandard[] = Array.from({ length: 10 }, (_, i) => {
  const std = i + 1;
  return { std, artwork: std <= 3 ? 0 : std <= 6 ? 1 : std <= 8 ? 2 : 3 };
});

export const OLYMPIAD_PROMO = {
  fee: 1,
  dates: '1–5 October 2026',
  durationMinutes: 60,
  autoplayMs: 6000,
};

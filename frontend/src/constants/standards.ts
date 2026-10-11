/**
 * Student standards. `user.currentStandard` is a number, as before: 1–10 = Standard 1–10, 99 = "Others"
 * (not in Std 1–10). Mirrors backend/src/constants/standards.js. Always display it through these helpers, never as
 * `Std ${n}` directly, so "Others" is never shown as "Std 99".
 */
export const STANDARD_OTHERS = 99;
export const NUMBERED_STANDARDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] as const;
export const STUDENT_STANDARDS: readonly number[] = [...NUMBERED_STANDARDS, STANDARD_OTHERS];

export const isOthersStandard = (v: unknown): boolean => v === STANDARD_OTHERS;
/** A real Std 1–10 (content such as Olympiads, exams and courses exists only for these). */
export const isNumberedStandard = (v: unknown): v is number => typeof v === 'number' && v >= 1 && v <= 10 && Number.isInteger(v);

/** "Standard 7" / "Others" / fallback ("" by default) */
export const standardLabel = (v: number | null | undefined, fallback = ''): string =>
  v == null ? fallback : v === STANDARD_OTHERS ? 'Others' : `Standard ${v}`;
/** "Std 7" / "Others" / fallback */
export const standardShortLabel = (v: number | null | undefined, fallback = ''): string =>
  v == null ? fallback : v === STANDARD_OTHERS ? 'Others' : `Std ${v}`;

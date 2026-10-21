/**
 * Bilingual (English + Marathi) answer options. Options are stored as ONE string, "English (मराठी)", so the Marathi label travels with its option
 * through storage, the student API, any shuffling and scoring (the key is an index into the same array). These helpers are shared by the paper
 * importer (checks the source files, decides which updates are safe for an exam that already has attempts) and the publish-time validation.
 */
const DEVANAGARI = /[ऀ-ॿ]/;
const MARATHI_TAIL = /\s*\([^()]*[ऀ-ॿ][^()]*\)\s*$/;

const hasMarathi = (o) => DEVANAGARI.test(String(o || ''));
/** The English (or symbol) part of an option: the Marathi bracket removed and the label brackets ignored, e.g. "☀️ (Sun)" and "☀️ Sun (सूर्य)" -> "☀️ Sun". */
const englishPart = (o) => String(o || '').replace(MARATHI_TAIL, '').replace(/[()]/g, '').replace(/\s+/g, ' ').trim();

/**
 * null when the options are consistently bilingual, otherwise the reason. Rules (applied to papers marked bilingual):
 *  - if ANY option carries Marathi, EVERY option must (the correct answer must never be the only translated one);
 *  - if none does, that is acceptable only for options that are numbers, single letters, symbols or spelling variants - i.e. no real English
 *    word of 3+ letters - or when the question is explicitly marked exempt in the paper file.
 */
const optionLanguageIssue = (options, exempt) => {
  if (exempt) return null;
  const opts = (options || []).map((o) => String(o || ''));
  const withMr = opts.filter(hasMarathi).length;
  if (withMr && withMr < opts.length) return `Only ${withMr} of ${opts.length} answer options have a Marathi translation (options ${opts.map((o, i) => (hasMarathi(o) ? null : String.fromCharCode(65 + i))).filter(Boolean).join(', ')} are English-only).`;
  if (!withMr && opts.some((o) => /[A-Za-z]{3,}/.test(o))) return 'The answer options have no Marathi translation.';
  return null;
};

/** Same-question update that only ADDS or corrects Marathi labels: every option keeps its English/symbol part and its position, none loses its Marathi. */
const isTranslationOnly = (before, after) => {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) return false;
  return before.every((b, i) => {
    const e0 = englishPart(b); const e1 = englishPart(after[i]);
    if (e1 !== e0 && !e1.startsWith(`${e0} `)) return false;
    return !hasMarathi(b) || hasMarathi(after[i]);
  });
};

module.exports = { hasMarathi, englishPart, optionLanguageIssue, isTranslationOnly };

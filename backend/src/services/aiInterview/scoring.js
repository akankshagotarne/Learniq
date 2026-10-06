/**
 * Final result — computed ONLY by the server from the stored per-question scores (0-10 each).
 * The AI never decides the percentage, grade or pass/fail; it only writes the short feedback text.
 */
const GRADE_BANDS = [[90, 'A+'], [80, 'A'], [70, 'B+'], [60, 'B'], [40, 'C'], [0, 'D']];
const STRENGTH_AT = 7;   // subject average (out of 10) that counts as a strength
const IMPROVE_BELOW = 5; // subject average below this needs practice
const MIN_COUNTED_QUESTIONS = 3; // fewer genuine attempts (answered or "I don't know") than this → no grade

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const gradeFor = (percentage) => {
  for (const [min, g] of GRADE_BANDS) if (percentage >= min) return g;
  return 'D';
};

/**
 * `no_response` (the student stayed silent — usually a microphone problem) is NOT an academic answer: it is left out
 * of the denominator. Everything else counts, including "I don't know" (0). Questions that were never reached because
 * the interview ended early count as unanswered (0), so stopping early cannot raise the percentage.
 */
const computeResult = (session, passPercentage) => {
  const asked = session.questions || [];
  const total = session.totalQuestions;
  const unreached = Math.max(0, total - asked.length);
  const counted = asked.filter((q) => q.reason !== 'no_response');
  const countedTotal = counted.length + unreached;
  const totalScore = counted.reduce((s, q) => s + (Number(q.score) || 0), 0);
  const maxScore = countedTotal * 10;
  const percentage = maxScore > 0 ? Math.round((totalScore / maxScore) * 100) : 0;

  const answered = asked.filter((q) => q.reason === 'answered');
  const correctAnswers = asked.filter((q) => q.evaluation && q.evaluation.correct === true).length;

  const bySubject = new Map();
  for (const q of counted) {
    const k = q.subject || 'General';
    const cur = bySubject.get(k) || { sum: 0, n: 0 };
    cur.sum += Number(q.score) || 0; cur.n += 1;
    bySubject.set(k, cur);
  }
  const strengths = []; const areasToImprove = [];
  for (const [subject, { sum, n }] of bySubject) {
    const avg = sum / n;
    if (avg >= STRENGTH_AT) strengths.push(subject);
    else if (avg < IMPROVE_BELOW) areasToImprove.push(subject);
  }

  // enough genuine attempts? (a question that was merely on screen when time ran out is not an attempt)
  const attempts = asked.filter((q) => q.reason === 'answered' || q.reason === 'student_does_not_know').length;
  const insufficient = attempts < MIN_COUNTED_QUESTIONS;
  const grade = insufficient ? null : gradeFor(percentage);
  return {
    answeredQuestions: answered.length,
    correctAnswers,
    totalScore: round2(totalScore),
    maxScore,
    percentage,
    grade,
    passed: !insufficient && percentage >= passPercentage,
    resultStatus: insufficient ? 'insufficient_answers' : 'scored',
    strengths,
    areasToImprove,
  };
};

module.exports = { computeResult, gradeFor, GRADE_BANDS, MIN_COUNTED_QUESTIONS };

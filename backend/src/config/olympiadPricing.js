/**
 * Single source of truth for the SPLIT Olympiad prices. The server always decides the amount; the browser never sends one.
 *
 *   EXAM       Rs 10 (1 credit)     - unlocks taking the exam only
 *   INTERVIEW  Rs 10 (1 credit)     - unlocks the teacher interview only (it still starts only after the existing eligibility rules)
 *   PACKAGE    legacy Rs 20 bundle  - historical purchases only; no new PACKAGE order can be created.
 *
 * Defaults can be overridden per deployment with OLYMPIAD_EXAM_FEE / OLYMPIAD_INTERVIEW_FEE (whole rupees, >= 1) or per exam with
 * exam.examFee / exam.interviewFee. exam.fee is left untouched: it remains the legacy bundle price.
 */
const COMPONENTS = ['EXAM', 'INTERVIEW'];
const DEFAULT_EXAM_FEE = 10;
const DEFAULT_INTERVIEW_FEE = 10;

const asFee = (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 100000 ? n : null; };

const isComponent = (c) => COMPONENTS.includes(c);

/** Price in whole rupees for one component of one exam. */
const priceFor = (component, exam) => {
  if (!isComponent(component)) throw new Error('Unknown component');
  const own = exam && asFee(component === 'EXAM' ? exam.examFee : exam.interviewFee);
  if (own) return own;
  const env = asFee(process.env[component === 'EXAM' ? 'OLYMPIAD_EXAM_FEE' : 'OLYMPIAD_INTERVIEW_FEE']);
  return env || (component === 'EXAM' ? DEFAULT_EXAM_FEE : DEFAULT_INTERVIEW_FEE);
};

const pricing = (exam) => ({ EXAM: priceFor('EXAM', exam), INTERVIEW: priceFor('INTERVIEW', exam), currency: (exam && exam.currency) || 'INR' });

module.exports = { COMPONENTS, DEFAULT_EXAM_FEE, DEFAULT_INTERVIEW_FEE, isComponent, priceFor, pricing };

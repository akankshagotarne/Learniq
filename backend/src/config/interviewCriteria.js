/**
 * Default teacher-interview evaluation criteria. Defined in code (not in the database and not editable from the UI), so
 * ordinary users can never change the scoring rules. Every interview is scored on these five criteria, 0-10 each, whole
 * numbers only, 50 marks in total.
 */
const CRITERIA = Object.freeze([
  { key: 'communication', label: 'Communication Skills', description: 'Speaks clearly, expresses ideas in a simple and organised way.', max: 10 },
  { key: 'confidence', label: 'Confidence and Self-Presentation', description: 'Stays calm, answers with confidence and presents themselves well.', max: 10 },
  { key: 'subjectKnowledge', label: 'Subject Knowledge and Understanding', description: 'Knows the concepts and can explain them correctly.', max: 10 },
  { key: 'listening', label: 'Listening Skills and Comprehension', description: 'Listens carefully and understands the question before answering.', max: 10 },
  { key: 'logicalThinking', label: 'Logical Thinking and Problem-Solving', description: 'Reasons step by step and works towards a sensible answer.', max: 10 },
].map((c) => Object.freeze(c)));

const MAX_TOTAL = CRITERIA.reduce((sum, c) => sum + c.max, 0); // 50
const KEYS = CRITERIA.map((c) => c.key);

module.exports = { CRITERIA, MAX_TOTAL, KEYS };

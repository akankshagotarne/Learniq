/**
 * Event-level interview setting: does THIS Olympiad event include an interview?
 *
 * OlympiadEvent.interviewEnabled is the single source of truth:
 *   true       Exam + Interview
 *   false      Exam Only
 *   undefined  a LEGACY event (created before this setting existed): it keeps its previous behaviour, which always offered the interview.
 *              Nothing is ever migrated or guessed, so no historical event changes meaning. New events always store an explicit value.
 * An exam that belongs to no event (the original exams) also keeps the interview.
 *
 * Always read fresh from the database: an administrator's change is effective on the next request.
 */
const { OlympiadEvent } = require('../models/OlympiadEvent');

const NOT_INCLUDED_MESSAGE = 'Interview is not included in this examination event.';
const NOT_INCLUDED_CODE = 'INTERVIEW_NOT_INCLUDED';

class InterviewNotIncludedError extends Error {
  constructor() { super(NOT_INCLUDED_MESSAGE); this.status = 409; this.code = NOT_INCLUDED_CODE; }
}

/** Pure: the setting of an event document (null event => legacy exam outside any event => enabled). */
const enabledForEvent = (event) => (event && typeof event.interviewEnabled === 'boolean' ? event.interviewEnabled : true);

const idOf = (v) => (v && v._id ? String(v._id) : v ? String(v) : null);

/** Does this exam's event include an interview? (exam document, with `event` set, or null) */
const enabledForExam = async (exam) => {
  if (!exam || !exam.event) return true;
  const event = await OlympiadEvent.findById(exam.event).select('interviewEnabled');
  return enabledForEvent(event);
};

/** Set of EVENT ids (strings) whose interview is switched off, for a list of exams (one query). */
const disabledEventIds = async (exams) => {
  const ids = [...new Set((exams || []).map((e) => idOf(e && e.event)).filter(Boolean))];
  if (!ids.length) return new Set();
  const events = await OlympiadEvent.find({ _id: { $in: ids } }).select('interviewEnabled');
  return new Set(events.filter((e) => !enabledForEvent(e)).map((e) => String(e._id)));
};

/** Exams (documents) whose event includes an interview. */
const filterInterviewExams = async (exams) => {
  const off = await disabledEventIds(exams);
  return (exams || []).filter((e) => !(e.event && off.has(idOf(e.event))));
};

/** Throws InterviewNotIncludedError (HTTP 409) for an Exam Only event. Accepts an exam document or id. */
const assertEnabledForExam = async (examOrId) => {
  let exam = examOrId;
  if (exam && !exam.standard && !exam.event) { // an id (or a bare reference)
    const { OlympiadExam } = require('../models/Olympiad');
    exam = await OlympiadExam.findById(idOf(examOrId)).select('event');
  }
  if (!(await enabledForExam(exam))) throw new InterviewNotIncludedError();
  return true;
};

module.exports = { NOT_INCLUDED_MESSAGE, NOT_INCLUDED_CODE, InterviewNotIncludedError, enabledForEvent, enabledForExam, disabledEventIds, filterInterviewExams, assertEnabledForExam };

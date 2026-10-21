/**
 * Per-event interview window and result announcement time.
 *
 * config/schedule.js holds the ORIGINAL (17 / 18 Oct 2026) calendar as global constants. Newer events carry their own values on the
 * OlympiadEvent (interviewOpensAt / interviewClosesAt / resultsPublishAt). An exam of an event that has none of them - and every exam
 * outside the event model - keeps using the global values, so the original event behaves exactly as before.
 *
 * Always a fresh read: an administrator's change is effective on the next request, nothing is cached.
 */
const G = require('../config/schedule');
const { OlympiadEvent } = require('../models/OlympiadEvent');

const GLOBAL = Object.freeze({ opensAt: G.INTERVIEW_OPENS_AT, closesAt: G.INTERVIEW_CLOSES_AT, announceAt: G.INTERVIEW_RESULTS_AT, source: 'global' });

/** Pure: the window that applies to an event document (or null => global). */
const windowOfEvent = (event) => {
  if (!event || !(event.interviewOpensAt || event.interviewClosesAt || event.resultsPublishAt)) return GLOBAL;
  const opensAt = event.interviewOpensAt ? new Date(event.interviewOpensAt) : GLOBAL.opensAt;
  const closesAt = event.interviewClosesAt ? new Date(event.interviewClosesAt) : GLOBAL.closesAt;
  // never fall back to the OLD global announcement time for an event that has its own interview day: that instant is long past
  const announceAt = event.resultsPublishAt ? new Date(event.resultsPublishAt) : (event.interviewClosesAt ? new Date(event.interviewClosesAt) : GLOBAL.announceAt);
  return { opensAt, closesAt, announceAt, source: 'event' };
};

/** The window of one exam (an exam document or an id). */
const windowForExam = async (examOrId) => {
  if (!examOrId) return GLOBAL;
  let exam = examOrId;
  if (!exam.event && !exam.standard) { // an id
    const { OlympiadExam } = require('../models/Olympiad');
    exam = await OlympiadExam.findById(examOrId).select('event');
  }
  if (!exam || !exam.event) return GLOBAL;
  const event = await OlympiadEvent.findById(exam.event);
  return windowOfEvent(event);
};

const phase = (win, now = new Date()) => (now.getTime() < win.opensAt.getTime() ? 'upcoming' : now.getTime() >= win.closesAt.getTime() ? 'closed' : 'open');

module.exports = { GLOBAL, windowOfEvent, windowForExam, phase };

/** The question-paper sets the importer knows, one per event day. */
const SETS = [require('./oct24Event'), require('./oct31Event')];
const byDay = (ymd) => SETS.find((s) => s.EVENT_DAY === ymd) || null;
const bySet = (name) => SETS.find((s) => s.PAPER_SET === name) || SETS[0];
module.exports = { SETS, byDay, bySet };

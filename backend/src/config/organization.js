/**
 * Virat Education Society - the organisation LearnIQ operates under. PUBLIC information (printed on the society's letterhead),
 * used on the certificates. The website keeps the same values in frontend/src/constants/organization.ts; the test
 * src/tests/organizationBranding.test.js checks that both files agree.
 *
 * Spellings are copied exactly from the letterhead ("Chharapati", "Ramgopalnagar"); confirm with the society before changing
 * them - see docs/VIRAT_EDUCATION_SOCIETY.md. The registration identifiers must never be reformatted.
 */
const SOCIETY = Object.freeze({
  name: 'Virat Education Society',
  affiliation: 'An Initiative of Virat Education Society',
  registrations: Object.freeze([
    Object.freeze({ number: 'MAH-93/19-(0222228)', date: '2019-02-16', dateLabel: '16 February 2019', place: 'Chharapati Sambhajinagar' }),
    Object.freeze({ number: 'F-25431(6750)', date: '2019-05-25', dateLabel: '25 May 2019', place: 'Chharapati Sambhajinagar' }),
  ]),
  officeLines: Object.freeze(['Virat Education Society', 'Plot No. 13, Ramgopalnagar', 'Nashik Road, Padegaon', 'District: Chharapati Sambhajinagar', 'Maharashtra – 431001']),
  phones: Object.freeze(['9765550636', '9860182080']),
  email: 'cool00mayur@gmail.com',
});

/** "MAH-93/19-(0222228) | F-25431(6750)" - both references, complete, never merged into one identifier. */
const registrationLine = () => SOCIETY.registrations.map((r) => r.number).join(' | ');

module.exports = { SOCIETY, registrationLine };

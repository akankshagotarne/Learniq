/**
 * Virat Education Society - the organisation LearnIQ operates under. PUBLIC information only (it is printed on the society's
 * letterhead); nothing here is a secret. The certificate renderer keeps the same values in backend/src/config/organization.js
 * and a backend test checks that both files agree, so the website and the certificates can never drift apart.
 *
 * Source: the society's official letterhead. Spellings are copied exactly as printed there (e.g. "Chharapati",
 * "Ramgopalnagar") - do not "correct" them here without confirming with the society; see docs/VIRAT_EDUCATION_SOCIETY.md.
 */
export interface SocietyRegistration { number: string; date: string; dateLabel: string; place: string }

export const SOCIETY = {
  name: 'Virat Education Society',
  shortName: 'VES',
  affiliation: 'An Initiative of Virat Education Society',
  registrations: [
    { number: 'MAH-93/19-(0222228)', date: '2019-02-16', dateLabel: '16 February 2019', place: 'Chharapati Sambhajinagar' },
    { number: 'F-25431(6750)', date: '2019-05-25', dateLabel: '25 May 2019', place: 'Chharapati Sambhajinagar' },
  ] as SocietyRegistration[],
  office: {
    lines: ['Virat Education Society', 'Plot No. 13, Ramgopalnagar', 'Nashik Road, Padegaon', 'District: Chharapati Sambhajinagar', 'Maharashtra – 431001'],
    locality: 'Padegaon, Chharapati Sambhajinagar',
    region: 'Maharashtra',
    postalCode: '431001',
    country: 'IN',
  },
  phones: ['9765550636', '9860182080'],
  email: 'cool00mayur@gmail.com',
  emblem: '/assets/brand/ves-emblem.png',
} as const;

/** "9765550636" -> "tel:+919765550636" (Indian mobile numbers on the letterhead are written without the country code). */
export const telHref = (n: string) => `tel:+91${n.replace(/\D/g, '')}`;

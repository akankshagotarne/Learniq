# Virat Education Society — organization information

LearnIQ is the primary brand. Virat Education Society is shown as a secondary
affiliation ("An Initiative of Virat Education Society").

## Source of truth

Details are copied from the society's official letterhead supplied by the
LearnIQ CEO. Nothing else has been added or inferred.

| Item | Value |
| --- | --- |
| Name | Virat Education Society |
| Registration reference 1 | `MAH-93/19-(0222228)`, dated 16 Feb 2019, Chharapati Sambhajinagar |
| Registration reference 2 | `F-25431(6750)`, dated 25 May 2019, Chharapati Sambhajinagar |
| Registered office | Plot No. 13, Ramgopalnagar, Nashik Road, Padegaon, District: Chharapati Sambhajinagar, Maharashtra – 431001 |
| Phones | 9765550636, 9860182080 |
| Email | cool00mayur@gmail.com |

The two registration references are separate identifiers and are never merged.

## Where it lives

- Frontend: `frontend/src/constants/organization.ts`
- Backend: `backend/src/config/organization.js` (used by the certificate PDF)
- `backend/src/tests/organizationBranding.test.js` fails if the two drift apart.

To update a detail, change both files; the test confirms they agree.

## Where it appears

- Navbar and footer (affiliation line, footer "About Virat Education Society" link)
- About page (section `#virat-education-society`, details card, JSON-LD)
- Contact page (society contacts kept separate from LearnIQ Support)
- Login, register and public certificate verification pages (affiliation line only)
- Both certificate types (Completion and Participation): footer band shows the
  affiliation and both registration references.

## Certificates and existing PDFs

PDFs are rendered on demand from stored records and are not stored, so no
regeneration or data migration is needed. Existing certificates show the new
footer the next time they are downloaded. Certificate numbers, issue dates,
QR targets, photos and signatures are unchanged.

## Spellings to verify with the society (not changed)

- "Chharapati Sambhajinagar" is used on the letterhead's registration line; the
  emblem reads "CHATRAPATI SAMBHAJI NAGAR". The usual spelling is
  "Chhatrapati Sambhajinagar".
- "Ramgopalnagar" is used as printed on the letterhead (the task text once
  typed "Ramgopalanagar").

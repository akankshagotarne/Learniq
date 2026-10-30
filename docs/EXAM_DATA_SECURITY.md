# Exam question banks and answer keys - handling rules

**The repository is public. Question papers with answer keys must never be committed to it.**

## How papers get into LearnIQ
Papers are imported into the database (collections `OlympiadExam` / `OlympiadQuestion`). The correct answer is stored in
`correctAnswer`, which the schema hides by default (`select: false`); only server-side scoring and admin result views load it
explicitly (`.select('+correctAnswer')`). Student-facing endpoints never return it (tests: `oct24Event.test.js` J/V, `examAccess` tests).

## Importing a paper (private source)
1. Keep the paper files (`std1.json` ... `std10.json`) **outside the repository**, e.g. `D:\LearnIQ-private\oct24\`.
2. Point the importer at that folder with `OLYMPIAD_PAPER_DIR` or `--dir`:

       cd backend
       node src/scripts/importOct24Papers.js --dir D:\LearnIQ-private\oct24            # dry run: validates and prints counts, writes nothing
       node src/scripts/importOct24Papers.js --dir D:\LearnIQ-private\oct24 --apply    # import (idempotent: no duplicates)

   The script uses the `MONGODB_URI` of `backend/.env`. It never prints questions or answers - only counts and problems.
3. The admin screen "Import question papers" reads `OLYMPIAD_PAPER_DIR` on the server; if it is not set, that button reports
   "paper source not configured" and changes nothing.

## Standard-exam banks (Std 1-10 Olympiad papers and the BE Engineering mock test)
These banks used to be bundled in `backend/src/data/` and were loaded by the start-up auto-seed, the admin "seed" action and the
engineering service. They are now read from a **private folder on the server**, named by `OLYMPIAD_BANK_DIR`:

    <OLYMPIAD_BANK_DIR>/olympiad1Questions.js ... olympiad10Questions.js     (same module shape as before: { sections, questions })
    <OLYMPIAD_BANK_DIR>/engineeringQuestions.js
    <OLYMPIAD_BANK_DIR>/engineeringKey.txt      (optional: an independent answer key, only used by the private test run)

Behaviour when the variable is NOT set (nothing is bundled as a fallback):
- exams, attempts, results and certificates already in the database are untouched and keep working;
- start-up logs one warning and skips the auto-seed; the admin "seed" action answers 503 `BANK_NOT_CONFIGURED`;
- a brand-new, empty database cannot create these exams until the folder is configured.

**Before deploying this change** the owner must (1) copy the 11 files from the previous commit (`git show b21d56a:<path>`; they
remain in history) into a private folder on the Render server or its persistent disk, (2) set `OLYMPIAD_BANK_DIR` in Render, and
(3) restart. Production data is not migrated or modified by this change.

Tests use **synthetic fixture banks** (`backend/src/tests/fixtures/banks/`, clearly marked `SYNTHETIC TEST FIXTURE`) so scoring, sections,
seeding and answer-leak checks run in CI. Tests that check the real printed wording/answers run only when a real private folder is
supplied (`OLYMPIAD_BANK_DIR=<private folder> node --test src/tests/olympiad.test.js ...`).

## What the repository checks
`scripts/check-no-confidential-data.js` (run in CI) fails if a paper directory, `stdN.json`, an exam document (`*paper*.pdf`, ...),
`.env`, private key, keystore, dump or any file shaped like a question bank with answer keys is tracked. There is **no path allowlist**.
A file with answer-shaped data passes only with an explicit in-file declaration in its first 600 characters - `SYNTHETIC TEST FIXTURE`
(test fixture folders only) or `PUBLIC DEMO CONTENT` (`backend/src/seed/` only) - and the guard lists every such file in its output.
`backend/src/seed/seedData.js` (generic classroom demo quizzes for a local dev database; refuses production) is the only declared demo file.

## Already exposed
The Oct-24 files were public from 2026-10-21 and remain in Git history; deleting them from the current tree cannot undo that.
Any clone, fork or cache may still hold them. See the exam-integrity notes in the remediation report.

## Plan only: historical clean-up (NOT executed, needs owner approval)
Rewriting public history is destructive and was deliberately not done. If the owner approves:
1. Announce a freeze; collaborators push everything and stop working.
2. Take a full mirror backup: `git clone --mirror <repo> backup.git`.
3. In a fresh mirror clone run `git filter-repo --path backend/src/data/oct24 --invert-paths` (add the other banks if retired).
4. Force-push all branches and tags, then ask GitHub Support to purge cached views and the pull-request refs
   (`refs/pull/*`), because forks and PR refs keep old objects.
5. Every collaborator re-clones. Old clones, forks and caches may still hold the data, so treat the papers as
   exposed regardless: the real remedy for exam integrity is replacing or re-issuing the affected questions.

## Operator steps for the historically exposed admin password (owner action)
The old default admin password appears in repository history. Code now refuses placeholder or default passwords and ends
all sessions on a reset. The credential itself is only safe once rotated:
1. On the server (never in chat), with `NEW_ADMIN_EMAIL` (the existing admin's email) and `NEW_ADMIN_PASSWORD`
   (a new unique password, at least 12 characters) set only in that shell session and `MONGODB_URI` pointing at the
   production database: first run `node src/scripts/createAdmin.js --check`, then
   `node src/scripts/createAdmin.js --set-password`. Placeholder or default-looking passwords are refused, and all
   existing sessions of that account are ended. Clear the variables afterwards.
2. Confirm the old password no longer works (the owner tries it once, deliberately).
3. Review admin activity and login logs since 2026-09-10 for anything unexpected.
4. Rotate any other secret that was ever stored near it (JWT secret, Razorpay keys, SMTP, database user) if logs show misuse.

## 31 October 2026 event
The 31 Oct papers use the same importer (`backend/src/config/oct31Event.js`). The private files go in the `oct31` sub-folder of the paper folder:

    <OLYMPIAD_PAPER_DIR>/oct31/std1.json ... std10.json     (diagrams are embedded in the file as data:image/png URIs)

    cd backend
    node src/scripts/importPapers.js --dir D:\LearnIQ-private            # dry run
    node src/scripts/importPapers.js --dir D:\LearnIQ-private --apply    # import (idempotent)

The import fills the questions only: event fees, registration, interview and results times are never changed by it. Add
`--durations` to also take the exam durations printed on the papers. The event stays in its current state (draft) until published.

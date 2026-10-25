# Security automation

* **CI** (`.github/workflows/ci.yml`): confidential-data check, backend tests, frontend unit tests + build (and a check that the production
  bundle has no proctoring test hooks), `npm audit --omit=dev --audit-level=high` for both packages. Permissions: `contents: read` only.
  No deployment secrets are used. Deployment stays with Vercel / Render.
* **Secret scan** (`.github/workflows/secret-scan.yml`): Gitleaks on the commits of each push / pull request, running on GitHub's runner.
  It does NOT re-scan the whole history on every run.
* **Dependabot** (`.github/dependabot.yml`): weekly update PRs for backend, frontend and GitHub Actions. They are never auto-merged/deployed.
  Also switch on *Dependabot security updates* in Settings > Code security.

## Full-history secret scan (run locally, occasionally)
    gitleaks detect --source . --config .gitleaks.toml --redact --report-format json --report-path gitleaks-report.json
`--redact` keeps secret values out of the report. Known historical finding: an old admin login in `backend/.env.example` / `seedData.js`
(2026-09-10 .. 2026-09-30). It shows up in a full-history scan until the history is cleaned; rotation is required regardless.

## Tests that guard these rules
`backend/src/tests/securityHardening.test.js` (placeholder admin passwords refused, answer keys hidden from students, importer needs a private folder).

## Security headers - behavioural check
`frontend/vercel.json` sets the headers. Unit tests (`frontend/tests-unit/securityHeaders.test.ts`) check the configuration, and
`frontend/scripts/verify-security-headers.mjs` checks the **behaviour** in a real Chromium: it serves a production build with those exact headers,
enforces the CSP, visits real routes and fails on any CSP violation, wrong header on the wire, loss of camera/microphone permission, or a page from
another origin being able to frame the app. Run it with:

    cd frontend
    VITE_API_URL=https://<your-api>.onrender.com/api npm run build -- --outDir dist-csp
    npm run test:headers -- dist-csp          # then delete dist-csp

It is not part of CI (needs a browser). The deployed policy is **Report-Only** on purpose: Razorpay checkout, WebRTC/TURN relays, the real API origin
and WebSockets cannot be exercised from this sandbox, so promote it to enforcing (rename the header) only after a day of clean reports in production.

## Backend test gate (regression gate)
CI runs `node scripts/ci-regression-gate.js` in `backend/` instead of a bare `node --test`. It runs **every** backend test (none skipped, output kept) and
compares the failures with `backend/tests-known-failures.json`: failures that **already exist on `main`** (verified on commit `31c1475` with the same
Node 22 / UTC environment, before the security remediation; mostly tests tied to dates in October 2026 and to the real question banks that are no longer
in the repository). Any failing test that is *not* in that list turns CI red, so a new regression is still caught; a listed test that starts passing is
reported so the entry can be removed. This is a stop-gap: the listed tests should be fixed or removed, then the list emptied.

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

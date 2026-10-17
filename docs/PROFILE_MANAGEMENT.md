# Profile management & payment history controls

Three features shipped together: **(1)** admin "Remove from History" for payments, **(2)** admin editing of student / teacher profiles,
**(3)** self-service Profile and Settings pages for students and teachers (including photo upload).

## 1. Payment "Remove from History"

* **Soft removal.** `removedAt`, `removedBy`, `removalReason` are added to `Payment` and `OlympiadPayment` (optional fields, no migration:
  a missing field means "not removed"). Nothing is deleted. Permanent deletion is deliberately not offered: payments are financial evidence.
* **One rule everywhere.** `services/paymentStats.js` (admin Payments page, dashboard, revenue trend), `adminProfiles.js` (per-student payment
  summary) and `olympiadController.js` (per-exam payment lists and stats) all exclude `removedAt != null`. Removing a payment therefore lowers revenue
  and the counts on every screen, and the UI never hides rows on its own.
* **Never a side effect.** The payment `status`, the Razorpay order/payment, exam access, registrations, attempts and certificates are untouched
  (access checks read `status`, not `removedAt`). No refund is started.
* **API** (admin only, `protect` + `authorize('admin')`):
  `GET /api/admin/payments?view=active|history|removed` · `DELETE /api/admin/payments/:source/:id` `{ reason }` · `POST /api/admin/payments/:source/:id/restore`.
  `source` is `course` or `olympiad`. A verified (paid) payment needs a reason of at least 5 characters. Removing twice answers `409 ALREADY_REMOVED`.
  The removal is one atomic `updateOne({ _id, removedAt: null })`, so a double click or two admins at once cannot double-apply it.
* **Audit.** Every removal / restore writes an append-only `AdminAuditLog` entry (admin, record, status, amount, reason; never credentials).
* **UI.** Payments page → each row has **View** and **Remove from History**; the modal is titled "Remove Payment from History?", shows student, amount,
  status and transaction id, and has Cancel / Remove Record (disabled while saving). Tabs: Payments · Payment History · Removed (restore button).

## 2. Admin edits a student / teacher

`PATCH /api/admin/students/:id`, `PATCH /api/admin/teachers/:id`, photo: `POST|DELETE /api/admin/users/:id/photo`.

| Role | Editable by an admin |
| --- | --- |
| student | name, email, phone, currentStandard, photo |
| teacher | name, email, phone, bio, experience, qualification, subjects, standards, photo |

Any other key (role, isApproved, isActive, password, points …) is rejected with `400 FIELD_NOT_ALLOWED`; the request body is never passed to the database.
E-mail / phone are normalised and checked for uniqueness with the same messages and indexes as registration (a lost race becomes the same `409`).
Only changed fields are written, so nothing is blanked. Audit entries record **field names only**, never the values.

## 3/4. Student and teacher Profile and Settings

Routes: `/student/profile`, `/student/settings`, `/teacher/profile`, `/teacher/settings` (sidebar items "My Profile" and "Settings").
The account always comes from the server session (`req.user`), never from the request.

| Endpoint | Purpose |
| --- | --- |
| `PATCH /api/auth/profile` | student: name, phone · teacher: name, phone, bio, experience, qualification, subjects, standards |
| `POST /api/auth/profile/email-change` | needs current password; sends a 30-minute link to the **new** address |
| `POST /api/auth/verify-email-change` | public; the token is the proof; e-mail changes only now |
| `POST /api/auth/change-password` | current password + policy; signs out the other devices |
| `POST|DELETE /api/auth/profile/photo` | photo upload / removal |

A student cannot change standard, role, e-mail (without the link), points or payments. A teacher cannot change role or approval. Changing the phone number (a login id) requires the current password.
If no mail provider is configured, an e-mail change answers `503` and changes nothing.

## Photos

JPEG / PNG / WebP only, validated from the **file signature** (not the name or the browser's MIME type), at most 512 KB on the server. The browser first crops to a
square and re-encodes at ≤ 400 px, shows a preview and a progress bar. Each user has at most one photo, stored in its own `ProfilePhoto` collection
(never inside the user document); `User.avatar` holds only the URL `/api/profile-photos/:userId?v=<timestamp>`, served with `nosniff`.
**Why MongoDB and not a file or a bucket:** the API host's disk is ephemeral (files vanish on every deploy) and no object-storage provider or credentials are configured.
The photo URL is the only coupling, so moving to Cloudinary / R2 later means changing `savePhoto` / `servePhoto` only.

## Not included (and why)

* No SMS / OTP verification for a phone change (no SMS provider). The current password is required instead.
* No school, address, date of birth, gender or notification preferences: these fields do not exist in the data model and were not invented.
* The Payments page has no CSV export, so there was nothing to change there.

## Tests

`backend/src/tests/profileManagement.test.js` (payment removal A, admin edits B/C, self-service D/E), `frontend/e2e/profileManagement.spec.ts`.

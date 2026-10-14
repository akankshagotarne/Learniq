# Accounts, teacher approval, interview schedule and reminders

## Accounts
- One `User` collection (student / teacher / admin). The role is read from the database on every request - never from the token or the browser.
- One phone = one account, one email = one account (all roles). Phone is normalised to E.164 (default country IN); email is lower-cased.
  Unique indexes: `uniq_email` (partial: only real emails) and `uniq_phoneNormalized` (partial). Duplicate attempts return `EMAIL_ALREADY_EXISTS`, `PHONE_ALREADY_EXISTS` or `EMAIL_AND_PHONE_ALREADY_EXIST`.
- Students: phone required, email optional. Teachers: email required, phone optional. Password: at least 8 characters (existing users are not touched).
- On startup the backend builds `uniq_email` and only then drops the old `email_1` index. No data is changed. If existing data has duplicates the index cannot be built;
  run `node src/scripts/auditUserIdentities.js` (dry run, masks values, never deletes or merges) to list them.

## Teacher approval
- A new teacher is `PENDING` (`isApproved:false`): no token, no session, a "request submitted" screen. `isApproved` is the single source of truth for access.
- Admin > Teachers approves / rejects (audited: `approvedBy/At`, `reviewedBy/At`, `reviewNote`). Rejecting or deactivating ends the teacher's sessions.
- Login and every teacher API re-check approval on the server (`TEACHER_PENDING_APPROVAL`, `TEACHER_NOT_APPROVED`).

## Interview schedule (Admin > Interviews > Schedule & reminders)
- Per standard: interview date, optional time window. Per student: exact slot with a teacher (a teacher cannot have overlapping slots; different teachers can interview at the same time). All times IST.
- After submitting, the student sees the congratulation text built by `services/interviewSchedule.js#messageFor` - a date/time is shown only when really configured, "tomorrow's" only when the date is tomorrow in IST.

## Reminders
- Sent only through a configured provider (Twilio): `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_WHATSAPP_FROM` and/or `TWILIO_SMS_FROM`; optional `INTERVIEW_REMINDER_CHANNEL` (whatsapp|sms), `INTERVIEW_REMINDER_LEAD_MINUTES` (default 60), `INTERVIEW_REMINDERS_ENABLED`.
- Without a provider nothing is sent and nothing is marked sent; the admin page says "Automatic reminders are OFF".
- Status flow: PENDING -> SENDING -> SENT (only after the provider accepted) | retried up to 3 times -> FAILED | EXPIRED (past start) | CANCELLED (rescheduled). One reminder per student/exam/time/channel (unique key).
- Not implemented: voice-call reminders and posting into a WhatsApp group (no provider/API for either). Share the schedule in the group yourself.
- WhatsApp free-text outside a 24h session needs a WhatsApp-approved template; if the provider rejects it the reminder is recorded FAILED.

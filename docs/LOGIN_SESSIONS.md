# One active login per account

LearnIQ allows **one active login session per account** (students, teachers and admins). The backend enforces it.
The frontend only shows the dialog.

## How it works

| Piece | Where |
|---|---|
| Session rows (`active` / `revoked` / `logged_out` / `expired`) | `backend/src/models/AuthSession.js` |
| **Partial unique index**: at most one `active` row per user | `one_active_session_per_user` |
| Sign-in, takeover, logout, token check | `backend/src/services/authSessions.js` |
| Every protected API + Socket.IO handshake | `middleware/auth.js` → `authenticate()` |

- **The token.** The JWT is `{ id, sid }`. Each request loads the session by `sid` and requires `status: 'active'`, with the same user, not expired and not idle.
  - Tokens without a `sid` (issued before this change) are rejected with `401 SESSION_REQUIRED`.
- **Password login when another device has a live session.** The server answers `409 SESSION_CONFLICT` with:
  - the other device (for example "Chrome on Windows", detected on the server from its User-Agent), and its last-active time;
  - a **takeover token**.

  No session is created and the other device is not touched. A wrong password never reveals the other session.
- **The takeover token** is 256-bit random. Only its SHA-256 hash is stored. It works once, for 2 minutes. It is bound to:
  - the user;
  - the exact conflicting session (`targetSid`);
  - the User-Agent of the browser that verified the password.
- **`POST /api/auth/session/takeover { takeoverToken }`** runs these steps in order:
  1. Consumes the token atomically.
  2. Re-checks that the account may sign in: it is active, and a teacher must be approved.
  3. Revokes exactly that session with a conditional update.
  4. Inserts the new session under the unique index.

  If a *different* session became active in the meantime, it answers `409 SESSION_CHANGED` and the user signs in again.
- **Cancel.** `POST /api/auth/session/takeover/cancel` voids the token. The other device stays signed in.
- **Logout.** `POST /api/auth/logout` ends only the caller's own session.
- **Password reset** ends every session of the account and voids pending takeovers. It then starts one new session.
- **Registration** starts the first session.
- **Refresh tokens.** There are none: `JWT_REFRESH_SECRET` is unused. Session lifetime = `JWT_EXPIRE` (default `7d`).
- **Stale sessions never lock anyone out.** A session that is past its expiry, or idle longer than `SESSION_IDLE_HOURS` (default 72), is marked `expired`. The next login replaces it without the dialog.
- **Last-active tracking.** `lastActiveAt` is written at most once per minute per session. The write is conditional and fire-and-forget.
- **The old device**
  - Its next API call gets `401 SESSION_REVOKED`.
  - The app returns to `/login` and says why: "You were signed out because your account was signed in on another device."
  - The app also checks `GET /api/auth/session` when the tab regains focus, and every 2 minutes while it is visible.
  - Open Socket.IO connections of the revoked session are disconnected.

## Error codes (401 unless noted)

| Code | Meaning |
|---|---|
| `SESSION_REVOKED` | Another device took over |
| `SESSION_PASSWORD_RESET` | The password was changed |
| `SESSION_EXPIRED` | Expired or idle session |
| `SESSION_ENDED` | Logged out, or unknown session |
| `SESSION_REQUIRED` | Token without a session id |
| `TAKEOVER_EXPIRED` | Takeover token is expired, used or cancelled |
| `TAKEOVER_INVALID` | Takeover token is malformed, or came from another browser |
| `SESSION_CONFLICT` | **409** on login: another device has the active session |
| `SESSION_CHANGED` | **409** on takeover: the active session changed meanwhile |
| `AUTH_UNAVAILABLE` | **503**: the database is unreachable. The app does not sign the user out. |

## Deploying

- **Everyone signs in once more.** Existing tokens have no session id, so all users must sign in again once after the deploy.
- **Indexes.** At startup the server logs `🔒 Session indexes verified`. If it logs `🚨 Session index check FAILED`, fix that first: without the index, simultaneous sign-ins are not guaranteed to stay single-session.
- **Optional setting.** `SESSION_IDLE_HOURS` on Render.

## Limits

- **The device name is display only.** It comes from the User-Agent, which a browser can fake. It is never used for authorization.
- **Two tabs of the same browser share one session.** They use the same token, which is intended.
- **Taking over during a proctored exam signs the exam device out.** The attempt and its saved answers stay on the server. The server's own deadline and sweeper still apply.

# Coach account lifecycle

## Registration

There is no public, unrestricted coach signup and no self-registration as an administrator. An authenticated admin creates a coach invitation from **Coach accounts**. The backend binds the invitation to one email address, stores only a SHA-256 digest of a 256-bit random token, expires it after 48 hours, and revokes any earlier unused invitation for that email.

The backend emails the one-time link to the invited coach and returns it once to the authenticated admin for private sharing if needed. The bearer token is in the URL fragment, so the browser does not send it to the web server in the request URL or as a referrer. Registration requires the token, creates a user with the instructor role only, and consumes the token in the same database transaction as account creation. The coach sets their own password (minimum 12 characters), country, and region-based IANA time zone. The region's rules account for daylight-saving changes.

## Admin controls

The admin coach list exposes coach email, name, country, time zone, role, and active status. Password hashes and reset tokens are never returned. Admins can activate or deactivate coach accounts and issue a one-time password-reset link that expires after 30 minutes. Coaches can also request a reset link from sign-in; a generic response avoids disclosing whether an account exists. Password reset consumes the token and revokes that coach's Redis sessions. Deactivation also revokes sessions; authorization checks the active flag on every request.

Reset and invitation links are returned once to the authenticated admin and are not persisted in plaintext. If SMTP delivery fails, the API reports that failure and the admin can still copy the link for private sharing. Configure an authorized transactional email provider and HTTPS in production.

## API

- `POST /api/v1/auth/coach-password-reset-request` requests a coach password-reset email.

- `GET /api/v1/admin/coaches` — list coaches (admin only)
- `POST /api/v1/admin/coaches/invitations` — issue an invitation (admin only)
- `PATCH /api/v1/admin/coaches/{user_id}/active` — activate/deactivate (admin only)
- `POST /api/v1/admin/coaches/{user_id}/password-reset` — issue a reset link (admin only)
- `POST /api/v1/auth/coach-invitation/validate` — validate an invitation token
- `POST /api/v1/auth/coach-register` — consume an invitation and register as instructor
- `POST /api/v1/auth/coach-password-reset` — consume a password-reset token

Admin mutations require the authenticated session and CSRF token. Public registration and reset operations require high-entropy, purpose-bound, expiring, single-use tokens.

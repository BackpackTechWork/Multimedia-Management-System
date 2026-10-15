# UMS sign-in

Contract: https://ums.quickstopsolution.com/developer/api-docs (OAuth v1).
MMS is UMS system **12**, slug **multimedia-management-system**.

## Enable

1. Apply `drizzle/0005_ums_identity.sql` to the MMS database before deploying this
   version. It only adds a nullable identity column and unique index to `users`.
   Use the two statements in this file on existing installations that were
   managed with `db:push`; do not replay baseline migrations against them.
   Installations using tracked Drizzle migrations can run `npm run db:migrate`.
2. In the UMS OAuth tab, find **Multimedia Management System**. Register the exact
   callback `https://mms.quickstopsolution.com/auth/ums/callback`, then generate
   the system's client ID and secret. Keep the secret in server configuration.
3. Set `UMS_BASE_URL`, `UMS_CLIENT_ID`, `UMS_CLIENT_SECRET`, and `UMS_REDIRECT_URI`
   in the server's `.env` using `.env.example` as a guide. Restart MMS.
   The button appears only when configuration is complete and valid.
4. Test with an assigned user, an unassigned user, and an existing MMS account.
   A user already signed in to UMS should return to MMS without a password prompt.

For development use a separately registered localhost callback and set that exact
URL in `UMS_REDIRECT_URI`. Production requires HTTPS. Use the existing trusted
reverse-proxy configuration so secure session cookies reach the browser.

## Accounts and permissions

UMS enforces system assignment during code exchange; no data API key is needed.
Use credentials for system 12 only. Email/password sign-in remains available.

First sign-in matches an existing MMS email and permanently binds its UMS ID.
Correct mismatched emails before first sign-in to avoid a separate empty account.
After linking, the stable ID identifies the account even if UMS changes its email.
An email already bound to a different UMS ID is refused. Files, local names,
passwords, and MMS roles remain attached to their existing local account.

An assigned user without a local account is created transactionally with a normal
`user` role and empty storage statistics. UMS administrator roles do not grant
MMS administrator access. New accounts have an unguessable generated password
hash and normally sign in through UMS.

Pending sign-ins expire after ten minutes and are capped at five per session.
PKCE uses S256; callback state is session-bound, consumed before exchange, and
session IDs regenerate after authentication. Identity is obtained server-side,
never from browser-submitted identity fields. Provider redirects are refused
during code exchange and requests time out after ten seconds.

Signing out ends the MMS session only. A user's UMS session remains active.
Removing UMS assignment prevents subsequent UMS sign-ins; existing MMS sessions
must be revoked using MMS device management when immediate removal is required.

## Checks

Run `node --test tests/ums-auth.test.cjs` for protocol, callback, session,
account-linking, and fallback coverage. A real UMS sign-in additionally requires
the registered client secret and a deployed or registered local callback.

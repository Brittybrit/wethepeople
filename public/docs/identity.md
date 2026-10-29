# Identity: sign-in and accounts

How accounts work on wethepeople305.org, what is stored, and how the founder sets it up. As of 2026-10-29. Ballot305 will later use this same service for sign-in.

## In one paragraph
You do not need an account to use the site. If you want one, you create it here with a passkey. Google sign-in is offered too, as an option, never as the only way in. A new account is a "citizen". Organizations can apply to be "organizers" against published criteria; an admin approves. We keep the minimum: an id, when it was made, your roles, your passkeys' public keys, your Google account number if you linked Google, and anything optional you chose to add.

## How sign-in works
- **Passkeys (the native way).** Your phone, computer or password manager makes a key pair for wethepeople305.org. It keeps the private key; we keep only the public key. To sign in, your device signs a one-time challenge and we check it with the public key. No password and no email are needed, so there is nothing to phish or leak. Built on WebAuthn with `@simplewebauthn/server` 14.0.3 on the server and the browser's own WebAuthn API in `public/js/passkey.js` (no outside script).
- **Google (optional).** OpenID Connect, authorization code flow with PKCE (S256), `state` and `nonce`. The code is exchanged on the server; the ID token's signature is checked against Google's published keys (fetched and cached), and its issuer, audience, expiry and nonce are checked. We ask Google only for `openid`, which gives us Google's account number (the "subject") and nothing else. If you tick "Save my Google email address", we also ask for `email` and store it, only if Google says it is verified.
- **Linking.** Signed in, you can link Google from your account page. A Google account links to at most one account here, and an account to at most one Google account. Signing in with a Google account we have not seen creates a new citizen account. If you already have a passkey account and sign in with an unlinked Google account while signed out, you get a second, separate account; to avoid that, sign in with your passkey first and use "Link Google".
- **Sessions.** After sign-in the server sets one cookie, `__Host-wtp305_session`: a random value, HttpOnly, Secure, SameSite=Lax, Path=/. The server stores only a SHA-256 hash of it, with an expiry 30 days out that rolls forward as you use the site. Signing out or deleting the account deletes the session row, so the cookie stops working at once. No token is readable by page scripts.
- **CSRF.** Every POST, PATCH and DELETE must carry this site's `Origin` header, or it is refused with 403. With SameSite=Lax on the cookie, a page on another site cannot act as you. The Google callback also checks that its `state` matches a short-lived `__Host-wtp305_oauth` cookie set in the same browser.

## What is stored
In the D1 database `wethepeople305-accounts` (schema: `migrations/0001_accounts.sql`):

| Table | What | Why |
|---|---|---|
| users | id (random), created, display name (optional), email (optional), precinct (optional) | the account |
| roles | citizen, organizer or admin, when and how granted | what the account may do |
| credentials | passkey id, public key, signature counter, transports, created, last used | to check passkey sign-ins |
| google_links | Google's subject id, linked at | to recognize your Google sign-in |
| sessions | SHA-256 hash of the session id, expiry | to keep you signed in |
| auth_flows | a one-time challenge or Google state, nonce and PKCE verifier; deleted on use or after 10 minutes | to finish a sign-in |
| organizer_applications | organization, website, criteria ticked, statement, status, reviewer's account id and note | organizer admission |

There is no column for a legal name, a street address, a phone number or an IP address. Events about sign-in say only which route ran and whether it worked; they carry no account id, email, Google subject, passkey id or IP (`lib/events.mjs` refuses name, email and IP fields).

## Roles
- **citizen**: every account, at once.
- **organizer**: by application against the published criteria (`organizer-criteria.md`, DRAFT), approved by an admin. A person can be both.
- **admin**: reviews organizer applications. No route can grant it. Only the founder, by running a command (below).

## Routes
| Method and path | What | Signed in? |
|---|---|---|
| GET `/auth/status` | `{ accounts, google }`: whether accounts and Google sign-in are switched on | no |
| POST `/auth/passkey/register/options` then `/verify` | create an account (signed out) or add a passkey (signed in) | either |
| POST `/auth/passkey/login/options` then `/verify` | sign in with a passkey | no |
| GET `/auth/google` (`?link=1` to link, `&email=1` to save email) | go to Google | either |
| GET `/auth/google/callback` | back from Google, then to `/account` | |
| POST `/auth/logout` | sign out | yes |
| GET `/api/v1/me` | id, created, roles, sign-in methods, display name, email, precinct, applications. 401 if signed out | yes |
| PATCH `/api/v1/me` | set or clear `displayName`, `email`, `precinct` | yes |
| DELETE `/api/v1/me` | delete the account and everything tied to it | yes |
| GET, POST `/api/v1/organizer-applications` | your applications; apply. `GET ?criteria=1` lists the criteria without signing in | yes |
| GET `/api/v1/review/organizer-applications?status=pending` | list applications | admin |
| POST `/api/v1/review/organizer-applications/{id}` `{ decision: "approve" or "decline", note }` | decide | admin |

These routes are same-origin only: no open CORS, and they are not MCP tools and not in the OpenAPI document. The architecture's API keys for the organizer tier (key issuance, per-key limits) are not built yet.

If the database is not bound, every route above except `/auth/status` answers 503 with "Accounts are not switched on yet", and the rest of the site works as before. If the Google secrets are not set, the Google button is hidden and `/auth/google` answers 503.

## Setup (founder)

### 1. Create the database
```
npx wrangler d1 create wethepeople305-accounts
```
Copy the `database_id` it prints into `wrangler.toml`, replacing `REPLACE_WITH_ID_FROM_wrangler_d1_create`. Then:
```
npx wrangler d1 migrations apply wethepeople305-accounts --remote
```
Commit `wrangler.toml` and push. Passkey sign-in works from the next deploy.

### 2. Google sign-in (optional)
1. Google Cloud Console, pick or create a project.
2. **OAuth consent screen** (Google Auth Platform, Branding): app name "We the People 305", support email, app home page `https://wethepeople305.org`, privacy policy `https://wethepeople305.org/docs/privacy.md`, authorized domain `wethepeople305.org`. Audience: External. Scopes (Data Access): `openid` and `.../auth/userinfo.email` only. Publish the app so anyone can sign in (these scopes need no Google verification review).
3. **Clients, Create client**: type **Web application**, name "wethepeople305.org". Authorized JavaScript origins: `https://wethepeople305.org`. Authorized redirect URI: `https://wethepeople305.org/auth/google/callback`. For local testing you may add `http://localhost:8787/auth/google/callback`.
4. Copy the client ID and client secret into Worker secrets:
```
npx wrangler secret put GOOGLE_OAUTH_CLIENT_ID_WETHEPEOPLE305
npx wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET_WETHEPEOPLE305
```
The button appears as soon as both secrets exist. Remove either secret to switch Google sign-in off.

Sign-ins from `www.wethepeople305.org` work for passkeys. For Google, use the apex domain, or add the `www` redirect URI in the console too.

### 3. Grant admin
Sign in at `/account` and copy your "Account id". Then:
```
node scripts/grant-admin.mjs <account id>
```
It prints the exact `npx wrangler d1 execute wethepeople305-accounts --remote --command "..."` to run, and a query to check it. `--revoke` prints the command that removes admin. The script changes nothing by itself.

### Local development
`npx wrangler dev` uses a local D1 database. Apply the migration to it with `npx wrangler d1 migrations apply wethepeople305-accounts --local`. Passkeys work on `http://localhost:8787` in current browsers. Without a database binding, setting `IDENTITY_STORE = "memory"` in `.dev.vars` uses an in-memory store that is lost on restart.

## Code
- `lib/identity/service.mjs`: routes and rules (plain JavaScript; the WebAuthn library, store, fetch and clock are injected).
- `lib/identity/store.mjs`: the Store interface with a D1 adapter and an in-memory adapter.
- `lib/identity/sessions.mjs`, `google.mjs`, `roles.mjs`: sessions and CSRF, Google OIDC, roles and admission.
- `src/identity.js`: wires them into the Worker. `src/worker.js` sends identity paths there.
- Tests: `tests/hand/identity-*.test.mjs` (both store adapters, Google token checks with a local RSA key and fake JWKS, PKCE and state, linking rules, roles, full passkey ceremonies with a software authenticator) and `tests/worker/identity.test.mjs` (the Worker in workerd, with and without D1).

## Related
- `privacy.md`: what accounts store and how to delete one.
- `security/threat-model.md`: session theft, CSRF, OAuth code interception, account takeover by linking, admin escalation.
- `decisions/0009-passkeys-native-google-federated.md`: why passkeys first.
- `organizer-criteria.md`: the DRAFT admission criteria.

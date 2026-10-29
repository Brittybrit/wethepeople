# 0009. Passkeys are the native sign-in; Google is an optional federation

- Status: Accepted
- Date: 2026-10-29

## Context
The platform needs accounts: citizens, organizers admitted by criteria, and later Ballot305 signing in through the same service. The founder's rules: people create an account on wethepeople305.org itself, Google is never the only way in, and we collect the minimum.

The usual native option, an emailed magic link, needs a service that sends email. Cloudflare Email Routing receives mail but cannot send it, so magic links would need a paid sender and would make an email address required. Passwords need storage, reset flows and breach handling, and they get phished.

## Decision
- Native sign-in is a passkey (WebAuthn). The server stores only the public key. No email, no password, no outside service. Server side uses `@simplewebauthn/server` 14.0.3, which runs on Cloudflare Workers without `nodejs_compat` (Web Crypto only; tested in workerd). The browser side is the browser's own WebAuthn API in a small file we serve, so no CDN and no CSP change.
- Google OpenID Connect is offered beside it: code flow with PKCE, state and nonce, server-side exchange, ID token verified against Google's keys. We ask for `openid` only, plus `email` when the person ticks a box.
- Sessions are opaque random ids in a `__Host-` cookie, hashed at rest, 30 days rolling, revocable. No JWTs in the browser.
- Storage is D1 behind a Store interface with an in-memory adapter (architecture section 3).
- The admin role is granted only by a command the founder runs, never by a route.

## Consequences
- Anyone with a current phone or computer can make an account without giving any personal detail.
- A person who loses every device with their passkey, and has not linked Google, loses the account. Synced passkeys (iCloud Keychain, Google Password Manager, 1Password) make this rare. Account recovery is not built; adding a second passkey or linking Google is the advice today.
- We cannot email people unless they give an address. That fits the minimum-data rule.
- The architecture's planned email magic-link adapter is not built. Apple sign-in can be added later as another federation behind the same linking rules.
- API keys for the organizer tier are a separate, later step; this record covers people signing in.

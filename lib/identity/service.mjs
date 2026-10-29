// The identity service: sign-in (passkeys natively, Google as an optional federation), sessions, accounts, roles and
// organizer admission. Plain JavaScript with no runtime imports: the WebAuthn library, the store, fetch and the clock
// are injected (src/identity.js wires them for the Worker; tests pass fakes).
//
// Routes (all JSON unless noted; every POST and DELETE must carry this site's Origin header):
//   GET    /auth/status                            { accounts, google } so pages know what to show
//   POST   /auth/passkey/register/options          new account, or a new passkey on the signed-in account
//   POST   /auth/passkey/register/verify
//   POST   /auth/passkey/login/options
//   POST   /auth/passkey/login/verify
//   GET    /auth/google?link=1&email=1             redirect to Google (link=1 links to the signed-in account)
//   GET    /auth/google/callback                   redirect back to /account
//   POST   /auth/logout
//   GET    /api/v1/me                              current account; 401 signed out
//   PATCH  /api/v1/me                              set or clear displayName, email, precinct
//   DELETE /api/v1/me                              delete the account, its passkeys, Google link, sessions and applications
//   GET    /api/v1/organizer-applications          the signed-in person's own applications
//   POST   /api/v1/organizer-applications          apply for the organizer role
//   GET    /api/v1/review/organizer-applications?status=pending       admin only
//   POST   /api/v1/review/organizer-applications/{id}  { decision: approve|decline, note }  admin only
import { startSession, currentSession, endSession, sameOrigin, iso, setCookie, clearCookie, readCookie } from './sessions.mjs';
import { authorizationUrl, exchangeCode, verifyIdToken, pkcePair, randomToken, safeEqual, b64url } from './google.mjs';
import { checkApplication, canApply, canDecide, hasRole, ORGANIZER_CRITERIA } from './roles.mjs';
import { LinkConflict } from './store.mjs';

export const IDENTITY_PATHS = /^\/(auth(\/|$)|api\/v1\/(me|organizer-applications|review\/organizer-applications)(\/|$))/;
export const isIdentityPath = path => IDENTITY_PATHS.test(path);

export const GOOGLE_SECRET_NAMES = { clientId: 'GOOGLE_OAUTH_CLIENT_ID_WETHEPEOPLE305', clientSecret: 'GOOGLE_OAUTH_CLIENT_SECRET_WETHEPEOPLE305' };
export const OAUTH_COOKIE = '__Host-wtp305_oauth';
export const FLOW_MS = 10 * 60 * 1000;
export const RP_NAME = 'We the People 305';
// ES256, Ed25519, RS256: what passkey providers use today.
export const PASSKEY_ALGORITHMS = [-7, -8, -257];

const MESSAGES = {
  noStore: 'Accounts are not switched on yet. The rest of the site works without one.',
  noGoogle: 'Google sign-in is not set up on this site. Create an account with a passkey instead.',
  origin: 'This request did not come from this site.',
  signedOut: 'Sign in first.'
};

const HEADERS = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
function json(body, status = 200, cookies = []) {
  const h = new Headers(HEADERS);
  for (const c of cookies) if (c) h.append('Set-Cookie', c);
  return new Response(JSON.stringify(body), { status, headers: h });
}
function redirect(location, cookies = []) {
  const h = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const c of cookies) if (c) h.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers: h });
}
async function body(request) {
  const t = request.headers.get('Content-Type') || '';
  if (!t.includes('application/json')) return null;
  try { const b = await request.json(); return b && typeof b === 'object' ? b : null; } catch { return null; }
}

// RP ID: the registrable host the passkey is bound to. www and the apex share one.
export const rpIdFor = hostname => hostname.replace(/^www\./, '');
const originsFor = url => {
  const rp = rpIdFor(url.hostname);
  const port = url.port ? ':' + url.port : '';
  return [...new Set([url.origin, url.protocol + '//' + rp + port, url.protocol + '//www.' + rp + port])];
};

export const googleConfigured = env => !!(env && env[GOOGLE_SECRET_NAMES.clientId] && env[GOOGLE_SECRET_NAMES.clientSecret]);

const cleanText = (v, max) => {
  if (v === null) return null;
  if (typeof v !== 'string') return undefined;
  const s = v.trim().replace(/\s+/g, ' ');
  if (!s) return null;
  return s.length > max ? false : s;
};
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const PRECINCT = /^\d{3}\.\d$/;

// Public view of an account. Never includes session data or public keys.
export async function accountView(store, userId) {
  const u = await store.getUser(userId);
  if (!u) return null;
  const [roles, creds, google, apps] = await Promise.all([store.listRoles(userId), store.listCredentials(userId), store.getGoogleLinkForUser(userId), store.listApplications({ userId })]);
  return {
    id: u.id, created: u.createdAt, roles,
    displayName: u.displayName, email: u.email, precinct: u.precinct,
    methods: {
      passkeys: creds.map(c => ({ id: c.id.slice(0, 8), created: c.createdAt, lastUsed: c.lastUsedAt })),
      google: google ? { linked: true, linkedAt: google.linkedAt } : { linked: false }
    },
    organizerApplications: apps.map(a => ({ id: a.id, organization: a.organization, status: a.status, created: a.createdAt, decided: a.decidedAt }))
  };
}

// Create a citizen account. Returns the user.
export async function createAccount(store, { id, displayName = null, email = null, at }) {
  const user = await store.createUser({ id, createdAt: at, displayName, email });
  await store.grantRole(user.id, 'citizen', { at, by: 'signup' });
  return user;
}

// Linking rules for a verified Google identity. Pure decision plus the writes, in one place.
//   signed in + sub unlinked            -> link to the signed-in account
//   signed in + sub linked to same      -> nothing to do
//   signed in + sub linked to another   -> refused (google_linked_elsewhere)
//   signed in + account already linked to a different sub -> refused (account_has_google)
//   signed out + sub linked             -> sign in as that account
//   signed out + sub unlinked           -> new citizen account, linked
// Google's email is saved only when the person ticked the box (consent) and Google says it is verified.
export async function resolveGoogle(store, { sub, email, emailVerified, consentEmail, signedInUserId, linkRequested, newId, at }) {
  const existing = await store.getGoogleLink(sub);
  const saveEmail = consentEmail && emailVerified && email ? email : null;
  if (linkRequested) {
    if (!signedInUserId) return { error: 'signed_out' };
    if (existing && existing.userId !== signedInUserId) return { error: 'google_linked_elsewhere' };
    if (!existing) {
      try { await store.addGoogleLink({ sub, userId: signedInUserId, at }); }
      catch (e) { if (e instanceof LinkConflict) return { error: e.reason }; throw e; }
    }
    if (saveEmail) await store.updateUser(signedInUserId, { email: saveEmail });
    return { userId: signedInUserId, outcome: existing ? 'already_linked' : 'linked' };
  }
  if (existing) {
    if (saveEmail) await store.updateUser(existing.userId, { email: saveEmail });
    return { userId: existing.userId, outcome: 'signed_in' };
  }
  const user = await createAccount(store, { id: newId, email: saveEmail, at });
  try { await store.addGoogleLink({ sub, userId: user.id, at }); }
  catch (e) { await store.deleteUser(user.id); if (e instanceof LinkConflict) return { error: e.reason }; throw e; }
  return { userId: user.id, outcome: 'created' };
}

const newUserId = () => b64url(crypto.getRandomValues(new Uint8Array(16)));
const newAppId = () => 'app_' + randomToken(9);

// deps: { store, webauthn: { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse },
//         fetch, jwks, now, emit(event) }
export async function handleIdentity(request, env, deps) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const method = request.method;
  const now = (deps.now || Date.now)();
  const at = iso(now);
  const emit = deps.emit || (() => {});
  const store = deps.store;

  if (path === '/auth/status' && method === 'GET') return json({ accounts: !!store, google: !!store && googleConfigured(env) });
  if (!store) return json({ error: MESSAGES.noStore }, 503);
  if (!['GET', 'HEAD'].includes(method) && !sameOrigin(request, url.origin)) return json({ error: MESSAGES.origin }, 403);

  const session = await currentSession(store, request, now);
  const keep = session && session.cookie ? [session.cookie] : [];
  const rpID = rpIdFor(url.hostname);

  // ---- Passkeys ----
  if (path === '/auth/passkey/register/options' && method === 'POST') {
    const b = (await body(request)) || {};
    const displayName = cleanText(b.displayName ?? null, 60);
    if (displayName === false) return json({ error: 'Display name: up to 60 characters.' }, 400);
    let userId, existing = [];
    if (session) { userId = session.userId; existing = await store.listCredentials(userId); }
    else userId = newUserId();
    const options = await deps.webauthn.generateRegistrationOptions({
      rpName: RP_NAME, rpID,
      userName: displayName || 'We the People 305 account',
      userDisplayName: displayName || '',
      userID: Uint8Array.from(atob(userId.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - userId.length % 4) % 4)), c => c.charCodeAt(0)),
      attestationType: 'none',
      excludeCredentials: existing.map(c => ({ id: c.id, transports: c.transports })),
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      supportedAlgorithmIDs: PASSKEY_ALGORITHMS
    });
    const flowId = randomToken(18);
    await store.putFlow({ id: flowId, kind: 'passkey.register', data: { challenge: options.challenge, userId, newAccount: !session, displayName: displayName || null }, expiresAt: iso(now + FLOW_MS) });
    return json({ flowId, options }, 200, keep);
  }
  if (path === '/auth/passkey/register/verify' && method === 'POST') {
    const b = await body(request);
    if (!b || typeof b.flowId !== 'string' || !b.response) return json({ error: 'Send flowId and the browser response.' }, 400);
    const flow = await store.takeFlow(b.flowId, 'passkey.register', at);
    if (!flow) return json({ error: 'This sign-up expired. Start again.' }, 400);
    if (!flow.newAccount && (!session || session.userId !== flow.userId)) return json({ error: MESSAGES.signedOut }, 401);
    let v;
    try {
      v = await deps.webauthn.verifyRegistrationResponse({ response: b.response, expectedChallenge: flow.challenge, expectedOrigin: originsFor(url), expectedRPID: rpID, requireUserVerification: false, supportedAlgorithmIDs: PASSKEY_ALGORITHMS });
    } catch { v = null; }
    if (!v || !v.verified) { emit({ event: 'auth.passkey.register', ok: false }); return json({ error: 'The passkey could not be verified. Try again.' }, 400); }
    const c = v.registrationInfo.credential;
    if (await store.getCredential(c.id)) return json({ error: 'This passkey is already registered.' }, 409);
    if (flow.newAccount) await createAccount(store, { id: flow.userId, displayName: flow.displayName, at });
    await store.addCredential({ id: c.id, userId: flow.userId, publicKey: b64url(c.publicKey), counter: c.counter || 0, transports: c.transports || b.response?.response?.transports || [], createdAt: at });
    emit({ event: 'auth.passkey.register', ok: true, props: { new_account: flow.newAccount } });
    if (flow.newAccount) {
      const s = await startSession(store, flow.userId, now);
      return json(await accountView(store, flow.userId), 201, [s.cookie]);
    }
    return json(await accountView(store, flow.userId), 200, keep);
  }
  if (path === '/auth/passkey/login/options' && method === 'POST') {
    const options = await deps.webauthn.generateAuthenticationOptions({ rpID, userVerification: 'preferred', allowCredentials: [] });
    const flowId = randomToken(18);
    await store.putFlow({ id: flowId, kind: 'passkey.login', data: { challenge: options.challenge }, expiresAt: iso(now + FLOW_MS) });
    if (deps.waitUntil) deps.waitUntil(store.purgeExpired(at));
    return json({ flowId, options });
  }
  if (path === '/auth/passkey/login/verify' && method === 'POST') {
    const b = await body(request);
    if (!b || typeof b.flowId !== 'string' || !b.response || typeof b.response.id !== 'string') return json({ error: 'Send flowId and the browser response.' }, 400);
    const flow = await store.takeFlow(b.flowId, 'passkey.login', at);
    if (!flow) return json({ error: 'This sign-in expired. Start again.' }, 400);
    const cred = await store.getCredential(b.response.id);
    const fail = () => { emit({ event: 'auth.passkey.login', ok: false }); return json({ error: 'That passkey is not registered here, or could not be verified.' }, 401); };
    if (!cred) return fail();
    let v;
    try {
      v = await deps.webauthn.verifyAuthenticationResponse({
        response: b.response, expectedChallenge: flow.challenge, expectedOrigin: originsFor(url), expectedRPID: rpID, requireUserVerification: false,
        credential: { id: cred.id, publicKey: Uint8Array.from(atob(cred.publicKey.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - cred.publicKey.length % 4) % 4)), ch => ch.charCodeAt(0)), counter: cred.counter, transports: cred.transports }
      });
    } catch { v = null; }
    if (!v || !v.verified) return fail();
    // The response's user handle, when sent, must name the credential's owner.
    const handle = b.response.response && b.response.response.userHandle;
    if (handle && !safeEqual(handle, cred.userId)) return fail();
    await store.updateCredentialUse(cred.id, { counter: v.authenticationInfo.newCounter, at });
    if (session) await store.deleteSession(session.idHash);
    const s = await startSession(store, cred.userId, now);
    emit({ event: 'auth.passkey.login', ok: true });
    return json(await accountView(store, cred.userId), 200, [s.cookie]);
  }

  // ---- Google ----
  if (path === '/auth/google' && method === 'GET') {
    if (!googleConfigured(env)) return json({ error: MESSAGES.noGoogle }, 503);
    const link = url.searchParams.get('link') === '1';
    if (link && !session) return redirect('/account?error=signed_out');
    const state = randomToken(24), nonce = randomToken(24);
    const { verifier, challenge } = await pkcePair();
    const wantEmail = url.searchParams.get('email') === '1';
    await store.putFlow({ id: state, kind: 'google', data: { nonce, verifier, link, wantEmail, linkUserId: link ? session.userId : null }, expiresAt: iso(now + FLOW_MS) });
    const location = authorizationUrl({ clientId: env[GOOGLE_SECRET_NAMES.clientId], redirectUri: url.origin + '/auth/google/callback', state, nonce, codeChallenge: challenge, wantEmail });
    // The state is also in a short-lived cookie, so the callback only completes in the browser that started it.
    return redirect(location, [setCookie(OAUTH_COOKIE, state, FLOW_MS / 1000), ...keep]);
  }
  if (path === '/auth/google/callback' && method === 'GET') {
    if (!googleConfigured(env)) return json({ error: MESSAGES.noGoogle }, 503);
    const back = (q, cookies = []) => redirect('/account?' + q, [clearCookie(OAUTH_COOKIE), ...cookies]);
    const state = url.searchParams.get('state') || '';
    const code = url.searchParams.get('code') || '';
    const cookieState = readCookie(request, OAUTH_COOKIE) || '';
    if (url.searchParams.get('error')) { if (state) await store.takeFlow(state, 'google', at); return back('error=google_cancelled'); }
    if (!state || !code || !safeEqual(state, cookieState)) return back('error=google_state');
    const flow = await store.takeFlow(state, 'google', at);
    if (!flow) return back('error=google_state');
    let claims;
    try {
      const idToken = await exchangeCode({ code, verifier: flow.verifier, clientId: env[GOOGLE_SECRET_NAMES.clientId], clientSecret: env[GOOGLE_SECRET_NAMES.clientSecret], redirectUri: url.origin + '/auth/google/callback', fetch: deps.fetch });
      claims = await verifyIdToken(idToken, { clientId: env[GOOGLE_SECRET_NAMES.clientId], nonce: flow.nonce, jwks: deps.jwks, now: () => now });
    } catch {
      emit({ event: 'auth.google', ok: false });
      return back('error=google_verify');
    }
    if (flow.link && (!session || session.userId !== flow.linkUserId)) return back('error=signed_out');
    const r = await resolveGoogle(store, { sub: claims.sub, email: claims.email, emailVerified: claims.email_verified, consentEmail: flow.wantEmail, signedInUserId: flow.link ? session.userId : null, linkRequested: flow.link, newId: newUserId(), at });
    if (r.error) { emit({ event: 'auth.google', ok: false, props: { reason: r.error } }); return back('error=' + r.error); }
    emit({ event: 'auth.google', ok: true, props: { outcome: r.outcome } });
    if (flow.link) return back('done=' + r.outcome, keep);
    if (session) await store.deleteSession(session.idHash);
    const s = await startSession(store, r.userId, now);
    return back('done=' + r.outcome, [s.cookie]);
  }

  if (path === '/auth/logout' && method === 'POST') {
    const c = await endSession(store, request);
    return json({ ok: true }, 200, [c]);
  }

  // ---- Account ----
  if (path === '/api/v1/me') {
    if (!session) return json({ error: MESSAGES.signedOut }, 401);
    if (method === 'GET') {
      const v = await accountView(store, session.userId);
      return v ? json(v, 200, keep) : json({ error: MESSAGES.signedOut }, 401, [clearCookie('__Host-wtp305_session')]);
    }
    if (method === 'PATCH') {
      const b = await body(request);
      if (!b) return json({ error: 'Send JSON.' }, 400);
      const patch = {};
      if ('displayName' in b) { const v = cleanText(b.displayName, 60); if (v === false || v === undefined) return json({ error: 'Display name: up to 60 characters, or null to clear.' }, 400); patch.displayName = v; }
      if ('email' in b) { const v = cleanText(b.email, 254); if (v === false || v === undefined || (v && !EMAIL.test(v))) return json({ error: 'Email: a valid address, or null to clear.' }, 400); patch.email = v; }
      if ('precinct' in b) { const v = cleanText(b.precinct, 5); if (v === false || v === undefined || (v && !PRECINCT.test(v))) return json({ error: 'Precinct: a code like 033.0, or null to clear.' }, 400); patch.precinct = v; }
      await store.updateUser(session.userId, patch);
      return json(await accountView(store, session.userId), 200, keep);
    }
    if (method === 'DELETE') {
      await store.deleteUser(session.userId);
      emit({ event: 'account.deleted', ok: true });
      return json({ deleted: true }, 200, [clearCookie('__Host-wtp305_session')]);
    }
    return json({ error: 'Method not allowed' }, 405);
  }

  if (path === '/api/v1/organizer-applications') {
    if (method === 'GET' && url.searchParams.get('criteria') === '1') return json({ status: 'draft', criteria: ORGANIZER_CRITERIA });
    if (!session) return json({ error: MESSAGES.signedOut }, 401);
    if (method === 'GET') return json({ applications: await store.listApplications({ userId: session.userId }) }, 200, keep);
    if (method === 'POST') {
      const roles = await store.listRoles(session.userId);
      const blocked = canApply(roles, await store.listApplications({ userId: session.userId }));
      if (blocked) return json({ error: blocked }, 409);
      const checked = checkApplication(await body(request));
      if (checked.error) return json({ error: checked.error }, 400);
      const app = await store.createApplication({ id: newAppId(), userId: session.userId, ...checked.value, createdAt: at });
      emit({ event: 'organizer.application', ok: true });
      return json(app, 201, keep);
    }
    return json({ error: 'Method not allowed' }, 405);
  }

  const review = /^\/api\/v1\/review\/organizer-applications(?:\/([A-Za-z0-9_-]{1,40}))?$/.exec(path);
  if (review) {
    if (!session) return json({ error: MESSAGES.signedOut }, 401);
    const roles = await store.listRoles(session.userId);
    if (!hasRole(roles, 'admin')) return json({ error: 'Admins only.' }, 403);
    if (!review[1] && method === 'GET') {
      const status = url.searchParams.get('status');
      if (status && !['pending', 'approved', 'declined'].includes(status)) return json({ error: 'status: pending, approved or declined' }, 400);
      return json({ applications: await store.listApplications({ status: status || undefined }) }, 200, keep);
    }
    if (review[1] && method === 'GET') {
      const a = await store.getApplication(review[1]);
      return a ? json(a, 200, keep) : json({ error: 'No such application.' }, 404);
    }
    if (review[1] && method === 'POST') {
      const b = await body(request);
      if (!b || !['approve', 'decline'].includes(b.decision)) return json({ error: 'decision: approve or decline' }, 400);
      const note = cleanText(b.note ?? null, 500);
      if (note === false || note === undefined) return json({ error: 'note: up to 500 characters' }, 400);
      const app = await store.getApplication(review[1]);
      const no = canDecide(session.userId, roles, app);
      if (no) return json({ error: no.error }, no.status);
      const status = b.decision === 'approve' ? 'approved' : 'declined';
      if (!(await store.decideApplication(app.id, { status, at, by: session.userId, note }))) return json({ error: 'This application has already been decided.' }, 409);
      if (status === 'approved') await store.grantRole(app.userId, 'organizer', { at, by: 'application:' + app.id });
      emit({ event: 'organizer.decision', ok: true, props: { decision: status } });
      return json(await store.getApplication(app.id), 200, keep);
    }
    return json({ error: 'Method not allowed' }, 405);
  }

  return json({ error: 'Not found' }, 404);
}

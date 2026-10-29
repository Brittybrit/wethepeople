import { describe, it, expect, beforeEach } from 'vitest';
import * as webauthn from '@simplewebauthn/server';
import { handleIdentity, resolveGoogle, createAccount, isIdentityPath, OAUTH_COOKIE } from '../../lib/identity/service.mjs';
import { memoryStore } from '../../lib/identity/store.mjs';
import { jwksCache } from '../../lib/identity/google.mjs';
import { SESSION_COOKIE } from '../../lib/identity/sessions.mjs';
import { CRITERIA_IDS } from '../../lib/identity/roles.mjs';
import { softAuthenticator } from '../helpers/soft-authenticator.mjs';
import { fakeGoogle } from '../helpers/fake-google.mjs';

const ORIGIN = 'https://wethepeople305.org';
const T0 = '2026-10-29T12:00:00.000Z';

// A tiny browser: keeps cookies, sends Origin on non-GET requests like a real one.
function browser(call) {
  const jar = new Map();
  const take = r => { for (const c of r.headers.getSetCookie()) { const [kv, ...attrs] = c.split(';'); const [k, ...v] = kv.split('='); if (/Max-Age=0/.test(attrs.join(';'))) jar.delete(k.trim()); else jar.set(k.trim(), v.join('=')); } return r; };
  const cookie = () => [...jar].map(([k, v]) => k + '=' + v).join('; ');
  return {
    jar,
    async req(method, path, body, { origin = ORIGIN, headers = {} } = {}) {
      const h = { ...headers };
      if (jar.size) h.Cookie = cookie();
      if (method !== 'GET' && origin) h.Origin = origin;
      if (body !== undefined) h['Content-Type'] = 'application/json';
      const r = take(await call(new Request(ORIGIN + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' })));
      let j = null; try { j = await r.clone().json(); } catch {}
      return { status: r.status, body: j, headers: r.headers };
    }
  };
}

describe('identity service', async () => {
  const g = await fakeGoogle();
  const env = { GOOGLE_OAUTH_CLIENT_ID_WETHEPEOPLE305: g.clientId, GOOGLE_OAUTH_CLIENT_SECRET_WETHEPEOPLE305: 'secret' };
  let store, events, call;
  beforeEach(() => {
    store = memoryStore();
    events = [];
    call = (request, e = env) => handleIdentity(request, e, { store, webauthn, fetch: g.fetch, jwks: jwksCache({ fetch: g.fetch }), emit: x => events.push(x) });
  });

  async function signUpWithPasskey(b, displayName) {
    const auth = await softAuthenticator({ origin: ORIGIN, rpID: 'wethepeople305.org' });
    const start = await b.req('POST', '/auth/passkey/register/options', { displayName });
    expect(start.status).toBe(200);
    const done = await b.req('POST', '/auth/passkey/register/verify', { flowId: start.body.flowId, response: await auth.create(start.body.options) });
    return { auth, done };
  }
  async function googleSignIn(b, sub, { link = false, email = false, claims = {} } = {}) {
    const start = await b.req('GET', '/auth/google' + (link ? '?link=1' + (email ? '&email=1' : '') : (email ? '?email=1' : '')));
    expect(start.status).toBe(302);
    const loc = new URL(start.headers.get('Location'));
    g.onToken(async body => {
      expect(body.get('code_verifier')).toBeTruthy();
      return { id_token: await g.sign(g.claims({ sub, nonce: loc.searchParams.get('nonce'), ...claims })) };
    });
    const cb = await b.req('GET', '/auth/google/callback?state=' + loc.searchParams.get('state') + '&code=abc');
    return { start, loc, cb, where: new URL(cb.headers.get('Location'), ORIGIN) };
  }

  it('matches only identity paths', () => {
    for (const p of ['/auth/google', '/auth/passkey/login/options', '/api/v1/me', '/api/v1/organizer-applications', '/api/v1/review/organizer-applications/app_1']) expect(isIdentityPath(p)).toBe(true);
    for (const p of ['/api/v1/your-area', '/api/v1/precinct', '/authors', '/api/v1/meeting', '/account']) expect(isIdentityPath(p)).toBe(false);
  });

  it('answers 503 with a plain message when no store is bound', async () => {
    const r = await handleIdentity(new Request(ORIGIN + '/api/v1/me'), {}, { store: null });
    expect(r.status).toBe(503);
    expect((await r.json()).error).toMatch(/not switched on/);
    const s = await handleIdentity(new Request(ORIGIN + '/auth/status'), {}, { store: null });
    expect(await s.json()).toEqual({ accounts: false, google: false });
  });

  it('creates an account with a passkey, signs in again with it, and shows the account', async () => {
    const b = browser(call);
    expect((await b.req('GET', '/api/v1/me')).status).toBe(401);
    const { auth, done } = await signUpWithPasskey(b, 'Ana');
    expect(done.status).toBe(201);
    expect(done.body).toMatchObject({ roles: ['citizen'], displayName: 'Ana', email: null, methods: { google: { linked: false } } });
    expect(done.body.methods.passkeys).toHaveLength(1);
    expect(b.jar.has(SESSION_COOKIE)).toBe(true);
    const me = await b.req('GET', '/api/v1/me');
    expect(me.status).toBe(200);
    expect(me.body.id).toBe(done.body.id);

    expect((await b.req('POST', '/auth/logout', {})).status).toBe(200);
    expect((await b.req('GET', '/api/v1/me')).status).toBe(401);

    const start = await b.req('POST', '/auth/passkey/login/options', {});
    const login = await b.req('POST', '/auth/passkey/login/verify', { flowId: start.body.flowId, response: await auth.get(start.body.options) });
    expect(login.status).toBe(200);
    expect(login.body.id).toBe(done.body.id);
    expect((await store.getCredential(auth.id)).counter).toBe(1);
    expect(events.map(e => e.event)).toContain('auth.passkey.login');
    for (const e of events) expect(JSON.stringify(e)).not.toMatch(/Ana|person@example|1234567890/);
  });

  it('refuses a passkey response from another origin, a reused challenge and a wrong user handle', async () => {
    const b = browser(call);
    const auth = await softAuthenticator({ origin: ORIGIN, rpID: 'wethepeople305.org' });
    const s1 = await b.req('POST', '/auth/passkey/register/options', {});
    const bad = await b.req('POST', '/auth/passkey/register/verify', { flowId: s1.body.flowId, response: await auth.create(s1.body.options, { originOverride: 'https://evil.example' }) });
    expect(bad.status).toBe(400);
    const s2 = await b.req('POST', '/auth/passkey/register/options', {});
    const resp = await auth.create(s2.body.options);
    expect((await b.req('POST', '/auth/passkey/register/verify', { flowId: s2.body.flowId, response: resp })).status).toBe(201);
    expect((await b.req('POST', '/auth/passkey/register/verify', { flowId: s2.body.flowId, response: resp })).status).toBe(400);

    const b2 = browser(call);
    const l = await b2.req('POST', '/auth/passkey/login/options', {});
    const wrong = await b2.req('POST', '/auth/passkey/login/verify', { flowId: l.body.flowId, response: await auth.get(l.body.options, { userHandleOverride: 'AAAAAAAAAAAAAAAAAAAAAA' }) });
    expect(wrong.status).toBe(401);
    const l2 = await b2.req('POST', '/auth/passkey/login/options', {});
    const replay = await auth.get(l2.body.options);
    expect((await b2.req('POST', '/auth/passkey/login/verify', { flowId: l2.body.flowId, response: replay })).status).toBe(200);
    expect((await b2.req('POST', '/auth/passkey/login/verify', { flowId: l2.body.flowId, response: replay })).status).toBe(400);
  });

  it('refuses state-changing requests without this site\'s Origin (CSRF)', async () => {
    const b = browser(call);
    await signUpWithPasskey(b);
    expect((await b.req('DELETE', '/api/v1/me', undefined, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await b.req('POST', '/auth/logout', {}, { origin: null })).status).toBe(403);
    expect((await b.req('GET', '/api/v1/me')).status).toBe(200);
  });

  it('Google: hidden and 503 without secrets', async () => {
    const r = await call(new Request(ORIGIN + '/auth/google'), {});
    expect(r.status).toBe(503);
    expect((await r.json()).error).toMatch(/not set up/);
    expect(await (await call(new Request(ORIGIN + '/auth/status'), {})).json()).toEqual({ accounts: true, google: false });
    expect(await (await call(new Request(ORIGIN + '/auth/status'))).json()).toEqual({ accounts: true, google: true });
  });

  it('Google: an unknown subject creates a citizen account; the same subject signs back in', async () => {
    const b = browser(call);
    const { loc, cb, where } = await googleSignIn(b, 'g-111');
    expect(loc.searchParams.get('code_challenge_method')).toBe('S256');
    expect(loc.searchParams.get('scope')).toBe('openid');
    expect(cb.status).toBe(302);
    expect(where.pathname + where.search).toBe('/account?done=created');
    const me = await b.req('GET', '/api/v1/me');
    expect(me.body).toMatchObject({ roles: ['citizen'], email: null, methods: { google: { linked: true }, passkeys: [] } });
    expect(b.jar.has(OAUTH_COOKIE)).toBe(false);

    const b2 = browser(call);
    const again = await googleSignIn(b2, 'g-111');
    expect(again.where.search).toBe('?done=signed_in');
    expect((await b2.req('GET', '/api/v1/me')).body.id).toBe(me.body.id);
  });

  it('Google: stores the email only with the consent box ticked and a verified email', async () => {
    const b = browser(call);
    await googleSignIn(b, 'g-222', { email: true });
    expect((await b.req('GET', '/api/v1/me')).body.email).toBe('person@example.com');
    const b2 = browser(call);
    await googleSignIn(b2, 'g-333', { email: true, claims: { email_verified: false } });
    expect((await b2.req('GET', '/api/v1/me')).body.email).toBeNull();
  });

  it('Google: refuses a callback with the wrong state, no state cookie, a replayed state, or a bad token', async () => {
    const b = browser(call);
    const start = await b.req('GET', '/auth/google');
    const state = new URL(start.headers.get('Location')).searchParams.get('state');
    const wrong = await b.req('GET', '/auth/google/callback?state=' + state + 'x&code=abc');
    expect(new URL(wrong.headers.get('Location'), ORIGIN).search).toBe('?error=google_state');

    const other = browser(call); // a different browser holding someone else's state (login CSRF)
    expect(new URL((await other.req('GET', '/auth/google/callback?state=' + state + '&code=abc')).headers.get('Location'), ORIGIN).search).toBe('?error=google_state');

    const b3 = browser(call);
    const s3 = await b3.req('GET', '/auth/google');
    const loc = new URL(s3.headers.get('Location'));
    g.onToken(async () => ({ id_token: await g.sign(g.claims({ nonce: 'not-the-nonce' })) }));
    const bad = await b3.req('GET', '/auth/google/callback?state=' + loc.searchParams.get('state') + '&code=abc');
    expect(new URL(bad.headers.get('Location'), ORIGIN).search).toBe('?error=google_verify');
    expect((await b3.req('GET', '/api/v1/me')).status).toBe(401);
  });

  it('Google linking: a signed-in passkey account links Google; that subject cannot link anywhere else', async () => {
    const a = browser(call);
    const { done } = await signUpWithPasskey(a);
    const linked = await googleSignIn(a, 'g-444', { link: true });
    expect(linked.where.search).toBe('?done=linked');
    expect((await a.req('GET', '/api/v1/me')).body.methods.google.linked).toBe(true);

    const other = browser(call);
    await signUpWithPasskey(other);
    const stolen = await googleSignIn(other, 'g-444', { link: true });
    expect(stolen.where.search).toBe('?error=google_linked_elsewhere');
    expect((await store.getGoogleLink('g-444')).userId).toBe(done.body.id);

    const second = await googleSignIn(a, 'g-555', { link: true });
    expect(second.where.search).toBe('?error=account_has_google');

    const signedOut = browser(call);
    const r = await signedOut.req('GET', '/auth/google?link=1');
    expect(r.headers.get('Location')).toBe('/account?error=signed_out');
  });

  it('linking rules hold without the HTTP layer', async () => {
    await createAccount(store, { id: 'u1', at: T0 });
    await createAccount(store, { id: 'u2', at: T0 });
    expect(await resolveGoogle(store, { sub: 's', linkRequested: true, signedInUserId: 'u1', at: T0 })).toEqual({ userId: 'u1', outcome: 'linked' });
    expect(await resolveGoogle(store, { sub: 's', linkRequested: true, signedInUserId: 'u1', at: T0 })).toEqual({ userId: 'u1', outcome: 'already_linked' });
    expect(await resolveGoogle(store, { sub: 's', linkRequested: true, signedInUserId: 'u2', at: T0 })).toEqual({ error: 'google_linked_elsewhere' });
    expect(await resolveGoogle(store, { sub: 's', linkRequested: true, signedInUserId: null, at: T0 })).toEqual({ error: 'signed_out' });
    expect(await resolveGoogle(store, { sub: 's', linkRequested: false, at: T0 })).toEqual({ userId: 'u1', outcome: 'signed_in' });
    const fresh = await resolveGoogle(store, { sub: 't', linkRequested: false, newId: 'u3', at: T0 });
    expect(fresh).toEqual({ userId: 'u3', outcome: 'created' });
    expect(await store.listRoles('u3')).toEqual(['citizen']);
  });

  it('updates the optional profile fields and validates them', async () => {
    const b = browser(call);
    await signUpWithPasskey(b);
    expect((await b.req('PATCH', '/api/v1/me', { precinct: '33' })).status).toBe(400);
    expect((await b.req('PATCH', '/api/v1/me', { email: 'nope' })).status).toBe(400);
    const ok = await b.req('PATCH', '/api/v1/me', { precinct: '033.0', email: 'me@example.org', displayName: 'A' });
    expect(ok.body).toMatchObject({ precinct: '033.0', email: 'me@example.org', displayName: 'A' });
    expect((await b.req('PATCH', '/api/v1/me', { email: null })).body.email).toBeNull();
  });

  it('organizer admission: apply, admin review, role granted; non-admins and self-review refused', async () => {
    const applicant = browser(call);
    const { done } = await signUpWithPasskey(applicant);
    const app = { organization: 'Overtown Neighbors', website: 'https://example.org', criteria: CRITERIA_IDS, statement: 'We attend every commission meeting and help neighbors speak.' };
    expect((await applicant.req('POST', '/api/v1/organizer-applications', { ...app, criteria: [] })).status).toBe(400);
    const sent = await applicant.req('POST', '/api/v1/organizer-applications', app);
    expect(sent.status).toBe(201);
    expect((await applicant.req('POST', '/api/v1/organizer-applications', app)).status).toBe(409);
    expect((await applicant.req('GET', '/api/v1/review/organizer-applications')).status).toBe(403);
    expect((await applicant.req('POST', '/api/v1/review/organizer-applications/' + sent.body.id, { decision: 'approve' })).status).toBe(403);

    const admin = browser(call);
    const a = await signUpWithPasskey(admin);
    await store.grantRole(a.done.body.id, 'admin', { at: T0, by: 'command' }); // what scripts/grant-admin.mjs prints
    const list = await admin.req('GET', '/api/v1/review/organizer-applications?status=pending');
    expect(list.body.applications.map(x => x.id)).toEqual([sent.body.id]);
    expect((await admin.req('POST', '/api/v1/review/organizer-applications/' + sent.body.id, { decision: 'maybe' })).status).toBe(400);
    const ok = await admin.req('POST', '/api/v1/review/organizer-applications/' + sent.body.id, { decision: 'approve', note: 'Checked the website and the clerk minutes.' });
    expect(ok.body).toMatchObject({ status: 'approved', decidedBy: a.done.body.id });
    expect((await admin.req('POST', '/api/v1/review/organizer-applications/' + sent.body.id, { decision: 'decline' })).status).toBe(409);
    expect((await applicant.req('GET', '/api/v1/me')).body.roles).toEqual(['citizen', 'organizer']);
    expect(await store.listRoles(done.body.id)).not.toContain('admin');

    // An admin cannot approve their own application.
    const own = await admin.req('POST', '/api/v1/organizer-applications', app);
    expect((await admin.req('POST', '/api/v1/review/organizer-applications/' + own.body.id, { decision: 'approve' })).status).toBe(403);
  });

  it('deletes the account with its passkeys, Google link, sessions and applications', async () => {
    const b = browser(call);
    const { auth, done } = await signUpWithPasskey(b);
    await googleSignIn(b, 'g-666', { link: true });
    await b.req('POST', '/api/v1/organizer-applications', { organization: 'Org name', criteria: CRITERIA_IDS, statement: 'A statement long enough to pass.' });
    const del = await b.req('DELETE', '/api/v1/me');
    expect(del.status).toBe(200);
    expect(b.jar.has(SESSION_COOKIE)).toBe(false);
    expect(await store.getUser(done.body.id)).toBeNull();
    expect(await store.getCredential(auth.id)).toBeNull();
    expect(await store.getGoogleLink('g-666')).toBeNull();
    expect(await store.listApplications({ userId: done.body.id })).toEqual([]);
  });
});

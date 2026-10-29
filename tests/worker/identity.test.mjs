import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF, applyD1Migrations, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../../src/worker.js';
import { softAuthenticator } from '../helpers/soft-authenticator.mjs';

// The identity routes inside the Workers runtime: the real @simplewebauthn/server and the local D1 from wrangler.toml.
const ORIGIN = 'https://wethepeople305.org';

// Call the Worker with a chosen env, to check how it behaves when a binding is missing.
async function callWith(e, path, init) {
  const ctx = createExecutionContext();
  const r = await worker.fetch(new Request(ORIGIN + path, init), e, ctx);
  await waitOnExecutionContext(ctx);
  return r;
}
const unbound = () => { const e = { ...env }; delete e.DB_WETHEPEOPLE305_ACCOUNTS; return e; };

describe('identity routes without the D1 binding', () => {
  it('answer 503 with a plain message', async () => {
    for (const [method, path] of [['GET', '/api/v1/me'], ['POST', '/auth/passkey/register/options'], ['POST', '/auth/passkey/login/options'], ['GET', '/auth/google'], ['POST', '/auth/logout'], ['POST', '/api/v1/organizer-applications']]) {
      const r = await callWith(unbound(), path, { method, headers: { Origin: ORIGIN, 'Content-Type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
      expect(r.status, method + ' ' + path).toBe(503);
      expect((await r.json()).error).toMatch(/not switched on/);
    }
    const s = await callWith(unbound(), '/auth/status');
    expect(await s.json()).toEqual({ accounts: false, google: false });
  });
  it('leave the rest of the site working', async () => {
    expect((await callWith(unbound(), '/api/v1')).status).toBe(200);
    expect((await callWith(unbound(), '/api/v1/your-area?precinct=33')).status).toBe(400);
  });
});

describe('identity routes with D1', () => {
  beforeAll(async () => { await applyD1Migrations(env.DB_WETHEPEOPLE305_ACCOUNTS, env.TEST_MIGRATIONS); });

  it('/api/v1/me is 401 signed out, and status says accounts are on and Google is off (no secrets)', async () => {
    const r = await SELF.fetch(ORIGIN + '/api/v1/me');
    expect(r.status).toBe(401);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(r.headers.get('Access-Control-Allow-Origin')).toBeNull();
    expect(await (await SELF.fetch(ORIGIN + '/auth/status')).json()).toEqual({ accounts: true, google: false });
    const g = await SELF.fetch(ORIGIN + '/auth/google', { redirect: 'manual' });
    expect(g.status).toBe(503);
    expect((await g.json()).error).toMatch(/Google sign-in is not set up/);
  });

  it('refuses a cross-site POST', async () => {
    expect((await SELF.fetch(ORIGIN + '/auth/passkey/login/options', { method: 'POST', headers: { Origin: 'https://evil.example' } })).status).toBe(403);
  });

  it('creates an account with a passkey and signs in with it, end to end in workerd', async () => {
    const auth = await softAuthenticator({ origin: ORIGIN, rpID: 'wethepeople305.org' });
    const post = (path, body, cookie) => SELF.fetch(ORIGIN + path, { method: 'POST', headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify(body) });
    const opt = await (await post('/auth/passkey/register/options', { displayName: 'Test' })).json();
    const reg = await post('/auth/passkey/register/verify', { flowId: opt.flowId, response: await auth.create(opt.options) });
    expect(reg.status).toBe(201);
    const set = reg.headers.get('Set-Cookie');
    expect(set).toMatch(/^__Host-wtp305_session=.+; Path=\/; Max-Age=2592000; HttpOnly; Secure; SameSite=Lax$/);
    const cookie = set.split(';')[0];
    const me = await (await SELF.fetch(ORIGIN + '/api/v1/me', { headers: { Cookie: cookie } })).json();
    expect(me.roles).toEqual(['citizen']);
    expect(me.methods.passkeys).toHaveLength(1);

    const lo = await (await post('/auth/passkey/login/options', {})).json();
    const login = await post('/auth/passkey/login/verify', { flowId: lo.flowId, response: await auth.get(lo.options) });
    expect(login.status).toBe(200);
    expect((await login.json()).id).toBe(me.id);

    expect((await post('/auth/logout', {}, cookie)).status).toBe(200);
    expect((await SELF.fetch(ORIGIN + '/api/v1/me', { headers: { Cookie: cookie } })).status).toBe(401);
  });

  it('serves the account and organizer pages and the passkey script', async () => {
    const a = await SELF.fetch(ORIGIN + '/account');
    expect(a.status).toBe(200);
    expect(await a.text()).toContain('Create account with a passkey');
    const o = await SELF.fetch(ORIGIN + '/organizers');
    expect(await o.text()).toContain('DRAFT');
    expect((await SELF.fetch(ORIGIN + '/js/passkey.js')).status).toBe(200);
  });

  it('adds no MCP tools for sign-in or accounts', async () => {
    const list = await (await SELF.fetch(ORIGIN + '/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) })).json();
    for (const t of list.result.tools) expect(t.name).not.toMatch(/auth|account|me$|organizer|passkey|google/i);
  });
});

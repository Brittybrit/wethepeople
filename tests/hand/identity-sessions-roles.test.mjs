import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { startSession, currentSession, endSession, sameOrigin, readCookie, SESSION_COOKIE, SESSION_MS, hashSessionId } from '../../lib/identity/sessions.mjs';
import { memoryStore } from '../../lib/identity/store.mjs';
import { checkApplication, canApply, canDecide, ORGANIZER_CRITERIA, CRITERIA_IDS, ROLES_GRANTABLE_BY_ROUTE } from '../../lib/identity/roles.mjs';
import { adminSql, adminCommand } from '../../scripts/grant-admin.mjs';

const req = (cookie, origin) => new Request('https://wethepeople305.org/x', { headers: { ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) } });
const idFrom = setCookie => decodeURIComponent(setCookie.split(';')[0].split('=').slice(1).join('='));

describe('sessions', () => {
  it('sets a __Host- cookie that is HttpOnly, Secure, SameSite=Lax, Path=/ and has no Domain', async () => {
    const s = memoryStore();
    await s.createUser({ id: 'u1', createdAt: 'x' });
    const { cookie } = await startSession(s, 'u1', 0);
    expect(cookie.startsWith(SESSION_COOKIE + '=')).toBe(true);
    expect(SESSION_COOKIE.startsWith('__Host-')).toBe(true);
    for (const a of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=' + SESSION_MS / 1000]) expect(cookie).toContain(a);
    expect(cookie).not.toMatch(/Domain=/i);
  });
  it('stores only a hash of the session id, never the id', async () => {
    const s = memoryStore();
    await s.createUser({ id: 'u1', createdAt: 'x' });
    const { cookie } = await startSession(s, 'u1', 0);
    const id = idFrom(cookie);
    expect(await s.getSession(id)).toBeNull();
    expect(await s.getSession(await hashSessionId(id))).toMatchObject({ userId: 'u1' });
    expect(id.length).toBeGreaterThanOrEqual(40);
  });
  it('finds the session, rolls the expiry after a day, and drops it once expired', async () => {
    const s = memoryStore();
    await s.createUser({ id: 'u1', createdAt: 'x' });
    const { cookie } = await startSession(s, 'u1', 0);
    const c = SESSION_COOKIE + '=' + idFrom(cookie);
    const a = await currentSession(s, req(c), 1000);
    expect(a.userId).toBe('u1');
    expect(a.cookie).toBeUndefined();
    const b = await currentSession(s, req(c), 2 * 86400 * 1000);
    expect(b.cookie).toContain('Max-Age=');
    expect(Date.parse((await s.getSession(b.idHash)).expiresAt)).toBe(2 * 86400 * 1000 + SESSION_MS);
    expect(await currentSession(s, req(c), 2 * 86400 * 1000 + SESSION_MS + 1)).toBeNull();
    expect(await s.getSession(b.idHash)).toBeNull();
  });
  it('ignores missing, malformed and unknown cookies', async () => {
    const s = memoryStore();
    expect(await currentSession(s, req(null))).toBeNull();
    expect(await currentSession(s, req(SESSION_COOKIE + '=short'))).toBeNull();
    expect(await currentSession(s, req(SESSION_COOKIE + '=' + 'a'.repeat(43)))).toBeNull();
  });
  it('revokes on sign out', async () => {
    const s = memoryStore();
    await s.createUser({ id: 'u1', createdAt: 'x' });
    const { cookie } = await startSession(s, 'u1');
    const c = SESSION_COOKIE + '=' + idFrom(cookie);
    expect(await endSession(s, req(c))).toContain('Max-Age=0');
    expect(await currentSession(s, req(c))).toBeNull();
  });
  it('reads cookies among others', () => {
    expect(readCookie(req('a=1; ' + SESSION_COOKIE + '=xyz; b=2'), SESSION_COOKIE)).toBe('xyz');
  });
  it('requires the site origin on state-changing requests', () => {
    expect(sameOrigin(req(null, 'https://wethepeople305.org'), 'https://wethepeople305.org')).toBe(true);
    expect(sameOrigin(req(null, 'https://evil.example'), 'https://wethepeople305.org')).toBe(false);
    expect(sameOrigin(req(null, null), 'https://wethepeople305.org')).toBe(false);
    expect(sameOrigin(req(null, 'null'), 'https://wethepeople305.org')).toBe(false);
  });
});

describe('roles and organizer admission', () => {
  const good = { organization: 'Overtown Neighbors', website: 'https://example.org', criteria: CRITERIA_IDS, statement: 'We attend every commission meeting and help neighbors speak.' };
  it('accepts a complete application and cleans it', () => {
    const r = checkApplication({ ...good, organization: '  Overtown Neighbors ', criteria: [...CRITERIA_IDS].reverse() });
    expect(r.value.organization).toBe('Overtown Neighbors');
    expect(r.value.criteria).toEqual(CRITERIA_IDS);
  });
  it('rejects missing fields, unknown or missing criteria and non-web links', () => {
    expect(checkApplication(null).error).toBeTruthy();
    expect(checkApplication({ ...good, organization: 'x' }).error).toMatch(/Organization/);
    expect(checkApplication({ ...good, website: 'javascript:alert(1)' }).error).toMatch(/Website/);
    expect(checkApplication({ ...good, criteria: ['made-up'] }).error).toMatch(/Criteria/);
    expect(checkApplication({ ...good, criteria: CRITERIA_IDS.slice(1) }).error).toMatch(/all of them/);
    expect(checkApplication({ ...good, statement: 'short' }).error).toMatch(/Statement/);
    expect(checkApplication({ ...good, website: '' }).value.website).toBeNull();
  });
  it('lets a citizen apply once at a time, and not an organizer', () => {
    expect(canApply(['citizen'], [])).toBeNull();
    expect(canApply([], [])).toMatch(/citizen/);
    expect(canApply(['citizen', 'organizer'], [])).toMatch(/already/);
    expect(canApply(['citizen'], [{ status: 'pending' }])).toMatch(/waiting/);
    expect(canApply(['citizen'], [{ status: 'declined' }])).toBeNull();
  });
  it('only an admin decides, never their own, only once', () => {
    const app = { id: 'a', userId: 'u2', status: 'pending' };
    expect(canDecide('u1', ['citizen', 'organizer'], app).status).toBe(403);
    expect(canDecide('u1', ['admin'], null).status).toBe(404);
    expect(canDecide('u2', ['admin'], app).status).toBe(403);
    expect(canDecide('u1', ['admin'], { ...app, status: 'approved' }).status).toBe(409);
    expect(canDecide('u1', ['admin'], app)).toBeNull();
  });
  it('no route can grant admin', () => {
    expect(ROLES_GRANTABLE_BY_ROUTE).not.toContain('admin');
    const src = readFileSync(new URL('../../lib/identity/service.mjs', import.meta.url), 'utf8');
    expect(src).not.toMatch(/grantRole\([^)]*'admin'/);
  });
  it('the draft criteria in code match the public doc and the page', () => {
    const doc = readFileSync(new URL('../../public/docs/organizer-criteria.md', import.meta.url), 'utf8');
    const page = readFileSync(new URL('../../public/organizers.html', import.meta.url), 'utf8');
    expect(doc).toMatch(/DRAFT/);
    expect(page).toMatch(/DRAFT/);
    for (const c of ORGANIZER_CRITERIA) { expect(doc).toContain(c.text); expect(page).toContain(c.text); expect(doc).toContain('`' + c.id + '`'); }
  });
});

describe('grant-admin script', () => {
  it('prints a wrangler d1 execute command for an existing account only', () => {
    const cmd = adminCommand('abcdefghijklmnopqrstuv', { at: '2026-10-29T00:00:00.000Z' });
    expect(cmd).toBe('npx wrangler d1 execute wethepeople305-accounts --remote --command "INSERT OR IGNORE INTO roles (user_id, role, granted_at, granted_by) SELECT id, \'admin\', \'2026-10-29T00:00:00.000Z\', \'command\' FROM users WHERE id = \'abcdefghijklmnopqrstuv\';"');
    expect(adminSql('abcdefghijklmnopqrstuv', { revoke: true })).toMatch(/^DELETE FROM roles/);
    expect(() => adminSql("x'; DROP TABLE users; --")).toThrow();
    expect(() => adminSql('')).toThrow();
  });
});

import { describe, it, expect, beforeEach } from 'vitest';
import { memoryStore, d1Store, storeFromEnv, LinkConflict } from '../../lib/identity/store.mjs';
import { d1FromSqlite } from '../helpers/d1-sqlite.mjs';

// One suite, both adapters: the in-memory store and the D1 store over the real migration (Node SQLite).
const adapters = { memory: () => memoryStore(), d1: () => d1Store(d1FromSqlite()) };
const T0 = '2026-10-29T12:00:00.000Z';

for (const [name, make] of Object.entries(adapters)) {
  describe('identity store: ' + name, () => {
    let s;
    beforeEach(async () => { s = make(); await s.createUser({ id: 'user_aaaaaaaaaaaaaaaa', createdAt: T0 }); });

    it('creates, reads and updates a user with only the minimal fields', async () => {
      const u = await s.getUser('user_aaaaaaaaaaaaaaaa');
      expect(u).toEqual({ id: 'user_aaaaaaaaaaaaaaaa', createdAt: T0, displayName: null, email: null, precinct: null });
      await s.updateUser(u.id, { displayName: 'Ana', precinct: '033.0' });
      await s.updateUser(u.id, { email: 'a@example.com' });
      expect(await s.getUser(u.id)).toMatchObject({ displayName: 'Ana', email: 'a@example.com', precinct: '033.0' });
      await s.updateUser(u.id, { displayName: null });
      expect((await s.getUser(u.id)).displayName).toBeNull();
      expect(await s.getUser('nobody')).toBeNull();
      expect(await s.updateUser('nobody', { displayName: 'x' })).toBeNull();
    });

    it('grants roles idempotently and revokes them', async () => {
      await s.grantRole('user_aaaaaaaaaaaaaaaa', 'citizen', { at: T0, by: 'signup' });
      await s.grantRole('user_aaaaaaaaaaaaaaaa', 'citizen', { at: T0, by: 'signup' });
      await s.grantRole('user_aaaaaaaaaaaaaaaa', 'organizer', { at: T0, by: 'application:x' });
      expect(await s.listRoles('user_aaaaaaaaaaaaaaaa')).toEqual(['citizen', 'organizer']);
      await s.revokeRole('user_aaaaaaaaaaaaaaaa', 'organizer');
      expect(await s.listRoles('user_aaaaaaaaaaaaaaaa')).toEqual(['citizen']);
    });

    it('stores passkey public keys and updates their counter', async () => {
      await s.addCredential({ id: 'cred1', userId: 'user_aaaaaaaaaaaaaaaa', publicKey: 'pk', counter: 0, transports: ['internal'], createdAt: T0 });
      expect(await s.getCredential('cred1')).toMatchObject({ userId: 'user_aaaaaaaaaaaaaaaa', publicKey: 'pk', counter: 0, transports: ['internal'], lastUsedAt: null });
      await s.updateCredentialUse('cred1', { counter: 5, at: T0 });
      expect(await s.getCredential('cred1')).toMatchObject({ counter: 5, lastUsedAt: T0 });
      expect(await s.listCredentials('user_aaaaaaaaaaaaaaaa')).toHaveLength(1);
      await expect(s.addCredential({ id: 'cred1', userId: 'user_aaaaaaaaaaaaaaaa', publicKey: 'x', createdAt: T0 })).rejects.toThrow();
    });

    it('links a Google subject to at most one account and an account to at most one subject', async () => {
      await s.createUser({ id: 'user_bbbbbbbbbbbbbbbb', createdAt: T0 });
      await s.addGoogleLink({ sub: 'g1', userId: 'user_aaaaaaaaaaaaaaaa', at: T0 });
      await expect(s.addGoogleLink({ sub: 'g1', userId: 'user_bbbbbbbbbbbbbbbb', at: T0 })).rejects.toBeInstanceOf(LinkConflict);
      await expect(s.addGoogleLink({ sub: 'g2', userId: 'user_aaaaaaaaaaaaaaaa', at: T0 })).rejects.toThrow('account_has_google');
      expect(await s.getGoogleLink('g1')).toMatchObject({ userId: 'user_aaaaaaaaaaaaaaaa' });
      expect(await s.getGoogleLinkForUser('user_aaaaaaaaaaaaaaaa')).toMatchObject({ sub: 'g1' });
      expect(await s.getGoogleLinkForUser('user_bbbbbbbbbbbbbbbb')).toBeNull();
    });

    it('keeps sessions by hash, refreshes and revokes them', async () => {
      await s.createSession({ idHash: 'h1', userId: 'user_aaaaaaaaaaaaaaaa', createdAt: T0, expiresAt: '2026-11-28T12:00:00.000Z' });
      expect(await s.getSession('h1')).toMatchObject({ userId: 'user_aaaaaaaaaaaaaaaa', refreshedAt: T0 });
      await s.refreshSession('h1', { expiresAt: '2026-12-01T00:00:00.000Z', at: '2026-11-01T00:00:00.000Z' });
      expect(await s.getSession('h1')).toMatchObject({ expiresAt: '2026-12-01T00:00:00.000Z', refreshedAt: '2026-11-01T00:00:00.000Z' });
      await s.deleteSession('h1');
      expect(await s.getSession('h1')).toBeNull();
      await s.createSession({ idHash: 'h2', userId: 'user_aaaaaaaaaaaaaaaa', createdAt: T0, expiresAt: T0 });
      await s.createSession({ idHash: 'h3', userId: 'user_aaaaaaaaaaaaaaaa', createdAt: T0, expiresAt: '2027-01-01T00:00:00.000Z' });
      await s.purgeExpired('2026-10-30T00:00:00.000Z');
      expect(await s.getSession('h2')).toBeNull();
      await s.deleteSessionsForUser('user_aaaaaaaaaaaaaaaa');
      expect(await s.getSession('h3')).toBeNull();
    });

    it('takes a flow once, and not after it expires or under the wrong kind', async () => {
      await s.putFlow({ id: 'f1', kind: 'google', data: { nonce: 'n' }, expiresAt: '2026-10-29T12:10:00.000Z' });
      expect(await s.takeFlow('f1', 'google', T0)).toEqual({ nonce: 'n' });
      expect(await s.takeFlow('f1', 'google', T0)).toBeNull();
      await s.putFlow({ id: 'f2', kind: 'google', data: {}, expiresAt: T0 });
      expect(await s.takeFlow('f2', 'google', '2026-10-29T12:00:01.000Z')).toBeNull();
      await s.putFlow({ id: 'f3', kind: 'passkey.login', data: {}, expiresAt: '2026-10-29T12:10:00.000Z' });
      expect(await s.takeFlow('f3', 'google', T0)).toBeNull();
      expect(await s.takeFlow('f3', 'passkey.login', T0)).toBeNull(); // consumed by the wrong-kind attempt
    });

    it('records organizer applications and decides each once', async () => {
      const a = await s.createApplication({ id: 'app_1', userId: 'user_aaaaaaaaaaaaaaaa', organization: 'Org', website: null, criteria: ['a', 'b'], statement: 's', createdAt: T0 });
      expect(a).toMatchObject({ id: 'app_1', status: 'pending', criteria: ['a', 'b'] });
      expect(await s.listApplications({ status: 'pending' })).toHaveLength(1);
      expect(await s.decideApplication('app_1', { status: 'approved', at: T0, by: 'admin', note: null })).toBe(true);
      expect(await s.decideApplication('app_1', { status: 'declined', at: T0, by: 'admin', note: null })).toBe(false);
      expect(await s.getApplication('app_1')).toMatchObject({ status: 'approved', decidedBy: 'admin' });
      expect(await s.listApplications({ status: 'pending' })).toHaveLength(0);
      expect(await s.listApplications({ userId: 'user_aaaaaaaaaaaaaaaa' })).toHaveLength(1);
    });

    it('deletes a user and everything that belongs to them', async () => {
      await s.grantRole('user_aaaaaaaaaaaaaaaa', 'citizen', { at: T0, by: 'signup' });
      await s.addCredential({ id: 'c', userId: 'user_aaaaaaaaaaaaaaaa', publicKey: 'pk', createdAt: T0 });
      await s.addGoogleLink({ sub: 'g', userId: 'user_aaaaaaaaaaaaaaaa', at: T0 });
      await s.createSession({ idHash: 'h', userId: 'user_aaaaaaaaaaaaaaaa', createdAt: T0, expiresAt: '2027-01-01T00:00:00.000Z' });
      await s.createApplication({ id: 'app_2', userId: 'user_aaaaaaaaaaaaaaaa', organization: 'O', criteria: [], statement: 's', createdAt: T0 });
      await s.deleteUser('user_aaaaaaaaaaaaaaaa');
      expect(await s.getUser('user_aaaaaaaaaaaaaaaa')).toBeNull();
      expect(await s.listRoles('user_aaaaaaaaaaaaaaaa')).toEqual([]);
      expect(await s.getCredential('c')).toBeNull();
      expect(await s.getGoogleLink('g')).toBeNull();
      expect(await s.getSession('h')).toBeNull();
      expect(await s.getApplication('app_2')).toBeNull();
    });
  });
}

describe('storeFromEnv', () => {
  it('picks D1 when bound, memory only when asked, and nothing otherwise', () => {
    expect(storeFromEnv({ DB_WETHEPEOPLE305_ACCOUNTS: d1FromSqlite() }).kind).toBe('d1');
    expect(storeFromEnv({ IDENTITY_STORE: 'memory' }).kind).toBe('memory');
    expect(storeFromEnv({})).toBeNull();
    expect(storeFromEnv(undefined)).toBeNull();
  });
  it('the schema has no column for a legal name, address, phone or IP', () => {
    const db = d1FromSqlite().raw;
    const cols = db.prepare("SELECT m.name AS t, p.name AS c FROM sqlite_master m JOIN pragma_table_info(m.name) p WHERE m.type = 'table'").all().map(r => r.c);
    for (const c of cols) expect(c).not.toMatch(/address|phone|ip_|^ip$|first_name|last_name|legal|street|ssn|birth/i);
  });
});

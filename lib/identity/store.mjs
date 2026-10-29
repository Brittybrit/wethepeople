// Identity store: one interface, two adapters (architecture section 3).
//   d1Store(db)    Cloudflare D1 (binding DB_WETHEPEOPLE305_ACCOUNTS), schema in migrations/0001_accounts.sql
//   memoryStore()  in-process, for tests and local dev without D1
// Every method is async. Times are ISO 8601 strings. Callers pass ids; the store never invents meaning.
//
// Interface:
//   createUser({ id, createdAt, displayName?, email? }) -> user
//   getUser(id) -> user | null                         user = { id, createdAt, displayName, email, precinct }
//   updateUser(id, { displayName?, email?, precinct? }) -> user | null   (undefined = leave, null = clear)
//   deleteUser(id)                                     removes the user and every row that belongs to them
//   listRoles(userId) -> string[]
//   grantRole(userId, role, { at, by })                idempotent
//   revokeRole(userId, role)
//   addCredential({ id, userId, publicKey, counter, transports, createdAt })
//   getCredential(id) -> credential | null             credential = { id, userId, publicKey, counter, transports, createdAt, lastUsedAt }
//   listCredentials(userId) -> credential[]
//   updateCredentialUse(id, { counter, at })
//   addGoogleLink({ sub, userId, at })                 throws LinkConflict if sub or user is already linked
//   getGoogleLink(sub) -> { sub, userId, linkedAt } | null
//   getGoogleLinkForUser(userId) -> link | null
//   createSession({ idHash, userId, createdAt, expiresAt })
//   getSession(idHash) -> { idHash, userId, createdAt, expiresAt, refreshedAt } | null
//   refreshSession(idHash, { expiresAt, at })
//   deleteSession(idHash)
//   deleteSessionsForUser(userId)
//   putFlow({ id, kind, data, expiresAt })
//   takeFlow(id, kind, now) -> data | null             one use: the row is deleted whether or not it has expired
//   createApplication({ id, userId, organization, website, criteria, statement, createdAt })
//   getApplication(id) -> application | null
//   listApplications({ status?, userId? }) -> application[]   newest first
//   decideApplication(id, { status, at, by, note })    only from 'pending'; returns true if it changed
//   purgeExpired(now)                                  drops expired sessions and flows

export class LinkConflict extends Error {
  constructor(reason) { super(reason); this.name = 'LinkConflict'; this.reason = reason; }
}

const userRow = r => r && { id: r.id, createdAt: r.created_at, displayName: r.display_name ?? null, email: r.email ?? null, precinct: r.precinct ?? null };
const credRow = r => r && { id: r.id, userId: r.user_id, publicKey: r.public_key, counter: r.counter, transports: r.transports ? JSON.parse(r.transports) : [], createdAt: r.created_at, lastUsedAt: r.last_used_at ?? null };
const appRow = r => r && { id: r.id, userId: r.user_id, organization: r.organization, website: r.website ?? null, criteria: JSON.parse(r.criteria), statement: r.statement, status: r.status, createdAt: r.created_at, decidedAt: r.decided_at ?? null, decidedBy: r.decided_by ?? null, decisionNote: r.decision_note ?? null };
const sessRow = r => r && { idHash: r.id_hash, userId: r.user_id, createdAt: r.created_at, expiresAt: r.expires_at, refreshedAt: r.refreshed_at };

export function d1Store(db) {
  const one = (sql, ...args) => db.prepare(sql).bind(...args).first();
  const all = async (sql, ...args) => (await db.prepare(sql).bind(...args).all()).results || [];
  const run = (sql, ...args) => db.prepare(sql).bind(...args).run();
  return {
    kind: 'd1',
    async createUser({ id, createdAt, displayName = null, email = null }) {
      await run('INSERT INTO users (id, created_at, display_name, email) VALUES (?, ?, ?, ?)', id, createdAt, displayName, email);
      return { id, createdAt, displayName, email, precinct: null };
    },
    async getUser(id) { return userRow(await one('SELECT * FROM users WHERE id = ?', id)); },
    async updateUser(id, patch) {
      const cur = await this.getUser(id);
      if (!cur) return null;
      const next = { ...cur };
      for (const k of ['displayName', 'email', 'precinct']) if (patch[k] !== undefined) next[k] = patch[k];
      await run('UPDATE users SET display_name = ?, email = ?, precinct = ? WHERE id = ?', next.displayName, next.email, next.precinct, id);
      return next;
    },
    async deleteUser(id) {
      // Explicit deletes so the result does not depend on the foreign_keys pragma.
      await db.batch(['sessions', 'credentials', 'google_links', 'roles', 'organizer_applications'].map(t => db.prepare('DELETE FROM ' + t + ' WHERE user_id = ?').bind(id)).concat(db.prepare('DELETE FROM users WHERE id = ?').bind(id)));
    },
    async listRoles(userId) { return (await all('SELECT role FROM roles WHERE user_id = ? ORDER BY role', userId)).map(r => r.role); },
    async grantRole(userId, role, { at, by }) { await run('INSERT OR IGNORE INTO roles (user_id, role, granted_at, granted_by) VALUES (?, ?, ?, ?)', userId, role, at, by); },
    async revokeRole(userId, role) { await run('DELETE FROM roles WHERE user_id = ? AND role = ?', userId, role); },
    async addCredential({ id, userId, publicKey, counter = 0, transports = [], createdAt }) {
      await run('INSERT INTO credentials (id, user_id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?, ?)', id, userId, publicKey, counter, JSON.stringify(transports || []), createdAt);
    },
    async getCredential(id) { return credRow(await one('SELECT * FROM credentials WHERE id = ?', id)); },
    async listCredentials(userId) { return (await all('SELECT * FROM credentials WHERE user_id = ? ORDER BY created_at', userId)).map(credRow); },
    async updateCredentialUse(id, { counter, at }) { await run('UPDATE credentials SET counter = ?, last_used_at = ? WHERE id = ?', counter, at, id); },
    async addGoogleLink({ sub, userId, at }) {
      if (await one('SELECT sub FROM google_links WHERE sub = ?', sub)) throw new LinkConflict('google_linked_elsewhere');
      if (await one('SELECT sub FROM google_links WHERE user_id = ?', userId)) throw new LinkConflict('account_has_google');
      try { await run('INSERT INTO google_links (sub, user_id, linked_at) VALUES (?, ?, ?)', sub, userId, at); }
      catch (e) { throw new LinkConflict('google_linked_elsewhere'); }
    },
    async getGoogleLink(sub) { const r = await one('SELECT * FROM google_links WHERE sub = ?', sub); return r && { sub: r.sub, userId: r.user_id, linkedAt: r.linked_at }; },
    async getGoogleLinkForUser(userId) { const r = await one('SELECT * FROM google_links WHERE user_id = ?', userId); return r && { sub: r.sub, userId: r.user_id, linkedAt: r.linked_at }; },
    async createSession({ idHash, userId, createdAt, expiresAt }) { await run('INSERT INTO sessions (id_hash, user_id, created_at, expires_at, refreshed_at) VALUES (?, ?, ?, ?, ?)', idHash, userId, createdAt, expiresAt, createdAt); },
    async getSession(idHash) { return sessRow(await one('SELECT * FROM sessions WHERE id_hash = ?', idHash)); },
    async refreshSession(idHash, { expiresAt, at }) { await run('UPDATE sessions SET expires_at = ?, refreshed_at = ? WHERE id_hash = ?', expiresAt, at, idHash); },
    async deleteSession(idHash) { await run('DELETE FROM sessions WHERE id_hash = ?', idHash); },
    async deleteSessionsForUser(userId) { await run('DELETE FROM sessions WHERE user_id = ?', userId); },
    async putFlow({ id, kind, data, expiresAt }) { await run('INSERT INTO auth_flows (id, kind, data, expires_at) VALUES (?, ?, ?, ?)', id, kind, JSON.stringify(data), expiresAt); },
    async takeFlow(id, kind, now) {
      const r = await one('DELETE FROM auth_flows WHERE id = ? RETURNING kind, data, expires_at', id);
      if (!r || r.kind !== kind || r.expires_at <= now) return null;
      return JSON.parse(r.data);
    },
    async createApplication({ id, userId, organization, website = null, criteria, statement, createdAt }) {
      await run('INSERT INTO organizer_applications (id, user_id, organization, website, criteria, statement, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', id, userId, organization, website, JSON.stringify(criteria), statement, createdAt);
      return this.getApplication(id);
    },
    async getApplication(id) { return appRow(await one('SELECT * FROM organizer_applications WHERE id = ?', id)); },
    async listApplications({ status, userId } = {}) {
      const where = [], args = [];
      if (status) { where.push('status = ?'); args.push(status); }
      if (userId) { where.push('user_id = ?'); args.push(userId); }
      return (await all('SELECT * FROM organizer_applications' + (where.length ? ' WHERE ' + where.join(' AND ') : '') + ' ORDER BY created_at DESC', ...args)).map(appRow);
    },
    async decideApplication(id, { status, at, by, note = null }) {
      const r = await run("UPDATE organizer_applications SET status = ?, decided_at = ?, decided_by = ?, decision_note = ? WHERE id = ? AND status = 'pending'", status, at, by, note, id);
      return (r.meta && r.meta.changes) > 0;
    },
    async purgeExpired(now) {
      await db.batch([db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now), db.prepare('DELETE FROM auth_flows WHERE expires_at <= ?').bind(now)]);
    }
  };
}

export function memoryStore() {
  const users = new Map(), roles = new Map(), creds = new Map(), links = new Map(), sessions = new Map(), flows = new Map(), apps = new Map();
  const copy = x => x && structuredClone(x);
  return {
    kind: 'memory',
    async createUser({ id, createdAt, displayName = null, email = null }) {
      if (users.has(id)) throw new Error('user exists');
      const u = { id, createdAt, displayName, email, precinct: null };
      users.set(id, u); roles.set(id, new Map());
      return copy(u);
    },
    async getUser(id) { return copy(users.get(id)) || null; },
    async updateUser(id, patch) {
      const u = users.get(id);
      if (!u) return null;
      for (const k of ['displayName', 'email', 'precinct']) if (patch[k] !== undefined) u[k] = patch[k];
      return copy(u);
    },
    async deleteUser(id) {
      users.delete(id); roles.delete(id);
      for (const [k, c] of creds) if (c.userId === id) creds.delete(k);
      for (const [k, l] of links) if (l.userId === id) links.delete(k);
      for (const [k, s] of sessions) if (s.userId === id) sessions.delete(k);
      for (const [k, a] of apps) if (a.userId === id) apps.delete(k);
    },
    async listRoles(userId) { return [...(roles.get(userId) || new Map()).keys()].sort(); },
    async grantRole(userId, role, { at, by }) {
      if (!users.has(userId)) throw new Error('no such user');
      const m = roles.get(userId);
      if (!m.has(role)) m.set(role, { at, by });
    },
    async revokeRole(userId, role) { roles.get(userId)?.delete(role); },
    async addCredential({ id, userId, publicKey, counter = 0, transports = [], createdAt }) {
      if (creds.has(id)) throw new Error('credential exists');
      creds.set(id, { id, userId, publicKey, counter, transports: transports || [], createdAt, lastUsedAt: null });
    },
    async getCredential(id) { return copy(creds.get(id)) || null; },
    async listCredentials(userId) { return [...creds.values()].filter(c => c.userId === userId).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map(copy); },
    async updateCredentialUse(id, { counter, at }) { const c = creds.get(id); if (c) { c.counter = counter; c.lastUsedAt = at; } },
    async addGoogleLink({ sub, userId, at }) {
      if (links.has(sub)) throw new LinkConflict('google_linked_elsewhere');
      if ([...links.values()].some(l => l.userId === userId)) throw new LinkConflict('account_has_google');
      links.set(sub, { sub, userId, linkedAt: at });
    },
    async getGoogleLink(sub) { return copy(links.get(sub)) || null; },
    async getGoogleLinkForUser(userId) { return copy([...links.values()].find(l => l.userId === userId)) || null; },
    async createSession({ idHash, userId, createdAt, expiresAt }) { sessions.set(idHash, { idHash, userId, createdAt, expiresAt, refreshedAt: createdAt }); },
    async getSession(idHash) { return copy(sessions.get(idHash)) || null; },
    async refreshSession(idHash, { expiresAt, at }) { const s = sessions.get(idHash); if (s) { s.expiresAt = expiresAt; s.refreshedAt = at; } },
    async deleteSession(idHash) { sessions.delete(idHash); },
    async deleteSessionsForUser(userId) { for (const [k, s] of sessions) if (s.userId === userId) sessions.delete(k); },
    async putFlow({ id, kind, data, expiresAt }) { flows.set(id, { kind, data: JSON.stringify(data), expiresAt }); },
    async takeFlow(id, kind, now) {
      const f = flows.get(id);
      flows.delete(id);
      if (!f || f.kind !== kind || f.expiresAt <= now) return null;
      return JSON.parse(f.data);
    },
    async createApplication({ id, userId, organization, website = null, criteria, statement, createdAt }) {
      apps.set(id, { id, userId, organization, website, criteria: [...criteria], statement, status: 'pending', createdAt, decidedAt: null, decidedBy: null, decisionNote: null });
      return copy(apps.get(id));
    },
    async getApplication(id) { return copy(apps.get(id)) || null; },
    async listApplications({ status, userId } = {}) {
      return [...apps.values()].filter(a => (!status || a.status === status) && (!userId || a.userId === userId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(copy);
    },
    async decideApplication(id, { status, at, by, note = null }) {
      const a = apps.get(id);
      if (!a || a.status !== 'pending') return false;
      Object.assign(a, { status, decidedAt: at, decidedBy: by, decisionNote: note });
      return true;
    },
    async purgeExpired(now) {
      for (const [k, s] of sessions) if (s.expiresAt <= now) sessions.delete(k);
      for (const [k, f] of flows) if (f.expiresAt <= now) flows.delete(k);
    }
  };
}

// Config picks the adapter; code never names a vendor beyond this function.
// D1 when the binding exists; the in-memory store only when IDENTITY_STORE = "memory" (local dev); otherwise null (503).
let devMemory = null;
export function storeFromEnv(env) {
  if (env && env.DB_WETHEPEOPLE305_ACCOUNTS) return d1Store(env.DB_WETHEPEOPLE305_ACCOUNTS);
  if (env && env.IDENTITY_STORE === 'memory') return (devMemory ||= memoryStore());
  return null;
}

-- Accounts for wethepeople305.org (the identity service). D1 database: wethepeople305-accounts,
-- binding DB_WETHEPEOPLE305_ACCOUNTS. Apply with:
--   npx wrangler d1 migrations apply wethepeople305-accounts --remote
-- Privacy by construction: no column for a legal name, a street address, a phone number or an IP address.
-- See public/docs/identity.md and public/docs/privacy.md.

-- One row per account. display_name and email are optional and set only by the person
-- (email also when they link Google and tick the box to save Google's email). precinct is optional and user-chosen.
CREATE TABLE users (
  id TEXT PRIMARY KEY,                 -- random, base64url; also the WebAuthn user handle
  created_at TEXT NOT NULL,            -- ISO 8601
  display_name TEXT,
  email TEXT,
  precinct TEXT
);

-- Roles a person holds. "citizen" on creation; "organizer" by an approved application; "admin" only by
-- scripts/grant-admin.mjs (no route can grant it).
CREATE TABLE roles (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('citizen', 'organizer', 'admin')),
  granted_at TEXT NOT NULL,
  granted_by TEXT NOT NULL,            -- 'signup', 'application:<id>' or 'command'
  PRIMARY KEY (user_id, role)
);

-- Passkeys: the public key only. The private key never leaves the person's device.
CREATE TABLE credentials (
  id TEXT PRIMARY KEY,                 -- WebAuthn credential id, base64url
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,            -- COSE public key, base64url
  counter INTEGER NOT NULL DEFAULT 0,
  transports TEXT,                     -- JSON array, as the browser reported it
  created_at TEXT NOT NULL,
  last_used_at TEXT
);
CREATE INDEX credentials_user ON credentials(user_id);

-- A Google account (its OpenID subject id) is linked to at most one account, and an account to at most one Google account.
CREATE TABLE google_links (
  sub TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL
);

-- Sessions: only a SHA-256 hash of the cookie value is stored, so a copy of this table cannot be used to sign in.
CREATE TABLE sessions (
  id_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  refreshed_at TEXT NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE INDEX sessions_expires ON sessions(expires_at);

-- Short-lived sign-in ceremonies: a WebAuthn challenge or a Google state/nonce/PKCE verifier. One use, 10 minutes.
CREATE TABLE auth_flows (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,                  -- 'passkey.register', 'passkey.login', 'google'
  data TEXT NOT NULL,                  -- JSON
  expires_at TEXT NOT NULL
);
CREATE INDEX auth_flows_expires ON auth_flows(expires_at);

-- Applications for the organizer role, reviewed by an admin against the published criteria.
CREATE TABLE organizer_applications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization TEXT NOT NULL,
  website TEXT,
  criteria TEXT NOT NULL,              -- JSON array of criterion ids the applicant says they meet
  statement TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'declined')),
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT,                     -- admin's account id
  decision_note TEXT
);
CREATE INDEX organizer_applications_status ON organizer_applications(status, created_at);
CREATE INDEX organizer_applications_user ON organizer_applications(user_id);

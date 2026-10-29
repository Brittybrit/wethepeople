// Prints the exact command that grants (or revokes) the admin role. No route can grant admin; only the founder,
// by running the printed command against the production database. This script changes nothing by itself.
//
//   node scripts/grant-admin.mjs <account id>            print the grant command
//   node scripts/grant-admin.mjs <account id> --revoke   print the revoke command
//
// The account id is shown on /account when signed in ("Account id"), and returned by GET /api/v1/me.

export const DATABASE = 'wethepeople305-accounts';
const ID = /^[A-Za-z0-9_-]{16,64}$/;

export function adminSql(userId, { revoke = false, at = new Date().toISOString() } = {}) {
  if (!ID.test(userId || '')) throw new Error('Account id must be 16 to 64 letters, digits, "-" or "_" (copy it from /account).');
  if (revoke) return "DELETE FROM roles WHERE user_id = '" + userId + "' AND role = 'admin';";
  return "INSERT OR IGNORE INTO roles (user_id, role, granted_at, granted_by) SELECT id, 'admin', '" + at + "', 'command' FROM users WHERE id = '" + userId + "';";
}

export function adminCommand(userId, opts) {
  return 'npx wrangler d1 execute ' + DATABASE + ' --remote --command "' + adminSql(userId, opts) + '"';
}

if (import.meta.url === 'file://' + process.argv[1]) {
  const [id, flag] = process.argv.slice(2);
  try {
    const revoke = flag === '--revoke';
    console.log(adminCommand(id, { revoke }));
    console.log('\nThen check it with:\nnpx wrangler d1 execute ' + DATABASE + " --remote --command \"SELECT user_id, role, granted_at, granted_by FROM roles WHERE user_id = '" + id + "';\"");
  } catch (e) { console.error(e.message); process.exit(1); }
}

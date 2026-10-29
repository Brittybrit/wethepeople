// Roles and the organizer admission rules.
//   citizen    anyone, on account creation
//   organizer  granted when an admin approves an application against the published criteria (public/docs/organizer-criteria.md)
//   admin      granted only by a command the founder runs (scripts/grant-admin.mjs); no route can grant it
// A person can hold several roles.

export const ROLES = ['citizen', 'organizer', 'admin'];
export const ROLES_GRANTABLE_BY_ROUTE = ['organizer'];

// DRAFT criteria, pending the founder's approval. Same text as public/docs/organizer-criteria.md; a test keeps them in step.
export const ORGANIZER_CRITERIA = [
  { id: 'miami-dade-civic-work', text: 'The organization does civic work in Miami-Dade County: for example attending public meetings, public comment, voter education, or neighborhood service.' },
  { id: 'verifiable-public-presence', text: 'The organization can be checked in public: a website, a public social media page, a Florida corporation record, or a listing of its public meetings.' },
  { id: 'not-a-campaign', text: 'The organization is not a candidate, a campaign, a political party, or a political committee, and is not run by one.' },
  { id: 'named-contact-for-review', text: 'The organization has someone who can answer questions from the reviewer about this application.' },
  { id: 'code-of-conduct', text: 'The organization agrees to the project Code of Conduct and to use organizer tools within it.' }
];
export const CRITERIA_IDS = ORGANIZER_CRITERIA.map(c => c.id);

export const hasRole = (roles, role) => Array.isArray(roles) && roles.includes(role);

const isHttpsUrl = s => { try { const u = new URL(s); return u.protocol === 'https:' || u.protocol === 'http:'; } catch { return false; } };
const text = v => typeof v === 'string' ? v.trim() : '';

// Check an organizer application. Returns { error } or { value } with clean fields.
// All criteria must be ticked under the draft rules; the reviewer still checks each one.
export function checkApplication(input) {
  if (!input || typeof input !== 'object') return { error: 'Send the application as JSON.' };
  const organization = text(input.organization);
  if (organization.length < 2 || organization.length > 200) return { error: 'Organization: 2 to 200 characters.' };
  let website = text(input.website) || null;
  if (website && (website.length > 300 || !isHttpsUrl(website))) return { error: 'Website: a full link starting with https://, or leave it blank.' };
  if (!Array.isArray(input.criteria) || input.criteria.some(c => !CRITERIA_IDS.includes(c))) return { error: 'Criteria: tick the published criteria you meet.' };
  const criteria = CRITERIA_IDS.filter(c => input.criteria.includes(c));
  if (criteria.length !== CRITERIA_IDS.length) return { error: 'Under the current criteria, an organization must meet all of them. Tick each one you meet; if one does not fit, write to us instead.' };
  const statement = text(input.statement);
  if (statement.length < 20 || statement.length > 1000) return { error: 'Statement: 20 to 1,000 characters on what your organization does in Miami-Dade.' };
  return { value: { organization, website, criteria, statement } };
}

// Who may apply: a signed-in citizen with no pending application who is not already an organizer.
export function canApply(roles, existing) {
  if (!hasRole(roles, 'citizen')) return 'Only a citizen account can apply.';
  if (hasRole(roles, 'organizer')) return 'This account is already an organizer.';
  if ((existing || []).some(a => a.status === 'pending')) return 'You already have an application waiting for review.';
  return null;
}

// Review: only an admin, never on their own application, and only a pending one.
export function canDecide(reviewerId, reviewerRoles, application) {
  if (!hasRole(reviewerRoles, 'admin')) return { status: 403, error: 'Admins only.' };
  if (!application) return { status: 404, error: 'No such application.' };
  if (application.userId === reviewerId) return { status: 403, error: 'An admin cannot decide their own application.' };
  if (application.status !== 'pending') return { status: 409, error: 'This application has already been decided.' };
  return null;
}

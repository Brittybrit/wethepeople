// Checks data/roster-additions/ before it is merged into the platform roster.
// Usage: node scripts/check-roster-additions.mjs [path/to/roster.json]
// Default roster path: ../vote-informed/public/data/roster.json (relative to this repo).
// Exits 1 and lists every problem if a check fails.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const additionsDir = resolve(repoRoot, 'data/roster-additions');
export const defaultRosterPath = resolve(repoRoot, '../vote-informed/public/data/roster.json');

const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (s) => isoDate.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const SELECTIONS = new Set(['appointed', 'elected', 'ex-officio']);
const LEVELS = new Set(['municipal', 'county', 'school', 'special-district', 'state']);

export function loadAdditions(dir = additionsDir) {
  const read = (f) => JSON.parse(readFileSync(resolve(dir, f), 'utf8'));
  return { people: read('people.json'), offices: read('offices.json'), terms: read('terms.json') };
}

// Returns a list of problems (empty when everything passes).
// roster is the parsed platform roster.json, or null to skip the collision check
// (and the check that references outside this folder resolve).
export function checkRosterAdditions({ people, offices, terms }, roster = null) {
  const problems = [];
  const dupes = (list, label) => {
    const seen = new Set();
    for (const x of list) {
      if (typeof x.id !== 'string' || !x.id) problems.push(`${label} without an id: ${JSON.stringify(x).slice(0, 80)}`);
      else if (seen.has(x.id)) problems.push(`duplicate ${label} id: ${x.id}`);
      seen.add(x.id);
    }
    return seen;
  };
  const personIds = dupes(people, 'person');
  const officeIds = dupes(offices, 'office');

  const rosterPeople = new Set((roster?.people ?? []).map((p) => p.id));
  const rosterOffices = new Set((roster?.offices ?? []).map((o) => o.id));
  if (roster) {
    for (const id of personIds) if (rosterPeople.has(id)) problems.push(`person id already in roster.json (reuse it instead of adding it): ${id}`);
    for (const id of officeIds) if (rosterOffices.has(id)) problems.push(`office id already in roster.json: ${id}`);
  }

  for (const o of offices) {
    if (!SELECTIONS.has(o.selection)) problems.push(`office ${o.id}: selection must be appointed, elected or ex-officio, got ${o.selection}`);
    if (!LEVELS.has(o.level)) problems.push(`office ${o.id}: unknown level ${o.level}`);
    for (const f of ['name', 'jurisdiction', 'body', 'kind', 'actionScope']) if (!o[f]) problems.push(`office ${o.id}: missing ${f}`);
  }

  for (const [i, t] of terms.entries()) {
    const at = `term ${i} (${t.person} / ${t.office})`;
    const knownPerson = personIds.has(t.person) || rosterPeople.has(t.person);
    const knownOffice = officeIds.has(t.office) || rosterOffices.has(t.office);
    // Without roster.json, a reference to a person or office outside this folder cannot be resolved; it is not an error then.
    if (!knownPerson && roster) problems.push(`${at}: person not found in people.json or roster.json`);
    if (!knownOffice && roster) problems.push(`${at}: office not found in offices.json or roster.json`);
    if (!Array.isArray(t.sources) || t.sources.length === 0) problems.push(`${at}: no source URL`);
    else for (const s of t.sources) if (!/^https?:\/\/\S+$/.test(s)) problems.push(`${at}: source is not a URL: ${s}`);
    if (!t.sourceKind) problems.push(`${at}: missing sourceKind`);
    for (const f of ['start', 'end', 'servingFrom', 'lastSeen', 'appointedOn', 'electedOn']) {
      if (t[f] != null && !validDate(t[f])) problems.push(`${at}: ${f} is not a YYYY-MM-DD date: ${t[f]}`);
    }
    if (t.termExpires != null && !/^\d{4}-\d{2}-\d{2}$|^(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}$/.test(t.termExpires)) {
      problems.push(`${at}: termExpires must be YYYY-MM-DD or "Month YYYY": ${t.termExpires}`);
    }
    if (t.termExpires && isoDate.test(t.termExpires) && !validDate(t.termExpires)) problems.push(`${at}: termExpires is not a real date: ${t.termExpires}`);
    if (t.start == null && t.startKnown !== false) problems.push(`${at}: start is null but startKnown is not false`);
    if (t.start && t.end && t.end < t.start) problems.push(`${at}: end is before start`);
  }
  return problems;
}

function main() {
  const rosterPath = resolve(process.argv[2] ?? defaultRosterPath);
  let roster = null;
  if (existsSync(rosterPath)) roster = JSON.parse(readFileSync(rosterPath, 'utf8'));
  else console.warn(`roster.json not found at ${rosterPath}; skipping the collision check and references to people or offices outside this folder`);
  const additions = loadAdditions();
  const problems = checkRosterAdditions(additions, roster);
  const n = (k) => additions[k].length;
  if (problems.length) {
    console.error(`${problems.length} problem(s):`);
    for (const p of problems) console.error(' - ' + p);
    process.exit(1);
  }
  console.log(`ok: ${n('offices')} offices, ${n('people')} people, ${n('terms')} terms${roster ? `; no id collides with ${rosterPath}` : ''}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();

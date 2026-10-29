// Everyone else who serves a precinct, beyond the elected seats in Ballot305's "now": the courts that hear its cases,
// the appointed officials who run its city, county and schools, and the countywide boards that spend public money.
// Pure: takes the loaded ledger (lib/ledger) and the roster additions (data/roster-additions/), returns plain data.
import { seatedOn } from './ledger/ledger.mjs';

export const COURTS = [
  { body: 'fl-circuit-11', name: '11th Judicial Circuit Court', hears: 'Felonies, family, probate, and civil cases over $50,000' },
  { body: 'mdc-county-court', name: 'Miami-Dade County Court', hears: 'Misdemeanors, traffic, evictions, and civil cases up to $50,000' },
  { body: 'fl-dca-3', name: 'Third District Court of Appeal', hears: 'Appeals from Miami-Dade and Monroe trial courts' },
  { body: 'fl-supreme-court', name: 'Florida Supreme Court', hears: 'The state\'s highest court' }
];

// Countywide boards whose decisions reach every precinct. Area-specific boards (community redevelopment agencies,
// community development districts) are left out until their boundaries are matched to precincts.
export const COUNTYWIDE_BOARDS = [
  { body: 'pht-board', name: 'Public Health Trust (Jackson Health System)', does: 'Runs Jackson Health System, the county\'s public hospital system' },
  { body: 'childrens-trust-board', name: 'The Children\'s Trust', does: 'Spends a dedicated property tax on children\'s programs' },
  { body: 'sfwmd-board', name: 'South Florida Water Management District', does: 'Sets a water property tax; flood control and water supply' },
  { body: 'mdc-tpo', name: 'Transportation Planning Organization', does: 'Decides which road and transit projects get federal and state money' },
  { body: 'citt', name: 'Citizens\' Independent Transportation Trust', does: 'Oversees the half-penny transportation sales tax' },
  { body: 'gmx-board', name: 'Greater Miami Expressway Agency', does: 'Runs the county\'s toll expressways' },
  { body: 'mdc-ethics-commission', name: 'Commission on Ethics and Public Trust', does: 'Enforces ethics, lobbying and campaign rules for county and city officials' },
  { body: 'find-miami-dade', name: 'Florida Inland Navigation District', does: 'Taxes and funds Intracoastal Waterway projects' },
  { body: 'mdc-educational-facilities-authority', name: 'Educational Facilities Authority', does: 'Issues tax-exempt bonds for colleges and universities' },
  { body: 'mdc-health-facilities-authority', name: 'Health Facilities Authority', does: 'Issues tax-exempt bonds for hospitals and health facilities' }
];

const COUNTY_APPOINTED = ['mdc-chief-administrative-officer', 'mdc-county-attorney', 'mdc-commission-auditor', 'mdc-inspector-general', 'mdc-ethics-executive-director'];
const SCHOOL_APPOINTED = ['mdcps-superintendent', 'mdcps-general-counsel', 'mdcps-inspector-general'];
const CITY_ROLES = /-(manager|administrator|attorney|clerk)$/;

// One view over the ledger roster plus the additions.
export function mergedRoster(ledger, additions = {}) {
  const people = new Map(ledger.people);
  for (const p of additions.people || []) if (!people.has(p.id)) people.set(p.id, p);
  const offices = new Map(ledger.offices);
  for (const o of additions.offices || []) offices.set(o.id, o);
  const termsByOffice = new Map([...ledger.termsByOffice].map(([k, v]) => [k, [...v]]));
  for (const t of additions.terms || []) { if (!termsByOffice.has(t.office)) termsByOffice.set(t.office, []); termsByOffice.get(t.office).push(t); }
  const officesByBody = new Map();
  for (const o of offices.values()) { if (!officesByBody.has(o.body)) officesByBody.set(o.body, []); officesByBody.get(o.body).push(o); }
  return { people, offices, termsByOffice, officesByBody };
}

function seat(r, office, today) {
  const holders = (r.termsByOffice.get(office.id) || []).filter(t => seatedOn(t, today)).map(t => ({
    person: t.person, name: (r.people.get(t.person) || {}).name || t.person,
    since: t.start || null, sinceKnown: t.startKnown !== false && !!t.start, termExpires: t.end || null,
    source: (t.sources || [])[0] || null
  }));
  return { office: office.id, name: office.name, selection: office.selection || (/elected/.test(office.kind || '') ? 'elected' : null), appointedBy: office.appointedBy || null, holders };
}

const byIds = (r, ids, today) => ids.map(id => r.offices.get(id)).filter(Boolean).map(o => seat(r, o, today)).filter(s => s.holders.length);

export function moreOfficials(ledger, additions, districts = {}, today) {
  const r = mergedRoster(ledger, additions);
  const appointed = [];
  const cityBody = districts.municipalityBody;
  if (cityBody) {
    const seats = (r.officesByBody.get(cityBody) || []).filter(o => CITY_ROLES.test(o.id)).sort((a, b) => a.id.localeCompare(b.id)).map(o => seat(r, o, today));
    const name = (districts.municipality || cityBody).replace(/\b\w/g, c => c.toUpperCase()).replace(/\B\w+/g, w => w.toLowerCase());
    appointed.push({ body: cityBody, name: 'City of ' + name, level: 'municipal', seats, vacant: seats.filter(s => !s.holders.length).map(s => s.name) });
  }
  appointed.push({ body: 'mdcps', name: 'Miami-Dade County Public Schools', level: 'school', seats: byIds(r, SCHOOL_APPOINTED, today) });
  appointed.push({ body: 'mdc', name: 'Miami-Dade County', level: 'county', seats: byIds(r, COUNTY_APPOINTED, today) });

  const courts = COURTS.map(c => {
    const judges = (r.officesByBody.get(c.body) || []).flatMap(o => seat(r, o, today).holders.map(h => ({ ...h, seat: o.name })));
    judges.sort((a, b) => a.name.localeCompare(b.name));
    return { ...c, count: judges.length, judges };
  }).filter(c => c.count);

  const boards = COUNTYWIDE_BOARDS.map(b => {
    const seats = (r.officesByBody.get(b.body) || []).map(o => seat(r, o, today));
    const members = seats.flatMap(s => s.holders.map(h => ({ ...h, seat: s.name, selection: s.selection, appointedBy: s.appointedBy })));
    return { ...b, count: members.length, members };
  }).filter(b => b.count);

  return { appointed: appointed.filter(a => a.seats.length), courts, boards, note: 'Community redevelopment agencies and community development districts are not matched to precincts yet, so they are not shown here.' };
}

// The ledger: the read API over Ballot305's hand-checked data (officials, actions, roll calls, gifts tied to actions,
// cycles, posted agendas, procurement, payments, connections, contacts). Ported from Ballot305's src/api.js with the
// HTTP layer split out: every function here takes the data as an argument and returns { status, body, total }.
// No file, fetch or runtime access, so it runs on Workers, Node and anywhere else. Response shapes are identical to
// Ballot305's /api/v1 (tests/hand/ledger-parity.test.mjs checks that), so Ballot305 can switch to this API later.
//
// Every tie carries its epistemic status as fields, not prose: match (how the donor was tied to the item), basis
// (what the match rests on), timing and days (gift date relative to the action date), and the action's split flag.
// Consumers that drop the prose keep the caveats.

export const LEDGER_API_VERSION = '1';
// Data license. The data is CC BY 4.0 with attribution to Ballot305 (ballot305.org); the records are public records.
export const DATA_LICENSE = { name: 'CC BY 4.0', url: 'https://creativecommons.org/licenses/by/4.0/', attribution: 'Ballot305 (ballot305.org)' };

// The data files the ledger reads, relative to the data folder. decisions/index.json has every body without its
// actions; each body's actions are in decisions/<key>.json (split so no file nears the 25 MiB static asset limit).
export const LEDGER_FILES = {
  decisions: 'decisions/index.json',
  roster: 'roster.json',
  transparency: 'transparency.json',
  moneySummary: 'money-summary.json',
  cycles: 'cycles.json',
  precincts: 'precincts.json',
  contacts: 'contacts.json',
  upcoming: 'upcoming.json',
  connections: 'connections.json'
};
export const decisionsBodyFile = key => 'decisions/' + encodeURIComponent(key) + '.json';
// Files listed by /bulk that the ledger does not read itself. The sync job copies them so /bulk links resolve here.
export const LEDGER_BULK_ONLY_FILES = ['donor-actions.json', 'lobby-ledger.json', 'county-lobbyists.json', 'school-board-lobbyists.json', 'city-reports.json'];

export const MAX_LIMIT = 500, DEFAULT_LIMIT = 100;

// Who is serving the API. Only labels and links in /ledger (the index) and /bulk depend on it, never the data.
//   dataPath: URL path the data folder is served at ('/data' on Ballot305, '/ledger-data' here).
export const PLATFORM_SITE = {
  name: 'We the People 305 ledger API',
  dataPath: '/ledger-data',
  docs: origin => origin + '/docs/api.md',
  methodology: () => 'https://ballot305.org/methodology',
  corrections: 'corrections@ballot305.org',
  repo: 'https://github.com/Brittybrit/vote-informed'
};
export const BALLOT305_SITE = {
  name: 'Ballot305 public data API',
  dataPath: '/data',
  docs: origin => origin + '/api',
  methodology: origin => origin + '/methodology',
  corrections: 'corrections@ballot305.org',
  repo: 'https://github.com/Brittybrit/vote-informed'
};

// A term with no end date counts as current unless the roster marks it as a past seat: last seen at a
// meeting, ended by a successor, or noted as a former member.
export function seatedOn(t, day) {
  if (t.start != null && t.start > day) return false;
  if (t.end != null) return t.end >= day;
  if (t.endKnown === false && (t.lastSeen || t.endBy || /^Former member/.test(t.note || ''))) return false;
  return true;
}

// The version key of a data release: the "updated" dates of every file. The loader rebuilds only when it changes.
export function ledgerVersionKey(raw) {
  return [raw.decisions && raw.decisions.updated, raw.roster && raw.roster.updated, raw.transparency && raw.transparency.updated, raw.cycles && raw.cycles.updated, raw.precincts && raw.precincts.asOf, raw.contacts && raw.contacts.updated, raw.upcoming && raw.upcoming.updated, raw.connections && raw.connections.updated].join('|');
}

// Builds the normalized view once per data version. raw.decisions must have each body with its actions (joined).
//   dataPath: where the data folder is served, used in each action's provenance (source.file).
export function buildIndex(raw, { dataPath = PLATFORM_SITE.dataPath } = {}) {
  const dec = raw.decisions || { bodies: [], updated: null };
  const roster = raw.roster || { people: [], offices: [], terms: [], ballot: [] };
  const people = new Map(roster.people.map(p => [p.id, p]));
  const termsByPerson = new Map();
  for (const t of roster.terms || []) {
    if (!termsByPerson.has(t.person)) termsByPerson.set(t.person, []);
    termsByPerson.get(t.person).push(t);
  }
  const offices = new Map((roster.offices || []).map(o => [o.id, o]));

  const bodies = [];
  const actions = [];
  const ties = [];
  for (const b of dec.bodies || []) {
    const memberByKey = new Map((b.members || []).map(m => [m.key, m]));
    const accounts = {};
    for (const [k, a] of Object.entries(b.accounts || {})) {
      const owner = memberByKey.get(a.owner);
      accounts[k] = { key: k, person: owner ? owner.person : null, owner: a.owner, name: text(a.name), url: a.url || null, kind: accountKind(k, a) };
    }
    const body = {
      key: b.key,
      name: text(b.name),
      names: b.name,
      type: b.type || 'votes',
      rosterBody: b.rosterBody || null,
      since: b.since || null,
      members: (b.members || []).map(m => ({ key: m.key, person: m.person || null, name: m.name, district: m.district == null ? null : m.district, ...(m.former ? { former: true } : {}) })),
      onBallot: Object.entries(b.onBallot || {}).map(([k, v]) => ({ key: k, person: (memberByKey.get(k) || {}).person || null, race: text(v.race), accounts: v.accounts || [] })),
      accounts,
      coverage: text(b.coverage),
      registries: b.registries || null,
      actionCount: (b.actions || []).length
    };
    bodies.push(body);
    for (const a of b.actions || []) {
      const roll = {};
      for (const [k, v] of Object.entries(a.roll || {})) {
        const m = memberByKey.get(k);
        roll[m && m.person ? m.person : k] = v;
      }
      const noVotes = Object.values(a.roll || {}).filter(v => v === 'no').length;
      const split = noVotes > 0 || (Array.isArray(a.tally) && Number(a.tally[1]) > 0);
      const act = {
        id: a.id,
        body: b.key,
        bodyName: text(b.name),
        date: a.date || null,
        ref: a.ref || null,
        kind: a.kind || null,
        meeting: a.meeting || null,
        subject: text(a.subject),
        subjects: a.subject || null,
        parties: a.parties || [],
        result: a.result || null,
        tally: a.tally || null,
        notVoting: a.notVoting == null ? null : a.notVoting,
        split,
        roll,
        rollComplete: a.rollComplete !== false,
        mover: personFor(memberByKey, a.mover),
        second: personFor(memberByKey, a.second),
        role: a.role || null,
        amount: a.amount == null ? null : a.amount,
        recipient: a.recipient || null,
        status: a.status || null,
        budget: a.budget || null,
        lobbied: a.lobbied || [],
        ties: [],
        note: text(a.note),
        notes: a.note || null,
        links: a.links || [],
        source: { file: dataPath + '/' + decisionsBodyFile(b.key), updated: dec.updated || null }
      };
      // Carry any field this view does not name so nothing is lost; the named ones win.
      for (const [k, v] of Object.entries(a)) if (!(k in act) && k !== 'gifts' && k !== 'roll' && k !== 'subject' && k !== 'note') act[k] = v;
      for (const g of a.gifts || []) {
        const to = memberByKey.get(g.to);
        const acct = accounts[g.acct] || null;
        const tie = {
          action: a.id,
          body: b.key,
          actionDate: a.date || null,
          actionSplit: split,
          person: to && to.person ? to.person : null,
          memberKey: g.to,
          vote: a.roll && a.roll[g.to] != null ? a.roll[g.to] : (a.role || null),
          account: acct ? { key: acct.key, name: acct.name, kind: acct.kind, url: acct.url } : { key: g.acct, name: g.acct, kind: accountKind(g.acct, {}), url: null },
          donor: g.donor,
          amount: g.amount == null ? null : g.amount,
          date: g.date || null,
          timing: timing(g.date, a.date),
          days: daysBetween(g.date, a.date),
          match: g.kind || null,
          rel: g.rel || null,
          basis: g.basis || null,
          lobbyist: g.lobbyist || null,
          firm: g.firm || null,
          forParty: g.forParty || null,
          occupation: g.occ || null,
          address: g.addr || null,
          note: g.note ? text(g.note) : null
        };
        for (const [k, v] of Object.entries(g)) if (!(k in tie) && !['to', 'acct', 'kind', 'occ', 'addr'].includes(k)) tie[k] = v;
        act.ties.push(tie);
        ties.push(tie);
      }
      actions.push(act);
    }
  }
  actions.sort((x, y) => String(y.date || '').localeCompare(String(x.date || '')) || String(x.id).localeCompare(String(y.id)));

  const actionsByPerson = new Map();
  for (const act of actions) {
    const seen = new Set();
    for (const pid of [...Object.keys(act.roll), act.mover, act.second, ...act.ties.map(t => t.person)]) {
      if (!pid || seen.has(pid)) continue;
      seen.add(pid);
      if (!actionsByPerson.has(pid)) actionsByPerson.set(pid, []);
      actionsByPerson.get(pid).push(act);
    }
  }
  const ms = raw.moneySummary && raw.moneySummary.people ? raw.moneySummary.people : {};
  const summaries = new Map(Object.entries(ms).map(([pid, s]) => [pid, { ...s, bodyName: text(s.bodyName) }]));

  const onBallot = new Set();
  for (const race of roster.ballot || []) for (const c of race.candidates || []) if (c.person) onBallot.add(c.person);

  return {
    updated: dec.updated || null,
    rosterUpdated: roster.updated || null,
    dataPath,
    bodies, actions, ties, people, termsByPerson, offices, actionsByPerson, summaries, onBallot,
    ballot: roster.ballot || [],
    transparency: raw.transparency || null,
    cycles: raw.cycles || { updated: null, bodies: [] },
    cyclesByBody: new Map(((raw.cycles && raw.cycles.bodies) || []).map(c => [c.rosterBody, c])),
    precincts: raw.precincts || null,
    contacts: raw.contacts || { updated: null, offices: {}, bodies: {} },
    upcoming: raw.upcoming || { updated: null, meetings: [] },
    connections: raw.connections || { updated: null, confirmed: [], underReview: {} },
    officesByBody: groupBy(roster.offices || [], o => o.body),
    termsByOffice: groupBy(roster.terms || [], t => t.office),
    ballotByOffice: groupBy(roster.ballot || [], r => r.officeId)
  };
}

function groupBy(rows, fn) { const m = new Map(); for (const r of rows) { const k = fn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; }

/* ---------------- operations: (data, args, ctx) -> { status, body, total } ---------------- */
// args: plain object of strings (query and path parameters). A missing parameter is undefined, null or ''.
// ctx: { origin, site, today }. today defaults to the current UTC date; site defaults to PLATFORM_SITE.

const ok = body => ({ status: 200, body });
const notFound = what => ({ status: 404, body: { error: 'Not found: ' + what } });

export const LEDGER_OPERATIONS = {
  ledger_index: (data, args, ctx) => ok(index(data, ctx)),
  ledger_bulk: (data, args, ctx) => ok(bulk(data, ctx)),
  ledger_bodies: data => ok({ updated: data.updated, bodies: data.bodies }),
  ledger_body: (data, { key }) => { const body = data.bodies.find(x => x.key === key); return body ? ok(body) : notFound('body'); },
  ledger_actions: (data, args) => page(filterActions(data, q(args)), q(args), data),
  ledger_action: (data, { body, id }) => {
    const act = data.actions.find(x => x.body === body && String(x.id) === id);
    return act ? ok(act) : notFound('action');
  },
  ledger_ties: (data, args) => page(filterTies(data, q(args)), q(args), data),
  ledger_people: (data, args) => {
    const p = q(args);
    const needle = (p.get('q') || '').toLowerCase();
    const ballotOnly = p.get('onBallot') === '1';
    let rows = [...data.people.values()];
    if (needle) rows = rows.filter(x => (x.name + ' ' + (x.aliases || []).join(' ')).toLowerCase().includes(needle));
    if (ballotOnly) rows = rows.filter(x => data.onBallot.has(x.id));
    rows = rows.map(x => personSummary(x, data));
    return page(rows, p, data);
  },
  ledger_person: (data, { id }) => { const p = data.people.get(id); return p ? ok(personDetail(p, data)) : notFound('person'); },
  ledger_transparency: data => ok(data.transparency || { cities: [] }),
  ledger_cycles: data => ok(data.cycles),
  ledger_cycle: (data, { key }) => { const c = data.cycles.bodies.find(x => x.key === key || x.rosterBody === key); return c ? ok(c) : notFound('cycle'); },
  ledger_now: (data, args, ctx) => now(data, q(args), ctx),
  ledger_upcoming: (data, args) => page(filterUpcoming(data, q(args)), q(args), data),
  ledger_connections: data => ok(data.connections),
  ledger_connections_for_person: (data, { person }) => {
    const rows = data.connections.confirmed.filter(c => c.person === person);
    return ok({ person, updated: data.connections.updated, confirmed: rows, underReview: data.connections.underReview[person] || 0, note: data.connections.note });
  },
  ledger_payments: data => {
    const rows = data.upcoming.payments || [];
    return ok({ updated: data.upcoming.updated, bodies: rows.map(p => ({ body: p.body, rosterBody: p.rosterBody, checked: p.checked, datasets: p.datasets.length, topVendors: p.vendors.top.length, departments: p.staffing ? p.staffing.byDepartment.length : 0 })) });
  },
  ledger_payments_for_body: (data, { body }) => { const py = (data.upcoming.payments || []).find(p => p.body === body || p.rosterBody === body); return py ? ok(py) : notFound('payments'); },
  ledger_procurement: data => {
    const rows = data.upcoming.procurement || [];
    return ok({ updated: data.upcoming.updated, bodies: rows.map(p => ({ body: p.body, rosterBody: p.rosterBody, checked: p.checked, open: p.solicitations.length, expiring: p.expiring.length, plan: p.capitalPlan.length })) });
  },
  ledger_procurement_for_body: (data, { body }) => { const pr = (data.upcoming.procurement || []).find(p => p.body === body || p.rosterBody === body); return pr ? ok(pr) : notFound('procurement'); },
  ledger_contacts: data => ok({ updated: data.contacts.updated, offices: Object.keys(data.contacts.offices).length, bodies: data.contacts.bodies }),
  ledger_contact: (data, { office }) => { const c = data.contacts.offices[office]; return c ? ok(c) : notFound('contact'); }
};

// Runs one ledger operation. Returns { status, body, total } (total is set on paged lists).
export function runLedger(id, data, args = {}, ctx = {}) {
  const fn = LEDGER_OPERATIONS[id];
  if (!fn) return notFound('endpoint');
  return fn(data, args, { origin: ctx.origin || 'https://wethepeople305.org', site: ctx.site || PLATFORM_SITE, today: ctx.today });
}

// ETag of a response: same recipe as Ballot305 (data dates plus the request path and query).
export function ledgerEtag(data, pathname, search) {
  return '"v1-' + hash((data.updated || '') + (data.rosterUpdated || '') + pathname + (search || '')) + '"';
}

// Query params as a URLSearchParams-like getter: missing or empty values read as null, like URLSearchParams.get.
function q(args) { return { get: k => (args[k] == null ? null : String(args[k])) }; }

function index(data, { origin, site }) {
  const base = origin + '/api/v1';
  return {
    name: site.name,
    version: LEDGER_API_VERSION,
    updated: data.updated,
    rosterUpdated: data.rosterUpdated,
    license: DATA_LICENSE,
    counts: { bodies: data.bodies.length, actions: data.actions.length, ties: data.ties.length, people: data.people.size },
    endpoints: {
      bodies: base + '/bodies',
      actions: base + '/actions?body=county&split=1&tied=1',
      action: base + '/actions/{body}/{id}',
      ties: base + '/ties?timing=before&match=party',
      people: base + '/people?q=lopez&onBallot=1',
      person: base + '/people/{id}',
      transparency: base + '/transparency',
      cycles: base + '/cycles',
      now: base + '/now?precinct=033.0',
      upcoming: base + '/upcoming?precinct=033.0&tagged=money',
      contacts: base + '/contacts/{office}',
      procurement: base + '/procurement/county',
      payments: base + '/payments/county',
      connections: base + '/connections/{person}',
      bulk: base + '/bulk',
      openapi: base + '/openapi.json'
    },
    fields: {
      'tie.match': 'how the donor was tied to the item: party (the company itself), lobbyist (the registered lobbyist), firm (the lobbying firm, its PAC or another of its lobbyists), office (a lobbyist at the same registered office), listed (name-only match, flagged), class (a kind of business the item helps, not a named party)',
      'tie.basis': 'what the match rests on (occ = reported occupation, addr = address, name = name only)',
      'tie.timing': 'gift date relative to the action date: before, after, same, unknown',
      'tie.days': 'signed days from action to gift (negative = before)',
      'action.split': 'true when any member voted no',
      'action.rollComplete': 'false when the roll shows only the members covered, not the whole body'
    },
    docs: site.docs(origin),
    methodology: site.methodology(origin),
    corrections: site.corrections
  };
}

function bulk(data, { origin, site }) {
  const o = origin + site.dataPath + '/';
  return {
    updated: data.updated,
    license: DATA_LICENSE,
    files: [
      { path: o + LEDGER_FILES.decisions, what: 'every body without its actions (site-native shape); each body\'s actions, roll calls, lobbyist registrations and tied gifts are in the files below' },
      ...data.bodies.map(b => ({ path: o + decisionsBodyFile(b.key), what: text(b.names) + ': the body with every action, roll call, lobbyist registration and tied gift (site-native shape)' })),
      { path: o + 'donor-actions.json', what: 'hand-checked candidate action cards' },
      { path: o + 'donor-actions.csv', what: 'the same cards as CSV' },
      { path: o + LEDGER_FILES.roster, what: 'officeholder roster: people, offices, terms, ballot' },
      { path: o + LEDGER_FILES.moneySummary, what: 'one-line money summary per incumbent' },
      { path: o + LEDGER_FILES.transparency, what: 'city records scorecard' },
      { path: o + LEDGER_FILES.cycles, what: 'governance calendar and citizen levers per body' },
      { path: o + LEDGER_FILES.precincts, what: 'precinct to district cross reference (county elections office)' },
      { path: o + LEDGER_FILES.contacts, what: 'official contacts per office' },
      { path: o + LEDGER_FILES.upcoming, what: 'items on posted agendas with ledger matches and tags' },
      { path: o + LEDGER_FILES.connections, what: 'confirmed connections between officials and the parties before them' },
      { path: o + 'lobby-ledger.json', what: 'state budget requests by lobbying firm' },
      { path: o + 'county-lobbyists.json', what: 'Miami-Dade County lobbyist registrations used for matching' },
      { path: o + 'school-board-lobbyists.json', what: 'M-DCPS lobbyist registrations' },
      { path: o + 'city-reports.json', what: 'typed transcriptions of scanned city campaign reports' }
    ],
    repo: site.repo
  };
}

function filterActions(data, q) {
  const body = q.get('body'), person = q.get('person'), kind = q.get('kind');
  const since = q.get('since'), until = q.get('until');
  const split = q.get('split') === '1', tied = q.get('tied') === '1';
  const party = (q.get('party') || '').toLowerCase(), needle = (q.get('q') || '').toLowerCase();
  const rows = person ? (data.actionsByPerson.get(person) || []) : data.actions;
  return rows.filter(a =>
    (!body || a.body === body) &&
    (!kind || a.kind === kind) &&
    (!since || (a.date && a.date >= since)) &&
    (!until || (a.date && a.date <= until)) &&
    (!split || a.split) &&
    (!tied || a.ties.length > 0) &&
    (!party || a.parties.some(p => String(p).toLowerCase().includes(party))) &&
    (!needle || [a.subject, a.ref, ...a.parties].some(s => String(s || '').toLowerCase().includes(needle)))
  );
}

function filterTies(data, q) {
  const person = q.get('person'), body = q.get('body'), timing = q.get('timing'), match = q.get('match');
  const donor = (q.get('donor') || '').toLowerCase();
  const since = q.get('since'), until = q.get('until');
  const min = q.get('minAmount') ? Number(q.get('minAmount')) : null;
  return data.ties.filter(t =>
    (!person || t.person === person) &&
    (!body || t.body === body) &&
    (!timing || t.timing === timing) &&
    (!match || t.match === match) &&
    (!donor || String(t.donor || '').toLowerCase().includes(donor)) &&
    (!since || (t.date && t.date >= since)) &&
    (!until || (t.date && t.date <= until)) &&
    (min == null || (t.amount != null && t.amount >= min))
  );
}

function page(rows, q, data) {
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(q.get('limit')) || DEFAULT_LIMIT));
  const offset = Math.max(0, Number(q.get('offset')) || 0);
  return { status: 200, body: { updated: data.updated, total: rows.length, limit, offset, items: rows.slice(offset, offset + limit) }, total: rows.length };
}

function personSummary(p, data) {
  const terms = (data.termsByPerson.get(p.id) || []).map(t => ({ ...t, officeName: (data.offices.get(t.office) || {}).name || t.office }));
  const acts = data.actionsByPerson.get(p.id) || [];
  const tied = data.ties.filter(t => t.person === p.id);
  return {
    id: p.id, name: p.name, aliases: p.aliases || [], ids: p.ids || {},
    onBallot: data.onBallot.has(p.id),
    offices: terms.map(t => ({ office: t.office, name: t.officeName, start: t.start || null, end: t.end || null, startKnown: t.startKnown !== false, endKnown: t.endKnown !== false, via: t.via || null })),
    actionCount: acts.length,
    tieCount: tied.length,
    tiedAmount: tied.reduce((s, t) => s + (t.amount || 0), 0),
    summary: data.summaries.get(p.id) || null
  };
}

function personDetail(p, data) {
  const s = personSummary(p, data);
  const terms = (data.termsByPerson.get(p.id) || []);
  const races = data.ballot.filter(r => (r.candidates || []).some(c => c.person === p.id)).map(r => ({ office: r.office, officeId: r.officeId, judicial: !!r.judicial }));
  return {
    ...s,
    terms,
    races,
    actions: (data.actionsByPerson.get(p.id) || []).map(a => ({ id: a.id, body: a.body, date: a.date, ref: a.ref, kind: a.kind, subject: a.subject, result: a.result, split: a.split, vote: a.roll[p.id] || (a.role || null), ties: a.ties.filter(t => t.person === p.id).length })),
    ties: data.ties.filter(t => t.person === p.id),
    connections: { confirmed: data.connections.confirmed.filter(c => c.person === p.id), underReview: data.connections.underReview[p.id] || 0 },
    contact: data.contacts.offices[(terms.find(t => (t.end == null)) || {}).office] || null
  };
}

/* ---------------- now: the citizen's view for one precinct ---------------- */

// Precinct municipality names (county cross reference) to roster body ids.
const MUNI_ALIAS = { 'N MIAMI BEACH': 'north-miami-beach', 'N BAY VILLAGE': 'north-bay-village', 'INDIAN CREEK VILLAGE': 'indian-creek', 'OPA LOCKA': 'opa-locka', 'UNINCORPORATED M-D': null };
function muniBody(name) {
  if (name == null) return null;
  const n = String(name).toUpperCase().trim();
  if (n in MUNI_ALIAS) return MUNI_ALIAS[n] ? 'city-' + MUNI_ALIAS[n] : null;
  return 'city-' + n.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}
export function normPrecinct(p) {
  const m = String(p || '').match(/(\d{1,4})(?:\.(\d))?/);
  if (!m) return '';
  return String(parseInt(m[1], 10)).padStart(3, '0') + '.' + (m[2] || '0');
}
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function now(data, q, ctx) {
  const pct = normPrecinct(q.get('precinct'));
  const today = DATE_RE.test(q.get('date') || '') ? q.get('date') : (ctx.today || new Date().toISOString().slice(0, 10));
  if (!pct) return { body: { error: 'precinct is required, e.g. ?precinct=033.0. Find yours on your voter card or at the county elections office.' }, status: 400 };
  const row = data.precincts && data.precincts.precincts && data.precincts.precincts[pct];
  if (!row) return notFound('precinct ' + pct);
  const [congress, stateSenate, stateHouse, muni, schoolBoard, countyCommission] = row;
  const cityBody = muniBody(muni);
  const cityDistrict = cityBody === 'city-north-miami' ? (data.precincts.northMiamiDistrict || {})[pct] : cityBody === 'city-miami-gardens' ? (data.precincts.miamiGardensDistrict || {})[pct] : null;

  // Which offices are mine: every office on a body I'm in, narrowed to my district where the office has one.
  const wanted = [
    { body: 'mdc-commission', district: String(countyCommission) }, { body: 'mdc-mayor' }, { body: 'mdc-sheriff' }, { body: 'mdc-clerk' },
    { body: 'mdc-property-appraiser' }, { body: 'mdc-tax-collector' }, { body: 'mdc-supervisor-of-elections' },
    { body: 'mdcps-board', district: String(schoolBoard) },
    cityBody ? { body: cityBody, district: cityDistrict == null ? null : String(cityDistrict) } : null,
    { body: 'fl-state-attorney-11' }, { body: 'fl-public-defender-11' },
    { body: 'fl-house', district: String(stateHouse) }, { body: 'fl-senate', district: String(stateSenate) },
    { body: 'us-house', district: String(congress) }, { body: 'us-senate' }, { body: 'fl-executive' }
  ].filter(Boolean);

  const bodiesOut = [];
  for (const w of wanted) {
    const offices = (data.officesByBody.get(w.body) || []).filter(o => w.district == null || o.district == null || String(o.district) === w.district);
    if (!offices.length) continue;
    const cycle = data.cyclesByBody.get(w.body) || null;
    const seats = offices.map(o => {
      const terms = (data.termsByOffice.get(o.id) || []).filter(t => seatedOn(t, today));
      const holders = terms.map(t => holder(t, data));
      const races = (data.ballotByOffice.get(o.id) || []).map(r => ({ office: r.office, judicial: !!r.judicial, candidates: (r.candidates || []).map(c => ({ person: c.person, name: c.asPrinted || (c.person && data.people.get(c.person) || {}).name || null, party: c.party || null, incumbent: holders.some(h => h.person === c.person) })) }));
      return { office: o.id, name: o.name, district: o.district == null ? null : o.district, kind: o.kind || null, actionScope: o.actionScope || 'all', holders, onBallot: races, contact: data.contacts.offices[o.id] || null };
    });
    bodiesOut.push({
      body: w.body,
      name: cycle ? cycle.name : (data.bodies.find(b => b.rosterBody === w.body) || {}).name || offices[0].jurisdiction || w.body,
      level: offices[0].level,
      jurisdiction: offices[0].jurisdiction,
      decisionsBody: (data.bodies.find(b => b.rosterBody === w.body) || {}).key || null,
      seats,
      cycle: cycle ? cycleNow(cycle, today) : null,
      bodyContact: data.contacts.bodies[w.body] || null,
      upcoming: upcomingFor(data, w.body, today, { countyDistrict: String(countyCommission), cityBody, cityDistrict }),
      procurement: procurementFor(data, w.body, today, { countyDistrict: String(countyCommission), cityBody, cityDistrict }),
      payments: paymentsFor(data, w.body)
    });
  }
  return { status: 200, body: {
    precinct: pct, date: today, updated: data.cycles.updated || null, rosterUpdated: data.rosterUpdated,
    districts: { congress, stateSenate, stateHouse, municipality: muni, municipalityBody: cityBody, cityDistrict: cityDistrict == null ? null : cityDistrict, schoolBoard, countyCommission },
    note: 'Offices are every seat on the bodies this precinct falls in, narrowed to its district. Holders are the people the roster shows seated today; candidates are from the Nov 3, 2026 ballot. The cycle block says what phase each body is in, its next posted meetings, and what a resident can do; bodies without a cycle block have not been researched yet.',
    bodies: bodiesOut
  } };
}

// Items on this body's posted agendas from today on, each with a relevance block for the precinct.
function upcomingFor(data, rosterBody, today, me) {
  const out = [];
  for (const m of data.upcoming.meetings || []) {
    if (m.rosterBody !== rosterBody || !m.meeting || m.meeting.date < today) continue;
    for (const it of m.items || []) out.push(relevance(itemView(m, it), me));
  }
  return out;
}
// Spending under consideration for this body: open solicitations, expiring contracts, the capital plan,
// each row with a near flag for the precinct where the row states a district or the body is the city.
function procurementFor(data, rosterBody, today, me) {
  const pr = (data.upcoming.procurement || []).find(p => p.rosterBody === rosterBody);
  if (!pr) return null;
  const near = loc => { if (!loc) return null; if (rosterBody === 'mdc-commission' && loc.district != null) return String(loc.district) === me.countyDistrict; if (rosterBody === me.cityBody) return loc.district == null || me.cityDistrict == null ? true : String(loc.district) === String(me.cityDistrict); return null; };
  return {
    checked: pr.checked, links: pr.links, levers: pr.levers, notes: pr.notes,
    open: pr.solicitations.filter(s => !s.due || s.due >= today).map(s => ({ ...s, near: near(s.location), daysToDue: s.due ? Math.round((Date.parse(s.due) - Date.parse(today)) / 86400000) : null })),
    expiring: pr.expiring.map(e => ({ ...e, daysToExpiry: Math.round((Date.parse(e.expires) - Date.parse(today)) / 86400000), money: e.matches && e.matches.ties.length > 0, lobbied: e.matches && e.matches.lobbyists.length > 0 })),
    plan: pr.capitalPlan.map(c => ({ ...c, near: near(c.location) })),
    counts: { open: pr.solicitations.length, expiring: pr.expiring.length, plan: pr.capitalPlan.length, planTotal: pr.capitalPlan.reduce((n, c) => n + (c.total || 0), 0) }
  };
}
// Who this body pays: staffing totals, top vendors with their ledger matches, union contracts, levers.
function paymentsFor(data, rosterBody) {
  const py = (data.upcoming.payments || []).find(p => p.rosterBody === rosterBody);
  if (!py) return null;
  return {
    checked: py.checked, datasets: py.datasets, staffing: py.staffing,
    vendors: py.vendors ? { period: py.vendors.period, total: py.vendors.total, source: py.vendors.source, top: py.vendors.top.map(v => ({ ...v, money: v.matches && v.matches.ties.length > 0, lobbied: v.matches && v.matches.lobbyists.length > 0, history: v.matches && v.matches.priorActions.length > 0 })) } : null,
    unionContracts: py.unionContracts, levers: py.levers, notes: py.notes
  };
}
function itemView(m, it) {
  return { body: m.body, rosterBody: m.rosterBody, bodyName: m.bodyName, meeting: m.meeting, comment: m.comment || [], ...it };
}
// What this item has to do with this precinct: computed from the item's own fields only.
function relevance(it, me) {
  const r = { near: null, wallet: !!(it.tags && it.tags.wallet), money: !!(it.tags && it.tags.money), lobbied: !!(it.tags && it.tags.lobbied), hearing: !!(it.tags && it.tags.hearing), why: [] };
  const loc = it.location || {};
  if (it.rosterBody === 'mdc-commission' && loc.district != null) { r.near = String(loc.district) === me.countyDistrict; r.why.push(r.near ? 'in your county commission district' : 'county district ' + loc.district + ', not yours'); }
  else if (it.rosterBody === me.cityBody) { r.near = true; r.why.push('your city'); if (loc.district != null && me.cityDistrict != null) { r.near = String(loc.district) === String(me.cityDistrict); r.why[r.why.length - 1] = r.near ? 'in your city district' : 'city district ' + loc.district + ', not yours'; } }
  if (r.wallet && it.fiscal) r.why.push('fiscal impact stated: ' + it.fiscal.slice(0, 160));
  if (r.money) r.why.push(it.matches.ties.length + ' gift' + (it.matches.ties.length === 1 ? '' : 's') + ' from a named party to a member');
  if (r.lobbied) r.why.push(it.matches.lobbyists.length + ' registered lobbyist' + (it.matches.lobbyists.length === 1 ? '' : 's'));
  if (it.matches && it.matches.priorActions.length) r.why.push(it.matches.priorActions.length + ' prior action' + (it.matches.priorActions.length === 1 ? '' : 's') + ' on this party');
  return { ...it, relevance: r };
}
function filterUpcoming(data, q) {
  const body = q.get('body'), since = q.get('since'), until = q.get('until');
  const tagged = (q.get('tagged') || '').split(',').map(s => s.trim()).filter(Boolean);
  const pct = normPrecinct(q.get('precinct'));
  const row = pct && data.precincts && data.precincts.precincts ? data.precincts.precincts[pct] : null;
  const me = row ? { countyDistrict: String(row[5]), cityBody: muniBody(row[3]), cityDistrict: muniBody(row[3]) === 'city-north-miami' ? (data.precincts.northMiamiDistrict || {})[pct] : muniBody(row[3]) === 'city-miami-gardens' ? (data.precincts.miamiGardensDistrict || {})[pct] : null } : null;
  const myBodies = me ? new Set(['mdc-commission', 'mdcps-board', me.cityBody].filter(Boolean)) : null;
  const out = [];
  for (const m of data.upcoming.meetings || []) {
    if (body && m.body !== body && m.rosterBody !== body) continue;
    if (since && m.meeting.date < since) continue;
    if (until && m.meeting.date > until) continue;
    if (myBodies && !myBodies.has(m.rosterBody)) continue;
    for (const it of m.items || []) {
      const v = me ? relevance(itemView(m, it), me) : itemView(m, it);
      if (tagged.length && !tagged.every(t => t === 'near' ? (v.relevance && v.relevance.near) : (v.tags && v.tags[t]))) continue;
      out.push(v);
    }
  }
  return out;
}

function holder(t, data) {
  const p = data.people.get(t.person) || {};
  const s = data.summaries.get(t.person) || null;
  return { person: t.person, name: p.name || t.person, since: t.start || null, sinceKnown: t.startKnown !== false, via: t.via || null, termExpires: t.termExpires || null, actionCount: (data.actionsByPerson.get(t.person) || []).length, moneySummary: s ? { total: s.total, donors: s.donors, gifts: s.gifts, before: s.before, items: s.items, split: s.split } : null };
}

// What phase a body is in today, its next meetings, and the levers, from its cycle file.
export function cycleNow(c, today) {
  const md = today.slice(5);
  const inPhase = p => {
    if (!p.start && !p.end) return false;
    if (p.repeats === 'yearly') {
      const s = (p.start || p.end).slice(5), e = (p.end || p.start).slice(5);
      return s <= e ? (md >= s && md <= e) : (md >= s || md <= e);
    }
    return (p.start || '0000') <= today && today <= (p.end || '9999');
  };
  const current = c.phases.filter(inPhase);
  const upcoming = c.phases
    .map(p => ({ p, start: nextStart(p, today) }))
    .filter(x => x.start && x.start > today)
    .sort((x, y) => x.start.localeCompare(y.start))
    .slice(0, 4)
    .map(x => ({ ...x.p, start: x.start }));
  const meetings = c.meetings.schedule.filter(m => m.date >= today).slice(0, 5);
  // Public and written comment are taken at regular meetings and public hearings (budget, zoning), not at workshops or
  // special sessions (ceremonies, single-subject meetings), so a comment lever points at the next meeting of those kinds.
  const takesComment = c.meetings.schedule.find(m => m.date >= today && ['regular', 'budget-hearing', 'zoning'].includes(m.kind));
  const levers = c.levers.map(l => ({ ...l, nextMeeting: /comment/.test(l.key) && takesComment ? takesComment.date : null }));
  return {
    key: c.key, checked: c.checked || null, links: c.links || {},
    meetings: { pattern: c.meetings.pattern || null, agendaLeadDays: c.meetings.agendaLeadDays == null ? null : c.meetings.agendaLeadDays, next: meetings, scheduleEnds: c.meetings.schedule.length ? c.meetings.schedule[c.meetings.schedule.length - 1].date : null },
    phases: { current, upcoming },
    levers,
    elections: c.elections || null,
    contacts: c.contacts || [],
    notes: c.notes || null
  };
}
function nextStart(p, today) {
  if (!p.start) return null;
  if (p.repeats !== 'yearly') return p.start;
  const y = Number(today.slice(0, 4));
  const thisYear = y + '-' + p.start.slice(5);
  return thisYear > today ? thisYear : (y + 1) + '-' + p.start.slice(5);
}

/* ---------------- helpers ---------------- */

function text(v) { return v == null ? null : (typeof v === 'string' ? v : (v.en || Object.values(v)[0] || null)); }
function personFor(memberByKey, key) { if (!key) return null; const m = memberByKey.get(key); return m && m.person ? m.person : key; }
function accountKind(key, a) {
  if (key === 'fec' || /fec\.gov/.test(String(a.url || ''))) return 'federal';
  if (key === 'pac' || /^pc\d+$/.test(key)) return 'committee';
  return 'campaign';
}
function timing(gift, action) {
  if (!gift || !action) return 'unknown';
  if (gift < action) return 'before';
  if (gift > action) return 'after';
  return 'same';
}
function daysBetween(gift, action) {
  if (!gift || !action) return null;
  const a = Date.parse(gift), b = Date.parse(action);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((a - b) / 86400000);
}
function hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return (h >>> 0).toString(16); }

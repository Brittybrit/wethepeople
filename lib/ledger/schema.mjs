// Schema for the ledger operations: Ballot305's read API, served here from a synced copy of its data
// (decisions/0008-ledger-moves-to-platform.md). lib/api-schema.mjs adds these to OPERATIONS, so they appear in the
// OpenAPI document and as MCP tools like every other operation. Paths and response shapes are the same as
// https://ballot305.org/api/v1, so Ballot305 can switch to this API after Nov 3, 2026.
// Response schemas name the fields every response has; the data carries more fields, passed through unchanged.
// Plain JavaScript, no runtime imports.

const str = description => ({ type: 'string', description });
const q = description => ({ in: 'query', required: false, schema: str(description) });
const pathParam = description => ({ in: 'path', required: true, schema: { ...str(description), minLength: 1, maxLength: 200 } });
const paging = { limit: q('Rows per page, default 100, max 500.'), offset: q('Rows to skip, default 0.') };
const updated = { type: ['string', 'null'], description: 'Date the underlying data file was last updated.' };
const obj = (required, properties) => ({ type: 'object', required, properties });
const pageOf = (item, what) => obj(['total', 'limit', 'offset', 'items'], {
  updated,
  total: { type: 'integer', description: 'Rows matching the filters (also in the X-Total-Count header).' },
  limit: { type: 'integer' }, offset: { type: 'integer' },
  items: { type: 'array', description: what, items: item }
});

const tie = {
  type: 'object', required: ['action', 'body', 'timing', 'match'],
  description: 'One campaign gift tied to one official action. match, basis, timing, days and actionSplit are the caveats; keep them with any amount you repeat.',
  properties: {
    action: { type: ['string', 'number'] }, body: { type: 'string' }, actionDate: { type: ['string', 'null'] }, actionSplit: { type: 'boolean' },
    person: { type: ['string', 'null'] }, vote: { type: ['string', 'null'] }, account: { type: 'object' }, donor: { type: ['string', 'null'] },
    amount: { type: ['number', 'null'] }, date: { type: ['string', 'null'] },
    timing: { type: 'string', enum: ['before', 'after', 'same', 'unknown'] }, days: { type: ['integer', 'null'] },
    match: { type: ['string', 'null'], description: 'party, lobbyist, firm, office, listed or class (see ledger_index fields).' },
    basis: { type: ['string', 'null'], description: 'occ, addr or name: what the match rests on.' }
  }
};
const action = {
  type: 'object', required: ['id', 'body', 'split', 'roll', 'ties', 'source'],
  properties: {
    id: { type: ['string', 'number'] }, body: { type: 'string' }, bodyName: { type: ['string', 'null'] }, date: { type: ['string', 'null'] },
    ref: { type: ['string', 'null'] }, kind: { type: ['string', 'null'] }, subject: { type: ['string', 'null'] }, parties: { type: 'array' },
    result: { type: ['string', 'null'] }, split: { type: 'boolean', description: 'true when any member voted no.' },
    roll: { type: 'object', description: 'Vote by roster person id.' }, rollComplete: { type: 'boolean' },
    ties: { type: 'array', items: tie }, links: { type: 'array' },
    source: { type: 'object', description: 'Provenance: the data file this action is in and its date.', properties: { file: { type: 'string' }, updated } }
  }
};
const bodiesList = what => obj(['bodies'], { updated, bodies: { type: 'array', description: what, items: { type: 'object' } } });
const NOTE = 'Data: Ballot305 (CC BY 4.0), copied into this platform hourly; /ledger-data/SOURCE.json has the Ballot305 commit and copy time.';
const DEFAULT_ERRORS = { 500: 'Ledger data unavailable' };
const notFound = what => ({ 404: 'No ' + what + ' with that id', ...DEFAULT_ERRORS });

const op = (id, path, title, summary, description, params, response, errors = DEFAULT_ERRORS, extra = {}) =>
  ({ id, method: 'GET', path, title, summary, description: (description ? description + ' ' : '') + NOTE, params, response, errors, sendsPersonalData: false, ledger: true, ...extra });

export const LEDGER_OPERATIONS_SCHEMA = [
  op('ledger_index', '/api/v1/ledger', 'Ledger index',
    'Ledger version, data dates, license, counts, endpoints and field definitions (what tie.match, tie.basis and tie.timing mean).',
    'Read this first to learn what the tie and action fields mean. The same body Ballot305 serves at /api/v1.', {},
    obj(['version', 'license', 'counts', 'fields'], { name: { type: 'string' }, version: { type: 'string' }, updated, rosterUpdated: updated, license: { type: 'object' }, counts: { type: 'object' }, endpoints: { type: 'object' }, fields: { type: 'object' }, docs: { type: 'string' }, methodology: { type: 'string' }, corrections: { type: 'string' } })),
  op('ledger_bodies', '/api/v1/bodies', 'Bodies covered',
    'Every body whose official actions are in the ledger, with members, campaign accounts and a coverage note.',
    'A body is a commission, council, board or chamber. Its key is used by ledger_body, ledger_actions and ledger_ties.', {},
    bodiesList('Bodies')),
  op('ledger_body', '/api/v1/bodies/{key}', 'One body',
    'One body: members, campaign accounts, who is on the ballot, coverage note and action count.', '',
    { key: pathParam('Body key from ledger_bodies, e.g. "county".') },
    obj(['key', 'members'], { key: { type: 'string' }, name: { type: ['string', 'null'] }, members: { type: 'array' }, accounts: { type: 'object' }, coverage: { type: ['string', 'null'] }, actionCount: { type: 'integer' } }),
    notFound('body')),
  op('ledger_actions', '/api/v1/actions', 'Official actions',
    'Votes and other official actions, newest first, each with its roll call and the gifts tied to it. Paged.',
    'Filters combine. split=1 keeps actions where any member voted no; tied=1 keeps actions with at least one tied gift.',
    { body: q('Body key.'), person: q('Roster person id.'), kind: q('Action kind.'), since: q('Action date from, YYYY-MM-DD.'), until: q('Action date to, YYYY-MM-DD.'), split: q('1 = any no vote.'), tied: q('1 = at least one tied gift.'), party: q('Substring of a named party.'), q: q('Substring of subject, ref or party.'), ...paging },
    pageOf(action, 'Actions')),
  op('ledger_action', '/api/v1/actions/{body}/{id}', 'One official action',
    'One action with its roll call, mover, links and every tied gift.', '',
    { body: pathParam('Body key.'), id: pathParam('Action id within the body.') },
    action, notFound('action')),
  op('ledger_ties', '/api/v1/ties', 'Gifts tied to actions',
    'One row per campaign gift tied to an official action, with how the donor was matched, on what basis and when. Paged.',
    'A tie records that a donor connected to an item gave to a member who acted on it. It is not a finding of wrongdoing. Repeat match, basis and timing with any amount.',
    { person: q('Roster person id.'), body: q('Body key.'), donor: q('Substring of the donor name.'), timing: q('before, after, same or unknown.'), match: q('party, lobbyist, firm, office, listed or class.'), since: q('Gift date from, YYYY-MM-DD.'), until: q('Gift date to, YYYY-MM-DD.'), minAmount: q('Smallest amount, a number.'), ...paging },
    pageOf(tie, 'Ties')),
  op('ledger_people', '/api/v1/people', 'People',
    'Officeholders and candidates on the roster, with offices held and action and tie counts. Search by name. Paged.',
    'Use it to find the person id for ledger_person.',
    { q: q('Substring of the name or an alias.'), onBallot: q('1 = on the Nov 3, 2026 ballot.'), ...paging },
    pageOf(obj(['id', 'name'], { id: { type: 'string' }, name: { type: 'string' }, onBallot: { type: 'boolean' }, offices: { type: 'array' }, actionCount: { type: 'integer' }, tieCount: { type: 'integer' } }), 'People')),
  op('ledger_person', '/api/v1/people/{id}', 'One person',
    'One person: terms, races, every action they took part in, tied gifts, confirmed connections and office contact.',
    'Large for long-serving officials (hundreds of actions); ledger_actions and ledger_ties with person= page through the same rows.',
    { id: pathParam('Roster person id, e.g. "vicki-l-lopez".') },
    obj(['id', 'name', 'terms', 'actions', 'ties'], { id: { type: 'string' }, name: { type: 'string' }, onBallot: { type: 'boolean' }, terms: { type: 'array' }, races: { type: 'array' }, actions: { type: 'array' }, ties: { type: 'array', items: tie }, connections: { type: 'object' }, contact: { type: ['object', 'null'] } }),
    notFound('person')),
  op('ledger_transparency', '/api/v1/transparency', 'City records scorecard',
    'What each city publishes online: meetings, votes, campaign reports.', '', {},
    obj(['cities'], { updated, cities: { type: 'array', items: { type: 'object' } } })),
  op('ledger_cycles', '/api/v1/cycles', 'Governance calendars',
    'Every researched body\'s meetings, budget and election phases, and the levers a resident can use.', '', {},
    bodiesList('One calendar per body')),
  op('ledger_cycle', '/api/v1/cycles/{key}', 'One body\'s calendar',
    'One body: meetings, phases, levers, elections and contacts.', '',
    { key: pathParam('Cycle key or roster body id, e.g. "mdc-commission".') },
    obj(['key', 'meetings', 'phases', 'levers'], { key: { type: 'string' }, rosterBody: { type: 'string' }, name: { type: 'string' }, meetings: { type: 'object' }, phases: { type: 'array' }, levers: { type: 'array' } }),
    notFound('calendar')),
  op('ledger_now', '/api/v1/now', 'One precinct today, raw',
    'For one precinct: every office that represents it, who holds it, who is running, each body\'s phase, next meetings, posted items, procurement and payments.',
    'The raw view behind your_area. For a resident, prefer your_area: it ranks what to do.',
    // precinct is required, but the ledger checks it itself so the 400 body matches Ballot305's.
    { precinct: q('Required. County precinct, e.g. "033.0" (33 and 033 also work).'), date: q('YYYY-MM-DD, defaults to today.') },
    obj(['precinct', 'date', 'districts', 'bodies'], { precinct: { type: 'string' }, date: { type: 'string' }, updated, rosterUpdated: updated, districts: { type: 'object' }, note: { type: 'string' }, bodies: { type: 'array', items: { type: 'object' } } }),
    { 400: 'Missing precinct', 404: 'Unknown precinct', ...DEFAULT_ERRORS }),
  op('ledger_upcoming', '/api/v1/upcoming', 'Items on posted agendas',
    'Items on posted agendas with ledger matches and tags. Given a precinct, only the bodies it votes for, each item with a relevance block. Paged.', '',
    { body: q('Cycle body key or roster body id.'), precinct: q('County precinct; limits to the bodies it votes for and adds relevance.'), since: q('Meeting date from, YYYY-MM-DD.'), until: q('Meeting date to, YYYY-MM-DD.'), tagged: q('Comma list of money, lobbied, wallet, place, hearing, history, near.'), ...paging },
    pageOf({ type: 'object' }, 'Agenda items')),
  op('ledger_contacts', '/api/v1/contacts', 'Official contacts index',
    'How many roster offices have a checked contact, and each body\'s general contact.', '', {},
    obj(['offices', 'bodies'], { updated, offices: { type: 'integer' }, bodies: { type: 'object' } })),
  op('ledger_contact', '/api/v1/contacts/{office}', 'One office\'s contact',
    'Official email, phone, office address and contact page for one roster office.', '',
    { office: pathParam('Roster office id, e.g. "city-aventura-mayor".') },
    obj(['office'], { office: { type: 'string' }, email: { type: ['string', 'null'] }, phone: { type: ['string', 'null'] }, contactUrl: { type: ['string', 'null'] }, source: { type: ['string', 'null'] }, checked: { type: ['string', 'null'] } }),
    notFound('contact')),
  op('ledger_procurement', '/api/v1/procurement', 'Procurement per body',
    'Bodies with a procurement register, with counts of open solicitations, expiring contracts and capital plan rows.', '', {},
    bodiesList('One summary row per body')),
  op('ledger_procurement_for_body', '/api/v1/procurement/{body}', 'One body\'s procurement',
    'Open solicitations, expiring contracts with ledger matches, the capital plan and levers for one body.', '',
    { body: pathParam('Body key or roster body id, e.g. "county".') },
    obj(['body', 'solicitations', 'expiring', 'capitalPlan'], { body: { type: 'string' }, rosterBody: { type: 'string' }, checked: { type: ['string', 'null'] }, solicitations: { type: 'array' }, expiring: { type: 'array' }, capitalPlan: { type: 'array' }, levers: { type: 'array' } }),
    notFound('procurement register')),
  op('ledger_payments', '/api/v1/payments', 'Payments per body',
    'Bodies with payment data, with counts of datasets, top vendors and departments.', '', {},
    bodiesList('One summary row per body')),
  op('ledger_payments_for_body', '/api/v1/payments/{body}', 'One body\'s payments',
    'Staffing by department, top vendors with ledger matches, union contracts and levers for one body.', '',
    { body: pathParam('Body key or roster body id, e.g. "county".') },
    obj(['body', 'datasets'], { body: { type: 'string' }, rosterBody: { type: 'string' }, checked: { type: ['string', 'null'] }, datasets: { type: 'array' }, staffing: { type: ['object', 'null'] }, vendors: { type: ['object', 'null'] }, levers: { type: 'array' } }),
    notFound('payment data')),
  op('ledger_connections', '/api/v1/connections', 'Confirmed connections',
    'Confirmed connections between officials and parties, donors, lobbyists and vendors, each with the record that states it, and counts under review per official.', '', {},
    obj(['confirmed', 'underReview'], { updated, note: { type: ['string', 'null'] }, confirmed: { type: 'array', items: { type: 'object', properties: { person: { type: 'string' }, relationship: { type: 'string' }, record: { type: 'object' } } } }, underReview: { type: 'object' } })),
  op('ledger_connections_for_person', '/api/v1/connections/{person}', 'One official\'s connections',
    'One official\'s confirmed connections and how many leads are under review.', '',
    { person: pathParam('Roster person id.') },
    obj(['person', 'confirmed', 'underReview'], { person: { type: 'string' }, updated, confirmed: { type: 'array' }, underReview: { type: 'integer' }, note: { type: ['string', 'null'] } })),
  op('ledger_bulk', '/api/v1/bulk', 'Raw data files',
    'Links to every raw data file behind the ledger.', 'For bulk download, so it is HTTP only and not an MCP tool.', {},
    obj(['files'], { updated, license: { type: 'object' }, files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, what: { type: 'string' } } } }, repo: { type: 'string' } }),
    DEFAULT_ERRORS, { mcp: false })
];

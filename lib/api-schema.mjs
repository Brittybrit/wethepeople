// One schema, every output. Each public operation is defined once here; the OpenAPI document (/api/v1/openapi.json),
// the MCP tool list (/mcp) and the contract tests are generated from it, so they cannot drift apart.
// Plain JavaScript, no runtime imports.

import { LEDGER_OPERATIONS_SCHEMA } from './ledger/schema.mjs';

export const API_VERSION = '1.0.0';

const precinctCode = { type: 'string', pattern: '^\\d{3}\\.\\d$', description: 'Miami-Dade precinct code as the county writes it, e.g. "033.0".', examples: ['033.0'] };
const url = { type: ['string', 'null'], description: 'Link to act or read more (https, mailto or tel).' };
const source = { type: ['string', 'null'], description: 'Where the fact comes from (official page or document).' };

const action = {
  type: 'object',
  required: ['rule', 'kind', 'title', 'why'],
  properties: {
    rule: { type: 'integer', minimum: 1, maximum: 4, description: 'Which published rule produced this action (see rules).' },
    kind: { type: 'string', enum: ['vote', 'write', 'speak', 'contact'] },
    title: { type: 'string' },
    why: { type: 'string' },
    deadline: { type: ['string', 'null'] },
    url, phone: { type: ['string', 'null'] }, source
  }
};

const seat = {
  type: 'object',
  required: ['office', 'name', 'holders'],
  properties: {
    office: { type: 'string' }, name: { type: 'string' }, district: { type: ['string', 'null'] },
    holders: { type: 'array', items: { type: 'object', properties: { person: { type: 'string' }, name: { type: 'string' }, since: { type: 'string' }, via: { type: 'string' }, termExpires: { type: ['string', 'null'] } } } },
    onBallot: { type: 'array', items: { type: 'object', properties: { person: { type: 'string' }, name: { type: 'string' }, party: { type: 'string' }, incumbent: { type: 'boolean' } } } },
    contact: { type: ['object', 'null'], properties: { email: { type: 'string' }, phone: { type: 'string' }, contactUrl: { type: 'string' }, officeAddress: { type: 'string' }, checked: { type: 'string' }, source: { type: 'string' } } }
  }
};

export const OPERATIONS = [
  {
    id: 'suggest_address',
    method: 'GET',
    path: '/api/v1/address-suggest',
    title: 'Suggest Miami-Dade addresses as someone types',
    summary: 'Partial street address to up to 6 matching Miami-Dade addresses, for autocomplete.',
    description: 'Esri World Geocoder suggestions limited to Miami-Dade County. Pass a chosen suggestion\'s magicKey to find_precinct for an exact match. The typed text is passed to Esri and never logged, stored or cached. A web form helper, so it is not offered as an MCP tool.',
    params: {
      text: { in: 'query', required: true, schema: { type: 'string', minLength: 3, maxLength: 120, description: 'What the person has typed so far, e.g. "1700 conven".' } }
    },
    response: {
      type: 'object',
      required: ['suggestions'],
      properties: { suggestions: { type: 'array', items: { type: 'object', required: ['text', 'magicKey'], properties: { text: { type: 'string' }, magicKey: { type: 'string' } } } } }
    },
    errors: { 400: 'text shorter than 3 characters', 429: 'More than 120 suggestion requests a minute from one client', 502: 'The geocoder did not answer' },
    sendsPersonalData: true,
    rateLimit: 'RATE_LIMIT_ADDRESS_SUGGEST',
    mcp: false
  },
  {
    id: 'find_precinct',
    method: 'GET',
    path: '/api/v1/precinct',
    title: 'Find a precinct from an address',
    summary: 'Street address to Miami-Dade precinct code(s).',
    description: 'Geocodes the address (Esri World Geocoder, then the U.S. Census geocoder) and finds the precinct in the county\'s precinct polygons. The address is passed to those services and is never logged, stored or cached. A split precinct returns both halves; only the voter\'s ballot or voter card says which.',
    params: {
      address: { in: 'query', required: true, schema: { type: 'string', minLength: 3, maxLength: 200, description: 'Street address in Miami-Dade County, e.g. "1700 Convention Center Dr, Miami Beach".' } },
      magicKey: { in: 'query', required: false, schema: { type: 'string', maxLength: 300, description: 'Optional: the magicKey of an address chosen from suggest_address, for an exact match.' } }
    },
    response: {
      type: 'object',
      required: ['precincts', 'split'],
      properties: {
        precincts: { type: 'array', items: precinctCode },
        split: { type: 'boolean' },
        matchedAddress: { type: 'string' },
        note: { type: ['string', 'null'] },
        sources: { type: 'object', properties: { geocoder: { type: 'string' }, precincts: { type: 'string' } } }
      }
    },
    errors: { 400: 'Missing address', 404: 'Address not found, or not in a Miami-Dade precinct', 429: 'More than 20 address lookups a minute from one client', 502: 'A geocoder or the county layer did not answer' },
    sendsPersonalData: true,
    rateLimit: 'RATE_LIMIT_ADDRESS_LOOKUP'
  },
  {
    id: 'your_area',
    method: 'GET',
    path: '/api/v1/your-area',
    title: 'Your area: who serves a precinct and what to do now',
    summary: 'One precinct\'s view: who holds every seat that represents it, the appointed officials, courts and countywide boards that serve it, the next meetings and decision points, items on posted agendas, ways to act, and up to four do-now actions ranked by fixed rules.',
    description: 'Closest to home first (city, schools, county, state, federal). The do-now list comes from four published rules, not a model; the response includes them. Money behind officials is not included: it lives on Ballot305 with its full context. Data: Ballot305 public API, CC BY 4.0, edge-cached for 15 minutes.',
    params: { precinct: { in: 'query', required: true, schema: precinctCode } },
    response: {
      type: 'object',
      required: ['precinct', 'today', 'doNow', 'rules', 'servants'],
      properties: {
        precinct: precinctCode,
        today: { type: 'string', format: 'date' },
        dataUpdated: { type: ['string', 'null'] },
        rosterUpdated: { type: ['string', 'null'] },
        districts: { type: 'object' },
        doNow: { type: 'array', items: action },
        rules: { type: 'array', items: { type: 'string' } },
        upcomingItems: { type: 'array', items: { type: 'object' } },
        upcomingItemsTotal: { type: 'integer' },
        meetings: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, time: { type: ['string', 'null'] }, kind: { type: ['string', 'null'] }, body: { type: 'string' }, bodyName: { type: 'string' }, note: { type: ['string', 'null'] }, source } } },
        decisionPoints: { type: 'array', items: { type: 'object' } },
        servants: { type: 'array', items: { type: 'object', properties: { body: { type: 'string' }, name: { type: 'string' }, level: { type: 'string', enum: ['municipal', 'school', 'county', 'state', 'federal'] }, seats: { type: 'array', items: seat } } } },
        levers: { type: 'array', items: { type: 'object' } },
        notResearchedYet: { type: 'array', items: { type: 'string' } },
        appointed: { type: 'array', description: 'Appointed officials who run the city, schools and county for this precinct.', items: { type: 'object', properties: { body: { type: 'string' }, name: { type: 'string' }, level: { type: 'string' }, seats: { type: 'array', items: { type: 'object' } } } } },
        courts: { type: 'array', description: 'Courts that hear cases from this precinct, with every sitting judge.', items: { type: 'object', properties: { body: { type: 'string' }, name: { type: 'string' }, hears: { type: 'string' }, count: { type: 'integer' }, judges: { type: 'array', items: { type: 'object' } } } } },
        boards: { type: 'array', description: 'Countywide boards and authorities that tax, borrow or spend public money, with members.', items: { type: 'object', properties: { body: { type: 'string' }, name: { type: 'string' }, does: { type: 'string' }, count: { type: 'integer' }, members: { type: 'array', items: { type: 'object' } } } } },
        note: { type: 'string' },
        decisionChains: { type: 'array', description: 'Each upcoming decision as its chain of milestones (actor, inputs, output, legal basis, what a resident can do, influence), with where it stands today.', items: { type: 'object' } },
        processes: { type: 'array', description: 'How a local law passes and how a contract is awarded for each body, step by step, without dates.', items: { type: 'object' } },
        nextLeveragePoint: { type: ['object', 'null'], description: 'The soonest open or upcoming step where a resident has high leverage.' },
        source: { type: 'object', properties: { name: { type: 'string' }, license: { type: 'string' }, docs: { type: 'string' }, methodology: { type: 'string' } } }
      }
    },
    errors: { 400: 'precinct is not a code like 033.0', 404: 'No data for that precinct', 502: 'The data source did not answer' },
    sendsPersonalData: false
  }
];

// The ledger's read operations (Ballot305's API shapes, served from the platform's copy of the data).
OPERATIONS.push(...LEDGER_OPERATIONS_SCHEMA);

// Finds the operation for a request path. A template segment like {id} matches one non-empty path segment,
// percent-decoded. Returns { op, pathArgs } or null.
export function matchOperation(path, method = 'GET') {
  const segs = path.split('/');
  for (const op of OPERATIONS) {
    if (op.method !== method) continue;
    const tpl = op.path.split('/');
    if (tpl.length !== segs.length) continue;
    const pathArgs = {};
    let hit = true;
    for (let i = 0; i < tpl.length && hit; i++) {
      const name = (tpl[i].match(/^\{(\w+)\}$/) || [])[1];
      if (!name) { hit = tpl[i] === segs[i]; continue; }
      try { pathArgs[name] = decodeURIComponent(segs[i]); } catch { hit = false; }
      if (hit && !pathArgs[name]) hit = false;
    }
    if (hit) return { op, pathArgs };
  }
  return null;
}

// Validate query input against an operation's params. Returns an error string or null. Tier 1, no library.
export function checkParams(op, input) {
  for (const [name, p] of Object.entries(op.params)) {
    const v = input[name];
    if (v == null || v === '') { if (p.required) return 'Missing ' + name; continue; }
    if (typeof v !== 'string') return name + ' must be a string';
    const s = p.schema;
    if (s.minLength && v.trim().length < s.minLength) return name + ' is too short';
    if (s.maxLength && v.length > s.maxLength) return name + ' is too long';
    if (s.pattern && !new RegExp(s.pattern).test(v)) return name + ' must look like ' + (s.examples ? s.examples[0] : s.pattern);
  }
  return null;
}

const errorSchema = { type: 'object', required: ['error'], properties: { error: { type: 'string' } } };

export function openApi(base = 'https://wethepeople305.org') {
  const paths = {};
  for (const op of OPERATIONS) {
    const responses = { 200: { description: 'OK', content: { 'application/json': { schema: op.response } } } };
    for (const [code, d] of Object.entries(op.errors)) responses[code] = { description: d, content: { 'application/json': { schema: errorSchema } } };
    paths[op.path] = {
      [op.method.toLowerCase()]: {
        operationId: op.id, summary: op.summary, description: op.description,
        parameters: Object.entries(op.params).map(([name, p]) => ({ name, in: p.in, required: !!p.required, schema: p.schema, description: p.schema.description })),
        responses,
        'x-sends-personal-data': op.sendsPersonalData,
        'x-mcp-tool': op.mcp === false ? null : op.id
      }
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'We the People 305 API', version: API_VERSION,
      description: 'Open-source civic intelligence for Miami-Dade. Read-only, no key, CORS open. Every operation except web-form helpers and bulk downloads is also an MCP tool at /mcp. The ledger operations (ids starting ledger_) serve Ballot305 data in Ballot305\'s response shapes.',
      license: { name: 'MIT (code); data CC BY 4.0 from Ballot305', identifier: 'MIT' },
      contact: { url: 'https://github.com/Brittybrit/wethepeople' }
    },
    servers: [{ url: base }],
    externalDocs: { url: base + '/docs/api.md' },
    paths
  };
}

// MCP tool list (tools/list). Same names, same input schema, same output schema as the HTTP API.
export function mcpTools() {
  return OPERATIONS.filter(op => op.mcp !== false).map(op => ({
    name: op.id,
    title: op.title,
    description: op.summary + ' ' + op.description,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(Object.entries(op.params).map(([n, p]) => [n, p.schema])),
      required: Object.entries(op.params).filter(([, p]) => p.required).map(([n]) => n),
      additionalProperties: false
    },
    outputSchema: op.response,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true }
  }));
}

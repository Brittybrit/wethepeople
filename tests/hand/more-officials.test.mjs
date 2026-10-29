import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { moreOfficials, mergedRoster } from '../../lib/more-officials.mjs';
import { buildIndex } from '../../lib/ledger/ledger.mjs';

const J = p => JSON.parse(readFileSync(new URL('../../' + p, import.meta.url), 'utf8'));
const ledger = buildIndex({ roster: J('public/ledger-data/roster.json') });
const additions = { offices: J('data/roster-additions/offices.json'), people: J('data/roster-additions/people.json'), terms: J('data/roster-additions/terms.json') };
const today = '2026-10-29';

describe('more officials for a precinct', () => {
  const out = moreOfficials(ledger, additions, { municipality: 'MIAMI BEACH', municipalityBody: 'city-miami-beach' }, today);
  it('names the city\'s appointed officers', () => {
    const city = out.appointed.find(a => a.body === 'city-miami-beach');
    expect(city.name).toBe('City of Miami Beach');
    expect(city.seats.map(s => s.office).sort()).toEqual(['city-miami-beach-attorney', 'city-miami-beach-clerk', 'city-miami-beach-manager']);
  });
  it('unincorporated areas get no city group', () => {
    const u = moreOfficials(ledger, additions, { municipality: null, municipalityBody: null }, today);
    expect(u.appointed.some(a => a.level === 'municipal')).toBe(false);
  });
  it('lists all four courts with sitting judges only', () => {
    expect(out.courts.map(c => c.body)).toEqual(['fl-circuit-11', 'mdc-county-court', 'fl-dca-3', 'fl-supreme-court']);
    for (const c of out.courts) expect(c.count).toBe(c.judges.length);
  });
  it('lists countywide boards, each member with a seat', () => {
    expect(out.boards.length).toBeGreaterThan(5);
    for (const b of out.boards) for (const m of b.members) expect(m.seat).toBeTruthy();
  });
  it('respects dates: the outgoing superintendent is not shown after his term', () => {
    const sch = out.appointed.find(a => a.body === 'mdcps').seats.find(s => s.office === 'mdcps-superintendent');
    expect(sch.holders.map(h => h.name)).toEqual(['Rafael A. Villalobos']);
    const before = moreOfficials(ledger, additions, {}, '2026-08-01').appointed.find(a => a.body === 'mdcps').seats.find(s => s.office === 'mdcps-superintendent');
    expect(before.holders.map(h => h.name)).toEqual(['José L. Dotres']);
  });
  it('merging keeps every ledger person and adds new ones', () => {
    const r = mergedRoster(ledger, additions);
    expect(r.people.size).toBeGreaterThan(ledger.people.size);
  });
});

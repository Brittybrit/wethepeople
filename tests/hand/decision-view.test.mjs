import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { decisionChains, decisionBodyKeys } from '../../lib/decision-view.mjs';

const data = JSON.parse(readFileSync(new URL('../../data/decision-processes/index.json', import.meta.url), 'utf8'));
const keys = ['county', 'schoolboard', 'city-miami-beach'];

describe('decision chains for a precinct', () => {
  it('maps a precinct\'s bodies to decision bodies through their cycle keys', () => {
    expect(decisionBodyKeys([{ cycle: { key: 'county' } }, { cycle: null }, { cycle: { key: 'nope' } }], data)).toEqual(['county']);
  });
  it('orders chains by their next step and marks where each stands', () => {
    const { decisionChains: c } = decisionChains(keys, '2027-06-15', data);
    expect(c.length).toBeGreaterThan(0);
    for (let i = 1; i < c.length; i++) expect(c[i - 1].next.when.from <= c[i].next.when.from).toBe(true);
    for (const ch of c) {
      for (const s of ch.steps) expect(['done', 'now', 'ahead', 'undated']).toContain(s.status);
      expect(['now', 'ahead']).toContain(ch.next.status);
    }
  });
  it('in July the county budget chain is past its first steps and the tax-rate cap is ahead or open', () => {
    const { decisionChains: c } = decisionChains(['county'], '2027-07-10', data);
    const b = c.find(x => x.decision.kind === 'annual-budget-and-millage');
    expect(b.steps.some(s => s.status === 'done')).toBe(true);
    expect(b.steps.find(s => s.key === 'maximum-millage-set').status).not.toBe('done');
  });
  it('lists ordinance and contract processes without dates', () => {
    const { processes } = decisionChains(keys, '2026-10-29', data);
    expect(processes.map(p => p.decision.kind)).toEqual(expect.arrayContaining(['ordinance-adoption', 'procurement-award']));
    for (const p of processes) for (const s of p.steps) expect(s.when).toBeUndefined();
  });
  it('names a next high-leverage moment', () => {
    expect(decisionChains(keys, '2026-10-29', data).nextLeveragePoint.influence).toBe('high');
  });
});

import { inputsDetail, bodyLinks } from '../../lib/decision-view.mjs';
const catalog = JSON.parse(readFileSync(new URL('../../data/decision-inputs/catalog.json', import.meta.url), 'utf8'));
describe('decision inputs catalog', () => {
  it('maps every input named in any decision step to a record with a status', () => {
    const names = new Set(Object.values(data.templates).flatMap(t => t.milestones.flatMap(m => m.inputs || [])));
    const keys = new Set(catalog.items.map(i => i.key));
    for (const n of names) expect(keys.has(catalog.map[n]), n).toBe(true);
    for (const i of catalog.items) expect(['on-site', 'online', 'records-request', 'not-used']).toContain(i.status);
  });
  it('points records requests at the body\'s own portal and agenda records at its agenda system', () => {
    const links = { records: 'https://records.example/req', agendas: 'https://agendas.example', home: 'https://city.example' };
    const out = inputsDetail(['Department requests', 'Staff report', 'TRIM notice'], catalog, links);
    expect(out[0]).toMatchObject({ status: 'records-request', url: 'https://records.example/req' });
    expect(out[1]).toMatchObject({ status: 'online', url: 'https://agendas.example' });
    expect(out[2].url).toMatch(/miamidadepa/);
  });
  it('reads links from a precinct\'s bodies', () => {
    expect(bodyLinks([{ cycle: { key: 'county', links: { agendas: 'a', home: 'h' } }, bodyContact: { recordsRequestUrl: 'r' } }])).toEqual({ county: { agendas: 'a', home: 'h', records: 'r' } });
  });
});

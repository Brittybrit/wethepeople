import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { loadAdditions, checkRosterAdditions, defaultRosterPath } from '../../scripts/check-roster-additions.mjs';

const additions = loadAdditions();
const roster = existsSync(defaultRosterPath) ? JSON.parse(readFileSync(defaultRosterPath, 'utf8')) : null;

describe('data/roster-additions', () => {
  it('passes every check on its own (ids unique, terms sourced, dates YYYY-MM-DD, references resolve)', () => {
    expect(checkRosterAdditions(additions, null)).toEqual([]);
  });
  it.skipIf(!roster)('does not collide with roster.json and every term resolves against it', () => {
    expect(checkRosterAdditions(additions, roster)).toEqual([]);
  });
  it('flags a term without a source, a bad date, and a reference that does not resolve', () => {
    const bad = { people: [{ id: 'a' }], offices: [{ id: 'o', name: 'O', level: 'county', jurisdiction: 'J', body: 'b', kind: 'board', actionScope: 'all', selection: 'appointed' }],
      terms: [{ person: 'a', office: 'o', start: '2026-13-01', end: null, sources: [], sourceKind: 'official' }] };
    const problems = checkRosterAdditions(bad, null);
    expect(problems.some((p) => p.includes('no source URL'))).toBe(true);
    expect(problems.some((p) => p.includes('not a YYYY-MM-DD date'))).toBe(true);
    const dangling = { ...bad, terms: [{ person: 'nobody', office: 'o', start: '2026-01-01', end: null, sources: ['https://example.gov'], sourceKind: 'official' }] };
    expect(checkRosterAdditions(dangling, { people: [], offices: [] }).some((p) => p.includes('person not found'))).toBe(true);
  });
});

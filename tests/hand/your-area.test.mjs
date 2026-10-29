import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { yourArea, itemReasons, daysBetween, todayIn, LEVEL_ORDER } from '../../lib/your-area.mjs';

const now = JSON.parse(readFileSync(new URL('../fixtures/ballot305-now-033.0.json', import.meta.url)));
const upcoming = JSON.parse(readFileSync(new URL('../fixtures/ballot305-upcoming-sample.json', import.meta.url)));
const empty = { items: [] };

describe('yourArea', () => {
  const out = yourArea(now, upcoming, '2026-10-29');

  it('orders bodies closest to home first', () => {
    const ranks = out.servants.map(b => LEVEL_ORDER.indexOf(b.level));
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    expect(out.servants[0].level).toBe('municipal');
  });

  it('puts voting first inside 30 days of an election', () => {
    expect(out.doNow[0].kind).toBe('vote');
    expect(out.doNow[0].rule).toBe(1);
  });

  it('drops the vote action after the election', () => {
    expect(yourArea(now, empty, '2026-11-04').doNow.some(a => a.kind === 'vote')).toBe(false);
  });

  it('picks the weightiest posted item and prefers written comment', () => {
    const w = out.doNow.find(a => a.rule === 2);
    expect(w.kind).toBe('write');
    expect(w.url).toBe('mailto:clerk@example.org');
    expect(w.why).toContain('seawall');
  });

  it('keeps only items whose meeting is still ahead, weightiest first', () => {
    expect(out.upcomingItems.map(i => i.id)).toEqual(['R7-A', 'C4-B']);
  });

  it('offers a seat with its own district and an email for reaching out', () => {
    const c = out.doNow.find(a => a.kind === 'contact');
    expect(c.url).toMatch(/^mailto:/);
  });

  it('never returns a meeting or decision point in the past', () => {
    for (const m of out.meetings) expect(m.date >= '2026-10-29').toBe(true);
    for (const p of out.decisionPoints) expect((p.end || p.start) >= '2026-10-29').toBe(true);
  });

  it('carries no money figures (those live on Ballot305 with their full context)', () => {
    expect(JSON.stringify(out)).not.toContain('moneySummary');
  });

  it('lists seats whose calendars are not researched yet', () => {
    expect(out.notResearchedYet.length).toBeGreaterThan(0);
  });
});

describe('helpers', () => {
  it('explains tags in plain words', () => {
    expect(itemReasons({ place: true, money: true })).toEqual(['in or near your area', 'spends or awards public money']);
    expect(itemReasons()).toEqual([]);
  });
  it('counts days', () => { expect(daysBetween('2026-10-29', '2026-11-03')).toBe(5); });
  it('gives today in Miami time', () => { expect(todayIn('America/New_York', new Date('2026-10-30T02:00:00Z'))).toBe('2026-10-29'); });
});

describe('show up rule', () => {
  it('sends people to a regular meeting, not a special session or ceremony', () => {
    const s = yourArea(now, empty, '2026-10-29').doNow.find(a => a.rule === 3);
    if (s) {
      const all = now.bodies.flatMap(b => ((b.cycle || {}).meetings || {}).next || []);
      const date = s.title.match(/\d{4}-\d{2}-\d{2}/)[0];
      expect(all.some(m => m.date === date && m.kind === 'regular')).toBe(true);
    }
  });
});

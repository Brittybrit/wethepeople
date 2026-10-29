import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  chainFor, upcomingMilestones, nextLeveragePoint, validateDecisionData, windowFromAnchor, addDays, span, KINDS, LEVERS
} from '../../lib/decision-processes.mjs';
import { buildDecisionProcesses } from '../../scripts/build-decision-processes.mjs';

const built = buildDecisionProcesses();
const data = built.index;
const committed = readFileSync(new URL('../../data/decision-processes/index.json', import.meta.url), 'utf8');
const clone = o => JSON.parse(JSON.stringify(o));
const ALL_BODIES = Object.keys(data.bodies);

describe('dataset validation', () => {
  it('has no validation problems', () => {
    expect(built.errors).toEqual([]);
  });

  it('committed index.json matches the source files (run node scripts/build-decision-processes.mjs)', () => {
    expect(committed).toBe(built.json);
  });

  it('covers all 21 bodies with a budget, ordinance, procurement and election decision each', () => {
    expect(ALL_BODIES).toHaveLength(21);
    expect(ALL_BODIES).toContain('county');
    expect(ALL_BODIES).toContain('schoolboard');
    for (const key of ALL_BODIES) {
      const kinds = new Set(data.bodies[key].decisions.map(d => d.kind));
      expect([...kinds].sort(), key).toEqual([...KINDS].sort());
    }
  });

  it('every legal rule in every template has a URL from an official source', () => {
    for (const t of Object.values(data.templates)) {
      for (const m of t.milestones) for (const l of m.legalBasis) {
        expect(l.url, `${t.key}/${m.key} ${l.cite}`).toMatch(/^https:\/\/(www\.)?(flsenate\.gov|floridarevenue\.com|miamidade\.gov|ethics\.miamidade\.gov)\//);
      }
    }
  });

  it('every resident lever uses a known lever key', () => {
    for (const t of Object.values(data.templates)) for (const m of t.milestones) for (const r of m.residentCan) expect(LEVERS).toContain(r.lever);
  });

  it('flags a legal rule without a URL', () => {
    const bad = clone(data);
    bad.templates['annual-budget-and-millage'].milestones.find(m => m.key === 'maximum-millage-set').legalBasis[0].url = '';
    expect(validateDecisionData(bad).join('\n')).toMatch(/maximum-millage-set: legal basis "s\. 200\.065\(2\)\(b\), F\.S\." has no URL/);
  });

  it('flags a body-specific date without a source', () => {
    const bad = clone(data);
    const row = bad.bodies.county.decisions[0].milestones.find(r => r.milestone === 'first-public-hearing');
    delete row.source;
    expect(validateDecisionData(bad).join('\n')).toMatch(/county \/ budget-fy2027-28 \/ first-public-hearing: body-source date has no source URL/);
  });

  it('flags an invalid dateBasis, a duplicate milestone key and a bad offset', () => {
    const bad = clone(data);
    bad.bodies.county.decisions[0].milestones[0].dateBasis = 'guess';
    const t = bad.templates['procurement-award'];
    t.milestones.push(clone(t.milestones[0]));
    bad.templates['annual-budget-and-millage'].milestones.find(m => m.key === 'final-public-hearing').timing.offsetDays = { min: 5, max: 2 };
    const out = validateDecisionData(bad).join('\n');
    expect(out).toMatch(/dateBasis "guess"/);
    expect(out).toMatch(/duplicate milestone key "need-funded"/);
    expect(out).toMatch(/offset min 5 is after max 2/);
  });

  it('flags a computed date that falls outside its legal window', () => {
    const bad = clone(data);
    const ms = bad.bodies['city-doral'].decisions[0].milestones;
    ms.find(r => r.milestone === 'maximum-millage-set').date = '2027-08-20';
    expect(validateDecisionData(bad).join('\n')).toMatch(/city-doral \/ budget-fy2027-28 \/ maximum-millage-set: ends 2027-08-20, after the legal window closes 2027-08-04/);
  });

  it('never shows an estimated date without saying so', () => {
    for (const b of Object.values(data.bodies)) for (const d of b.decisions) for (const r of d.milestones) {
      if (r.dateBasis === 'pattern') { expect(r.note, `${b.key}/${r.milestone}`).toMatch(/estimated/i); expect(r.source).toMatch(/^https?:/); }
    }
  });

  it('keeps the dataset compact', () => {
    expect(built.json.length).toBeLessThan(400 * 1024);
  });
});

describe('statutory windows from anchors', () => {
  it('35-day window: certification July 1 means the proposed rate is due by August 4', () => {
    const m = data.templates['annual-budget-and-millage'].milestones.find(x => x.key === 'maximum-millage-set');
    expect(m.timing.anchor).toBe('taxable-value-certified');
    expect(windowFromAnchor('2027-07-01', m.timing.offsetDays)).toEqual({ from: '2027-07-01', to: '2027-08-04' });
  });

  it('2-to-5-day window: final hearing 2 to 5 days after the ad', () => {
    const m = data.templates['annual-budget-and-millage'].milestones.find(x => x.key === 'final-public-hearing');
    expect(m.timing.anchor).toBe('final-hearing-advertised');
    expect(m.timing.offsetDays).toEqual({ min: 2, max: 5 });
    expect(windowFromAnchor('2027-09-12', m.timing.offsetDays)).toEqual({ from: '2027-09-14', to: '2027-09-17' });
  });

  it('first hearing between day 65 and day 80, and TRIM notice by day 55', () => {
    const ms = Object.fromEntries(data.templates['annual-budget-and-millage'].milestones.map(m => [m.key, m]));
    expect(windowFromAnchor('2027-07-01', ms['first-public-hearing'].timing.offsetDays)).toEqual({ from: '2027-09-03', to: '2027-09-18' });
    expect(windowFromAnchor('2027-07-01', ms['trim-notice-mailed'].timing.offsetDays).to).toBe('2027-08-24');
  });

  it('school district: tentative ad within 29 days, hearing 2 to 5 days after it', () => {
    const ms = Object.fromEntries(data.templates['annual-budget-and-millage-school-district'].milestones.map(m => [m.key, m]));
    expect(windowFromAnchor('2027-07-01', ms['tentative-budget-advertised'].timing.offsetDays).to).toBe('2027-07-29');
    expect(ms['tentative-budget-hearing'].timing.offsetDays).toEqual({ min: 2, max: 5 });
  });

  it('county body file: computed windows agree with its own dates', () => {
    const rows = data.bodies.county.decisions.find(d => d.kind === 'annual-budget-and-millage').milestones;
    const get = k => rows.find(r => r.milestone === k);
    expect(get('maximum-millage-set').window).toEqual({ from: '2027-07-01', to: '2027-08-04' });
    expect(get('first-public-hearing').date).toBe('2027-09-09');
    const ad = get('final-hearing-advertised').window;
    // within 15 days after the Sept 9 hearing and 2 to 5 days before the Sept 23 hearing
    expect(ad).toEqual({ from: '2027-09-18', to: '2027-09-21' });
    expect(addDays(ad.to, 2)).toBe('2027-09-23');
  });

  it('open-ended windows: span uses the side that is set', () => {
    expect(span({ window: { from: null, to: '2027-01-30' } })).toEqual({ from: '2027-01-30', to: '2027-01-30' });
    expect(windowFromAnchor('2027-09-09', { min: null, max: -5 })).toEqual({ from: null, to: '2027-09-04' });
  });
});

describe('chainFor', () => {
  it('returns the county budget chain in template order with step numbers', () => {
    const [chain] = chainFor('county', 'annual-budget-and-millage', data);
    const keys = chain.steps.map(s => s.key);
    expect(keys.indexOf('taxable-value-certified')).toBeLessThan(keys.indexOf('maximum-millage-set'));
    expect(keys.indexOf('maximum-millage-set')).toBeLessThan(keys.indexOf('trim-notice-mailed'));
    expect(keys.indexOf('trim-notice-mailed')).toBeLessThan(keys.indexOf('first-public-hearing'));
    expect(keys.indexOf('first-public-hearing')).toBeLessThan(keys.indexOf('final-hearing-advertised'));
    expect(keys.indexOf('final-hearing-advertised')).toBeLessThan(keys.indexOf('final-public-hearing'));
    expect(keys).toContain('mayor-veto-window');
    chain.steps.forEach((s, i) => { expect(s.step).toBe(i + 1); expect(s.stepLabel).toBe(`${i + 1} of ${chain.steps.length}`); });
  });

  it('dated steps run in date order along the chain', () => {
    for (const key of ALL_BODIES) {
      for (const chain of chainFor(key, 'annual-budget-and-millage', data)) {
        const first = k => chain.steps.find(s => s.key === k)?.instances.map(span).filter(Boolean)[0];
        const pairs = chain.body.level === 'school'
          ? [['tentative-budget-hearing', 'final-budget-hearing']]
          : [['maximum-millage-set', 'first-public-hearing'], ['first-public-hearing', 'final-public-hearing']];
        for (const [a, b] of pairs) {
          const A = first(a), B = first(b);
          if (A && B) expect(A.from <= B.to, `${key}: ${a} ${A.from} before ${b} ${B.to}`).toBe(true);
        }
      }
    }
  });

  it('city chains leave out county-only steps and keep city law', () => {
    const [chain] = chainFor('city-doral', 'annual-budget-and-millage', data);
    expect(chain.steps.map(s => s.key)).not.toContain('mayor-veto-window');
    const posted = chain.steps.find(s => s.key === 'tentative-budget-posted');
    expect(posted.legalBasis.map(l => l.cite)).toEqual(['s. 166.241(3)(a), F.S.']);
  });

  it('school board budget uses the school district template', () => {
    const [chain] = chainFor('schoolboard', 'annual-budget-and-millage', data);
    expect(chain.decision.template).toBe('annual-budget-and-millage-school-district');
    expect(chain.steps.find(s => s.key === 'tentative-budget-hearing').instances[0].date).toBe('2027-07-28');
  });

  it('county procurement shows the Cone of Silence and the 3-work-day protest window', () => {
    const [chain] = chainFor('county', 'procurement-award', data);
    const adv = chain.steps.find(s => s.key === 'solicitation-advertised');
    expect(adv.legalBasis.map(l => l.cite)).toContain('Miami-Dade County Code Sec. 2-11.1(t)');
    const protest = chain.steps.find(s => s.key === 'bid-protest-window');
    expect(protest.timing.offsetUnit).toBe('business-days');
    expect(protest.timing.offsetDays).toEqual({ min: 1, max: 3 });
  });

  it('returns two election chains for the county (2026 and 2028) and none for an unknown body', () => {
    expect(chainFor('county', 'election-to-office', data).map(c => c.decision.key)).toEqual(['election-2026', 'election-2028']);
    expect(chainFor('no-such-body', 'annual-budget-and-millage', data)).toEqual([]);
  });

  it('adds the body\'s own link for a lever', () => {
    const [chain] = chainFor('county', 'annual-budget-and-millage', data);
    const rr = chain.steps.find(s => s.key === 'trim-compliance-certified').residentCan.find(r => r.lever === 'records-request');
    expect(rr.url).toMatch(/^https:\/\/miamidadecounty\.govqa\.us\//);
  });
});

describe('upcomingMilestones', () => {
  const july = upcomingMilestones(['county'], '2027-07-10', data, { horizonDays: 30 });

  it('a date in July 2027 includes the county maximum millage step, open now, with its place in the chain', () => {
    const m = july.find(x => x.milestone.key === 'maximum-millage-set');
    expect(m).toBeTruthy();
    expect(m.openNow).toBe(true);
    expect(m.window).toEqual({ from: '2027-07-01', to: '2027-08-04' });
    expect(m.dateBasis).toBe('statutory-window');
    expect(m.influence).toBe('high');
    expect(m.stepLabel).toMatch(/^\d+ of \d+$/);
    expect(m.cameBefore.key).toBe('budget-workshops-before-rate-cap');
    expect(m.feeds.key).toBe('budget-workshops-before-hearings');
    expect(m.residentCan.map(r => r.lever)).toEqual(expect.arrayContaining(['public-comment', 'written-comment', 'contact']));
    expect(m.milestone.legalBasis[0].cite).toBe('s. 200.065(2)(b), F.S.');
  });

  it('is sorted by start date and stays inside the horizon', () => {
    const starts = july.map(m => m.when.from);
    expect(starts).toEqual([...starts].sort());
    for (const m of july) { expect(m.when.to >= '2027-07-10').toBe(true); expect(m.when.from <= '2027-08-09').toBe(true); }
  });

  it('skips process-only decisions and steps with no date', () => {
    const all = upcomingMilestones(ALL_BODIES, '2026-10-29', data, { horizonDays: 800 });
    expect(all.some(m => m.decision.kind === 'ordinance-adoption' || m.decision.kind === 'procurement-award')).toBe(false);
    expect(all.every(m => m.dateBasis !== 'unknown')).toBe(true);
  });

  it('marks pattern dates as estimated', () => {
    const m = upcomingMilestones(['city-doral'], '2027-07-01', data, { horizonDays: 60 }).find(x => x.milestone.key === 'maximum-millage-set');
    expect(m.dateBasis).toBe('pattern');
    expect(m.estimated).toBe(true);
    expect(m.note).toMatch(/estimated/i);
  });
});

describe('nextLeveragePoint', () => {
  it('returns a high-influence step', () => {
    const p = nextLeveragePoint(['county'], '2027-07-10', data);
    expect(p.influence).toBe('high');
    expect(p.milestone.key).toBe('maximum-millage-set');
  });

  it('looks past steps that are over to the next high one', () => {
    const p = nextLeveragePoint(['county'], '2027-08-10', data);
    expect(p.influence).toBe('high');
    expect(p.milestone.key).toBe('first-public-hearing');
    expect(p.date).toBe('2027-09-09');
  });

  it('works across several bodies and returns null when nothing is dated', () => {
    const p = nextLeveragePoint(['city-pinecrest', 'county', 'schoolboard'], '2027-07-20', data);
    expect(p.influence).toBe('high');
    expect(p.when.to >= '2027-07-20').toBe(true);
    expect(nextLeveragePoint(['no-such-body'], '2027-07-10', data)).toBeNull();
  });
});

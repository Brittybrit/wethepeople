import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

// The budget page shows hand-entered figures. These checks hold them to the totals the source documents print.
const data = JSON.parse(readFileSync(new URL('../../public/budget-data/amendment-3-budgets.json', import.meta.url), 'utf8'));
const county = data.governments.find(g => g.key === 'miami-dade-county');
const beach = data.governments.find(g => g.key === 'miami-beach');
const sum = (rows, field) => rows.reduce((t, r) => t + r[field], 0);

describe('amendment 3 budget figures', () => {
  it('county revenue by source adds up to the operating budget', () => {
    expect(sum(county.revenueBySource, 'amount')).toBe(county.operatingBudget);
    expect(county.revenueBySource.filter(r => r.isPropertyTax).length).toBe(1);
  });
  it('county department columns add up to the totals printed in Appendix A', () => {
    expect(sum(county.departments, 'countywideGeneralFund')).toBe(county.countywideGeneralFundTotal);
    expect(sum(county.departments, 'unincorporatedAreaGeneralFund')).toBe(748189);
    expect(sum(county.departments, 'feesDistrictTaxesAndBondFunds')).toBe(5018586);
    expect(sum(county.departments, 'state')).toBe(47318);
    expect(sum(county.departments, 'federal')).toBe(333978);
    expect(sum(county.departments, 'paidByOtherCountyDepartments')).toBe(876086);
    expect(sum(county.departments, 'total') - sum(county.departments, 'paidByOtherCountyDepartments')).toBe(county.operatingBudget);
  });
  it('every county department row adds up to its own total', () => {
    for (const d of county.departments) {
      expect(d.countywideGeneralFund + d.unincorporatedAreaGeneralFund + d.feesDistrictTaxesAndBondFunds + d.state + d.federal + d.paidByOtherCountyDepartments, d.name).toBe(d.total);
    }
  });
  it('county loss by fund adds up to the county total, within rounding', () => {
    const loss = county.projectedPropertyTaxLoss;
    expect(sum(loss.byFund, 'fiscalYear2027_28')).toBe(loss.total.fiscalYear2027_28);
    expect(Math.abs(sum(loss.byFund, 'fiscalYear2028_29Cumulative') - loss.total.fiscalYear2028_29Cumulative)).toBeLessThanOrEqual(100);
  });
  it('Miami Beach shares add up to 100 and the rate parts add up to the total rate', () => {
    expect(sum(beach.generalFundRevenueShares, 'percent')).toBe(100);
    expect(sum(beach.generalFundSpendingShares, 'percent')).toBe(100);
    expect(sum(beach.taxRateMills.parts, 'mills')).toBeCloseTo(beach.taxRateMills.total, 4);
  });
  it('vote counts follow the rule for each body size', () => {
    for (const g of data.governments) {
      const b = g.governingBody;
      expect(b.votesForRolledBackRate, g.key).toBe(Math.floor(b.members / 2) + 1);
      expect(b.votesForUpTo110Percent, g.key).toBe(Math.ceil(b.members * 2 / 3));
      expect(b.votesAbove110Percent, g.key).toBe(b.members >= 9 ? Math.ceil(b.members * 3 / 4) : b.members);
    }
  });
  it('every source is an https link and the page has no em dashes', () => {
    for (const g of data.governments) for (const u of Object.values(g.sources)) expect(u).toMatch(/^https:\/\//);
    const page = readFileSync(new URL('../../public/amendment-3-budget.html', import.meta.url), 'utf8');
    expect(page + JSON.stringify(data)).not.toContain('—');
  });
});

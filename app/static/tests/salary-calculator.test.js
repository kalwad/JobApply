import { describe, it, expect, beforeAll } from 'vitest';
import { loadScripts } from './setup.js';

beforeAll(() => {
    document.body.innerHTML = '<div id="toast-container"></div><div id="app"></div>';
    loadScripts('utils.js', 'tax-data.js', 'salary-calculator.js');
});

describe('TAX_DATA', () => {
    it('has federal brackets for single filers', () => {
        expect(TAX_DATA.federal.brackets.single.length).toBeGreaterThan(0);
    });

    it('has standard deduction', () => {
        expect(TAX_DATA.federal.standardDeduction.single).toBeGreaterThan(0);
    });

    it('has FICA rates', () => {
        expect(TAX_DATA.fica.socialSecurity.rate).toBeGreaterThan(0);
        expect(TAX_DATA.fica.socialSecurity.cap).toBeGreaterThan(0);
        expect(TAX_DATA.fica.medicare.rate).toBeGreaterThan(0);
    });

    it('has state data for all 50 states + DC', () => {
        const stateCount = Object.keys(TAX_DATA.states).length;
        expect(stateCount).toBeGreaterThanOrEqual(51);
    });
});

describe('calcFederalTax', () => {
    it('returns 0 for zero or negative income', () => {
        expect(calcFederalTax(0).total).toBe(0);
        expect(calcFederalTax(-1000).total).toBe(0);
    });

    it('returns breakdown array', () => {
        const result = calcFederalTax(100000);
        expect(result.total).toBeGreaterThan(0);
        expect(result.breakdown).toBeInstanceOf(Array);
        expect(result.breakdown.length).toBeGreaterThan(0);
    });

    it('calculates progressively — higher income = more tax', () => {
        expect(calcFederalTax(200000).total).toBeGreaterThan(calcFederalTax(100000).total);
    });

    it('uses brackets for single filers by default', () => {
        const result = calcFederalTax(50000, 'single');
        expect(result.total).toBeGreaterThan(0);
        expect(result.total).toBeLessThan(50000);
    });
});

describe('calcStateTax', () => {
    it('returns 0 for states with no income tax', () => {
        expect(calcStateTax(100000, 'TX')).toBe(0);
        expect(calcStateTax(100000, 'FL')).toBe(0);
        expect(calcStateTax(100000, 'WA')).toBe(0);
        expect(calcStateTax(100000, 'NV')).toBe(0);
    });

    it('calculates tax for bracket states like CA', () => {
        const tax = calcStateTax(100000, 'CA');
        expect(tax).toBeGreaterThan(0);
    });

    it('calculates tax for flat-rate states like IL', () => {
        const tax = calcStateTax(100000, 'IL');
        expect(tax).toBeGreaterThan(0);
    });

    it('returns 0 for zero income', () => {
        expect(calcStateTax(0, 'CA')).toBe(0);
    });

    it('returns 0 for missing state code', () => {
        expect(calcStateTax(100000, null)).toBe(0);
        expect(calcStateTax(100000, '')).toBe(0);
    });
});

describe('calcFICA', () => {
    it('calculates SS and Medicare for W2', () => {
        const result = calcFICA(100000, 'w2');
        expect(result.ss).toBeGreaterThan(0);
        expect(result.medicare).toBeGreaterThan(0);
        expect(result.total).toBe(result.ss + result.medicare);
        expect(result.seTax).toBe(0);
    });

    it('caps Social Security at the wage base', () => {
        const cap = TAX_DATA.fica.socialSecurity.cap;
        const atCap = calcFICA(cap, 'w2');
        const aboveCap = calcFICA(cap + 50000, 'w2');
        expect(atCap.ss).toBe(aboveCap.ss);
    });

    it('calculates self-employment tax for 1099', () => {
        const result = calcFICA(100000, '1099');
        expect(result.seTax).toBeGreaterThan(0);
        expect(result.deductibleHalf).toBeGreaterThan(0);
        expect(result.total).toBe(result.seTax);
    });

    it('1099 FICA is roughly double W2 FICA', () => {
        const w2 = calcFICA(100000, 'w2');
        const se = calcFICA(100000, '1099');
        expect(se.total).toBeGreaterThan(w2.total * 1.5);
        expect(se.total).toBeLessThan(w2.total * 2.5);
    });

    it('applies additional Medicare tax for high earners', () => {
        const threshold = TAX_DATA.fica.medicare.additionalThreshold;
        const below = calcFICA(threshold - 1000, 'w2');
        const above = calcFICA(threshold + 50000, 'w2');
        const baseMedicareAbove = (threshold + 50000) * TAX_DATA.fica.medicare.rate;
        expect(above.medicare).toBeGreaterThan(baseMedicareAbove);
    });
});

describe('calculateSalary', () => {
    it('calculates take-home for W2 employee', () => {
        const result = calculateSalary({
            gross: 120000, state: 'CA', filingStatus: 'single', employmentType: 'w2'
        });
        expect(result).not.toBeNull();
        expect(result.type).toBe('w2');
        expect(result.gross).toBe(120000);
        expect(result.federal).toBeGreaterThan(0);
        expect(result.state).toBeGreaterThan(0);
        expect(result.totalTax).toBeGreaterThan(0);
        expect(result.takeHome).toBeGreaterThan(0);
        expect(result.takeHome).toBeLessThan(120000);
        expect(result.effectiveRate).toBeGreaterThan(0);
        expect(result.effectiveRate).toBeLessThan(1);
    });

    it('calculates take-home for 1099 contractor', () => {
        const w2 = calculateSalary({
            gross: 120000, state: 'CA', filingStatus: 'single', employmentType: 'w2'
        });
        const contractor = calculateSalary({
            gross: 120000, state: 'CA', filingStatus: 'single', employmentType: '1099'
        });
        expect(contractor.type).toBe('1099');
        expect(contractor.seTax).toBeGreaterThan(0);
        expect(contractor.takeHome).toBeLessThan(w2.takeHome);
    });

    it('calculates C2C (S-Corp model)', () => {
        const result = calculateSalary({
            gross: 150000, state: 'CA', filingStatus: 'single', employmentType: 'c2c'
        });
        expect(result.type).toBe('c2c');
        expect(result.salaryPortion).toBeGreaterThan(0);
        expect(result.distribution).toBeGreaterThan(0);
        expect(result.takeHome).toBeGreaterThan(0);
    });

    it('returns null for zero or negative gross', () => {
        expect(calculateSalary({ gross: 0, state: 'CA', filingStatus: 'single', employmentType: 'w2' })).toBeNull();
        expect(calculateSalary({ gross: -1, state: 'CA', filingStatus: 'single', employmentType: 'w2' })).toBeNull();
    });

    it('handles no-income-tax states', () => {
        const tx = calculateSalary({
            gross: 120000, state: 'TX', filingStatus: 'single', employmentType: 'w2'
        });
        const ca = calculateSalary({
            gross: 120000, state: 'CA', filingStatus: 'single', employmentType: 'w2'
        });
        expect(tx.state).toBe(0);
        expect(tx.takeHome).toBeGreaterThan(ca.takeHome);
    });
});

describe('compareEmploymentTypes', () => {
    it('compares W2, 1099, and C2C for same rate', () => {
        const result = compareEmploymentTypes(120000, 'CA', 'single');
        expect(result.w2).not.toBeNull();
        expect(result['1099']).not.toBeNull();
        expect(result.c2c).not.toBeNull();
        expect(result.w2.gross).toBe(120000);
        expect(result.w2.takeHome).toBeGreaterThan(result['1099'].takeHome);
    });
});

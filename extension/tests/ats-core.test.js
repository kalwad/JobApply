import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

function loadCore() {
  window.__jaAtsCore = undefined;
  const code = readFileSync(join(__dirname, '..', 'ats-core.js'), 'utf-8');
  eval(code);
  return window.__jaAtsCore;
}

let core;

beforeEach(() => {
  core = loadCore();
});

describe('FieldDescriptor helpers', () => {
  it('createFieldDescriptor fills defaults', () => {
    const field = core.createFieldDescriptor({ selector: '#email', label: 'Email' });
    expect(field.selector).toBe('#email');
    expect(field.label).toBe('Email');
    expect(field.required).toBe(false);
    expect(field.currentValue).toBe('');
  });

  it('normalizeFieldDescriptor preserves options', () => {
    const field = core.normalizeFieldDescriptor({
      selector: '#country',
      tag: 'select',
      options: [{ value: 'us', text: 'United States' }],
    });
    expect(field.options).toHaveLength(1);
  });
});

describe('buildFillReport', () => {
  it('counts filled and failed results', () => {
    const report = core.buildFillReport([
      { selector: '#a', success: true },
      { selector: '#b', success: false },
    ]);
    expect(report.filled).toBe(1);
    expect(report.failed).toBe(1);
  });

  it('counts savedAnswers from custom Q&A mappings', () => {
    const report = core.buildFillReport(
      [{ selector: '#q', success: true }],
      { '#q': { qa_matched: true, confidence: 1 } },
    );
    expect(report.savedAnswers).toBe(1);
    expect(report.filled).toBe(1);
  });

  it('counts needsReview for low confidence AI drafts', () => {
    const report = core.buildFillReport(
      [{ selector: '#q', success: true }],
      { '#q': { confidence: 0.5 } },
    );
    expect(report.needsReview).toBe(1);
    expect(report.aiDrafts).toBe(1);
  });

  it('counts alreadyCompleted skips', () => {
    const report = core.buildFillReport([
      { selector: '#x', success: true, skipped: true, alreadyCompleted: true },
    ]);
    expect(report.alreadyCompleted).toBe(1);
    expect(report.filled).toBe(0);
  });

  it('counts skippedSensitive for submit refusal', () => {
    const report = core.buildFillReport([
      { selector: '#submit', success: true, skipped: true, reason: 'refusing to interact with submit control' },
    ]);
    expect(report.skippedSensitive).toBe(1);
  });

  it('formatFillReport renders summary string', () => {
    const text = core.formatFillReport({ filled: 3, needsReview: 1, failed: 0 });
    expect(text).toContain('3 filled');
    expect(text).toContain('1 review');
  });
});

describe('adapter contract', () => {
  it('wrapLegacyAdapter maps match to detect', () => {
    const wrapped = core.wrapLegacyAdapter({
      name: 'Test',
      match: () => true,
      getFormRoot: (doc) => doc,
      getFieldMap: () => ({}),
    });
    expect(wrapped.detect('https://example.com', document)).toBe(true);
    core.assertAdapterContract(wrapped);
  });
});

describe('extractWithAdapter / applyFieldMapHints', () => {
  it('stamps urls[Github] via case-insensitive Lever name match', () => {
    document.body.innerHTML = `<form><input name="urls[Github]" type="text" /><input name="urls[LinkedIn]" type="text" /></form>`;
    const fields = [
      { selector: 'input[name="urls[Github]"]', name: 'urls[Github]', tag: 'input', type: 'text' },
      { selector: 'input[name="urls[LinkedIn]"]', name: 'urls[LinkedIn]', tag: 'input', type: 'text' },
    ];
    const out = core.applyFieldMapHints(fields, {
      'input[name="urls[GitHub]"]': 'github_url',
      'input[name="urls[LinkedIn]"]': 'linkedin_url',
    }, document);
    expect(out.find(f => f.name === 'urls[Github]').semanticType).toBe('github_url');
    expect(out.find(f => f.name === 'urls[LinkedIn]').semanticType).toBe('linkedin_url');
  });

  it('stamps semanticType from field map and preserves fieldKind', () => {
    document.body.innerHTML = `
      <form id="app_form">
        <input id="email" name="email" type="email" />
        <input id="phone_country_code" name="phone_country_code" />
      </form>
    `;
    const adapter = core.wrapLegacyAdapter({
      name: 'Greenhouse',
      match: () => true,
      getFormRoot: (doc) => doc.querySelector('#app_form') || doc,
      getFieldMap: () => ({
        '#email': 'email',
        '#phone_country_code': 'phone_country_code',
      }),
    });
    const fields = core.extractWithAdapter(adapter, document, (root) => ([
      {
        selector: '#email',
        tag: 'input',
        type: 'email',
        name: 'email',
        id: 'email',
        label: 'Email',
        fieldKind: null,
        isContentEditable: false,
      },
      {
        selector: '#phone_country_code',
        tag: 'input',
        name: 'phone_country_code',
        id: 'phone_country_code',
        label: 'Country',
        fieldKind: 'phone_country',
        isContentEditable: false,
      },
    ]));
    const email = fields.find(f => f.selector === '#email');
    const phoneCc = fields.find(f => f.selector === '#phone_country_code');
    expect(email.semanticType).toBe('email');
    expect(phoneCc.semanticType).toBe('phone_country_code');
    expect(phoneCc.fieldKind).toBe('phone_country');
  });

  it('exports applyFieldMapHints', () => {
    expect(typeof core.applyFieldMapHints).toBe('function');
  });
});

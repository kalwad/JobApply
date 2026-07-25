import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const FIXTURES = join(__dirname, '..', '..', 'fixtures');

function loadScripts() {
  window.__jaAtsCore = undefined;
  window.__jaAtsAdapters = undefined;
  window.__jaAutofillLoaded = false;
  window.__jaAutofillTest = true;
  window.__jaAutofillTestAPI = undefined;

  eval(readFileSync(join(__dirname, '..', 'normalize.js'), 'utf-8'));
  eval(readFileSync(join(__dirname, '..', 'ats-core.js'), 'utf-8'));
  eval(readFileSync(join(__dirname, '..', 'ats-adapters.js'), 'utf-8'));

  let contentCode = readFileSync(join(__dirname, '..', 'content.js'), 'utf-8');
  contentCode = contentCode.replace(
    /chrome\.runtime\.onMessage\.addListener/g,
    'globalThis.chrome.runtime.onMessage.addListener',
  );
  contentCode = contentCode.replace(
    /badgeObserver\.observe\(document\.documentElement,\s*\{[\s\S]*?\}\);/g,
    '/* badgeObserver disabled in tests */',
  );
  eval(contentCode);
  return {
    adapters: window.__jaAtsAdapters,
    api: window.__jaAutofillTestAPI,
    core: window.__jaAtsCore,
  };
}

function loadFixtureIntoDom(name) {
  const html = readFileSync(join(FIXTURES, name, 'basic-form.html'), 'utf-8');
  const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  document.body.innerHTML = match ? match[1] : html;
}

const FIXTURE_URLS = {
  workday: 'https://company.myworkdayjobs.com/en-US/careers/apply',
  greenhouse: 'https://boards.greenhouse.io/company/jobs/123',
  lever: 'https://jobs.lever.co/acme/abc-123',
};

let ctx;

beforeEach(() => {
  document.body.innerHTML = '';
  ctx = loadScripts();
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('fixture adapter detect + extract', () => {
  it('Workday fixture finds first name and email fields', () => {
    loadFixtureIntoDom('workday');
    const adapter = ctx.adapters.detectATS(FIXTURE_URLS.workday, document);
    expect(adapter).not.toBeNull();
    expect(adapter.name).toBe('Workday');

    const root = adapter.getFormRoot(document);
    const fields = ctx.api.extractFormData(root);
    expect(fields.some(f => /first|firstname/i.test(`${f.name}${f.label}${f.id}`))).toBe(true);
    expect(fields.some(f => /email/i.test(`${f.name}${f.label}${f.id}`))).toBe(true);
  });

  it('Greenhouse fixture finds standard applicant fields', () => {
    loadFixtureIntoDom('greenhouse');
    const adapter = ctx.adapters.detectATS(FIXTURE_URLS.greenhouse, document);
    expect(adapter?.name).toBe('Greenhouse');

    const fields = ctx.api.extractFormData(adapter.getFormRoot(document));
    const names = fields.map(f => f.name || f.id);
    expect(names).toContain('first_name');
    expect(names).toContain('email');
  });

  it('Lever fixture finds name and email fields', () => {
    loadFixtureIntoDom('lever');
    const adapter = ctx.adapters.detectATS(FIXTURE_URLS.lever, document);
    expect(adapter?.name).toBe('Lever');

    const fields = ctx.api.extractFormData(adapter.getFormRoot(document));
    const names = fields.map(f => f.name);
    expect(names).toContain('name');
    expect(names).toContain('email');
  });

  it('Lever profile-links fixture stamps semanticTypes via extractWithAdapter', () => {
    const html = readFileSync(join(FIXTURES, 'lever', 'profile-links.html'), 'utf-8');
    const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    document.body.innerHTML = match ? match[1] : html;
    const adapter = ctx.adapters.detectATS(FIXTURE_URLS.lever, document);
    const fields = ctx.core.extractWithAdapter(adapter, document, (root) => ctx.api.extractFormData(root));
    const byName = Object.fromEntries(fields.map(f => [f.name, f]));
    expect(byName['urls[LinkedIn]']?.semanticType).toBe('linkedin_url');
    expect(byName['urls[GitHub]']?.semanticType).toBe('github_url');
    expect(byName['urls[Portfolio]']?.semanticType).toBe('portfolio_url');
    expect(byName.org?.semanticType).toBe('current_company');
    expect(byName.location?.semanticType).toBe('current_location');
  });

  it('Greenhouse location fixture tags location + resume + open-ended', () => {
    const html = readFileSync(join(FIXTURES, 'greenhouse', 'location-autocomplete.html'), 'utf-8');
    const match = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    document.body.innerHTML = match ? match[1] : html;
    const adapter = ctx.adapters.detectATS(FIXTURE_URLS.greenhouse, document);
    let fields = ctx.core.extractWithAdapter(adapter, document, (root) => ctx.api.extractFormData(root));
    fields = adapter.enhanceExtraction(fields);
    const loc = fields.find(f => f.id === 'job_application_location');
    expect(loc?.semanticType).toBe('current_location');
    const resume = fields.find(f => f.id === 'resume');
    expect(resume?.semanticType).toBe('resume_file');
    const open = fields.filter(f => f.semanticType === 'open_ended_question');
    expect(open.length).toBeGreaterThanOrEqual(2);
  });
});

describe('fill report + safety invariants', () => {
  it('buildFillReport tracks categories from fixture fill simulation', () => {
    const report = ctx.adapters.buildFillReport([
      { selector: '#email', success: true },
      { selector: '#submit', success: true, skipped: true, reason: 'refusing to interact with submit control' },
      { selector: '#phone', success: true, skipped: true, alreadyCompleted: true },
      { selector: '#missing', success: false },
    ], {
      '#email': { confidence: 0.6 },
    });
    expect(report.filled + report.aiDrafts + report.savedAnswers).toBeGreaterThan(0);
    expect(report.skippedSensitive).toBe(1);
    expect(report.alreadyCompleted).toBe(1);
    expect(report.failed).toBe(1);
  });

  it('refuses to fill submit controls (nonempty protection invariant)', async () => {
    const form = document.createElement('form');
    const input = document.createElement('input');
    input.type = 'text';
    input.name = 'email';
    input.id = 'email-field';
    input.value = 'existing@example.com';
    form.appendChild(input);
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.textContent = 'Submit Application';
    form.appendChild(submit);
    document.body.appendChild(form);

    const protectedResult = await ctx.api.fillField('#email-field', 'new@example.com', 'fill_text', 1, 'Email');
    expect(protectedResult.skipped).toBe(true);
    expect(protectedResult.alreadyCompleted).toBe(true);

    const submitResult = await ctx.api.fillField(
      'button[type="submit"]',
      'clicked',
      'fill_text',
      1,
      'Submit',
    );
    expect(submitResult.skipped).toBe(true);
    expect(submitResult.reason).toMatch(/submit/i);
  });
});

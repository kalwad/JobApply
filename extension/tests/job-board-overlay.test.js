import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { cleanDOM } from './helpers.js';
import { readFileSync } from 'fs';
import { join } from 'path';

function loadScript() {
  window.__cpAutofillLoaded = false;
  window.__cpAutofillTest = true;
  window.__cpAutofillTestAPI = undefined;

  const code = readFileSync(join(__dirname, '..', 'content.js'), 'utf-8');
  const safeCode = code.replace(
    /chrome\.runtime\.onMessage\.addListener/g,
    'globalThis.chrome.runtime.onMessage.addListener'
  );
  eval(safeCode);
  return window.__cpAutofillTestAPI;
}

let api;

beforeEach(() => {
  cleanDOM();
  // Reset chrome mock for each test
  globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: false });
  api = loadScript();
});

afterEach(() => {
  cleanDOM();
});

// ═══════════════════════════════════════════════════════════════
// Job board detection
// ═══════════════════════════════════════════════════════════════

describe('detectJobBoard', () => {
  it('detects LinkedIn', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.linkedin.com', href: 'https://www.linkedin.com/jobs/', origin: 'https://www.linkedin.com' },
      writable: true,
      configurable: true,
    });
    const config = api.detectJobBoard();
    expect(config).not.toBeNull();
    expect(config.name).toBe('LinkedIn');
  });

  it('detects Indeed', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.indeed.com', href: 'https://www.indeed.com/jobs', origin: 'https://www.indeed.com' },
      writable: true,
      configurable: true,
    });
    const config = api.detectJobBoard();
    expect(config).not.toBeNull();
    expect(config.name).toBe('Indeed');
  });

  it('detects Dice', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.dice.com', href: 'https://www.dice.com/jobs', origin: 'https://www.dice.com' },
      writable: true,
      configurable: true,
    });
    const config = api.detectJobBoard();
    expect(config).not.toBeNull();
    expect(config.name).toBe('Dice');
  });

  it('detects Glassdoor', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.glassdoor.com', href: 'https://www.glassdoor.com/Job/', origin: 'https://www.glassdoor.com' },
      writable: true,
      configurable: true,
    });
    const config = api.detectJobBoard();
    expect(config).not.toBeNull();
    expect(config.name).toBe('Glassdoor');
  });

  it('returns null for unknown sites', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'example.com', href: 'https://example.com', origin: 'https://example.com' },
      writable: true,
      configurable: true,
    });
    const config = api.detectJobBoard();
    expect(config).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// Job board configs exist
// ═══════════════════════════════════════════════════════════════

describe('JOB_BOARD_CONFIGS', () => {
  it('has configs for LinkedIn, Indeed, Dice, Glassdoor', () => {
    expect(api.JOB_BOARD_CONFIGS).toBeDefined();
    expect(api.JOB_BOARD_CONFIGS['linkedin.com']).toBeDefined();
    expect(api.JOB_BOARD_CONFIGS['indeed.com']).toBeDefined();
    expect(api.JOB_BOARD_CONFIGS['dice.com']).toBeDefined();
    expect(api.JOB_BOARD_CONFIGS['glassdoor.com']).toBeDefined();
  });

  it('each config has required fields', () => {
    for (const [domain, config] of Object.entries(api.JOB_BOARD_CONFIGS)) {
      expect(config.name).toBeTruthy();
      expect(config.listingSelector).toBeTruthy();
      expect(config.titleSelector).toBeTruthy();
      expect(config.companySelector).toBeTruthy();
      expect(config.locationSelector).toBeTruthy();
      expect(typeof config.getJobUrl).toBe('function');
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// parseJobCard
// ═══════════════════════════════════════════════════════════════

describe('parseJobCard', () => {
  const mockConfig = {
    name: 'TestBoard',
    listingSelector: '.job-card',
    titleSelector: '.title',
    companySelector: '.company',
    locationSelector: '.location',
    getJobUrl: (card) => {
      const link = card.querySelector('a');
      return link ? link.href : null;
    },
  };

  it('parses a valid job card', () => {
    const card = document.createElement('div');
    card.className = 'job-card';
    card.innerHTML = `
      <span class="title">Software Engineer</span>
      <span class="company">Acme Corp</span>
      <span class="location">Remote</span>
      <a href="https://example.com/job/123">View</a>
    `;
    document.body.appendChild(card);

    const result = api.parseJobCard(card, mockConfig);
    expect(result).not.toBeNull();
    expect(result.title).toBe('Software Engineer');
    expect(result.company).toBe('Acme Corp');
    expect(result.location).toBe('Remote');
    expect(result.url).toBe('https://example.com/job/123');
    expect(result.source).toBe('TestBoard');
  });

  it('returns null when title is missing', () => {
    const card = document.createElement('div');
    card.innerHTML = `
      <span class="company">Acme Corp</span>
      <a href="https://example.com/job/123">View</a>
    `;
    document.body.appendChild(card);

    const result = api.parseJobCard(card, mockConfig);
    expect(result).toBeNull();
  });

  it('returns null when URL is missing', () => {
    const card = document.createElement('div');
    card.innerHTML = `<span class="title">Software Engineer</span>`;
    document.body.appendChild(card);

    const result = api.parseJobCard(card, mockConfig);
    expect(result).toBeNull();
  });

  it('handles missing company and location gracefully', () => {
    const card = document.createElement('div');
    card.innerHTML = `
      <span class="title">Software Engineer</span>
      <a href="https://example.com/job/456">View</a>
    `;
    document.body.appendChild(card);

    const result = api.parseJobCard(card, mockConfig);
    expect(result).not.toBeNull();
    expect(result.company).toBe('');
    expect(result.location).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
// createSaveButton
// ═══════════════════════════════════════════════════════════════

describe('createSaveButton', () => {
  const jobData = {
    title: 'Software Engineer',
    company: 'Acme',
    url: 'https://example.com/job/1',
    source: 'TestBoard',
  };

  it('creates a save button on a card', () => {
    const card = document.createElement('div');
    document.body.appendChild(card);

    const btn = api.createSaveButton(jobData, card);
    expect(btn).toBeTruthy();
    expect(btn.textContent).toBe('Save to CareerPulse');
    expect(btn.className).toContain('cp-overlay-save-btn');
  });

  it('does not duplicate buttons on the same card', () => {
    const card = document.createElement('div');
    document.body.appendChild(card);

    api.createSaveButton(jobData, card);
    api.createSaveButton(jobData, card);

    const buttons = card.querySelectorAll('.cp-overlay-save-btn');
    expect(buttons.length).toBe(1);
  });

  it('sets card position to relative', () => {
    const card = document.createElement('div');
    document.body.appendChild(card);

    api.createSaveButton(jobData, card);
    expect(card.style.position).toBe('relative');
  });

  it('sends saveJob message on click', async () => {
    const card = document.createElement('div');
    document.body.appendChild(card);

    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      data: { id: 1, score: 85 },
    });

    const btn = api.createSaveButton(jobData, card);
    btn.click();

    // Wait for async handler
    await new Promise(r => setTimeout(r, 10));

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'saveJob',
      jobData,
    });
  });

  it('shows "Saved" state after successful save', async () => {
    const card = document.createElement('div');
    document.body.appendChild(card);

    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      data: { id: 1 },
    });

    const btn = api.createSaveButton(jobData, card);
    btn.click();

    await new Promise(r => setTimeout(r, 10));

    expect(btn.textContent).toBe('Saved');
    expect(btn.classList.contains('cp-overlay-saved')).toBe(true);
    expect(btn.disabled).toBe(true);
  });

  it('shows error state on failure', async () => {
    const card = document.createElement('div');
    document.body.appendChild(card);

    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      ok: false,
      error: 'Server error',
    });

    const btn = api.createSaveButton(jobData, card);
    btn.click();

    await new Promise(r => setTimeout(r, 10));

    expect(btn.textContent).toContain('Error');
    expect(btn.classList.contains('cp-overlay-error')).toBe(true);
    expect(btn.disabled).toBe(false); // retry allowed
  });
});

// ═══════════════════════════════════════════════════════════════
// showScoreBadge
// ═══════════════════════════════════════════════════════════════

describe('showScoreBadge', () => {
  it('creates a score badge on a card', () => {
    const card = document.createElement('div');
    document.body.appendChild(card);

    api.showScoreBadge(card, 85);

    const badge = card.querySelector('.cp-overlay-score-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('85%');
    expect(badge.classList.contains('cp-overlay-score-high')).toBe(true);
  });

  it('applies high class for scores >= 75', () => {
    const card = document.createElement('div');
    document.body.appendChild(card);

    api.showScoreBadge(card, 75);
    const badge = card.querySelector('.cp-overlay-score-badge');
    expect(badge.classList.contains('cp-overlay-score-high')).toBe(true);
  });

  it('applies mid class for scores 50-74', () => {
    const card = document.createElement('div');
    document.body.appendChild(card);

    api.showScoreBadge(card, 60);
    const badge = card.querySelector('.cp-overlay-score-badge');
    expect(badge.classList.contains('cp-overlay-score-mid')).toBe(true);
  });

  it('applies low class for scores < 50', () => {
    const card = document.createElement('div');
    document.body.appendChild(card);

    api.showScoreBadge(card, 30);
    const badge = card.querySelector('.cp-overlay-score-badge');
    expect(badge.classList.contains('cp-overlay-score-low')).toBe(true);
  });

  it('updates existing badge instead of creating duplicate', () => {
    const card = document.createElement('div');
    document.body.appendChild(card);

    api.showScoreBadge(card, 85);
    api.showScoreBadge(card, 40);

    const badges = card.querySelectorAll('.cp-overlay-score-badge');
    expect(badges.length).toBe(1);
    expect(badges[0].textContent).toBe('40%');
    expect(badges[0].classList.contains('cp-overlay-score-low')).toBe(true);
    expect(badges[0].classList.contains('cp-overlay-score-high')).toBe(false);
  });

  it('rounds score to nearest integer', () => {
    const card = document.createElement('div');
    document.body.appendChild(card);

    api.showScoreBadge(card, 72.7);
    const badge = card.querySelector('.cp-overlay-score-badge');
    expect(badge.textContent).toBe('73%');
  });

  it('sets title attribute', () => {
    const card = document.createElement('div');
    document.body.appendChild(card);

    api.showScoreBadge(card, 90);
    const badge = card.querySelector('.cp-overlay-score-badge');
    expect(badge.title).toContain('90%');
  });
});

// ═══════════════════════════════════════════════════════════════
// processJobCards
// ═══════════════════════════════════════════════════════════════

describe('processJobCards', () => {
  const config = {
    name: 'TestBoard',
    listingSelector: '.job-card',
    titleSelector: '.title',
    companySelector: '.company',
    locationSelector: '.location',
    getJobUrl: (card) => {
      const link = card.querySelector('a');
      return link ? link.href : null;
    },
  };

  function createJobCard(title, company, location, url) {
    const card = document.createElement('div');
    card.className = 'job-card';
    card.innerHTML = `
      <span class="title">${title}</span>
      <span class="company">${company}</span>
      <span class="location">${location}</span>
      <a href="${url}">View</a>
    `;
    document.body.appendChild(card);
    return card;
  }

  it('processes all job cards and adds save buttons', async () => {
    createJobCard('Engineer', 'Acme', 'NYC', 'https://example.com/job/1');
    createJobCard('Designer', 'Beta', 'LA', 'https://example.com/job/2');

    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: false });

    await api.processJobCards(config);

    const buttons = document.querySelectorAll('.cp-overlay-save-btn');
    expect(buttons.length).toBe(2);
  });

  it('marks already-saved jobs with Saved state', async () => {
    const card = createJobCard('Engineer', 'Acme', 'NYC', 'https://example.com/job/1');

    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      data: { id: 1, score: 92 },
    });

    await api.processJobCards(config);

    const btn = card.querySelector('.cp-overlay-save-btn');
    expect(btn.textContent).toBe('Saved');
    expect(btn.classList.contains('cp-overlay-saved')).toBe(true);
  });

  it('shows score badge for already-saved jobs', async () => {
    const card = createJobCard('Engineer', 'Acme', 'NYC', 'https://example.com/job/1');

    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      data: { id: 1, score: 88 },
    });

    await api.processJobCards(config);

    const badge = card.querySelector('.cp-overlay-score-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toBe('88%');
  });

  it('does not re-process cards', async () => {
    createJobCard('Engineer', 'Acme', 'NYC', 'https://example.com/job/1');

    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: false });

    await api.processJobCards(config);
    await api.processJobCards(config);

    const buttons = document.querySelectorAll('.cp-overlay-save-btn');
    expect(buttons.length).toBe(1);
  });

  it('skips cards without valid job data', async () => {
    const card = document.createElement('div');
    card.className = 'job-card';
    card.innerHTML = `<span>No title or link</span>`;
    document.body.appendChild(card);

    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: false });

    await api.processJobCards(config);

    const buttons = document.querySelectorAll('.cp-overlay-save-btn');
    expect(buttons.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// LinkedIn-specific getJobUrl
// ═══════════════════════════════════════════════════════════════

describe('LinkedIn getJobUrl', () => {
  it('extracts URL from LinkedIn job card link', () => {
    Object.defineProperty(window, 'location', {
      value: { hostname: 'www.linkedin.com', href: 'https://www.linkedin.com/jobs/', origin: 'https://www.linkedin.com' },
      writable: true,
      configurable: true,
    });

    const card = document.createElement('div');
    const link = document.createElement('a');
    link.href = 'https://www.linkedin.com/jobs/view/12345?refId=abc';
    card.appendChild(link);
    document.body.appendChild(card);

    const config = api.JOB_BOARD_CONFIGS['linkedin.com'];
    const url = config.getJobUrl(card);
    expect(url).toBe('https://www.linkedin.com/jobs/view/12345');
  });

  it('returns null when no matching link', () => {
    const card = document.createElement('div');
    card.innerHTML = `<a href="https://linkedin.com/in/user">Profile</a>`;
    document.body.appendChild(card);

    const config = api.JOB_BOARD_CONFIGS['linkedin.com'];
    const url = config.getJobUrl(card);
    expect(url).toBeNull();
  });
});

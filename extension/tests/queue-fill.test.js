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
  globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: true, data: { mappings: [] } });
  api = loadScript();
});

afterEach(() => {
  cleanDOM();
  if (api) {
    api.queueContext = null;
    api.removeQueueBanner();
  }
});

// ═══════════════════════════════════════════════════════════════
// Queue banner display
// ═══════════════════════════════════════════════════════════════

describe('showQueueBanner', () => {
  it('creates a queue banner with position and total', () => {
    api.showQueueBanner(2, 5, 'Software Engineer', 'Acme Corp');

    const banner = document.getElementById('cp-autofill-queue-banner');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('2/5');
    expect(banner.textContent).toContain('Software Engineer');
    expect(banner.textContent).toContain('Acme Corp');
  });

  it('shows fallback text when no job title', () => {
    api.showQueueBanner(3, 10, '', '');

    const banner = document.getElementById('cp-autofill-queue-banner');
    expect(banner.textContent).toContain('Application 3 of 10');
  });

  it('has Done, Skip, and Cancel buttons', () => {
    api.showQueueBanner(1, 3, 'Dev', 'Co');

    const banner = document.getElementById('cp-autofill-queue-banner');
    expect(banner.querySelector('.cp-autofill-queue-done-btn')).not.toBeNull();
    expect(banner.querySelector('.cp-autofill-queue-skip-btn')).not.toBeNull();
    expect(banner.querySelector('.cp-autofill-queue-cancel-btn')).not.toBeNull();
  });

  it('replaces existing banner on re-call', () => {
    api.showQueueBanner(1, 5, 'Job A', 'Co');
    api.showQueueBanner(2, 5, 'Job B', 'Co');

    const banners = document.querySelectorAll('#cp-autofill-queue-banner');
    expect(banners.length).toBe(1);
    expect(banners[0].textContent).toContain('2/5');
    expect(banners[0].textContent).toContain('Job B');
  });
});

// ═══════════════════════════════════════════════════════════════
// removeQueueBanner
// ═══════════════════════════════════════════════════════════════

describe('removeQueueBanner', () => {
  it('removes the banner from DOM', () => {
    api.showQueueBanner(1, 3, 'Test', 'Co');
    expect(document.getElementById('cp-autofill-queue-banner')).not.toBeNull();

    api.removeQueueBanner();
    expect(document.getElementById('cp-autofill-queue-banner')).toBeNull();
  });

  it('does nothing if no banner exists', () => {
    expect(() => api.removeQueueBanner()).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════
// handleQueueAction
// ═══════════════════════════════════════════════════════════════

describe('handleQueueAction', () => {
  it('sends queueUserAction message with submitted action', () => {
    api.queueContext = { queueItemId: 'q-42', jobId: 10 };
    api.showQueueBanner(1, 3, 'Test', 'Co');

    api.handleQueueAction('submitted');

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'queueUserAction',
      queueItemId: 'q-42',
      action: 'submitted',
    });
  });

  it('sends queueUserAction message with skipped action', () => {
    api.queueContext = { queueItemId: 'q-99', jobId: 20 };
    api.showQueueBanner(1, 3, 'Test', 'Co');

    api.handleQueueAction('skipped');

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'queueUserAction',
      queueItemId: 'q-99',
      action: 'skipped',
    });
  });

  it('removes banner after action', () => {
    api.queueContext = { queueItemId: 'q-1', jobId: 1 };
    api.showQueueBanner(1, 3, 'Test', 'Co');

    api.handleQueueAction('submitted');

    expect(document.getElementById('cp-autofill-queue-banner')).toBeNull();
  });

  it('clears queueContext after action', () => {
    api.queueContext = { queueItemId: 'q-1', jobId: 1 };
    api.showQueueBanner(1, 3, 'Test', 'Co');

    api.handleQueueAction('submitted');

    expect(api.queueContext).toBeNull();
  });

  it('does nothing if no queueContext', () => {
    api.queueContext = null;
    api.handleQueueAction('submitted');

    // Should not send any queue-related messages
    const calls = globalThis.chrome.runtime.sendMessage.mock.calls;
    const queueCalls = calls.filter(c => c[0].type === 'queueUserAction');
    expect(queueCalls.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Done button click
// ═══════════════════════════════════════════════════════════════

describe('queue banner Done button', () => {
  it('sends submitted action on click', () => {
    api.queueContext = { queueItemId: 'q-1', jobId: 1 };
    api.showQueueBanner(1, 3, 'Test', 'Co');

    const doneBtn = document.querySelector('.cp-autofill-queue-done-btn');
    doneBtn.click();

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'queueUserAction',
      queueItemId: 'q-1',
      action: 'submitted',
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// Skip button click
// ═══════════════════════════════════════════════════════════════

describe('queue banner Skip button', () => {
  it('sends skipped action on click', () => {
    api.queueContext = { queueItemId: 'q-2', jobId: 2 };
    api.showQueueBanner(2, 5, 'Test', 'Co');

    const skipBtn = document.querySelector('.cp-autofill-queue-skip-btn');
    skipBtn.click();

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'queueUserAction',
      queueItemId: 'q-2',
      action: 'skipped',
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// Cancel button click
// ═══════════════════════════════════════════════════════════════

describe('queue banner Cancel button', () => {
  it('sends cancelQueue message on click', () => {
    api.queueContext = { queueItemId: 'q-3', jobId: 3 };
    api.showQueueBanner(1, 3, 'Test', 'Co');

    const cancelBtn = document.querySelector('.cp-autofill-queue-cancel-btn');
    cancelBtn.click();

    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith({ type: 'cancelQueue' });
  });

  it('removes banner and clears context on cancel', () => {
    api.queueContext = { queueItemId: 'q-3', jobId: 3 };
    api.showQueueBanner(1, 3, 'Test', 'Co');

    const cancelBtn = document.querySelector('.cp-autofill-queue-cancel-btn');
    cancelBtn.click();

    expect(document.getElementById('cp-autofill-queue-banner')).toBeNull();
    expect(api.queueContext).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// startQueueFill sets context
// ═══════════════════════════════════════════════════════════════

describe('startQueueFill', () => {
  it('sets queueContext from message', async () => {
    const message = {
      queueItemId: 'q-10',
      jobId: 55,
      jobTitle: 'Backend Dev',
      company: 'TechCo',
      queuePosition: 2,
      queueTotal: 8,
    };

    await api.startQueueFill(message);

    expect(api.queueContext).not.toBeNull();
    expect(api.queueContext.queueItemId).toBe('q-10');
    expect(api.queueContext.jobId).toBe(55);
    expect(api.queueContext.position).toBe(2);
    expect(api.queueContext.total).toBe(8);
  });

  it('shows queue banner', async () => {
    await api.startQueueFill({
      queueItemId: 'q-11',
      jobId: 60,
      jobTitle: 'Frontend Dev',
      company: 'WebCo',
      queuePosition: 1,
      queueTotal: 3,
    });

    const banner = document.getElementById('cp-autofill-queue-banner');
    expect(banner).not.toBeNull();
    expect(banner.textContent).toContain('1/3');
    expect(banner.textContent).toContain('Frontend Dev');
  });

  it('reports fill status to background', async () => {
    await api.startQueueFill({
      queueItemId: 'q-12',
      jobId: 70,
      jobTitle: 'Dev',
      company: 'Co',
      queuePosition: 1,
      queueTotal: 1,
    });

    const reportCalls = globalThis.chrome.runtime.sendMessage.mock.calls
      .filter(c => c[0].type === 'reportFillStatus');
    expect(reportCalls.length).toBe(1);
    expect(reportCalls[0][0].queueItemId).toBe('q-12');
    expect(reportCalls[0][0].status).toBe('filled');
  });

  it('never auto-submits the form', async () => {
    // Create a form with a submit button to verify it's not clicked
    const form = document.createElement('form');
    const submitBtn = document.createElement('button');
    submitBtn.type = 'submit';
    const submitHandler = vi.fn(e => e.preventDefault());
    form.addEventListener('submit', submitHandler);
    form.appendChild(submitBtn);
    document.body.appendChild(form);

    await api.startQueueFill({
      queueItemId: 'q-safety',
      jobId: 100,
      jobTitle: 'Test',
      company: 'Co',
      queuePosition: 1,
      queueTotal: 1,
    });

    expect(submitHandler).not.toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// XSS safety
// ═══════════════════════════════════════════════════════════════

describe('queue banner XSS safety', () => {
  it('escapes HTML in job title', () => {
    api.showQueueBanner(1, 1, '<script>alert("xss")</script>', 'Co');

    const banner = document.getElementById('cp-autofill-queue-banner');
    expect(banner.innerHTML).not.toContain('<script>');
    expect(banner.textContent).toContain('<script>');
  });

  it('escapes HTML in company name', () => {
    api.showQueueBanner(1, 1, 'Job', '<img onerror=alert(1)>');

    const banner = document.getElementById('cp-autofill-queue-banner');
    // Should be escaped so no actual img tag is rendered
    expect(banner.innerHTML).toContain('&lt;img');
    expect(banner.querySelector('img')).toBeNull();
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createInput, createForm, createSelect, createLabel, createTypeaheadInput,
  createCustomDropdown, createRichTextEditor, createDateInput,
  createShadowDOMInput, cleanDOM,
} from './helpers.js';
import { readFileSync } from 'fs';
import { join } from 'path';

// Load dependency IIFEs (normalize.js, ats-adapters.js) then content.js
function loadScript() {
  window.__jaAutofillLoaded = false;
  window.__jaAutofillTest = true;
  window.__jaAutofillTestAPI = undefined;
  window.__jaNormalize = undefined;
  window.__jaAtsAdapters = undefined;

  eval(readFileSync(join(__dirname, '..', 'build-info.js'), 'utf-8'));

  // Load normalize.js first
  const normCode = readFileSync(join(__dirname, '..', 'normalize.js'), 'utf-8');
  eval(normCode);

  // Load ats-core.js + ats-adapters.js
  eval(readFileSync(join(__dirname, '..', 'ats-core.js'), 'utf-8'));
  const atsCode = readFileSync(join(__dirname, '..', 'ats-adapters.js'), 'utf-8');
  eval(atsCode);

  const code = readFileSync(join(__dirname, '..', 'content.js'), 'utf-8');
  // Replace chrome.runtime references in the IIFE to avoid errors during load
  let safeCode = code.replace(
    /chrome\.runtime\.onMessage\.addListener/g,
    'globalThis.chrome.runtime.onMessage.addListener'
  );
  // Disable auto-detection observers/timeouts that fire during load
  safeCode = safeCode.replace(
    /badgeObserver\.observe\(document\.documentElement,\s*\{[\s\S]*?\}\);/g,
    '/* badgeObserver disabled in tests */'
  );
  eval(safeCode);
  return window.__jaAutofillTestAPI;
}

let api;

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  cleanDOM();
  api = loadScript();
  // Legacy CareerPulse tests assume fills may replace existing values.
  // Nonempty protection is covered in a dedicated describe below.
  api.overwriteExistingFields = true;
});

afterEach(() => {
  // Stop multi-page tracking if active (to clean up observers)
  try { api.stopMultiPageTracking(); } catch { /* skip */ }
  cleanDOM();
  vi.useRealTimers();
});

// ═══════════════════════════════════════════════════════════════
// Form extraction
// ═══════════════════════════════════════════════════════════════

describe('extractFormData', () => {
  it('extracts text inputs', () => {
    createInput({ type: 'text', name: 'firstName', id: 'firstName' });
    createLabel('firstName', 'First Name');

    const fields = api.extractFormData();
    expect(fields.length).toBe(1);
    expect(fields[0].name).toBe('firstName');
    expect(fields[0].label).toBe('First Name');
  });

  it('extracts select elements with options', () => {
    createSelect({ name: 'country', id: 'country' }, [
      { value: 'us', text: 'United States' },
      { value: 'ca', text: 'Canada' },
    ]);

    const fields = api.extractFormData();
    expect(fields.length).toBe(1);
    expect(fields[0].options).toHaveLength(2);
    expect(fields[0].options[0].text).toBe('United States');
  });

  it('extracts contenteditable elements', () => {
    const { editor } = createRichTextEditor({ id: 'coverLetter' });
    createLabel('coverLetter', 'Cover Letter');

    const fields = api.extractFormData();
    // contenteditable divs are matched by [contenteditable="true"] selector
    const editableFields = fields.filter(f => f.id === 'coverLetter' || f.isContentEditable);
    expect(editableFields.length).toBeGreaterThanOrEqual(1);
  });

  it('extracts role="combobox" elements', () => {
    const div = document.createElement('div');
    div.setAttribute('role', 'combobox');
    div.id = 'cityCombo';
    document.body.appendChild(div);

    const fields = api.extractFormData();
    const comboFields = fields.filter(f => f.role === 'combobox');
    expect(comboFields.length).toBe(1);
  });

  it('skips hidden and disabled fields', () => {
    createInput({ type: 'hidden', name: 'csrf' });
    createInput({ type: 'text', name: 'disabled_field', id: 'df' });
    document.getElementById('df').disabled = true;

    const fields = api.extractFormData();
    expect(fields.length).toBe(0);
  });

  it('skips submit/button inputs', () => {
    createInput({ type: 'submit', name: 'sub' });
    createInput({ type: 'button', name: 'btn' });

    const fields = api.extractFormData();
    expect(fields.length).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Label finding
// ═══════════════════════════════════════════════════════════════

describe('findLabel', () => {
  it('finds explicit label via for attribute', () => {
    const input = createInput({ id: 'email', type: 'email' });
    createLabel('email', 'Email Address');
    expect(api.findLabel(input)).toBe('Email Address');
  });

  it('finds aria-label', () => {
    const input = createInput({ 'aria-label': 'Phone Number' });
    expect(api.findLabel(input)).toBe('Phone Number');
  });

  it('finds label from parent label element', () => {
    const label = document.createElement('label');
    label.textContent = 'Your Name ';
    const input = document.createElement('input');
    input.type = 'text';
    label.appendChild(input);
    document.body.appendChild(label);
    expect(api.findLabel(input)).toBe('Your Name');
  });

  it('returns empty string when no label found', () => {
    const input = createInput({ type: 'text' });
    expect(api.findLabel(input)).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
// Selector building
// ═══════════════════════════════════════════════════════════════

describe('buildSelector', () => {
  it('uses id when available', () => {
    const input = createInput({ id: 'myField' });
    expect(api.buildSelector(input)).toBe('#myField');
  });

  it('uses name when unique', () => {
    const input = createInput({ name: 'uniqueName', type: 'text' });
    const sel = api.buildSelector(input);
    expect(sel).toContain('uniqueName');
  });

  it('builds path for elements without id or unique name', () => {
    const div = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'text';
    div.appendChild(input);
    document.body.appendChild(div);

    const sel = api.buildSelector(input);
    expect(sel).toBeTruthy();
    expect(document.querySelector(sel)).toBe(input);
  });
});

// ═══════════════════════════════════════════════════════════════
// Element resolution (with fallbacks)
// ═══════════════════════════════════════════════════════════════

describe('resolveElement', () => {
  it('resolves by id selector', () => {
    const input = createInput({ id: 'test-input' });
    expect(api.resolveElement('#test-input')).toBe(input);
  });

  it('resolves by name selector', () => {
    const input = createInput({ name: 'email', type: 'text' });
    expect(api.resolveElement('input[name="email"][type="text"]')).toBe(input);
  });

  it('falls back to id extraction from complex selector', () => {
    const input = createInput({ id: 'deep-field' });
    // A stale selector that doesn't directly work
    expect(api.resolveElement('#deep-field')).toBe(input);
  });

  it('returns null for non-existent element', () => {
    expect(api.resolveElement('#does-not-exist')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// Shadow DOM
// ═══════════════════════════════════════════════════════════════

describe('Shadow DOM', () => {
  it('deepQuerySelectorAll finds elements in shadow roots', () => {
    const { input } = createShadowDOMInput({ type: 'text', hostId: 'shadow1' });
    const results = api.deepQuerySelectorAll(document, 'input[type="text"]');
    expect(results).toContain(input);
  });

  it('deepQuerySelector finds first element in shadow root', () => {
    const { input } = createShadowDOMInput({ type: 'email', hostId: 'shadow2' });
    const result = api.deepQuerySelector(document, 'input[type="email"]');
    expect(result).toBe(input);
  });

  it('extractFormData includes shadow DOM fields', () => {
    createShadowDOMInput({ type: 'text', name: 'shadowField', hostId: 'shadow3' });
    const fields = api.extractFormData();
    const shadowFields = fields.filter(f => f.name === 'shadowField');
    expect(shadowFields.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// Native value setting
// ═══════════════════════════════════════════════════════════════

describe('setNativeValue', () => {
  it('sets value on input element', () => {
    const input = createInput({ type: 'text' });
    api.setNativeValue(input, 'hello');
    expect(input.value).toBe('hello');
  });

  it('sets value on textarea', () => {
    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);
    api.setNativeValue(textarea, 'multi\nline');
    expect(textarea.value).toBe('multi\nline');
  });
});

// ═══════════════════════════════════════════════════════════════
// Event dispatch
// ═══════════════════════════════════════════════════════════════

describe('dispatchEvents', () => {
  it('dispatches input event', () => {
    const input = createInput({ type: 'text' });
    const handler = vi.fn();
    input.addEventListener('input', handler);
    api.dispatchEvents(input, ['input']);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('dispatches multiple events', () => {
    const input = createInput({ type: 'text' });
    const handlers = { input: vi.fn(), change: vi.fn(), blur: vi.fn() };
    input.addEventListener('input', handlers.input);
    input.addEventListener('change', handlers.change);
    input.addEventListener('blur', handlers.blur);
    api.dispatchEvents(input, ['input', 'change', 'blur']);
    expect(handlers.input).toHaveBeenCalledTimes(1);
    expect(handlers.change).toHaveBeenCalledTimes(1);
    expect(handlers.blur).toHaveBeenCalledTimes(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// Simulated typing
// ═══════════════════════════════════════════════════════════════

describe('simulateTyping', () => {
  it('types value character by character', () => {
    const input = createInput({ type: 'text' });
    const inputEvents = [];
    input.addEventListener('input', () => inputEvents.push(input.value));

    api.simulateTyping(input, 'abc');
    expect(input.value).toBe('abc');
    // Should have fired input events as each char was typed
    expect(inputEvents).toContain('a');
    expect(inputEvents).toContain('ab');
    expect(inputEvents).toContain('abc');
  });

  it('fires keydown/keyup for each character', () => {
    const input = createInput({ type: 'text' });
    const keydowns = [];
    input.addEventListener('keydown', (e) => keydowns.push(e.key));
    api.simulateTyping(input, 'hi');
    expect(keydowns).toEqual(['h', 'i']);
  });
});

// ═══════════════════════════════════════════════════════════════
// Visibility detection
// ═══════════════════════════════════════════════════════════════

describe('isElementVisible', () => {
  it('returns false for null', () => {
    expect(api.isElementVisible(null)).toBe(false);
  });

  it('returns false for display:none elements', () => {
    const div = document.createElement('div');
    div.style.display = 'none';
    document.body.appendChild(div);
    expect(api.isElementVisible(div)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Fuzzy option matching (native <select>)
// ═══════════════════════════════════════════════════════════════

describe('fuzzyMatchOption', () => {
  const options = [
    { value: 'us', text: 'United States' },
    { value: 'ca', text: 'Canada' },
    { value: 'uk', text: 'United Kingdom' },
  ];

  it('matches exact value', () => {
    expect(api.fuzzyMatchOption(options, 'us')).toBe(0);
  });

  it('matches exact text', () => {
    expect(api.fuzzyMatchOption(options, 'Canada')).toBe(1);
  });

  it('matches text case-insensitively', () => {
    expect(api.fuzzyMatchOption(options, 'united states')).toBe(0);
  });

  it('matches partial (contains)', () => {
    expect(api.fuzzyMatchOption(options, 'Kingdom')).toBe(2);
  });

  it('returns -1 for no match', () => {
    expect(api.fuzzyMatchOption(options, 'France')).toBe(-1);
  });

  it('returns -1 for empty options', () => {
    expect(api.fuzzyMatchOption([], 'test')).toBe(-1);
  });
});

// ═══════════════════════════════════════════════════════════════
// Fuzzy dropdown option matching
// ═══════════════════════════════════════════════════════════════

describe('fuzzyMatchDropdownOption', () => {
  function createOptions(texts) {
    return texts.map(t => {
      const el = document.createElement('div');
      el.textContent = t;
      return el;
    });
  }

  it('matches exact text', () => {
    const opts = createOptions(['New York', 'Los Angeles', 'Chicago']);
    const match = api.fuzzyMatchDropdownOption(opts, 'New York');
    expect(match.textContent).toBe('New York');
  });

  it('matches case-insensitively', () => {
    const opts = createOptions(['United States', 'Canada']);
    const match = api.fuzzyMatchDropdownOption(opts, 'united states');
    expect(match.textContent).toBe('United States');
  });

  it('matches partial city with full location string', () => {
    const opts = createOptions(['Animas, Hidalgo, NM', 'Las Animas, CO']);
    const match = api.fuzzyMatchDropdownOption(opts, 'Animas');
    expect(match.textContent).toBe('Animas, Hidalgo, NM');
  });

  it('matches when target contains option text', () => {
    const opts = createOptions(['NM', 'NY', 'CA']);
    const match = api.fuzzyMatchDropdownOption(opts, 'NM');
    expect(match.textContent).toBe('NM');
  });

  it('matches by word overlap', () => {
    const opts = createOptions(['San Francisco, CA', 'San Diego, CA', 'San Jose, CA']);
    const match = api.fuzzyMatchDropdownOption(opts, 'San Francisco');
    expect(match.textContent).toBe('San Francisco, CA');
  });

  it('selects single option', () => {
    const opts = createOptions(['Only Option']);
    const match = api.fuzzyMatchDropdownOption(opts, 'something unrelated');
    expect(match.textContent).toBe('Only Option');
  });

  it('returns null for empty options', () => {
    expect(api.fuzzyMatchDropdownOption([], 'test')).toBeNull();
  });

  it('handles state abbreviations', () => {
    const opts = createOptions(['New Mexico', 'New York', 'Nevada']);
    const match = api.fuzzyMatchDropdownOption(opts, 'New Mexico');
    expect(match.textContent).toBe('New Mexico');
  });

  it('handles country names with starts-with', () => {
    const opts = createOptions(['United States of America', 'United Kingdom', 'United Arab Emirates']);
    const match = api.fuzzyMatchDropdownOption(opts, 'United States');
    expect(match.textContent).toBe('United States of America');
  });
});

// ═══════════════════════════════════════════════════════════════
// Date parsing
// ═══════════════════════════════════════════════════════════════

describe('parseFlexibleDate', () => {
  it('passes through YYYY-MM-DD', () => {
    expect(api.parseFlexibleDate('2024-01-15')).toBe('2024-01-15');
  });

  it('converts YYYY-MM to YYYY-MM-01', () => {
    expect(api.parseFlexibleDate('2024-06')).toBe('2024-06-01');
  });

  it('converts MM/DD/YYYY', () => {
    expect(api.parseFlexibleDate('03/15/2024')).toBe('2024-03-15');
  });

  it('converts MM-DD-YYYY', () => {
    expect(api.parseFlexibleDate('12-25-2023')).toBe('2023-12-25');
  });

  it('converts "Month YYYY"', () => {
    expect(api.parseFlexibleDate('January 2024')).toBe('2024-01-01');
    expect(api.parseFlexibleDate('December 2023')).toBe('2023-12-01');
  });

  it('converts bare year', () => {
    expect(api.parseFlexibleDate('2024')).toBe('2024-01-01');
  });

  it('returns null for empty/invalid', () => {
    expect(api.parseFlexibleDate('')).toBeNull();
    expect(api.parseFlexibleDate(null)).toBeNull();
  });

  it('handles single-digit month/day', () => {
    expect(api.parseFlexibleDate('1/5/2024')).toBe('2024-01-05');
  });
});

// ═══════════════════════════════════════════════════════════════
// Date field detection
// ═══════════════════════════════════════════════════════════════

describe('isDateField', () => {
  it('detects type="date"', () => {
    const input = createDateInput({ type: 'date' });
    expect(api.isDateField(input)).toBe(true);
  });

  it('detects type="month"', () => {
    const input = createDateInput({ type: 'month' });
    expect(api.isDateField(input)).toBe(true);
  });

  it('detects date-related names', () => {
    const input = createInput({ type: 'text', name: 'start_date', id: 'sd' });
    expect(api.isDateField(input)).toBe(true);
  });

  it('detects graduation in name', () => {
    const input = createInput({ type: 'text', name: 'graduation', id: 'grad' });
    expect(api.isDateField(input)).toBe(true);
  });

  it('does not detect regular text fields', () => {
    const input = createInput({ type: 'text', name: 'firstName', id: 'fn' });
    expect(api.isDateField(input)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Rich text editor detection
// ═══════════════════════════════════════════════════════════════

describe('isRichTextEditor', () => {
  it('detects contenteditable div', () => {
    const { editor } = createRichTextEditor();
    expect(api.isRichTextEditor(editor)).toBe(true);
  });

  it('detects role="textbox" div', () => {
    const div = document.createElement('div');
    div.setAttribute('role', 'textbox');
    document.body.appendChild(div);
    expect(api.isRichTextEditor(div)).toBe(true);
  });

  it('does not detect regular input', () => {
    const input = createInput({ type: 'text' });
    expect(api.isRichTextEditor(input)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Rich text filling
// ═══════════════════════════════════════════════════════════════

describe('fillRichText', () => {
  it('fills contenteditable with text', () => {
    const { editor } = createRichTextEditor();
    const result = api.fillRichText(editor, 'Hello World');
    expect(result).toBe(true);
    expect(editor.textContent).toContain('Hello World');
  });

  it('preserves newlines as <br>', () => {
    const { editor } = createRichTextEditor();
    api.fillRichText(editor, 'Line 1\nLine 2');
    expect(editor.innerHTML).toContain('<br>');
  });
});

// ═══════════════════════════════════════════════════════════════
// Custom dropdown trigger detection
// ═══════════════════════════════════════════════════════════════

describe('isCustomDropdownTrigger', () => {
  it('detects role="combobox"', () => {
    const div = document.createElement('div');
    div.setAttribute('role', 'combobox');
    expect(api.isCustomDropdownTrigger(div)).toBe(true);
  });

  it('detects aria-haspopup="listbox"', () => {
    const div = document.createElement('div');
    div.setAttribute('aria-haspopup', 'listbox');
    expect(api.isCustomDropdownTrigger(div)).toBe(true);
  });

  it('detects aria-expanded', () => {
    const div = document.createElement('div');
    div.setAttribute('aria-expanded', 'false');
    expect(api.isCustomDropdownTrigger(div)).toBe(true);
  });

  it('detects dropdown class', () => {
    const div = document.createElement('div');
    div.className = 'custom-select-dropdown';
    expect(api.isCustomDropdownTrigger(div)).toBe(true);
  });

  it('does not detect regular div', () => {
    const div = document.createElement('div');
    div.className = 'regular-content';
    expect(api.isCustomDropdownTrigger(div)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// clickOption
// ═══════════════════════════════════════════════════════════════

describe('clickOption', () => {
  it('dispatches mouseenter, mouseover, mousedown, mouseup, click', () => {
    const option = document.createElement('div');
    document.body.appendChild(option);
    const events = [];
    for (const evt of ['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click']) {
      option.addEventListener(evt, () => events.push(evt));
    }
    api.clickOption(option);
    expect(events).toEqual(['mouseenter', 'mouseover', 'mousedown', 'mouseup', 'click']);
  });
});

// ═══════════════════════════════════════════════════════════════
// fillField — text inputs
// ═══════════════════════════════════════════════════════════════

describe('fillField — fill_text', () => {
  it('fills a simple text input', async () => {
    const input = createInput({ id: 'name', type: 'text' });
    const result = await api.fillField('#name', 'John Doe', 'fill_text');
    expect(result.success).toBe(true);
    expect(input.value).toBe('John Doe');
  });

  it('fills a textarea', async () => {
    const ta = document.createElement('textarea');
    ta.id = 'bio';
    document.body.appendChild(ta);
    const result = await api.fillField('#bio', 'My bio text', 'fill_text');
    expect(result.success).toBe(true);
    expect(ta.value).toBe('My bio text');
  });

  it('returns failure for non-existent selector', async () => {
    const result = await api.fillField('#no-exist', 'test', 'fill_text');
    expect(result.success).toBe(false);
    expect(result.reason).toContain('not found');
  });

  it('fills a date input with proper format', async () => {
    const input = createDateInput({ type: 'date', id: 'startDate' });
    const result = await api.fillField('#startDate', 'January 2024', 'fill_text');
    expect(result.success).toBe(true);
    expect(result.dateField).toBe(true);
    expect(input.value).toBe('2024-01-01');
  });
});

// ═══════════════════════════════════════════════════════════════
// fillField — select dropdowns
// ═══════════════════════════════════════════════════════════════

describe('fillField — select_dropdown', () => {
  it('selects matching option by text', async () => {
    createSelect({ id: 'country' }, [
      { value: '', text: 'Select...' },
      { value: 'us', text: 'United States' },
      { value: 'ca', text: 'Canada' },
    ]);
    const result = await api.fillField('#country', 'United States', 'select_dropdown');
    expect(result.success).toBe(true);
    expect(result.selectedValue).toBe('us');
  });

  it('selects matching option by value', async () => {
    createSelect({ id: 'state' }, [
      { value: '', text: 'Select...' },
      { value: 'NM', text: 'New Mexico' },
      { value: 'NY', text: 'New York' },
    ]);
    const result = await api.fillField('#state', 'NM', 'select_dropdown');
    expect(result.success).toBe(true);
    expect(result.selectedValue).toBe('NM');
  });

  it('fails gracefully for no matching option', async () => {
    createSelect({ id: 'opts' }, [
      { value: 'a', text: 'Option A' },
    ]);
    const result = await api.fillField('#opts', 'nonexistent', 'select_dropdown');
    expect(result.success).toBe(false);
    expect(result.reason).toContain('no matching option');
  });
});

// ═══════════════════════════════════════════════════════════════
// fillField — Workday-style custom state dropdown
// (button[aria-haspopup="listbox"] trigger + portal-rendered popup
//  with [data-automation-id="promptOption"] items)
// ═══════════════════════════════════════════════════════════════

describe('fillField — Workday state dropdown', () => {
  function createWorkdayStateField(states) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'stateBtn';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('data-automation-id', 'stateProvince');
    button.setAttribute('aria-label', 'State');
    button.textContent = 'Select One';
    document.body.appendChild(button);

    const label = document.createElement('label');
    label.setAttribute('for', 'stateBtn');
    label.textContent = 'State';
    document.body.appendChild(label);

    // Popup rendered as a portal sibling of body (no role on container).
    const popup = document.createElement('div');
    popup.setAttribute('data-automation-widget', 'wd-popup');
    popup.style.display = 'none';

    for (const s of states) {
      const opt = document.createElement('div');
      opt.setAttribute('role', 'option');
      opt.setAttribute('data-automation-id', 'promptOption');
      opt.textContent = s;
      opt.style.height = '30px';
      Object.defineProperty(opt, 'offsetHeight', { value: 30, configurable: true });
      Object.defineProperty(opt, 'offsetWidth', { value: 200, configurable: true });
      popup.appendChild(opt);
    }
    document.body.appendChild(popup);

    const selected = { text: '' };
    button.addEventListener('click', () => {
      popup.style.display = 'block';
      popup.style.position = 'fixed';
      Object.defineProperty(popup, 'offsetParent', { value: document.body, configurable: true });
      Object.defineProperty(popup, 'offsetHeight', { value: 200, configurable: true });
      Object.defineProperty(popup, 'offsetWidth', { value: 250, configurable: true });
      for (const opt of popup.querySelectorAll('[role="option"]')) {
        Object.defineProperty(opt, 'offsetParent', { value: popup, configurable: true });
      }
    });
    for (const opt of popup.querySelectorAll('[role="option"]')) {
      opt.addEventListener('click', () => {
        selected.text = opt.textContent;
        button.textContent = opt.textContent;
      });
    }
    return { button, popup, selected };
  }

  it('clicks the button and selects the matching state option', async () => {
    const { popup, selected } = createWorkdayStateField([
      'California', 'New York', 'Texas', 'North Carolina', 'South Carolina',
    ]);

    const result = await api.fillField('#stateBtn', 'California', 'select_dropdown');
    expect(result.success).toBe(true);
    expect(result.selectedText).toBe('California');
    expect(selected.text).toBe('California');
    // Confirm the popup was actually opened (not just .value set on the button)
    expect(popup.style.display).toBe('block');
  });

  it('normalizes a state abbreviation ("CA") to the full name ("California")', async () => {
    // This is the core regression: "CA" previously failed because it startsWith-matches
    // "California", "North Carolina", and "South Carolina" — and the wrong one could win.
    const { selected } = createWorkdayStateField([
      'North Carolina', 'South Carolina', 'California',
    ]);

    const result = await api.fillField('#stateBtn', 'CA', 'select_dropdown');
    expect(result.success).toBe(true);
    expect(result.selectedText).toBe('California');
    expect(selected.text).toBe('California');
  });

  it('selects Michigan via Workday searchBox without clearing the selection', async () => {
    const { button, popup, selected } = createWorkdayStateField([
      'Maine', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi', 'Missouri',
    ]);

    // Real Workday prompts include a filter input; typing must not leave State as "Select One".
    const search = document.createElement('input');
    search.setAttribute('data-automation-id', 'searchBox');
    search.type = 'text';
    popup.insertBefore(search, popup.firstChild);

    // Simulate the old failure mode: aggressive outside-click clears an uncommitted value.
    button.addEventListener('blur', () => {
      if (selected.text && document.activeElement !== button) {
        // Keep selection — Workday commits on option click; blur alone must not reset.
      }
    });

    const result = await api.fillField('#stateBtn', 'Michigan', 'select_dropdown');
    expect(result.success).toBe(true);
    expect(result.selectedText).toBe('Michigan');
    expect(selected.text).toBe('Michigan');
    expect(button.textContent).toBe('Michigan');
  });

  it('fills state when the mapped node is a Workday container wrapping the button', async () => {
    const wrap = document.createElement('div');
    wrap.id = 'stateWrap';
    wrap.setAttribute('data-automation-id', 'addressSection_stateProvince');
    document.body.appendChild(wrap);

    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-haspopup', 'listbox');
    button.textContent = 'Select One';
    wrap.appendChild(button);

    const popup = document.createElement('div');
    popup.setAttribute('data-automation-widget', 'wd-popup');
    popup.style.display = 'none';
    for (const s of ['Michigan', 'Ohio', 'Illinois']) {
      const opt = document.createElement('div');
      opt.setAttribute('role', 'option');
      opt.setAttribute('data-automation-id', 'promptOption');
      opt.textContent = s;
      opt.style.height = '30px';
      Object.defineProperty(opt, 'offsetHeight', { value: 30, configurable: true });
      Object.defineProperty(opt, 'offsetWidth', { value: 200, configurable: true });
      popup.appendChild(opt);
    }
    document.body.appendChild(popup);

    button.addEventListener('click', () => {
      popup.style.display = 'block';
      Object.defineProperty(popup, 'offsetParent', { value: document.body, configurable: true });
      Object.defineProperty(popup, 'offsetHeight', { value: 200, configurable: true });
      for (const opt of popup.querySelectorAll('[role="option"]')) {
        Object.defineProperty(opt, 'offsetParent', { value: popup, configurable: true });
      }
    });
    for (const opt of popup.querySelectorAll('[role="option"]')) {
      opt.addEventListener('click', () => {
        button.textContent = opt.textContent;
      });
    }

    const result = await api.fillField('#stateWrap', 'MI', 'select_dropdown');
    expect(result.success).toBe(true);
    expect(button.textContent).toBe('Michigan');
  });
});

// ═══════════════════════════════════════════════════════════════
// fillField — radio buttons
// ═══════════════════════════════════════════════════════════════

describe('fillField — click_radio', () => {
  it('selects radio by value', async () => {
    const form = document.createElement('form');

    const r1 = document.createElement('input');
    r1.type = 'radio'; r1.name = 'gender'; r1.value = 'male'; r1.id = 'genderMale';
    const l1 = document.createElement('label');
    l1.setAttribute('for', 'genderMale'); l1.textContent = 'Male';

    const r2 = document.createElement('input');
    r2.type = 'radio'; r2.name = 'gender'; r2.value = 'female'; r2.id = 'genderFemale';
    const l2 = document.createElement('label');
    l2.setAttribute('for', 'genderFemale'); l2.textContent = 'Female';

    form.append(r1, l1, r2, l2);
    document.body.appendChild(form);

    const result = await api.fillField('#genderFemale', 'female', 'click_radio');
    expect(result.success).toBe(true);
    expect(result.selectedValue).toBe('female');
    expect(r2.checked).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// fillField — checkboxes
// ═══════════════════════════════════════════════════════════════

describe('fillField — check_checkbox', () => {
  it('checks a checkbox', async () => {
    const cb = createInput({ type: 'checkbox', id: 'agree' });
    const result = await api.fillField('#agree', 'true', 'check_checkbox');
    expect(result.success).toBe(true);
    expect(cb.checked).toBe(true);
  });

  it('unchecks a checkbox', async () => {
    const cb = createInput({ type: 'checkbox', id: 'agree2' });
    cb.checked = true;
    const result = await api.fillField('#agree2', 'false', 'check_checkbox');
    expect(result.success).toBe(true);
    expect(cb.checked).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// fillField — skip and fallback
// ═══════════════════════════════════════════════════════════════

describe('fillField — skip', () => {
  it('returns success with skipped flag', async () => {
    createInput({ id: 'skipped' });
    const result = await api.fillField('#skipped', '', 'skip');
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
  });
});

describe('fillField — unknown action', () => {
  it('falls back to setting value', async () => {
    const input = createInput({ id: 'fallback', type: 'text' });
    const result = await api.fillField('#fallback', 'test', 'unknown_action');
    expect(result.success).toBe(true);
    expect(result.action).toBe('fallback');
    expect(input.value).toBe('test');
  });
});

// ═══════════════════════════════════════════════════════════════
// fillField — file upload
// ═══════════════════════════════════════════════════════════════

describe('fillField — upload_file', () => {
  it('reports file attachment unavailable (not a silent verify failure)', async () => {
    createInput({ type: 'file', id: 'resume' });
    const result = await api.fillField('#resume', 'file.pdf', 'upload_file');
    expect(result.skipped).toBe(true);
    expect(result.inventoryCategory).toBe('file_attachment_unavailable');
    expect(result.reason).toContain('user interaction');
  });
});

// ═══════════════════════════════════════════════════════════════
// Typeahead dropdown detection
// ═══════════════════════════════════════════════════════════════

describe('findTypeaheadDropdown', () => {
  it('finds dropdown via aria-controls', () => {
    const input = createInput({ id: 'cityInput', 'aria-controls': 'city-listbox' });
    const listbox = document.createElement('ul');
    listbox.id = 'city-listbox';
    listbox.setAttribute('role', 'listbox');
    // Make element pass visibility check in jsdom
    listbox.style.position = 'fixed';
    Object.defineProperty(listbox, 'offsetHeight', { value: 100, configurable: true });
    Object.defineProperty(listbox, 'offsetWidth', { value: 200, configurable: true });
    document.body.appendChild(listbox);

    const found = api.findTypeaheadDropdown(input);
    expect(found).toBe(listbox);
  });

  it('finds dropdown as sibling in parent', () => {
    const wrapper = document.createElement('div');
    const input = document.createElement('input');
    input.type = 'text';
    wrapper.appendChild(input);

    const listbox = document.createElement('ul');
    listbox.setAttribute('role', 'listbox');
    listbox.style.position = 'fixed';
    Object.defineProperty(listbox, 'offsetHeight', { value: 100, configurable: true });
    Object.defineProperty(listbox, 'offsetWidth', { value: 200, configurable: true });
    wrapper.appendChild(listbox);
    document.body.appendChild(wrapper);

    const found = api.findTypeaheadDropdown(input);
    expect(found).toBe(listbox);
  });

  it('returns null when no dropdown is visible', () => {
    const input = createInput({ type: 'text', id: 'nodd' });
    expect(api.findTypeaheadDropdown(input)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// getDropdownOptions
// ═══════════════════════════════════════════════════════════════

describe('getDropdownOptions', () => {
  it('gets options by role="option"', () => {
    const listbox = document.createElement('div');
    listbox.setAttribute('role', 'listbox');
    for (const text of ['Opt 1', 'Opt 2', 'Opt 3']) {
      const opt = document.createElement('div');
      opt.setAttribute('role', 'option');
      opt.textContent = text;
      opt.style.height = '30px';
      Object.defineProperty(opt, 'offsetParent', { value: listbox, configurable: true });
      Object.defineProperty(opt, 'offsetHeight', { value: 30, configurable: true });
      listbox.appendChild(opt);
    }

    const options = api.getDropdownOptions(listbox);
    expect(options).toHaveLength(3);
    expect(options[0].textContent).toBe('Opt 1');
  });

  it('gets options by li elements', () => {
    const ul = document.createElement('ul');
    for (const text of ['Item A', 'Item B']) {
      const li = document.createElement('li');
      li.textContent = text;
      Object.defineProperty(li, 'offsetParent', { value: ul, configurable: true });
      Object.defineProperty(li, 'offsetHeight', { value: 30, configurable: true });
      ul.appendChild(li);
    }

    const options = api.getDropdownOptions(ul);
    expect(options).toHaveLength(2);
  });

  it('returns empty array for empty dropdown', () => {
    const empty = document.createElement('div');
    expect(api.getDropdownOptions(empty)).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Form HTML serialization
// ═══════════════════════════════════════════════════════════════

describe('serializeFormHtml', () => {
  it('serializes form content', () => {
    const form = document.createElement('form');
    form.innerHTML = '<input type="text" name="test">';
    document.body.appendChild(form);

    const html = api.serializeFormHtml();
    expect(html).toContain('input');
    expect(html).toContain('name="test"');
  });

  it('removes script and style tags', () => {
    const form = document.createElement('form');
    form.innerHTML = '<script>alert("xss")</script><input type="text"><style>body{}</style>';
    document.body.appendChild(form);

    const html = api.serializeFormHtml();
    expect(html).not.toContain('alert');
    expect(html).not.toContain('<style>');
  });

  it('truncates to 50KB', () => {
    const form = document.createElement('form');
    const bigContent = '<div>' + 'x'.repeat(60000) + '</div>';
    form.innerHTML = bigContent;
    document.body.appendChild(form);

    const html = api.serializeFormHtml();
    expect(html.length).toBeLessThanOrEqual(50000);
  });
});

// ═══════════════════════════════════════════════════════════════
// dismissOpenDropdowns
// ═══════════════════════════════════════════════════════════════

describe('dismissOpenDropdowns', () => {
  it('dispatches Escape and body click when dropdown is open', () => {
    const listbox = document.createElement('div');
    listbox.setAttribute('role', 'listbox');
    const opt = document.createElement('div');
    opt.textContent = 'option';
    listbox.appendChild(opt);
    Object.defineProperty(listbox, 'offsetParent', { value: document.body, configurable: true });
    document.body.appendChild(listbox);

    const bodyClicked = vi.fn();
    document.body.addEventListener('click', bodyClicked);

    api.dismissOpenDropdowns();
    expect(bodyClicked).toHaveBeenCalled();
  });
});

// ═══════════════════════════════════════════════════════════════
// Date field filling
// ═══════════════════════════════════════════════════════════════

describe('fillDateField', () => {
  it('fills native date input with ISO format', () => {
    const input = createDateInput({ type: 'date', id: 'date1' });
    const result = api.fillDateField(input, '03/15/2024');
    expect(result).toBe(true);
    expect(input.value).toBe('2024-03-15');
  });

  it('fills month input with YYYY-MM', () => {
    const input = createDateInput({ type: 'month', id: 'month1' });
    const result = api.fillDateField(input, 'June 2024');
    expect(result).toBe(true);
    // Should be YYYY-MM format
    expect(input.value).toBe('2024-06');
  });

  it('fills text date input as-is', () => {
    const input = createInput({ type: 'text', name: 'date_field', id: 'textDate' });
    const result = api.fillDateField(input, 'January 2024');
    expect(result).toBe(true);
    expect(input.value).toBe('January 2024');
  });
});

// ═══════════════════════════════════════════════════════════════
// Integration: fillForm flow
// ═══════════════════════════════════════════════════════════════

describe('fillForm', () => {
  it('fills multiple fields and tracks count', async () => {
    createInput({ id: 'f1', type: 'text' });
    createInput({ id: 'f2', type: 'text' });

    const mappings = [
      { selector: '#f1', value: 'Alice', action: 'fill_text', confidence: 0.9 },
      { selector: '#f2', value: 'Smith', action: 'fill_text', confidence: 0.95 },
    ];

    const result = await api.fillForm(mappings);
    expect(result.filledCount).toBe(2);
    expect(result.total).toBe(2);
  });

  it('skips fields with skip action', async () => {
    createInput({ id: 'f3', type: 'text' });

    const mappings = [
      { selector: '#f3', value: '', action: 'skip' },
    ];

    const result = await api.fillForm(mappings);
    expect(result.filledCount).toBe(0);
    expect(result.total).toBe(0);
  });

  it('handles mixed success/failure', async () => {
    createInput({ id: 'exists', type: 'text' });

    const mappings = [
      { selector: '#exists', value: 'hello', action: 'fill_text' },
      { selector: '#gone', value: 'world', action: 'fill_text' },
    ];

    const result = await api.fillForm(mappings);
    expect(result.filledCount).toBe(1);
    expect(result.total).toBe(2);
    expect(result.results.some(r => !r.success)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Edge cases
// ═══════════════════════════════════════════════════════════════

describe('edge cases', () => {
  it('handles empty value for fill_text', async () => {
    const input = createInput({ id: 'empty', type: 'text', value: 'existing' });
    const result = await api.fillField('#empty', '', 'fill_text');
    expect(result.success).toBe(true);
    expect(input.value).toBe('');
  });

  it('handles special characters in value', async () => {
    const input = createInput({ id: 'special', type: 'text' });
    const result = await api.fillField('#special', 'O\'Brien & Co. <test>', 'fill_text');
    expect(result.success).toBe(true);
    expect(input.value).toBe('O\'Brien & Co. <test>');
  });

  it('handles very long values', async () => {
    const textarea = document.createElement('textarea');
    textarea.id = 'long';
    document.body.appendChild(textarea);
    const longVal = 'x'.repeat(10000);
    const result = await api.fillField('#long', longVal, 'fill_text');
    expect(result.success).toBe(true);
    expect(textarea.value.length).toBe(10000);
  });

  it('handles selector with special characters', async () => {
    const input = document.createElement('input');
    input.id = 'field-with.dots:and-colons';
    input.type = 'text';
    document.body.appendChild(input);

    const selector = `#${CSS.escape('field-with.dots:and-colons')}`;
    const result = await api.fillField(selector, 'test', 'fill_text');
    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Auto-detection of application forms
// ═══════════════════════════════════════════════════════════════

describe('detectApplicationForm', () => {
  it('returns none for inputs not inside a form element', () => {
    createInput({ type: 'text', name: 'firstName', id: 'firstName' });
    createInput({ type: 'text', name: 'coverLetter', id: 'coverLetter' });

    const confidence = api.detectApplicationForm();
    expect(confidence).toBe('none');
  });

  it('returns none for generic contact forms without job-specific fields', () => {
    const form = createForm();
    createInput({ type: 'text', name: 'firstName', id: 'firstName' }, form);
    createInput({ type: 'text', name: 'lastName', id: 'lastName' }, form);
    createInput({ type: 'email', name: 'email', id: 'email' }, form);

    const confidence = api.detectApplicationForm();
    expect(confidence).toBe('none');
  });

  it('returns high confidence with job-specific fields plus generic fields in a form', () => {
    const form = createForm();
    createInput({ type: 'text', name: 'firstName', id: 'firstName' }, form);
    createInput({ type: 'text', name: 'lastName', id: 'lastName' }, form);
    createInput({ type: 'email', name: 'email', id: 'email' }, form);
    createInput({ type: 'text', name: 'coverLetter', id: 'coverLetter' }, form);

    const confidence = api.detectApplicationForm();
    expect(confidence).toBe('high');
  });

  it('returns medium confidence with generic fields and application title', () => {
    const form = createForm();
    createInput({ type: 'text', name: 'firstName', id: 'firstName' }, form);
    createInput({ type: 'text', name: 'lastName', id: 'lastName' }, form);
    createInput({ type: 'email', name: 'email', id: 'email' }, form);
    document.title = 'Apply for Software Engineer';

    const confidence = api.detectApplicationForm();
    expect(confidence).toBe('medium');
  });

  it('returns medium confidence with 1 job-specific field and application title', () => {
    const form = createForm();
    createInput({ type: 'text', name: 'yearsOfExperience', id: 'yearsOfExperience' }, form);
    document.title = 'Apply for Software Engineer';

    const confidence = api.detectApplicationForm();
    expect(confidence).toBe('medium');
  });

  it('returns none for pages without forms', () => {
    createInput({ type: 'text', name: 'search', id: 'search' });

    const confidence = api.detectApplicationForm();
    expect(confidence).toBe('none');
  });

  it('returns none for login forms with password fields', () => {
    const form = createForm();
    createInput({ type: 'email', name: 'email', id: 'email' }, form);
    createInput({ type: 'password', name: 'password', id: 'password' }, form);
    createInput({ type: 'text', name: 'coverLetter', id: 'coverLetter' }, form);

    const confidence = api.detectApplicationForm();
    expect(confidence).toBe('none');
  });

  it('returns none for search forms', () => {
    const form = createForm({ role: 'search' });
    createInput({ type: 'text', name: 'q', id: 'q' }, form);

    const confidence = api.detectApplicationForm();
    expect(confidence).toBe('none');
  });

  it('counts resume file input as a strong job signal', () => {
    const form = createForm();
    createInput({ type: 'text', name: 'firstName', id: 'firstName' }, form);
    createInput({ type: 'text', name: 'lastName', id: 'lastName' }, form);
    createInput({ type: 'file', name: 'resume', id: 'resume' }, form);

    const confidence = api.detectApplicationForm();
    expect(confidence).toBe('high');
  });

  it('returns high confidence with 2+ job-specific fields', () => {
    const form = createForm();
    createInput({ type: 'text', name: 'coverLetter', id: 'coverLetter' }, form);
    createInput({ type: 'text', name: 'salaryExpectation', id: 'salaryExpectation' }, form);

    const confidence = api.detectApplicationForm();
    expect(confidence).toBe('high');
  });

  it('returns high confidence when #grnhse_app container exists (Greenhouse embed)', () => {
    const div = document.createElement('div');
    div.id = 'grnhse_app';
    document.body.appendChild(div);

    const confidence = api.detectApplicationForm();
    expect(confidence).toBe('high');
  });

  it('returns high confidence when iframe with greenhouse src exists', () => {
    const iframe = document.createElement('iframe');
    iframe.id = 'grnhse_iframe';
    document.body.appendChild(iframe);

    const confidence = api.detectApplicationForm();
    expect(confidence).toBe('high');
  });
});

// ═══════════════════════════════════════════════════════════════
// Phone field detection
// ═══════════════════════════════════════════════════════════════

describe('isPhoneField', () => {
  it('detects type="tel"', () => {
    const input = createInput({ type: 'tel', name: 'phone_number', id: 'ph' });
    expect(api.isPhoneField(input)).toBe(true);
  });

  it('detects by name attribute', () => {
    const input = createInput({ type: 'text', name: 'phone', id: 'ph2' });
    expect(api.isPhoneField(input)).toBe(true);
  });

  it('detects by label', () => {
    const input = createInput({ type: 'text', name: 'field1', id: 'field1' });
    createLabel('field1', 'Phone Number');
    expect(api.isPhoneField(input)).toBe(true);
  });

  it('detects mobile in name', () => {
    const input = createInput({ type: 'text', name: 'mobile_number', id: 'mob' });
    expect(api.isPhoneField(input)).toBe(true);
  });

  it('does not detect firstName', () => {
    const input = createInput({ type: 'text', name: 'firstName', id: 'fn' });
    expect(api.isPhoneField(input)).toBe(false);
  });

  it('does not detect email', () => {
    const input = createInput({ type: 'email', name: 'email', id: 'em' });
    expect(api.isPhoneField(input)).toBe(false);
  });

  it('returns false for null', () => {
    expect(api.isPhoneField(null)).toBe(false);
  });

  it('does not detect phone country code field as phone', () => {
    const input = createInput({ type: 'text', name: 'countryPhoneCode', id: 'cpc' });
    expect(api.isPhoneField(input)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Phone country code detection
// ═══════════════════════════════════════════════════════════════

describe('isPhoneCountryCodeField', () => {
  it('detects countryPhoneCode name', () => {
    const input = createInput({ type: 'text', name: 'countryPhoneCode', id: 'cpc1' });
    expect(api.isPhoneCountryCodeField(input)).toBe(true);
  });

  it('detects country code label', () => {
    const input = createInput({ type: 'text', name: 'field_x', id: 'cc1' });
    createLabel('cc1', 'Country Phone Code');
    expect(api.isPhoneCountryCodeField(input)).toBe(true);
  });

  it('detects dial code label', () => {
    const input = createInput({ type: 'text', name: 'dial', id: 'dc1' });
    createLabel('dc1', 'Dial Code');
    expect(api.isPhoneCountryCodeField(input)).toBe(true);
  });

  it('does not detect regular phone field', () => {
    const input = createInput({ type: 'tel', name: 'phone', id: 'ph3' });
    expect(api.isPhoneCountryCodeField(input)).toBe(false);
  });

  it('returns false for null', () => {
    expect(api.isPhoneCountryCodeField(null)).toBe(false);
  });
});

describe('hasNearbyPhoneCountryCode', () => {
  it('finds Workday countryPhoneCode dropdown near phone field', () => {
    const container = document.createElement('div');
    container.setAttribute('data-automation-id', 'phone-section');
    const codeDropdown = document.createElement('button');
    codeDropdown.setAttribute('data-automation-id', 'countryPhoneCode');
    codeDropdown.setAttribute('aria-haspopup', 'listbox');
    container.appendChild(codeDropdown);
    const phoneInput = createInput({ type: 'tel', name: 'phone', id: 'wdph' });
    container.appendChild(phoneInput);
    document.body.appendChild(container);

    expect(api.hasNearbyPhoneCountryCode(phoneInput)).toBe(true);
  });

  it('finds Greenhouse phone_country_code select via #app_form ancestor', () => {
    const form = document.createElement('form');
    form.id = 'app_form';

    const codeDiv = document.createElement('div');
    codeDiv.className = 'field';
    const codeSelect = document.createElement('select');
    codeSelect.id = 'phone_country_code';
    codeSelect.name = 'phone_country_code';
    codeDiv.appendChild(codeSelect);
    form.appendChild(codeDiv);

    const phoneDiv = document.createElement('div');
    phoneDiv.className = 'field';
    const phoneInput = createInput({ type: 'text', name: 'phone', id: 'gh_phone' });
    phoneDiv.appendChild(phoneInput);
    form.appendChild(phoneDiv);

    document.body.appendChild(form);

    expect(api.hasNearbyPhoneCountryCode(phoneInput)).toBe(true);
  });

  it('finds Greenhouse phone_country_code select via #grnhse_app ancestor', () => {
    const wrapper = document.createElement('div');
    wrapper.id = 'grnhse_app';

    const codeSelect = document.createElement('select');
    codeSelect.id = 'phone_country_code';
    codeSelect.name = 'phone_country_code';
    wrapper.appendChild(codeSelect);

    const phoneInput = createInput({ type: 'text', name: 'phone', id: 'gh_phone2' });
    wrapper.appendChild(phoneInput);

    document.body.appendChild(wrapper);

    expect(api.hasNearbyPhoneCountryCode(phoneInput)).toBe(true);
  });

  it('returns false when no country code dropdown nearby', () => {
    const input = createInput({ type: 'tel', name: 'phone_alone', id: 'ph_alone' });
    expect(api.hasNearbyPhoneCountryCode(input)).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// looksLikePhoneNumber
// ═══════════════════════════════════════════════════════════════

describe('looksLikePhoneNumber', () => {
  it('detects raw 10-digit number', () => {
    expect(api.looksLikePhoneNumber('1234567890')).toBe(true);
  });

  it('detects formatted US phone', () => {
    expect(api.looksLikePhoneNumber('(123) 456-7890')).toBe(true);
  });

  it('detects phone with country code', () => {
    expect(api.looksLikePhoneNumber('+1 (123) 456-7890')).toBe(true);
  });

  it('detects dot-separated phone', () => {
    expect(api.looksLikePhoneNumber('123.456.7890')).toBe(true);
  });

  it('rejects text values', () => {
    expect(api.looksLikePhoneNumber('John Smith')).toBe(false);
  });

  it('rejects short numbers', () => {
    expect(api.looksLikePhoneNumber('123')).toBe(false);
  });

  it('rejects null/empty', () => {
    expect(api.looksLikePhoneNumber(null)).toBe(false);
    expect(api.looksLikePhoneNumber('')).toBe(false);
  });

  it('rejects mixed alphanumeric', () => {
    expect(api.looksLikePhoneNumber('abc1234567')).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════
// Phone guard in fillField
// ═══════════════════════════════════════════════════════════════

describe('fillField — phone number guard', () => {
  it('skips phone-like value for non-phone text field', async () => {
    createInput({ type: 'text', name: 'firstName', id: 'fname' });
    const result = await api.fillField('#fname', '(555) 123-4567', 'fill_text');
    expect(result.success).toBe(true);
    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/phone/i);
  });

  it('allows phone value for actual phone field', async () => {
    const input = createInput({ type: 'tel', name: 'phone', id: 'phone1' });
    const result = await api.fillField('#phone1', '(555) 123-4567', 'fill_text');
    expect(result.success).toBe(true);
    expect(result.skipped).toBeUndefined();
  });

  it('allows non-phone value for non-phone field', async () => {
    const input = createInput({ type: 'text', name: 'city', id: 'city1' });
    const result = await api.fillField('#city1', 'New York', 'fill_text');
    expect(result.success).toBe(true);
    expect(result.skipped).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// fillField — click_radio normalization
// ═══════════════════════════════════════════════════════════════

describe('fillField — click_radio normalization', () => {
  it('matches synonym via normalization (Caucasian → White)', async () => {
    const form = document.createElement('form');

    const r1 = document.createElement('input');
    r1.type = 'radio'; r1.name = 'race'; r1.value = 'white'; r1.id = 'raceWhite';
    const l1 = document.createElement('label');
    l1.setAttribute('for', 'raceWhite'); l1.textContent = 'White';

    const r2 = document.createElement('input');
    r2.type = 'radio'; r2.name = 'race'; r2.value = 'black'; r2.id = 'raceBlack';
    const l2 = document.createElement('label');
    l2.setAttribute('for', 'raceBlack'); l2.textContent = 'Black or African American';

    form.append(r1, l1, r2, l2);
    document.body.appendChild(form);

    const result = await api.fillField('#raceWhite', 'Caucasian', 'click_radio');
    expect(result.success).toBe(true);
    expect(result.selectedValue).toBe('white');
    expect(r1.checked).toBe(true);
  });

  it('matches EEO long form via normalization (Latino → Hispanic or Latino)', async () => {
    const form = document.createElement('form');

    const r1 = document.createElement('input');
    r1.type = 'radio'; r1.name = 'ethnicity'; r1.value = 'hispanic'; r1.id = 'ethHisp';
    const l1 = document.createElement('label');
    l1.setAttribute('for', 'ethHisp'); l1.textContent = 'Hispanic or Latino';

    const r2 = document.createElement('input');
    r2.type = 'radio'; r2.name = 'ethnicity'; r2.value = 'white'; r2.id = 'ethWhite';
    const l2 = document.createElement('label');
    l2.setAttribute('for', 'ethWhite'); l2.textContent = 'White (Not Hispanic or Latino)';

    form.append(r1, l1, r2, l2);
    document.body.appendChild(form);

    const result = await api.fillField('#ethHisp', 'Latino', 'click_radio');
    expect(result.success).toBe(true);
    expect(result.selectedValue).toBe('hispanic');
    expect(r1.checked).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// Resume upload field detection
// ═══════════════════════════════════════════════════════════════

describe('detectUploadType', () => {
  it('detects resume upload field', () => {
    const input = createInput({ type: 'file', name: 'resume', id: 'resume-upload' });
    createLabel('resume-upload', 'Resume');
    expect(api.detectUploadType(input)).toBe('resume');
  });

  it('detects cover letter upload field', () => {
    const input = createInput({ type: 'file', name: 'cover_letter', id: 'cl-upload' });
    createLabel('cl-upload', 'Cover Letter');
    expect(api.detectUploadType(input)).toBe('cover-letter');
  });

  it('detects CV as resume', () => {
    const input = createInput({ type: 'file', name: 'cv_file', id: 'cv-upload' });
    createLabel('cv-upload', 'CV Upload');
    expect(api.detectUploadType(input)).toBe('resume');
  });

  it('returns null for unrecognized file input', () => {
    const input = createInput({ type: 'file', name: 'photo', id: 'photo-upload' });
    createLabel('photo-upload', 'Photo');
    expect(api.detectUploadType(input)).toBeNull();
  });

  it('returns null for generic file input without document hints', () => {
    const input = createInput({ type: 'file', name: 'attachment', id: 'attach' });
    createLabel('attach', 'Upload File');
    expect(api.detectUploadType(input)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// enrichFieldHints
// ═══════════════════════════════════════════════════════════════

describe('enrichFieldHints', () => {
  it('tags a select with dial code options as phone country code', () => {
    const fields = [{
      tag: 'select',
      label: '',
      name: 'cc_field',
      id: 'cc1',
      options: [
        { value: 'US', text: 'United States (+1)' },
        { value: 'GB', text: 'United Kingdom (+44)' },
        { value: 'DE', text: 'Germany (+49)' },
        { value: 'FR', text: 'France (+33)' },
        { value: 'IN', text: 'India (+91)' },
        { value: 'AU', text: 'Australia (+61)' },
        { value: 'JP', text: 'Japan (+81)' },
        { value: 'AF', text: 'Afghanistan (+93)' },
      ],
    }];
    const result = api.enrichFieldHints(fields);
    expect(result[0].label).toContain('phone country code');
  });

  it('does not change label if already contains country code hint', () => {
    const fields = [{
      tag: 'select',
      label: 'Phone Country Code',
      name: 'country_code',
      id: 'cc2',
      options: [
        { value: 'US', text: 'United States (+1)' },
        { value: 'GB', text: 'United Kingdom (+44)' },
        { value: 'DE', text: 'Germany (+49)' },
        { value: 'FR', text: 'France (+33)' },
        { value: 'IN', text: 'India (+91)' },
        { value: 'AU', text: 'Australia (+61)' },
      ],
    }];
    const result = api.enrichFieldHints(fields);
    expect(result[0].label).toBe('Phone Country Code');
  });

  it('does not tag non-dial-code selects', () => {
    const fields = [{
      tag: 'select',
      label: 'State',
      name: 'state',
      id: 'st1',
      options: [
        { value: 'CA', text: 'California' },
        { value: 'NY', text: 'New York' },
        { value: 'TX', text: 'Texas' },
        { value: 'FL', text: 'Florida' },
        { value: 'WA', text: 'Washington' },
        { value: 'OR', text: 'Oregon' },
      ],
    }];
    const result = api.enrichFieldHints(fields);
    expect(result[0].label).toBe('State');
  });
});

// ═══════════════════════════════════════════════════════════════
// Multi-page state tracking
// ═══════════════════════════════════════════════════════════════

describe('multi-page tracking', () => {
  it('startMultiPageTracking initializes state', () => {
    api.startMultiPageTracking(5);
    // After starting, stopMultiPageTracking should work without error
    api.stopMultiPageTracking();
  });

  it('stopMultiPageTracking cleans up without error', () => {
    api.startMultiPageTracking(3);
    api.stopMultiPageTracking();
    // Calling stop again should be a no-op
    api.stopMultiPageTracking();
  });

  it('stopMultiPageTracking is safe when not started', () => {
    // Should not throw
    api.stopMultiPageTracking();
  });
});

// ═══════════════════════════════════════════════════════════════
// originalValues Map (overlay undo tracking)
// ═══════════════════════════════════════════════════════════════

describe('originalValues tracking', () => {
  it('is populated after verified fillForm success', async () => {
    createInput({ id: 'tracked', type: 'text' });
    await api.fillForm([
      { selector: '#tracked', value: 'test value', action: 'fill_text', confidence: 0.9, field_label: 'Tracked Field' },
    ]);

    expect(api.originalValues.size).toBeGreaterThanOrEqual(1);
    const entry = api.originalValues.get('#tracked');
    expect(entry).toBeDefined();
    expect(entry.value).toBe('test value');
    expect(entry.label).toBe('Tracked Field');
    expect(entry.confidence).toBe(0.9);
    expect(entry.undone).toBe(false);
    expect(api.fieldResults.get('#tracked')?.status).toBe('filled');
  });

  it('stores original value for undo', async () => {
    api.overwriteExistingFields = true;
    const input = createInput({ id: 'undo-test', type: 'text', value: 'original' });
    await api.fillForm([
      { selector: '#undo-test', value: 'new value', action: 'fill_text', confidence: 1, field_label: 'Undo' },
    ]);

    const entry = api.originalValues.get('#undo-test');
    expect(entry.originalValue).toBe('original');
  });

  it('undoField restores original value', async () => {
    api.overwriteExistingFields = true;
    const input = createInput({ id: 'undo-field', type: 'text', value: 'before' });
    await api.fillForm([
      { selector: '#undo-field', value: 'after', action: 'fill_text', confidence: 1, field_label: 'Undo' },
    ]);
    expect(input.value).toBe('after');

    api.undoField('#undo-field');
    expect(input.value).toBe('before');

    expect(api.fieldResults.get('#undo-field')?.status).toBe('undone');
    expect(api.originalValues.has('#undo-field')).toBe(false);
  });
});

describe('nonempty field protection', () => {
  it('skips nonempty text fields by default', async () => {
    api.overwriteExistingFields = false;
    const input = createInput({ id: 'protected', type: 'text', value: 'keep-me' });
    const result = await api.fillField('#protected', 'overwrite', 'fill_text');
    expect(result.skipped).toBe(true);
    expect(result.alreadyCompleted).toBe(true);
    expect(input.value).toBe('keep-me');
  });

  it('allows overwrite when enabled', async () => {
    api.overwriteExistingFields = true;
    const input = createInput({ id: 'overwrite-ok', type: 'text', value: 'old' });
    const result = await api.fillField('#overwrite-ok', 'new', 'fill_text');
    expect(result.skipped).toBeFalsy();
    expect(input.value).toBe('new');
  });

  it('refuses submit controls', async () => {
    const btn = document.createElement('button');
    btn.id = 'submit-app';
    btn.type = 'submit';
    btn.textContent = 'Submit Application';
    document.body.appendChild(btn);
    expect(api.isSubmitControl(btn)).toBe(true);
    const result = await api.fillField('#submit-app', 'x', 'fill_text');
    expect(result.skipped).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════
// ATS adapter detection
// ═══════════════════════════════════════════════════════════════

describe('ATS adapter detection', () => {
  it('detects Workday URL', () => {
    const adapters = window.__jaAtsAdapters;
    const adapter = adapters.detectATS('https://company.myworkdayjobs.com/en-US/job/12345', document);
    expect(adapter).not.toBeNull();
    expect(adapter.name).toBe('Workday');
  });

  it('detects Greenhouse URL', () => {
    const adapters = window.__jaAtsAdapters;
    const adapter = adapters.detectATS('https://boards.greenhouse.io/company/jobs/12345', document);
    expect(adapter).not.toBeNull();
    expect(adapter.name).toBe('Greenhouse');
  });

  it('detects Lever URL', () => {
    const adapters = window.__jaAtsAdapters;
    const adapter = adapters.detectATS('https://jobs.lever.co/company/apply', document);
    expect(adapter).not.toBeNull();
    expect(adapter.name).toBe('Lever');
  });

  it('detects iCIMS URL', () => {
    const adapters = window.__jaAtsAdapters;
    const adapter = adapters.detectATS('https://careers.icims.com/company/job/12345', document);
    expect(adapter).not.toBeNull();
    expect(adapter.name).toBe('iCIMS');
  });

  it('detects Taleo URL', () => {
    const adapters = window.__jaAtsAdapters;
    const adapter = adapters.detectATS('https://company.taleo.net/apply/12345', document);
    expect(adapter).not.toBeNull();
    expect(adapter.name).toBe('Taleo');
  });

  it('returns null for unknown URL', () => {
    const adapters = window.__jaAtsAdapters;
    const adapter = adapters.detectATS('https://example.com/jobs', document);
    expect(adapter).toBeNull();
  });

  it('lists all adapter names', () => {
    const names = window.__jaAtsAdapters.listAdapters();
    expect(names).toContain('Workday');
    expect(names).toContain('Greenhouse');
    expect(names).toContain('Lever');
    expect(names).toContain('iCIMS');
    expect(names).toContain('Taleo');
  });
});

// ═══════════════════════════════════════════════════════════════
// Normalized fuzzy matching (select dropdowns)
// ═══════════════════════════════════════════════════════════════

describe('fuzzyMatchOption with normalization', () => {
  it('matches state abbreviation via normalization', () => {
    const options = [
      { value: '', text: 'Select...' },
      { value: 'NM', text: 'New Mexico' },
      { value: 'NY', text: 'New York' },
    ];
    // When normalization is available, "NM" should match option at index 1
    const idx = api.fuzzyMatchOption(options, 'NM');
    expect(idx).toBe(1);
  });

  it('matches country name via normalization', () => {
    const options = [
      { value: 'us', text: 'United States' },
      { value: 'ca', text: 'Canada' },
    ];
    const idx = api.fuzzyMatchOption(options, 'USA');
    expect(idx).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// getFieldHints
// ═══════════════════════════════════════════════════════════════

describe('getFieldHints', () => {
  it('returns label, name, id, placeholder', () => {
    const input = createInput({ type: 'text', name: 'firstName', id: 'fn', placeholder: 'Enter name' });
    createLabel('fn', 'First Name');
    const hints = api.getFieldHints(input);
    expect(hints.name).toBe('firstName');
    expect(hints.id).toBe('fn');
    expect(hints.placeholder).toBe('Enter name');
    expect(hints.label).toBe('First Name');
  });

  it('returns empty strings for null element', () => {
    const hints = api.getFieldHints(null);
    expect(hints.label).toBe('');
    expect(hints.name).toBe('');
    expect(hints.id).toBe('');
    expect(hints.placeholder).toBe('');
  });
});

// ═══════════════════════════════════════════════════════════════
// Badge display
// ═══════════════════════════════════════════════════════════════

describe('auto-detection badge', () => {
  it('showBadge adds badge element to DOM', () => {
    api.showBadge('high');
    const badge = document.querySelector('.ja-auto-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain('JobApply');
  });

  it('removeBadge cleans up badge', () => {
    api.showBadge('high');
    expect(document.querySelector('.ja-auto-badge')).not.toBeNull();

    api.removeBadge();
    expect(document.querySelector('.ja-auto-badge')).toBeNull();
  });

  it('showBadge with medium confidence adds medium class', () => {
    api.showBadge('medium');
    const badge = document.querySelector('.ja-auto-badge');
    expect(badge.classList.contains('ja-badge-medium')).toBe(true);
  });

  it('showBadge does not add duplicate badges', () => {
    api.showBadge('high');
    api.showBadge('high');
    const badges = document.querySelectorAll('.ja-auto-badge');
    expect(badges.length).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════
// Custom Q&A fuzzy matching
// ═══════════════════════════════════════════════════════════════

describe('fuzzyMatchQA', () => {
  const qaEntries = [
    { question_pattern: 'How did you hear about us', answer: 'LinkedIn', category: 'general' },
    { question_pattern: 'desired salary', answer: '120000', category: 'compensation' },
    { question_pattern: 'Are you authorized to work in the United States', answer: 'Yes', category: 'eligibility' },
    { question_pattern: 'start date', answer: '2 weeks notice', category: 'availability' },
  ];

  it('returns null for empty label', () => {
    expect(api.fuzzyMatchQA('', qaEntries)).toBeNull();
    expect(api.fuzzyMatchQA(null, qaEntries)).toBeNull();
  });

  it('returns null for empty entries', () => {
    expect(api.fuzzyMatchQA('some label', [])).toBeNull();
    expect(api.fuzzyMatchQA('some label', null)).toBeNull();
  });

  it('matches exact question pattern', () => {
    const match = api.fuzzyMatchQA('desired salary', qaEntries);
    expect(match).not.toBeNull();
    expect(match.answer).toBe('120000');
  });

  it('matches case-insensitively', () => {
    const match = api.fuzzyMatchQA('Desired Salary', qaEntries);
    expect(match).not.toBeNull();
    expect(match.answer).toBe('120000');
  });

  it('matches when label contains the pattern', () => {
    const match = api.fuzzyMatchQA('What is your desired salary range?', qaEntries);
    expect(match).not.toBeNull();
    expect(match.answer).toBe('120000');
  });

  it('matches when pattern contains the label', () => {
    const match = api.fuzzyMatchQA('salary', qaEntries);
    expect(match).not.toBeNull();
    expect(match.answer).toBe('120000');
  });

  it('matches by keyword overlap', () => {
    const match = api.fuzzyMatchQA('How did you hear about this position?', qaEntries);
    expect(match).not.toBeNull();
    expect(match.answer).toBe('LinkedIn');
  });

  it('matches work authorization question', () => {
    const match = api.fuzzyMatchQA('Are you authorized to work in the US?', qaEntries);
    expect(match).not.toBeNull();
    expect(match.answer).toBe('Yes');
  });

  it('returns null for no match', () => {
    const match = api.fuzzyMatchQA('Upload your portfolio', qaEntries);
    expect(match).toBeNull();
  });

  it('skips entries with empty question_pattern', () => {
    const entries = [{ question_pattern: '', answer: 'nope' }];
    expect(api.fuzzyMatchQA('anything', entries)).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// Custom Q&A application to mappings
// ═══════════════════════════════════════════════════════════════

describe('applyCustomQA', () => {
  beforeEach(() => {
    // Mock chrome.runtime.sendMessage for Q&A fetch
    globalThis.chrome.runtime.sendMessage = vi.fn().mockImplementation((msg) => {
      if (msg.type === 'getCustomQA') {
        return Promise.resolve({
          ok: true,
          data: [
            { question_pattern: 'desired salary', answer: '120000', category: 'compensation' },
            { question_pattern: 'How did you hear about us', answer: 'LinkedIn', category: 'general' },
          ],
        });
      }
      return Promise.resolve({ ok: false });
    });
  });

  it('fills skipped fields that match Q&A', async () => {
    const mappings = [
      { selector: '#name', value: 'John', action: 'fill_text', field_label: 'Full Name' },
      { selector: '#salary', value: '', action: 'skip', field_label: 'What is your desired salary?' },
    ];

    const result = await api.applyCustomQA(mappings);
    expect(result[0].action).toBe('fill_text');
    expect(result[0].value).toBe('John');
    expect(result[1].action).toBe('fill_text');
    expect(result[1].value).toBe('120000');
    expect(result[1].qa_matched).toBe(true);
  });

  it('does not modify non-skip fields', async () => {
    const mappings = [
      { selector: '#name', value: 'John', action: 'fill_text', field_label: 'Full Name' },
    ];

    const result = await api.applyCustomQA(mappings);
    expect(result[0].action).toBe('fill_text');
    expect(result[0].value).toBe('John');
    expect(result[0].qa_matched).toBeUndefined();
  });

  it('leaves skip fields that do not match any Q&A', async () => {
    const mappings = [
      { selector: '#portfolio', value: '', action: 'skip', field_label: 'Upload your portfolio' },
    ];

    const result = await api.applyCustomQA(mappings);
    expect(result[0].action).toBe('skip');
  });

  it('handles Q&A fetch failure gracefully', async () => {
    globalThis.chrome.runtime.sendMessage = vi.fn().mockRejectedValue(new Error('Extension error'));

    const mappings = [
      { selector: '#salary', value: '', action: 'skip', field_label: 'Desired Salary' },
    ];

    const result = await api.applyCustomQA(mappings);
    expect(result[0].action).toBe('skip');
  });

  it('handles empty Q&A response', async () => {
    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: true, data: [] });

    const mappings = [
      { selector: '#salary', value: '', action: 'skip', field_label: 'Desired Salary' },
    ];

    const result = await api.applyCustomQA(mappings);
    expect(result[0].action).toBe('skip');
  });

  it('handles invalid Q&A response', async () => {
    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: false });

    const mappings = [
      { selector: '#salary', value: '', action: 'skip', field_label: 'Desired Salary' },
    ];

    const result = await api.applyCustomQA(mappings);
    expect(result[0].action).toBe('skip');
  });
});

// ═══════════════════════════════════════════════════════════════
// Toast notifications
// ═══════════════════════════════════════════════════════════════

describe('showToast', () => {
  it('creates a toast element in the DOM', () => {
    api.showToast('Test message');
    const toast = document.getElementById('ja-autofill-toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toBe('Test message');
  });

  it('removes existing toast before creating new one', () => {
    api.showToast('First');
    api.showToast('Second');
    const toasts = document.querySelectorAll('#ja-autofill-toast');
    expect(toasts.length).toBe(1);
    expect(toasts[0].textContent).toBe('Second');
  });

  it('uses green background for success type', () => {
    const toast = api.showToast('Success!', 'success');
    expect(toast.style.background).toContain('rgb(34, 197, 94)');
  });

  it('uses red background for error type', () => {
    const toast = api.showToast('Error!', 'error');
    expect(toast.style.background).toContain('rgb(239, 68, 68)');
  });

  it('has role="status" for accessibility', () => {
    api.showToast('Accessible');
    const toast = document.getElementById('ja-autofill-toast');
    expect(toast.getAttribute('role')).toBe('status');
  });
});

// ═══════════════════════════════════════════════════════════════
// Auto-track applied jobs
// ═══════════════════════════════════════════════════════════════

describe('autoTrackApplied', () => {
  beforeEach(() => {
    api.autoTrackFired = false;
    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: true, data: { job_id: 1 } });
  });

  it('calls markAppliedByUrl via background message', async () => {
    await api.autoTrackApplied();
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledWith({
      type: 'markAppliedByUrl',
      url: expect.any(String),
    });
  });

  it('shows success toast on successful track', async () => {
    await api.autoTrackApplied();
    const toast = document.getElementById('ja-autofill-toast');
    expect(toast).not.toBeNull();
    expect(toast.textContent).toContain('marked as applied');
  });

  it('only fires once per page', async () => {
    await api.autoTrackApplied();
    await api.autoTrackApplied();
    expect(globalThis.chrome.runtime.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('does not show toast on failure', async () => {
    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({ ok: false });
    await api.autoTrackApplied();
    const toast = document.getElementById('ja-autofill-toast');
    expect(toast).toBeNull();
  });

  it('handles message send error gracefully', async () => {
    globalThis.chrome.runtime.sendMessage = vi.fn().mockRejectedValue(new Error('No connection'));
    await api.autoTrackApplied();
    // Should not throw, no toast shown
    const toast = document.getElementById('ja-autofill-toast');
    expect(toast).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════
// Timeout configuration
// ═══════════════════════════════════════════════════════════════

describe('timeout configuration', () => {
  it('API_TIMEOUT_MS should be 60000ms (60s) to allow margin for AI analysis', () => {
    expect(api.API_TIMEOUT_MS).toBe(60000);
  });
});

// ═══════════════════════════════════════════════════════════════
// fillForm iteration limit
// ═══════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════
// startFillFlow overall timeout
// ═══════════════════════════════════════════════════════════════

describe('startFillFlow overall timeout', () => {
  it('shows timeout error in overlay when flow exceeds 90 seconds', async () => {
    // Strategy: analyzeForm resolves slowly (55s), then getNewMappings hangs.
    // Without an overall 90s timeout, the flow would be stuck until getNewMappings'
    // own 60s per-API timeout at 115s total. The overall timeout should fire at 90s,
    // showing a user-friendly error before the per-API timeout triggers.

    globalThis.chrome.runtime.sendMessage = vi.fn().mockImplementation((msg) => {
      // lookupJob: resolve immediately (job not found)
      if (msg.type === 'lookupJob') {
        return Promise.resolve({ ok: false });
      }
      if (msg.type === 'analyzeForm') {
        // analyzeForm: resolves after 55s
        return new Promise(resolve => {
          setTimeout(() => resolve({
            ok: true,
            data: {
              mappings: [
                { selector: '#f1', value: 'test', action: 'fill_text', confidence: 0.9 },
              ],
            },
          }), 55000);
        });
      }
      // getNewMappings / anything else: hang forever
      return new Promise(() => {});
    });

    const form = createForm();
    const input = createInput({ id: 'f1', type: 'text', name: 'first_name' }, form);

    // Add dynamic field after fill to trigger iteration 1 (which calls getNewMappings)
    input.addEventListener('input', () => {
      if (!document.getElementById('dyn-1')) {
        createInput({ id: 'dyn-1', type: 'text', name: 'dynamic' }, form);
      }
    });

    // Start the flow (don't await — it will hang without overall timeout)
    api.startFillFlow();

    // Advance to 56s: analyzeForm resolves; review is skipped in tests
    await vi.advanceTimersByTimeAsync(56000);
    // Allow microtasks (fill, dynamic field detection) to settle
    await vi.advanceTimersByTimeAsync(2000);
    // Fill phase has its own 90s timeout (review wait is excluded)
    await vi.advanceTimersByTimeAsync(90000);

    // Check the overlay — fill-phase overall timeout should have fired
    const overlay = document.getElementById('ja-autofill-overlay');
    expect(overlay).not.toBeNull();
    const statusEl = overlay.querySelector('.ja-autofill-overlay-status');
    expect(statusEl.textContent).toMatch(/timed?\s*out|too long/i);
  }, 15000);
});

describe('Greenhouse phone-country widget classification', () => {
  function loadPhoneWidgetFixture() {
    const html = readFileSync(
      join(__dirname, '..', '..', 'fixtures', 'greenhouse', 'phone-country-widget.html'),
      'utf-8',
    );
    document.documentElement.innerHTML = html;
  }

  it('classifies Select country next to phone as phone_country, not address country', () => {
    loadPhoneWidgetFixture();
    const fields = api.enrichFieldHints(api.extractFormData());
    const phoneCountry = fields.find(f => f.selector === '#phone_country_trigger' || f.id === 'phone_country_trigger');
    const addressCountry = fields.find(f => f.selector === '#address_country' || f.id === 'address_country');
    expect(phoneCountry).toBeTruthy();
    expect(phoneCountry.fieldKind).toBe('phone_country');
    expect(addressCountry?.fieldKind).not.toBe('phone_country');
  });

  it('refuses to autofill the phone-country control (manual review)', async () => {
    loadPhoneWidgetFixture();
    const result = await api.fillField(
      '#phone_country_trigger',
      'United States (+1)',
      'select_dropdown',
      1,
      'Select country',
    );
    expect(result.skipped).toBe(true);
    expect(result.reason).toBe('phone_country_manual_review');
    expect(document.getElementById('phone_country_iso').value).toBe('');
    expect(document.getElementById('phone_country_trigger').textContent).toMatch(/Select country/i);
  });

  it('isSelectCountryInPhoneWidget is true only inside the phone widget', () => {
    loadPhoneWidgetFixture();
    const trigger = document.getElementById('phone_country_trigger');
    const addr = document.getElementById('address_country');
    expect(api.isSelectCountryInPhoneWidget(trigger)).toBe(true);
    expect(api.isSelectCountryInPhoneWidget(addr)).toBe(false);
  });
});

describe('matchPhoneCountryCodeOption', () => {
  const options = [
    { value: 'AF', text: 'Afghanistan (+93)' },
    { value: 'AL', text: 'Albania (+355)' },
    { value: 'DZ', text: 'Algeria (+213)' },
    { value: 'AS', text: 'American Samoa (+1)' },
    { value: 'US', text: 'United States (+1)' },
    { value: 'CA', text: 'Canada (+1)' },
  ];

  it('prefers United States for +1 over Albania/Algeria/American Samoa', () => {
    expect(options[api.matchPhoneCountryCodeOption(options, 'United States (+1)')].text)
      .toBe('United States (+1)');
    expect(options[api.matchPhoneCountryCodeOption(options, '+1')].text)
      .toBe('United States (+1)');
    expect(options[api.matchPhoneCountryCodeOption(options, '1')].text)
      .toBe('United States (+1)');
  });

  it('does not let fuzzyMatchOption pick Albania for +1', () => {
    const hints = { label: 'Phone Country Code', name: 'phone_country_code', id: 'phone_country_code' };
    const idx = api.fuzzyMatchOption(options, 'United States (+1)', hints);
    expect(options[idx].text).toBe('United States (+1)');
    expect(api.fuzzyMatchOption(options, '1', hints)).toBe(idx);
  });
});

describe('sanitizeMappings / getNearbyHeading', () => {
  it('drops phone-like values on non-phone fields', () => {
    const cleaned = api.sanitizeMappings([
      { selector: '#phone', field_label: 'Phone', value: '5551234567', action: 'fill_text', confidence: 1 },
      { selector: '#gpa', field_label: 'What is your current cumulative GPA?', value: '5551234567', action: 'fill_text', confidence: 0.9 },
      { selector: '#why', field_label: 'Why are you interested?', value: '5551234567', action: 'fill_text', confidence: 0.9 },
      { selector: '#linkedin', field_label: 'LinkedIn Profile', value: 'https://linkedin.com/in/x', action: 'fill_text', confidence: 1 },
    ]);
    expect(cleaned.map(m => m.selector)).toEqual(['#phone', '#linkedin']);
  });

  it('collapses duplicate City and Phone DOM proposals to one each', () => {
    const cleaned = api.sanitizeMappings([
      { selector: '[data-automation-id="city"]', field_label: 'City', value: 'Testville', action: 'fill_text', confidence: 1 },
      { selector: '#city-dup', field_label: 'City *', value: 'Testville', action: 'fill_text', confidence: 0.85 },
      { selector: '[data-automation-id="phone-number"]', field_label: 'Phone Number', value: '5551234567', action: 'fill_text', confidence: 1 },
      { selector: '#phone-alt', field_label: 'Phone', value: '5551234567', action: 'fill_text', confidence: 0.7 },
      { selector: '#phone-sms-opt-in', field_label: 'Phone SMS Opt In', value: 'true', action: 'check_checkbox', confidence: 0.9 },
      { selector: '#email', field_label: 'Email', value: 'user@example.com', action: 'fill_text', confidence: 1 },
      { selector: '#contact_by_email', field_label: 'Contact me by email', value: 'yes', action: 'check_checkbox', confidence: 0.95 },
    ]);
    const cities = cleaned.filter(m => /city/i.test(m.field_label || '') && m.action === 'fill_text');
    const phones = cleaned.filter(m => mappingIsPhoneNumberProposal(m));
    expect(cities).toHaveLength(1);
    expect(cities[0].selector).toBe('[data-automation-id="city"]');
    expect(phones).toHaveLength(1);
    expect(phones[0].selector).toBe('[data-automation-id="phone-number"]');
    expect(cleaned.some(m => m.selector === '#phone-sms-opt-in')).toBe(true);
    expect(cleaned.some(m => m.selector === '#email')).toBe(true);
    expect(cleaned.some(m => m.selector === '#contact_by_email')).toBe(true);
  });

  it('does not collapse contact_pref radio with email value into contact_by_email', () => {
    const cleaned = api.sanitizeMappings([
      { selector: '#email', field_label: 'Email', value: 'user@example.com', action: 'fill_text', confidence: 0.95 },
      {
        selector: 'input[name="contact_pref"][value="email"]',
        field_label: 'Preferred contact',
        value: 'phone',
        action: 'click_radio',
        confidence: 0.9,
      },
      {
        selector: '#contact_by_email',
        field_label: 'Contact me by email',
        value: 'yes',
        action: 'check_checkbox',
        confidence: 0.95,
      },
    ]);
    expect(cleaned.map(m => m.selector).sort()).toEqual([
      '#contact_by_email',
      '#email',
      'input[name="contact_pref"][value="email"]',
    ].sort());
  });

  function mappingIsPhoneNumberProposal(m) {
    const text = `${m.field_label || ''} ${m.selector || ''}`.toLowerCase();
    if (/sms|opt[-_]?in/.test(text)) return false;
    if (/country|device/.test(text)) return false;
    return /\bphone\b/.test(text);
  }

  it('uses the nearest preceding section heading, not the first heading in the form', () => {
    const form = createForm();
    const hPhone = document.createElement('h2');
    hPhone.textContent = 'Phone';
    form.appendChild(hPhone);
    createInput({ id: 'phone', name: 'phone', type: 'tel' }, form);
    const hEdu = document.createElement('h2');
    hEdu.textContent = 'Education';
    form.appendChild(hEdu);
    const gpa = createInput({ id: 'gpa', name: 'gpa', type: 'text' }, form);
    // Old parent.querySelector('h2') returned "Phone" for every field under the form.
    expect(api.getNearbyHeading(gpa)).toMatch(/education/i);
  });
});

// ═══════════════════════════════════════════════════════════════
// startFillFlow ATS iframe delegation
// ═══════════════════════════════════════════════════════════════

describe('startFillFlow ATS iframe delegation', () => {
  it('defers when a real Greenhouse iframe exists and the page has no local fields', async () => {
    const iframe = document.createElement('iframe');
    iframe.src = 'https://boards.greenhouse.io/acme/jobs/1';
    document.body.appendChild(iframe);

    await api.startFillFlow();

    const overlay = document.getElementById('ja-autofill-overlay');
    expect(overlay).toBeNull();
  });

  it('does not defer for #grnhse_app alone when local form fields exist', async () => {
    const container = document.createElement('div');
    container.id = 'grnhse_app';
    const form = document.createElement('form');
    form.id = 'app_form';
    const input = document.createElement('input');
    input.id = 'first_name';
    input.name = 'first_name';
    input.type = 'text';
    form.appendChild(input);
    container.appendChild(form);
    document.body.appendChild(container);

    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      data: { mappings: [] },
    });

    await api.startFillFlow();

    // Same-document Greenhouse forms should analyze (not silently no-op).
    const overlay = document.getElementById('ja-autofill-overlay');
    expect(overlay).not.toBeNull();
  });

  it('silently removes overlay in iframe with no form fields', async () => {
    // Simulate being in an iframe (window.self !== window.top)
    Object.defineProperty(window, 'self', { value: {}, configurable: true });

    // Empty page — no form fields
    // startFillFlow should bail silently after extractFormData finds nothing
    await api.startFillFlow();

    const overlay = document.getElementById('ja-autofill-overlay');
    expect(overlay).toBeNull();

    // Restore
    Object.defineProperty(window, 'self', { value: window, configurable: true });
  });

  it('does not defer solely because gh_jid is present without an ATS iframe', async () => {
    const origLocation = window.location.href;
    Object.defineProperty(window, 'location', {
      value: new URL('https://careers.example.com/detail/123/?gh_jid=456'),
      writable: true,
      configurable: true,
    });

    globalThis.chrome.runtime.sendMessage = vi.fn().mockResolvedValue({
      ok: true,
      data: { mappings: [] },
    });

    await api.startFillFlow();

    // Parent career pages with only gh_jid used to no-op incorrectly; now they analyze.
    const overlay = document.getElementById('ja-autofill-overlay');
    expect(overlay).not.toBeNull();

    Object.defineProperty(window, 'location', {
      value: new URL(origLocation),
      writable: true,
      configurable: true,
    });
  });
});

// ═══════════════════════════════════════════════════════════════
// getNewMappings error logging
// ═══════════════════════════════════════════════════════════════

describe('getNewMappings error logging', () => {
  it('logs a console warning when re-analysis fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Make sendMessage reject (simulating a timeout or network error)
    globalThis.chrome.runtime.sendMessage = vi.fn().mockRejectedValue(
      new Error('API form analysis timed out after 60000ms')
    );

    const result = await api.getNewMappings();

    expect(result).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
    expect(warnSpy.mock.calls[0][0]).toMatch(/re-analysis|getNewMappings|failed/i);

    warnSpy.mockRestore();
  });
});

describe('fillForm approved-only (no silent second pass)', () => {
  it('does not call getNewMappings / re-analyze after filling approved mappings', async () => {
    let reAnalyzeCount = 0;
    globalThis.chrome.runtime.sendMessage = vi.fn().mockImplementation(() => {
      reAnalyzeCount++;
      return Promise.resolve({
        ok: true,
        data: { mappings: [{ selector: '#extra', value: 'x', action: 'fill_text', confidence: 0.9 }] },
      });
    });

    createInput({ id: 'f1', type: 'text' });
    const mappings = [
      { selector: '#f1', value: 'initial', action: 'fill_text', confidence: 0.9 },
    ];

    const result = await api.fillForm(mappings);
    expect(result.filledCount).toBe(1);
    expect(result.total).toBe(1);
    // Silent post-review AI pass removed — progress must stay N/N, not 10/6.
    expect(reAnalyzeCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════
// Review overlay UX + Workday state failure reporting
// ═══════════════════════════════════════════════════════════════

describe('review overlay Fill/Cancel and Expand', () => {
  afterEach(() => {
    window.__jaAutofillTest = true;
    window.__jaSkipReview = true;
    document.getElementById('ja-autofill-overlay')?.remove();
  });

  it('keeps Fill and Cancel visible for a long review list', async () => {
    window.__jaAutofillTest = false;
    window.__jaSkipReview = false;

    const mappings = Array.from({ length: 40 }, (_, i) => ({
      selector: `#f${i}`,
      field_label: `Field ${i}`,
      value: `Value ${i}`,
      action: 'fill_text',
      confidence: 0.95,
    }));

    const reviewPromise = api.reviewMappingsBeforeFill(mappings);
    await vi.advanceTimersByTimeAsync(50);

    const overlay = document.getElementById('ja-autofill-overlay');
    expect(overlay).not.toBeNull();
    expect(overlay.classList.contains('ja-autofill-overlay-review')).toBe(true);

    const actions = overlay.querySelector('.ja-autofill-review-actions');
    const approve = overlay.querySelector('.ja-autofill-approve-btn');
    const cancel = overlay.querySelector('.ja-autofill-cancel-btn');
    expect(actions).not.toBeNull();
    expect(approve).not.toBeNull();
    expect(cancel).not.toBeNull();
    expect(approve.textContent).toMatch(/Fill approved/i);
    expect(cancel.textContent).toMatch(/Cancel/i);

    // Actions are siblings of the scrollable list (not trapped inside <ul>).
    const list = overlay.querySelector('.ja-autofill-review-list');
    const chrome = overlay.querySelector('.ja-autofill-review-chrome');
    expect(list).not.toBeNull();
    expect(chrome).not.toBeNull();
    expect(list.contains(actions)).toBe(false);
    expect(list.querySelectorAll('.ja-autofill-review-item').length).toBe(40);
    expect(overlay.querySelector('.ja-autofill-overlay-body').contains(actions)).toBe(true);
    // Actions come after the scrollable list in DOM order (pinned footer).
    expect(
      actions.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_PRECEDING
    ).toBeTruthy();

    cancel.click();
    await expect(reviewPromise).resolves.toBeNull();
  });

  it('shows a clearly labeled Expand control when the overlay is collapsed', async () => {
    window.__jaAutofillTest = false;
    window.__jaSkipReview = false;

    const reviewPromise = api.reviewMappingsBeforeFill([
      { selector: '#a', field_label: 'Name', value: 'Test', action: 'fill_text', confidence: 1 },
    ]);
    await vi.advanceTimersByTimeAsync(50);

    const overlay = document.getElementById('ja-autofill-overlay');
    const minBtn = overlay.querySelector('.ja-autofill-overlay-minimize');
    expect(minBtn).not.toBeNull();

    minBtn.click();
    expect(overlay.classList.contains('ja-autofill-overlay-collapsed')).toBe(true);
    expect(minBtn.getAttribute('aria-label')).toBe('Expand');
    expect(minBtn.title).toBe('Expand');

    minBtn.click();
    expect(overlay.classList.contains('ja-autofill-overlay-collapsed')).toBe(false);
    expect(minBtn.getAttribute('aria-label')).toBe('Minimize');

    overlay.querySelector('.ja-autofill-cancel-btn').click();
    await reviewPromise;
  });
});

describe('phone-sms-opt-in is never a phone number field', () => {
  it('isPhoneField is false for Workday phone-sms-opt-in', () => {
    const form = createForm();
    const cb = createInput({
      id: 'phone-sms-opt-in',
      name: 'phone-sms-opt-in',
      type: 'checkbox',
    }, form);
    const label = document.createElement('label');
    label.setAttribute('for', 'phone-sms-opt-in');
    label.textContent = 'Phone SMS Opt In';
    form.appendChild(label);
    expect(api.isPhoneField(cb)).toBe(false);
  });
});

describe('fillField — Workday state failure reporting', () => {
  it('reports selection did not stick instead of success when State stays Select One', async () => {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'stateFailBtn';
    button.setAttribute('aria-haspopup', 'listbox');
    button.setAttribute('data-automation-id', 'stateProvince');
    button.setAttribute('aria-label', 'State');
    button.textContent = 'Select One';
    document.body.appendChild(button);

    const popup = document.createElement('div');
    popup.setAttribute('data-automation-widget', 'wd-popup');
    popup.style.display = 'none';
    const opt = document.createElement('div');
    opt.setAttribute('role', 'option');
    opt.setAttribute('data-automation-id', 'promptOption');
    opt.textContent = 'Michigan';
    opt.style.height = '30px';
    Object.defineProperty(opt, 'offsetHeight', { value: 30, configurable: true });
    Object.defineProperty(opt, 'offsetWidth', { value: 200, configurable: true });
    popup.appendChild(opt);
    document.body.appendChild(popup);

    button.addEventListener('click', () => {
      popup.style.display = 'block';
      Object.defineProperty(popup, 'offsetParent', { value: document.body, configurable: true });
      Object.defineProperty(popup, 'offsetHeight', { value: 200, configurable: true });
      Object.defineProperty(opt, 'offsetParent', { value: popup, configurable: true });
    });
    // Option click intentionally does NOT update the button — simulates Workday race/clear.
    opt.addEventListener('click', () => {});

    const resultPromise = api.fillField('#stateFailBtn', 'Michigan', 'select_dropdown');
    // Workday path polls + retries; advance fake timers past waitForControlValue loops.
    for (let i = 0; i < 80; i++) {
      await vi.advanceTimersByTimeAsync(200);
    }
    const result = await resultPromise;
    expect(result.success).toBe(false);
    expect(result.reason).toMatch(/selection did not stick|no matching option/i);
    expect(button.textContent).toBe('Select One');
  }, 20000);
});

// ═══════════════════════════════════════════════════════════════
// Same-URL section fingerprint + overlay lifecycle (Workday)
// ═══════════════════════════════════════════════════════════════

describe('Workday same-URL section transitions', () => {
  it('buildSectionFingerprint changes when My Information becomes My Experience', () => {
    document.body.innerHTML = `
      <h1>My Information</h1>
      <label>First Name <input id="fn" name="firstName" data-automation-id="legalNameSection_firstName" /></label>
    `;
    const fp1 = api.buildSectionFingerprint();

    document.body.innerHTML = `
      <h1>My Experience</h1>
      <h2>Work Experience</h2>
      <button type="button">Add</button>
      <h2>Education</h2>
      <button type="button">Add</button>
      <input type="file" />
      <p>Type to Add Skills</p>
    `;
    const fp2 = api.buildSectionFingerprint();
    expect(fp1).not.toBe(fp2);
    expect(fp2).toMatch(/my experience/i);
  });

  it('ordinary field value mutations do not change fingerprint', () => {
    createInput({ id: 'city', name: 'city', type: 'text', 'data-automation-id': 'city' });
    createLabel('city', 'City');
    const fp1 = api.buildSectionFingerprint();
    document.getElementById('city').value = 'Ann Arbor';
    const fp2 = api.buildSectionFingerprint();
    expect(fp1).toBe(fp2);
  });

  it('detects new section after same-URL DOM swap and shows Analyze', async () => {
    document.body.innerHTML = `
      <h1>My Information</h1>
      <input id="fn" name="firstName" data-automation-id="legalNameSection_firstName" />
    `;
    await api.fillForm([
      { selector: '#fn', value: 'Ada', action: 'fill_text', confidence: 0.9, field_label: 'First Name' },
    ]);
    expect(api.originalValues.size).toBeGreaterThan(0);
    api.startMultiPageTracking(1);

    document.body.innerHTML = `
      <h1>My Experience</h1>
      <h2>Work Experience</h2>
      <button type="button">Add</button>
      <input type="file" />
      <p>Type to Add Skills</p>
    `;

    await vi.advanceTimersByTimeAsync(1000);

    expect(api.originalValues.size).toBe(0);
    expect(api.currentState).toBe('idle');
    const overlay = document.getElementById('ja-autofill-overlay');
    expect(overlay).toBeTruthy();
    expect(overlay.textContent).toMatch(/New application section detected/i);
    expect(overlay.querySelector('.ja-autofill-analyze-section-btn')).toBeTruthy();
    expect(document.querySelector('[data-automation-id="bottom-navigation-next-button"]')).toBeNull();
  });

  it('JobApply overlay mutations alone do not trigger a new section', async () => {
    document.body.innerHTML = `<h1>My Information</h1><input id="a" name="a" />`;
    api.startMultiPageTracking(0);
    const fpBefore = api.buildSectionFingerprint();

    const junk = document.createElement('div');
    junk.id = 'ja-autofill-overlay';
    junk.textContent = 'noise';
    document.body.appendChild(junk);
    await vi.advanceTimersByTimeAsync(1000);

    // Fingerprint of page content unchanged; overlay-only mutation ignored.
    expect(api.buildSectionFingerprint()).toBe(fpBefore);
    expect(document.body.textContent).not.toMatch(/New application section detected/i);
  });
});

describe('overlay lifecycle', () => {
  it('recreates overlay when previous node is detached', () => {
    const first = api.createOverlay();
    expect(first.isConnected).toBe(true);
    first.remove();
    expect(api.overlayIsLive()).toBe(false);
    const second = api.createOverlay();
    expect(second.isConnected).toBe(true);
    expect(second).not.toBe(first);
    expect(document.getElementById('ja-autofill-overlay')).toBe(second);
  });

  it('close button dismisses overlay and returns to idle', () => {
    api.currentState = 'done';
    const overlay = api.createOverlay();
    overlay.querySelector('.ja-autofill-overlay-close').click();
    expect(document.getElementById('ja-autofill-overlay')).toBeNull();
    expect(api.currentState).toBe('idle');
  });

  it('error message is not hidden by prior completion pill', async () => {
    createInput({ id: 'x', type: 'text' });
    await api.fillForm([
      { selector: '#x', value: 'v', action: 'fill_text', confidence: 0.9, field_label: 'X' },
    ]);
    expect(api.fieldResults.get('#x')?.status).toBe('filled');
    api.updateOverlay('done', 'No fillable fields found on this section.', { forceStatus: true });
    const overlay = document.getElementById('ja-autofill-overlay');
    expect(overlay.textContent).toMatch(/No fillable fields/i);
    expect(overlay.classList.contains('ja-autofill-overlay-compact')).toBe(false);
  });

  it('clearPageScopedState clears originalValues and fieldResults', async () => {
    createInput({ id: 'y', type: 'text' });
    await api.fillForm([
      { selector: '#y', value: 'v', action: 'fill_text', confidence: 1, field_label: 'Y' },
    ]);
    expect(api.originalValues.size).toBe(1);
    expect(api.fieldResults.size).toBe(1);
    api.clearPageScopedState({ keepCumulative: true });
    expect(api.originalValues.size).toBe(0);
    expect(api.fieldResults.size).toBe(0);
  });
});

describe('post-fill verification + None sanitization', () => {
  it('rejects location fill when autocomplete clears value on blur', async () => {
    const input = document.createElement('input');
    input.id = 'job_application_location';
    input.name = 'job_application[location]';
    input.setAttribute('aria-label', 'Location (City)');
    input.setAttribute('role', 'combobox');
    // Simulate Greenhouse: any value without a committed suggestion is cleared.
    input.addEventListener('blur', () => { input.value = ''; });
    document.body.appendChild(input);
    const label = document.createElement('label');
    label.setAttribute('for', 'job_application_location');
    label.textContent = 'Location (City)';
    document.body.appendChild(label);

    const result = await api.fillField(
      '#job_application_location',
      'Sterling Heights, MI, United States',
      'fill_text',
      1,
      'Location (City)',
    );
    expect(result.success).toBe(false);
    expect(result.inventoryCategory).toBe('failed_verification');
    expect(input.value).toBe('');
  });

  it('sanitizeMappings drops None/null proposed values', () => {
    const out = api.sanitizeMappings([
      { selector: '#a', value: 'None', action: 'fill_text', field_label: 'Salary' },
      { selector: '#b', value: null, action: 'fill_text', field_label: 'X' },
      { selector: '#c', value: 'Ada', action: 'fill_text', field_label: 'Name' },
    ]);
    expect(out.map(m => m.selector)).toEqual(['#c']);
  });
});

describe('Workday My Experience collapsed unsupported', () => {
  it('detects collapsed My Experience fixture shape', () => {
    const html = readFileSync(
      join(__dirname, '..', '..', 'fixtures', 'workday', 'my-experience-collapsed.html'),
      'utf-8',
    );
    document.documentElement.innerHTML = html.replace(/^[\s\S]*<html[^>]*>/i, '').replace(/<\/html>[\s\S]*$/i, '');
    // jsdom may not parse full document replace well — set body directly
    const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
    document.body.innerHTML = bodyMatch ? bodyMatch[1] : html;
    expect(api.looksLikeWorkdayMyExperienceCollapsed()).toBe(true);
  });

  it('startFillFlow shows explicit unsupported message and does not click Save', async () => {
    const bodyMatch = readFileSync(
      join(__dirname, '..', '..', 'fixtures', 'workday', 'my-experience-collapsed.html'),
      'utf-8',
    ).match(/<body[^>]*>([\s\S]*)<\/body>/i);
    document.body.innerHTML = bodyMatch[1];
    let saveClicks = 0;
    document.querySelector('[data-automation-id="bottom-navigation-next-button"]')
      ?.addEventListener('click', () => { saveClicks += 1; });

    const result = await api.startFillFlow({ force: true });
    expect(result.unsupported).toBe(true);
    const overlay = document.getElementById('ja-autofill-overlay');
    expect(overlay.textContent).toMatch(/My Experience detected/i);
    expect(overlay.textContent).toMatch(/Stage 1\.1/i);
    expect(overlay.querySelector('.ja-autofill-analyze-section-btn')).toBeTruthy();
    expect(saveClicks).toBe(0);
    expect(api.currentState).toBe('idle');
  });
});

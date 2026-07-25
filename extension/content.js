(() => {
  'use strict';

  // Guard against multiple injections
  if (window.__jaAutofillLoaded) return;
  window.__jaAutofillLoaded = true;

  const PREFIX = 'ja-autofill';
  const OVERLAY_PREFIX = 'ja-overlay';
  const FIELD_TIMEOUT_MS = 8000;  // Max time per field fill
  const API_TIMEOUT_MS = 60000;   // Max time for API analyze call
  const SCAN_DEBOUNCE_MS = 1500;  // Debounce for MutationObserver re-scans
  let currentState = 'idle'; // idle | analyzing | review | filling | done | error

  // Stage 1 safety defaults (overridable via chrome.storage.local)
  let overwriteExistingFields = false;
  let enableJobBoardOverlay = false;
  let enableQueueFill = false;
  // Detailed field/value logging is OFF by default (PII). Enable via chrome.storage.local.debugAutofill=true
  let debugAutofill = false;

  function debugLog(...args) {
    if (!debugAutofill && !(typeof window !== 'undefined' && window.__jaAutofillTest)) return;
    console.debug('[JobApply:debug]', ...args);
  }

  function redactValue(value) {
    const s = String(value ?? '');
    if (!s) return '';
    if (s.length <= 2) return '**';
    return s[0] + '***' + s.slice(-1);
  }

  function getBuildInfo() {
    const info = (typeof globalThis !== 'undefined' && globalThis.__JA_BUILD_INFO__) || {};
    const source = info.sourceSha || info.shortSha || 'unknown';
    return {
      shortSha: source,
      sourceSha: source,
      sha: info.sha || 'unknown',
      branch: info.branch || 'unknown',
      committedAt: info.committedAt || '',
    };
  }

  function sanitizePageOrigin() {
    try {
      return location.origin || '';
    } catch {
      return '';
    }
  }

  /** Last analyze/fill snapshot for Copy sanitized diagnostics (no PII values). */
  let lastDiagnosticsSnapshot = null;

  /**
   * Verified fill outcomes — source of truth for the completion panel.
   * originalValues only stores undo snapshots for status==="filled".
   * status: pending | filled | already_completed | skipped | failed | undone
   */
  const fieldResults = new Map(); // selector -> FieldResult
  // Undo snapshots for successfully filled fields only
  const originalValues = new Map(); // selector -> { originalValue, label, value, confidence, action }
  let overlayMode = 'status'; // status | compact | expanded

  function setFieldResult(selector, partial) {
    const prev = fieldResults.get(selector) || {};
    fieldResults.set(selector, {
      selector,
      label: partial.label ?? prev.label ?? '',
      proposedValue: partial.proposedValue ?? prev.proposedValue ?? '',
      originalValue: partial.originalValue ?? prev.originalValue ?? '',
      status: partial.status ?? prev.status ?? 'pending',
      reason: partial.reason ?? prev.reason ?? '',
      confidence: partial.confidence ?? prev.confidence ?? 1,
      action: partial.action ?? prev.action ?? '',
    });
  }

  const PLACEHOLDER_VALUES = new Set([
    '', 'select', 'select one', 'select an option', 'choose', 'choose one',
    '--', '—', 'n/a', 'na', 'none', 'please select',
  ]);

  function isEffectivelyEmpty(value) {
    const v = String(value ?? '').trim().toLowerCase();
    return !v || PLACEHOLDER_VALUES.has(v);
  }

  function getCurrentFieldValue(el) {
    if (!el) return '';
    const type = (el.type || '').toLowerCase();
    // Radios/checkboxes always have a value attribute; "filled" means selected.
    if (type === 'radio' || type === 'checkbox') {
      return el.checked ? String(el.value || 'on') : '';
    }
    if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true') {
      return (el.textContent || '').trim();
    }
    // Custom Workday-style button dropdowns: use visible text only if it looks selected
    if (el.tagName === 'BUTTON' && el.getAttribute('aria-haspopup')) {
      return (el.textContent || '').trim();
    }
    return el.value || '';
  }

  function isSubmitControl(el) {
    if (!el || !el.tagName) return false;
    const tag = el.tagName.toLowerCase();
    const type = (el.getAttribute('type') || '').toLowerCase();
    const text = (el.textContent || el.value || '').trim().toLowerCase();
    if (type === 'submit') return true;
    if (tag === 'button' && type === 'submit') return true;
    if (/(^|\s)submit(\s|$)/.test(text) && /application|apply|form/.test(text)) return true;
    if (text === 'submit application' || text === 'submit your application') return true;
    return false;
  }

  async function loadSafetySettings() {
    // Tests control flags via __jaAutofillTestAPI; avoid async storage races.
    if (typeof window !== 'undefined' && window.__jaAutofillTest) {
      return;
    }
    try {
      const stored = await chrome.storage.local.get([
        'overwriteExistingFields',
        'enableJobBoardOverlay',
        'enableQueueFill',
        'debugAutofill',
      ]);
      overwriteExistingFields = !!stored.overwriteExistingFields;
      enableJobBoardOverlay = !!stored.enableJobBoardOverlay;
      enableQueueFill = !!stored.enableQueueFill;
      debugAutofill = !!stored.debugAutofill;
    } catch {
      // Defaults already set
    }
  }

  // Load once in production; tests set flags explicitly.
  if (!(typeof window !== 'undefined' && window.__jaAutofillTest)) {
    try { loadSafetySettings(); } catch { /* ignore */ }
  }

  // ─── History interceptor (single patch, multiple callbacks) ──

  const historyCallbacks = { pushState: new Set(), replaceState: new Set() };
  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;

  history.pushState = function (...args) {
    origPushState.apply(this, args);
    for (const cb of historyCallbacks.pushState) cb();
  };
  history.replaceState = function (...args) {
    origReplaceState.apply(this, args);
    for (const cb of historyCallbacks.replaceState) cb();
  };

  // ─── Utilities ──────────────────────────────────────────────

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function withTimeout(promise, ms, label = 'operation') {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      ),
    ]);
  }

  // ─── Shadow DOM traversal ──────────────────────────────────

  function deepQuerySelectorAll(root, selector) {
    const results = [];
    try {
      results.push(...root.querySelectorAll(selector));
    } catch { /* skip */ }

    // Traverse shadow roots
    const walk = (node) => {
      if (node.shadowRoot) {
        try {
          results.push(...node.shadowRoot.querySelectorAll(selector));
          node.shadowRoot.querySelectorAll('*').forEach(walk);
        } catch { /* skip */ }
      }
    };

    try {
      root.querySelectorAll('*').forEach(walk);
    } catch { /* skip */ }
    return results;
  }

  function deepQuerySelector(root, selector) {
    try {
      const direct = root.querySelector(selector);
      if (direct) return direct;
    } catch { /* skip */ }

    // Search shadow roots
    const walk = (node) => {
      if (node.shadowRoot) {
        try {
          const found = node.shadowRoot.querySelector(selector);
          if (found) return found;
          for (const child of node.shadowRoot.querySelectorAll('*')) {
            const result = walk(child);
            if (result) return result;
          }
        } catch { /* skip */ }
      }
      return null;
    };

    try {
      for (const node of root.querySelectorAll('*')) {
        const result = walk(node);
        if (result) return result;
      }
    } catch { /* skip */ }
    return null;
  }

  // ─── Form extraction ─────────────────────────────────────────

  function findLabel(el) {
    try {
      const type = (el.type || '').toLowerCase();
      const isOptionControl = type === 'checkbox' || type === 'radio';
      const questionCard = el.closest?.(
        'li.application-question, .application-question, li.custom-question, .custom-question'
      );

      // 0a. Checkbox/radio options: use the nearest option label text — NEVER the
      // group .application-label (that made every Lever language read as the heading).
      if (isOptionControl) {
        const parentLabel = el.closest('label');
        if (parentLabel && (!questionCard || !parentLabel.querySelector('.application-label'))) {
          const clone = parentLabel.cloneNode(true);
          clone.querySelectorAll('input, select, textarea').forEach((c) => c.remove());
          const text = clone.textContent.trim().replace(/\s+/g, ' ');
          if (text && text.length < 200) return text;
        }
        // Sibling text next to the input (common Lever pattern)
        let sib = el.nextSibling;
        while (sib) {
          if (sib.nodeType === Node.TEXT_NODE && sib.textContent.trim()) {
            return sib.textContent.trim().replace(/\s+/g, ' ');
          }
          if (sib.nodeType === Node.ELEMENT_NODE) {
            const t = (sib.textContent || '').trim().replace(/\s+/g, ' ');
            if (t && t.length < 120 && !/✱|\*$/.test(t)) return t;
            break;
          }
          sib = sib.nextSibling;
        }
      }

      // 0b. Lever / Greenhouse question cards: prefer clean application-label for
      // the primary control only (not each checkbox in a multi-option group).
      if (questionCard && !isOptionControl) {
        const appLabel = questionCard.querySelector(
          ':scope > label .application-label, :scope > .application-label, '
          + ':scope > label > div.application-label, .application-label'
        );
        if (appLabel) {
          const t = (appLabel.textContent || '').trim().replace(/\s+/g, ' ');
          const cleaned = t.replace(/[✱*]\s*$/, '').trim();
          if (cleaned && cleaned.length < 200) return cleaned;
        }
      }

      // 1. Explicit <label for="">
      if (el.id) {
        const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (label) {
          // Prefer nested .application-label over the whole label blob
          const nested = label.querySelector('.application-label');
          if (nested && !isOptionControl) {
            const t = (nested.textContent || '').trim().replace(/\s+/g, ' ');
            if (t) return t.replace(/[✱*]\s*$/, '').trim();
          }
          const clone = label.cloneNode(true);
          clone.querySelectorAll('input, select, textarea').forEach((c) => c.remove());
          return clone.textContent.trim().replace(/\s+/g, ' ');
        }
      }

      // 2. aria-labelledby
      const labelledBy = el.getAttribute('aria-labelledby');
      if (labelledBy) {
        const parts = labelledBy.split(/\s+/).map(id => {
          const ref = document.getElementById(id);
          return ref ? ref.textContent.trim() : '';
        }).filter(Boolean);
        if (parts.length) return parts.join(' ');
      }

      // 3. aria-label
      const ariaLabel = el.getAttribute('aria-label');
      if (ariaLabel) return ariaLabel.trim();

      // 4. Parent label
      const parentLabel = el.closest('label');
      if (parentLabel) {
        const nested = parentLabel.querySelector('.application-label');
        if (nested && !isOptionControl) {
          const t = (nested.textContent || '').trim().replace(/\s+/g, ' ');
          if (t) return t.replace(/[✱*]\s*$/, '').trim();
        }
        const clone = parentLabel.cloneNode(true);
        clone.querySelectorAll('input, select, textarea, .dropdown-results, .dropdown-no-results, .dropdown-loading-results').forEach(c => c.remove());
        const text = clone.textContent.trim().replace(/\s+/g, ' ');
        if (text) return text;
      }

      // 5. Preceding sibling or nearby text
      const prev = el.previousElementSibling;
      if (prev && (prev.tagName === 'LABEL' || prev.tagName === 'SPAN' || prev.tagName === 'DIV')) {
        const text = prev.textContent.trim();
        if (text && text.length < 200) return text;
      }

      // 6. Google Forms: walk up to question container and find the title
      // Google Forms nests inputs inside [data-params] containers with [role="heading"] titles
      let ancestor = el.parentElement;
      for (let i = 0; i < 15 && ancestor; i++) {
        if (ancestor.hasAttribute('data-params') || ancestor.classList.contains('freebirdFormviewerComponentsQuestionBaseRoot')) {
          const heading = ancestor.querySelector('[role="heading"], .freebirdFormviewerComponentsQuestionBaseTitle');
          if (heading) return heading.textContent.trim();
        }
        ancestor = ancestor.parentElement;
      }

      // 7. Generic: walk up looking for a heading-like element near a form field container
      ancestor = el.parentElement;
      for (let i = 0; i < 8 && ancestor; i++) {
        const heading = ancestor.querySelector('[role="heading"], legend, h3, h4');
        if (heading) {
          const inputs = ancestor.querySelectorAll('input, select, textarea, [role="checkbox"], [role="radio"]');
          if (inputs.length <= 10) return heading.textContent.trim();
        }
        ancestor = ancestor.parentElement;
      }

      return '';
    } catch {
      return '';
    }
  }

  function getNearbyHeading(el) {
    try {
      // Prefer the fieldset legend that actually wraps this control.
      const fieldset = el.closest('fieldset');
      if (fieldset) {
        const legend = fieldset.querySelector(':scope > legend');
        if (legend?.textContent) return legend.textContent.trim().slice(0, 200);
      }

      // Walk previous siblings (and parents' previous siblings) for a heading.
      // Do NOT use parent.querySelector('h1...') — that returns the first heading
      // in a huge form subtree (often "Phone"), poisoning every later field.
      let node = el;
      for (let depth = 0; depth < 8 && node; depth++) {
        let sib = node.previousElementSibling;
        while (sib) {
          if (/^H[1-6]$/i.test(sib.tagName) || sib.tagName === 'LEGEND') {
            const text = sib.textContent?.trim();
            if (text) return text.slice(0, 200);
          }
          // Header-only sibling containers (no nested inputs)
          if (sib.querySelector && !sib.querySelector('input, select, textarea, [contenteditable="true"]')) {
            const inner = sib.querySelector('h1, h2, h3, h4, h5, h6, legend');
            const text = inner?.textContent?.trim();
            if (text) return text.slice(0, 200);
          }
          sib = sib.previousElementSibling;
        }
        node = node.parentElement;
      }
      return '';
    } catch {
      return '';
    }
  }

  function getSelectOptions(el) {
    try {
      return Array.from(el.options).map(opt => ({
        value: opt.value,
        text: opt.textContent.trim(),
      }));
    } catch {
      return [];
    }
  }

  function getRadioCheckboxGroup(el) {
    try {
      const name = el.getAttribute('name');
      if (!name) return [];
      const group = document.querySelectorAll(`input[name="${CSS.escape(name)}"]`);
      return Array.from(group).map(inp => ({
        value: inp.value,
        label: findLabel(inp) || inp.value,
        checked: inp.checked,
      }));
    } catch {
      return [];
    }
  }

  function cssAttrValue(value) {
    // Quote attribute values safely. Do NOT use CSS.escape inside quotes —
    // that is for identifiers and can break names like urls[LinkedIn].
    return String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  function buildSelector(el) {
    try {
      if (el.id) return `#${CSS.escape(el.id)}`;
      if (el.name) {
        const tag = el.tagName.toLowerCase();
        const type = el.type ? `[type="${cssAttrValue(el.type)}"]` : '';
        const sel = `${tag}[name="${cssAttrValue(el.name)}"]${type}`;
        if (document.querySelectorAll(sel).length === 1) return sel;
      }
      // Fallback: build a path
      const parts = [];
      let cur = el;
      while (cur && cur !== document.body) {
        let seg = cur.tagName.toLowerCase();
        if (cur.id) {
          seg = `#${CSS.escape(cur.id)}`;
          parts.unshift(seg);
          break;
        }
        const parent = cur.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(c => c.tagName === cur.tagName);
          if (siblings.length > 1) {
            const idx = siblings.indexOf(cur) + 1;
            seg += `:nth-of-type(${idx})`;
          }
        }
        parts.unshift(seg);
        cur = parent;
      }
      return parts.join(' > ');
    } catch {
      return '';
    }
  }

  function extractFormData(formRoot) {
    const root = formRoot || document;
    const fields = [];
    const seen = new Set();

    const selectors = 'input, select, textarea, [contenteditable="true"], [role="combobox"], [role="textbox"], [role="spinbutton"], [role="checkbox"], [role="radio"], button[aria-haspopup], [role="button"][aria-haspopup], [data-automation-id][aria-haspopup], [data-automation-id*="select"], [data-automation-id*="dropdown"], [data-automation-id*="stateProvince"], [data-automation-id*="countryRegion"]';

    // Search both light DOM and shadow DOM
    const elements = deepQuerySelectorAll(root, selectors);

    // Also check iframes we can access
    try {
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        try {
          const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iDoc) elements.push(...deepQuerySelectorAll(iDoc, selectors));
        } catch { /* cross-origin, skip */ }
      }
    } catch { /* skip */ }

    for (const el of elements) {
      try {
        const type = (el.type || '').toLowerCase();
        if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'image') {
          // Don't skip dropdown trigger elements (e.g., Workday button dropdowns)
          if (!el.hasAttribute('aria-haspopup')) continue;
        }
        if (el.disabled) continue;

        // Skip our own overlay/badge elements
        if (el.closest(`#${PREFIX}-overlay`) || el.closest(`#${PREFIX}-learn-prompt`) || el.closest('.ja-auto-badge')) continue;

        const selector = buildSelector(el);
        if (!selector || seen.has(selector)) continue;
        seen.add(selector);

        // For radio/checkbox groups, only process once per name
        if ((type === 'radio' || type === 'checkbox') && el.name) {
          const groupKey = `group:${el.name}`;
          if (seen.has(groupKey)) continue;
          seen.add(groupKey);
        }

        const field = {
          selector,
          tag: el.tagName.toLowerCase(),
          type: type || null,
          name: el.name || null,
          id: el.id || null,
          placeholder: el.placeholder || null,
          label: findLabel(el),
          nearbyHeading: getNearbyHeading(el),
          required: el.required || el.getAttribute('aria-required') === 'true',
          // Radios/checkboxes: use checked state, not the value attribute ("on").
          currentValue: getCurrentFieldValue(el),
          isContentEditable: el.isContentEditable && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA',
          role: el.getAttribute('role') || null,
        };

        if (el.tagName === 'SELECT') {
          field.options = getSelectOptions(el);
        } else if (type === 'radio' || type === 'checkbox') {
          field.options = getRadioCheckboxGroup(el);
        }

        fields.push(field);
      } catch {
        // Skip problematic elements
      }
    }

    return fields;
  }

  // ─── Post-extraction field enrichment ──────────────────────────

  function findSharedPhoneComponent(el) {
    if (!el || !el.closest) return null;
    let node = el.parentElement;
    while (node && node !== document.body) {
      let phoneInput = null;
      try {
        phoneInput = node.querySelector(
          'input[type="tel"], input[name*="phone" i]:not([name*="country" i]), input[id*="phone" i]:not([id*="country" i])'
        );
      } catch {
        // Older engines without case-insensitive attribute selectors
        phoneInput = node.querySelector('input[type="tel"]');
        if (!phoneInput) {
          for (const inp of node.querySelectorAll('input')) {
            const n = `${inp.name || ''} ${inp.id || ''}`.toLowerCase();
            if (/\bphone\b|\bmobile\b|\btel\b/.test(n) && !/country|code|ext/.test(n)) {
              phoneInput = inp;
              break;
            }
          }
        }
      }
      if (phoneInput && phoneInput !== el) {
        const controlCount = node.querySelectorAll(
          'input:not([type="hidden"]), select, textarea, [role="combobox"], button[aria-haspopup]'
        ).length;
        // Bounded phone widget (country + number), not the whole application form.
        if (controlCount > 0 && controlCount <= 8) return node;
      }
      node = node.parentElement;
    }
    return null;
  }

  function isSelectCountryInPhoneWidget(el) {
    if (!el) return false;
    try {
      const hints = getFieldHints(el);
      const aria = el.getAttribute('aria-label') || '';
      const text = `${hints.label} ${hints.name} ${hints.id} ${hints.placeholder} ${aria} ${(el.textContent || '').slice(0, 80)}`.toLowerCase();
      const looksCountry = /\bcountry\b|select country|country code|dial code/i.test(text);
      if (!looksCountry) return false;
      // Address-country fields live outside the phone widget.
      if (/address|mailing|billing|residence|location/i.test(text) && !/phone|dial|mobile|tel/i.test(text)) {
        return false;
      }
      return !!findSharedPhoneComponent(el);
    } catch {
      return false;
    }
  }

  function enrichFieldHints(fields) {
    for (const field of fields) {
      // Detect country code selects by dial-code options like "(+1)", "(+44)"
      if (field.tag === 'select' && field.options?.length > 5) {
        const dialCodeCount = field.options.filter(o =>
          /\(\+\d{1,4}\)/.test(o.text || o.value || '')
        ).length;
        if (dialCodeCount > 5 && !/country.?code/i.test(`${field.label} ${field.name} ${field.id}`)) {
          field.label = field.label ? `${field.label} (phone country code)` : 'phone country code';
          field.fieldKind = 'phone_country';
          field.atsHint = 'phone_country';
        }
      }

      // Greenhouse React phone widget: custom control labeled only "Select country"
      // sitting next to the phone input — classify by component ownership.
      if (!field.fieldKind) {
        try {
          const el = resolveElement(field.selector);
          if (el && (isPhoneCountryCodeField(el) || isSelectCountryInPhoneWidget(el))) {
            field.fieldKind = 'phone_country';
            field.atsHint = 'phone_country';
            if (!/phone.?country|country.?code/i.test(field.label || '')) {
              field.label = field.label
                ? `${field.label} (phone country code)`
                : 'phone country code';
            }
          }
        } catch { /* skip */ }
      }
    }
    return fields;
  }

  // ─── Form HTML serialization ──────────────────────────────────

  function serializeFormHtml() {
    try {
      const clone = document.body.cloneNode(true);

      // Remove noisy elements
      const removeSelectors = 'script, style, img, svg, iframe, video, audio, canvas, noscript, link, meta';
      clone.querySelectorAll(removeSelectors).forEach(el => el.remove());

      // Remove data attributes and inline styles
      const allEls = clone.querySelectorAll('*');
      for (const el of allEls) {
        const attrs = Array.from(el.attributes);
        for (const attr of attrs) {
          if (attr.name.startsWith('data-') || attr.name === 'style' || attr.name === 'onclick'
              || attr.name === 'onchange' || attr.name === 'onsubmit') {
            el.removeAttribute(attr.name);
          }
        }
      }

      // Only keep form-relevant sections
      const forms = clone.querySelectorAll('form, [role="form"], main, [role="main"]');
      let html;
      if (forms.length) {
        html = Array.from(forms).map(f => f.outerHTML).join('\n');
      } else {
        html = clone.innerHTML;
      }

      // Truncate to 50KB
      if (html.length > 50000) {
        html = html.slice(0, 50000);
      }

      return html;
    } catch (err) {
      return `<error>${err.message}</error>`;
    }
  }

  // ─── Element resolution ────────────────────────────────────

  function resolveElement(selector) {
    // Handle iframe selectors: "iframe:SELECTOR>>>FIELD_SELECTOR"
    if (selector.startsWith('iframe:')) {
      try {
        const parts = selector.slice(7).split('>>>');
        const iframeSelector = parts[0];
        const fieldSelector = parts[1];
        const iframe = document.querySelector(iframeSelector);
        if (!iframe) return null;
        const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
        if (!iDoc) return null;
        return iDoc.querySelector(fieldSelector);
      } catch {
        return null;
      }
    }

    // Try standard querySelector first
    try {
      const el = document.querySelector(selector);
      if (el) return el;
    } catch { /* skip */ }

    // Try shadow DOM
    try {
      const el = deepQuerySelector(document, selector);
      if (el) return el;
    } catch { /* skip */ }

    // Fallback: try finding by id/name fragments from the selector
    try {
      const idMatch = selector.match(/#([\w-]+)/);
      if (idMatch) {
        const el = document.getElementById(idMatch[1]);
        if (el) return el;
      }
      const nameMatch = selector.match(/\[name="([^"]+)"\]/);
      if (nameMatch) {
        const el = document.querySelector(`[name="${nameMatch[1]}"]`);
        if (el) return el;
      }
    } catch { /* skip */ }

    return null;
  }

  // ─── Event dispatch ────────────────────────────────────────

  function setNativeValue(el, value) {
    // React-compatible value setting
    const prototype = Object.getPrototypeOf(el);
    const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;

    if (nativeSetter) {
      nativeSetter.call(el, value);
    } else {
      el.value = value;
    }
  }

  function dispatchEvents(el, eventNames) {
    for (const name of eventNames) {
      try {
        if (name === 'input') {
          el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText' }));
        } else if (name === 'change') {
          el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
        } else if (name === 'click') {
          el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        } else if (name === 'focus') {
          el.dispatchEvent(new FocusEvent('focus', { bubbles: true }));
        } else if (name === 'blur') {
          el.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
        } else if (name === 'keydown' || name === 'keyup' || name === 'keypress') {
          el.dispatchEvent(new KeyboardEvent(name, { bubbles: true, cancelable: true }));
        }
      } catch { /* skip */ }
    }
  }

  function simulateTyping(el, value) {
    // Simulate realistic key-by-key input for frameworks that need it
    setNativeValue(el, '');
    dispatchEvents(el, ['input']);

    for (let i = 0; i < value.length; i++) {
      const char = value[i];
      try {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keypress', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true }));
      } catch { /* skip */ }
      setNativeValue(el, value.slice(0, i + 1));
      dispatchEvents(el, ['input']);
      try {
        el.dispatchEvent(new KeyboardEvent('keyup', { key: char, code: `Key${char.toUpperCase()}`, bubbles: true }));
      } catch { /* skip */ }
    }
  }

  // ─── Field hints and phone detection ────────────────────────

  function getFieldHints(el) {
    if (!el) return { label: '', name: '', id: '', placeholder: '' };
    try {
      return {
        label: findLabel(el),
        name: el.getAttribute('name') || '',
        id: el.id || '',
        placeholder: el.getAttribute('placeholder') || '',
      };
    } catch {
      return { label: '', name: '', id: '', placeholder: '' };
    }
  }

  function looksLikePhoneNumber(val) {
    if (val == null) return false;
    const s = String(val).trim();
    if (!s) return false;
    // Must be composed only of digits and phone formatting characters
    if (!/^[\d\s()+.\-/]+$/.test(s)) return false;
    const digits = s.replace(/\D/g, '');
    return digits.length >= 7 && digits.length <= 15;
  }

  function isPhoneExtensionField(el) {
    if (!el) return false;
    try {
      const hints = getFieldHints(el);
      const combined = `${hints.label} ${hints.name} ${hints.id} ${hints.placeholder}`;
      return /\bext(ension)?\b/i.test(combined);
    } catch {
      return false;
    }
  }

  function isPhoneField(el) {
    if (!el) return false;
    try {
      // Phone extension fields are NOT phone number fields
      if (isPhoneExtensionField(el)) return false;
      // Phone country code fields are NOT phone number fields
      if (isPhoneCountryCodeField(el)) return false;
      if ((el.type || '').toLowerCase() === 'tel') return true;
      const hints = getFieldHints(el);
      const combined = `${hints.label} ${hints.name} ${hints.id} ${hints.placeholder}`;
      // SMS/opt-in checkboxes are not phone number fields (Workday phone-sms-opt-in).
      if (/sms|opt[-_]?in|text\s*me|marketing|consent/i.test(combined)) return false;
      return /phone|tel|mobile|cell/i.test(combined);
    } catch {
      return false;
    }
  }

  function isPhoneCountryCodeField(el) {
    if (!el) return false;
    try {
      const hints = getFieldHints(el);
      const combined = `${hints.label} ${hints.name} ${hints.id} ${hints.placeholder}`;
      if (/country.?(?:phone|code)|phone.?country|dial.?code|calling.?code|countryPhoneCode|country.?iso/i.test(combined)) {
        return true;
      }
      // Custom Greenhouse control: "Select country" owned by the phone widget.
      return isSelectCountryInPhoneWidget(el);
    } catch {
      return false;
    }
  }

  function hasNearbyPhoneCountryCode(el) {
    // Check if there's a phone country code dropdown near this phone field
    try {
      const container = el.closest('fieldset, [data-automation-id*="phone"], [class*="phone"], section, .form-group, .field-group, #app_form, #application_form, #grnhse_app') || el.parentElement?.parentElement?.parentElement?.parentElement?.parentElement;
      if (!container) return false;
      const candidates = container.querySelectorAll('select, [role="combobox"], [role="listbox"], [aria-haspopup], button[aria-haspopup]');
      for (const c of candidates) {
        if (isPhoneCountryCodeField(c)) return true;
      }
      // Also check for Workday-specific phone code dropdown
      if (container.querySelector('[data-automation-id="countryPhoneCode"]')) return true;
    } catch { /* skip */ }
    return false;
  }

  // ─── Dropdown / listbox detection ──────────────────────────

  function extractDialCode(value) {
    if (value == null) return null;
    const s = String(value);
    const paren = s.match(/\(\s*\+(\d{1,4})\s*\)/);
    if (paren) return paren[1];
    const bare = s.trim().match(/^\+?(\d{1,4})$/);
    return bare ? bare[1] : null;
  }

  function hintsLookLikePhoneCountry(fieldHints) {
    const hints = fieldHints || {};
    const combined = `${hints.label || ''} ${hints.name || ''} ${hints.id || ''} ${hints.placeholder || ''}`;
    return /phone.?country|country.?phone|country.?code|dial.?code|calling.?code|countryPhoneCode/i.test(combined);
  }

  /**
   * Score phone-country / dial-code options. Prevents "+1" from matching
   * Albania (+355) or Algeria (+213) via naive digit substring checks.
   */
  function matchPhoneCountryCodeOption(options, targetValue) {
    if (!options?.length || targetValue == null) return -1;
    const target = String(targetValue).toLowerCase().trim();
    const dial = extractDialCode(targetValue);
    const countryName = target.replace(/\s*\(\s*\+\d{1,4}\s*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();

    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < options.length; i++) {
      const text = String(options[i].text || '').toLowerCase().trim();
      const value = String(options[i].value || '').toLowerCase().trim();
      if (!text && !value) continue;
      let score = 0;
      if (text === target || value === target) score = 100;
      else if (countryName && (text === countryName || text.startsWith(`${countryName} `) || text.includes(countryName))) score = 85;
      if (dial) {
        const dialRe = new RegExp(`\\(\\s*\\+${dial}\\s*\\)`);
        const exactDial = new RegExp(`^\\+?${dial}$`);
        if (dialRe.test(text) || exactDial.test(text) || exactDial.test(value)) {
          score = Math.max(score, 60);
          if (countryName && countryName.split(/\s+/).some(p => p.length > 2 && text.includes(p))) {
            score = Math.max(score, 92);
          }
        }
        if (dial === '1' && /\bunited states\b|\busa\b|\bu\.s\.a?\b/.test(text)) {
          score = Math.max(score, 96);
        }
      }
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    return bestScore >= 60 ? bestIdx : -1;
  }

  function fuzzyMatchOption(options, targetValue, fieldHints) {
    if (!options || !options.length) return -1;
    const target = targetValue.toLowerCase().trim();

    if (hintsLookLikePhoneCountry(fieldHints) || extractDialCode(targetValue)) {
      const phoneIdx = matchPhoneCountryCodeOption(options, targetValue);
      if (phoneIdx >= 0) return phoneIdx;
      // For dial-code targets, do not fall through to naive "1" ⊆ "213" matching.
      if (/^\+?\d{1,4}$/.test(String(targetValue).trim()) || hintsLookLikePhoneCountry(fieldHints)) {
        return -1;
      }
    }

    // Pass 1: exact match on value
    for (let i = 0; i < options.length; i++) {
      if (options[i].value.toLowerCase() === target) return i;
    }
    // Pass 2: exact match on text
    for (let i = 0; i < options.length; i++) {
      if (options[i].text.toLowerCase().trim() === target) return i;
    }

    // Pass 3: normalization via lookup tables
    if (window.__jaNormalize) {
      try {
        const norm = window.__jaNormalize;
        const hints = fieldHints || {};
        const hintValues = [hints.label, hints.name, hints.id, hints.placeholder].filter(Boolean);
        const tables = norm.detectFieldCategory(hintValues);

        // Try normalizedMatch against option text values
        const optionTexts = options.map(o => o.text.trim());
        const normIdx = norm.normalizedMatch(optionTexts, targetValue, tables.length ? tables : undefined);
        if (normIdx >= 0) return normIdx;

        // Try normalizedMatch against option value attributes
        const optionValues = options.map(o => o.value);
        const normValIdx = norm.normalizedMatch(optionValues, targetValue, tables.length ? tables : undefined);
        if (normValIdx >= 0) return normValIdx;

        // Boolean equivalence (yes/true/1, no/false/0)
        const boolIdx = norm.normalizedMatch(optionTexts, targetValue, [norm.BOOLEAN_YES_NO]);
        if (boolIdx >= 0) return boolIdx;
        const boolValIdx = norm.normalizedMatch(optionValues, targetValue, [norm.BOOLEAN_YES_NO]);
        if (boolValIdx >= 0) return boolValIdx;
      } catch { /* normalization unavailable, continue */ }
    }

    // Pass 4: contains / substring match (reject tiny tokens like "1"/"us")
    if (target.length >= 3) {
      for (let i = 0; i < options.length; i++) {
        const optVal = options[i].value.toLowerCase();
        const optText = options[i].text.toLowerCase().trim();
        if (optVal.length >= 3 && (optVal.includes(target) || target.includes(optVal))) return i;
        if (optText.length >= 3 && (optText.includes(target) || target.includes(optText))) return i;
      }
    }
    return -1;
  }

  function dismissOpenDropdowns() {
    // Close any stale dropdowns from previous field fills
    const dropdownSelectors = [
      '[role="listbox"]',
      '.autocomplete-results',
      '.autocomplete-dropdown',
      '.suggestions',
      '.tt-menu',
      '.select2-results__options',
      '[class*="MenuList"]',
      '[class*="menu-list"]',
    ];

    for (const sel of dropdownSelectors) {
      try {
        const dropdowns = document.querySelectorAll(sel);
        for (const dd of dropdowns) {
          if (dd.offsetParent !== null && dd.children.length > 0) {
            // Press Escape to close it
            document.activeElement?.dispatchEvent(
              new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })
            );
            // Also click the body to dismiss
            document.body.click();
            return;
          }
        }
      } catch { /* skip */ }
    }
  }

  function isElementVisible(el) {
    if (!el) return false;
    try {
      // Check offsetParent (null for hidden elements, but also null for position:fixed)
      if (el.offsetParent === null) {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (style.position !== 'fixed' && style.position !== 'sticky') return false;
      }
      if (el.offsetHeight === 0 && el.offsetWidth === 0) return false;
      return true;
    } catch {
      return false;
    }
  }

  function findTypeaheadDropdown(el, options = {}) {
    const searchSelectors = [
      '[role="listbox"]',
      '[role="option"]',
      '.autocomplete-results',
      '.autocomplete-dropdown',
      '.suggestions',
      '.tt-menu',
      '.select2-results',
      '.css-1nmdiq5-menu',
      '[class*="menu-list"]',
      '[class*="MenuList"]',
      '[class*="listbox"]',
      '[class*="dropdown"] ul',
      '[class*="suggestion"]',
      '[class*="typeahead"]',
      '[class*="autocomplete"]',
      'ul[id*="listbox"]',
      'ul[id*="options"]',
      'div[id*="listbox"]',
      'datalist',
    ];

    // Check aria-owns / aria-controls on the input first
    for (const attr of ['aria-owns', 'aria-controls', 'aria-activedescendant', 'list']) {
      const refId = el.getAttribute(attr);
      if (refId) {
        const ref = document.getElementById(refId);
        if (ref && isElementVisible(ref)) return ref;
      }
    }

    // Search near the input (parent containers, then document-wide)
    let container = el.parentElement;
    for (let depth = 0; depth < 8 && container; depth++) {
      for (const sel of searchSelectors) {
        try {
          const found = container.querySelector(sel);
          if (found && isElementVisible(found) && found !== el) return found;
        } catch { /* invalid selector, skip */ }
      }
      container = container.parentElement;
    }

    // Document-wide search helps Workday portals, but is unsafe for phone-country
    // widgets (virtualized lists often show Albania first). Callers can pass
    // { allowDocumentWide: false } to disable.
    if (options.allowDocumentWide !== false) {
      for (const sel of searchSelectors) {
        try {
          const all = document.querySelectorAll(sel);
          for (const node of all) {
            if (isElementVisible(node) && node !== el) return node;
          }
        } catch { /* skip */ }
      }

      try {
        const shadowDropdowns = deepQuerySelectorAll(document, '[role="listbox"], [role="option"]');
        for (const node of shadowDropdowns) {
          if (isElementVisible(node)) return node;
        }
      } catch { /* skip */ }
    }

    return null;
  }

  function getDropdownOptions(dropdownEl) {
    const optionSelectors = [
      '[role="option"]',
      '[data-automation-id="promptOption"]',
      '[data-automation-id="menuItem"]',
      'li:not([role="presentation"])',
      '[class*="option"]',
      '[class*="item"]:not([class*="menu-item"])',
      '[class*="suggestion"]',
      '[class*="result"]',
    ];

    for (const sel of optionSelectors) {
      try {
        const options = dropdownEl.querySelectorAll(sel);
        if (options.length > 0) {
          const visible = Array.from(options).filter(o => isElementVisible(o) || o.offsetHeight > 0);
          if (visible.length > 0) return visible;
        }
      } catch { /* skip */ }
    }

    // Fallback: direct children that look clickable
    const children = Array.from(dropdownEl.children).filter(c =>
      c.offsetHeight > 0 && c.tagName !== 'STYLE' && c.tagName !== 'SCRIPT'
    );
    if (children.length > 0) return children;

    return [];
  }

  function fuzzyMatchDropdownOption(options, targetValue, fieldHints) {
    if (!options.length) return null;
    const target = targetValue.toLowerCase().trim();

    if (hintsLookLikePhoneCountry(fieldHints) || extractDialCode(targetValue)) {
      const mapped = options.map(o => ({ text: o.textContent.trim(), value: o.getAttribute?.('data-value') || o.value || '' }));
      const phoneIdx = matchPhoneCountryCodeOption(mapped, targetValue);
      if (phoneIdx >= 0) return options[phoneIdx];
      if (/^\+?\d{1,4}$/.test(String(targetValue).trim()) || hintsLookLikePhoneCountry(fieldHints)) {
        return null;
      }
    }

    // Pass 1: Exact text match
    for (const opt of options) {
      if (opt.textContent.trim().toLowerCase() === target) return opt;
    }

    // Pass 2: Text starts with target
    for (const opt of options) {
      if (opt.textContent.trim().toLowerCase().startsWith(target)) return opt;
    }

    // Pass 2b: Target starts with option text (ignore tiny tokens like "a"/"1")
    for (const opt of options) {
      const text = opt.textContent.trim().toLowerCase();
      if (text.length < 3 || target.length < 3) continue;
      if (text.startsWith(target) || target.startsWith(text)) return opt;
    }

    // Pass 3: Normalization via lookup tables
    if (window.__jaNormalize) {
      try {
        const norm = window.__jaNormalize;
        const hints = fieldHints || {};
        const hintValues = [hints.label, hints.name, hints.id, hints.placeholder].filter(Boolean);
        const tables = norm.detectFieldCategory(hintValues);

        const optionTexts = options.map(o => o.textContent.trim());
        const normIdx = norm.normalizedMatch(optionTexts, targetValue, tables.length ? tables : undefined);
        if (normIdx >= 0) return options[normIdx];

        // Boolean equivalence
        const boolIdx = norm.normalizedMatch(optionTexts, targetValue, [norm.BOOLEAN_YES_NO]);
        if (boolIdx >= 0) return options[boolIdx];
      } catch { /* normalization unavailable, continue */ }
    }

    // Pass 4: Contains match (reject tiny tokens)
    if (target.length >= 3) {
      for (const opt of options) {
        const text = opt.textContent.trim().toLowerCase();
        if (text.length < 3) continue;
        if (text.includes(target) || target.includes(text)) return opt;
      }
    }

    // Pass 5: Word-level overlap (for "Animas, Hidalgo, NM" matching "Animas")
    const targetWords = target.split(/[\s,]+/).filter(w => w.length >= 3);
    let bestMatch = null;
    let bestScore = 0;
    for (const opt of options) {
      const text = opt.textContent.trim().toLowerCase();
      const words = text.split(/[\s,]+/).filter(w => w.length >= 3);
      let score = 0;
      for (const tw of targetWords) {
        if (words.some(w => w.startsWith(tw) || tw.startsWith(w))) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestMatch = opt;
      }
    }
    if (bestMatch && bestScore > 0) return bestMatch;

    // Selecting the only currently visible option is unsafe for virtualized
    // phone-country lists (Albania may be the sole rendered row).
    if (options.length === 1 && !hintsLookLikePhoneCountry(fieldHints)) {
      return options[0];
    }

    return null;
  }

  // ─── Custom (click-to-open) dropdown handling ──────────────

  function isCustomDropdownTrigger(el) {
    // Detect elements that are styled as dropdowns but aren't native <select>
    const role = el.getAttribute('role');
    if (role === 'combobox' || role === 'listbox') return true;

    const ariaHaspopup = el.getAttribute('aria-haspopup');
    if (ariaHaspopup === 'listbox' || ariaHaspopup === 'true' || ariaHaspopup === 'menu') return true;

    const ariaExpanded = el.getAttribute('aria-expanded');
    if (ariaExpanded !== null) return true;

    // Workday prompt buttons often expose only data-automation-id (no role/haspopup).
    const autoId = (el.getAttribute?.('data-automation-id') || '').toLowerCase();
    if (/stateprovince|countryregion|dropdown|multiselect|prompt/.test(autoId)) return true;

    // Check for common custom dropdown class patterns
    const className = (el.className || '').toString().toLowerCase();
    if (/select|dropdown|combobox|picker/.test(className)) return true;

    return false;
  }

  function findWorkdayDropdownTrigger(el) {
    if (!el) return el;
    if (el.matches?.('button, [role="button"], [role="combobox"], [aria-haspopup]')) return el;
    try {
      const nested = el.querySelector?.(
        'button[aria-haspopup], button[aria-expanded], [role="combobox"], button[data-automation-id], [data-automation-id][aria-haspopup]',
      );
      if (nested) return nested;
    } catch { /* skip */ }
    return el;
  }

  function controlDisplaysValue(el, value) {
    if (!el || value == null) return false;
    const target = String(value).toLowerCase().trim();
    if (!target || /^(select|select one|choose|choose one|--)$/i.test(target)) return false;
    const hay = `${el.textContent || ''} ${el.value || ''} ${el.getAttribute?.('aria-label') || ''} ${el.getAttribute?.('aria-valuetext') || ''}`.toLowerCase();
    if (hay.includes(target)) return true;
    // "MI" ↔ "Michigan" via normalize tables when available
    if (window.__jaNormalize) {
      try {
        const idx = window.__jaNormalize.normalizedMatch(
          [hay],
          value,
          [window.__jaNormalize.US_STATES, window.__jaNormalize.CA_PROVINCES],
        );
        if (idx >= 0) return true;
      } catch { /* skip */ }
    }
    return false;
  }

  function collectPromptOptions(excludeVisibleSet) {
    const found = [];
    try {
      for (const opt of document.querySelectorAll('[role="option"], [data-automation-id="promptOption"]')) {
        if (excludeVisibleSet?.has(opt)) continue;
        if (isElementVisible(opt) || opt.offsetHeight > 0) found.push(opt);
      }
    } catch { /* skip */ }
    return found;
  }

  async function handleCustomDropdown(el, value, fieldHints) {
    // Pre-normalize the target value via the lookup tables (e.g., "CA" → "California").
    // Workday state dropdowns ship a `searchBox` that filters option text — typing the
    // canonical full name yields the correct single match; typing "CA" matches
    // California, North Carolina, and South Carolina.
    const trigger = findWorkdayDropdownTrigger(el);
    let effectiveValue = value;
    const autoId = (
      trigger.getAttribute?.('data-automation-id')
      || el.getAttribute?.('data-automation-id')
      || ''
    ).toLowerCase();
    if (window.__jaNormalize && fieldHints) {
      try {
        const norm = window.__jaNormalize;
        const hintValues = [
          fieldHints.label, fieldHints.name, fieldHints.id, fieldHints.placeholder, autoId,
        ].filter(Boolean);
        const tables = norm.detectFieldCategory(hintValues);
        // Workday stateProvince controls often lack a "state" label — force US_STATES.
        if (/state|province|region/.test(autoId) && !tables.includes?.(norm.US_STATES)) {
          tables.push(norm.US_STATES);
        }
        for (const t of tables) {
          const canonical = norm.normalizeValue(value, t);
          if (canonical) {
            effectiveValue = canonical.replace(/\b\w/g, c => c.toUpperCase());
            break;
          }
        }
        // Title-case full state names when normalizeValue missed (already "Michigan").
        if (effectiveValue === value && /state|province/i.test(`${hintValues.join(' ')} ${autoId}`)) {
          const asCanon = norm.normalizeValue(value, norm.US_STATES);
          if (asCanon) effectiveValue = asCanon.replace(/\b\w/g, c => c.toUpperCase());
        }
      } catch { /* skip */ }
    }

    const stateHints = {
      ...fieldHints,
      label: `${fieldHints?.label || ''} state`.trim(),
    };

    // Snapshot existing *visible* option elements BEFORE clicking, so any
    // newly-appeared (or previously-hidden) options can be treated as part of
    // the freshly-opened dropdown. Tracking options is more reliable than
    // tracking listbox containers because Workday renders its prompt popup as
    // a portal that may not have role="listbox" on the outer element.
    const preExistingOptions = new Set();
    try {
      for (const opt of document.querySelectorAll('[role="option"], [data-automation-id="promptOption"]')) {
        if (isElementVisible(opt)) preExistingOptions.add(opt);
      }
    } catch { /* skip */ }

    const isWorkday = /myworkdayjobs\.com/i.test(location.href)
      || !!autoId
      || !!el.closest?.('[data-automation-id]')
      || !!trigger.closest?.('[data-automation-id]');

    async function openDropdown() {
      try {
        trigger.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        trigger.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
      } catch { /* skip */ }
      trigger.click();
      dispatchEvents(trigger, ['click', 'focus']);
    }

    await openDropdown();

    // Wait for new options / dropdown to appear (retry with increasing delays)
    let dd = null;
    let openedOptions = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      await sleep(attempt < 2 ? 250 : isWorkday ? 400 : 300);

      openedOptions = collectPromptOptions(preExistingOptions);
      // Accept a single newly visible option (filtered lists / slow portals).
      if (openedOptions.length >= 1) {
        dd = openedOptions[0].closest('[role="listbox"], [role="menu"], [data-automation-widget*="popup"], [data-automation-widget*="prompt"]')
          || openedOptions[0].parentElement;
        if (dd) break;
      }

      // Workday often leaves the active popup marked with automation widget attrs.
      try {
        const popup = document.querySelector('[data-automation-widget*="popup"]:not([aria-hidden="true"]), [data-automation-widget*="prompt"]:not([aria-hidden="true"])');
        if (popup) {
          const opts = getDropdownOptions(popup);
          if (opts.length >= 1) { dd = popup; openedOptions = opts; break; }
        }
      } catch { /* skip */ }

      // Fallback: use findTypeaheadDropdown but prefer listboxes with multiple options.
      // Phone-country / Workday: never grab an unrelated document-wide listbox.
      const candidate = findTypeaheadDropdown(trigger, {
        allowDocumentWide: !hintsLookLikePhoneCountry(fieldHints) && !isWorkday,
      });
      if (candidate) {
        const opts = getDropdownOptions(candidate);
        if (opts.length >= 1) { dd = candidate; openedOptions = opts; break; }
      }

      // Retry opening via nested/child trigger
      if (attempt === 1 || attempt === 3) {
        const nested = el.querySelector?.(
          'button, [class*="arrow"], [class*="indicator"], [class*="toggle"], [data-automation-id*="button"]',
        );
        if (nested && nested !== trigger) nested.click();
        else await openDropdown();
      }
    }

    if (!dd) {
      closeOpenDropdowns({ gentle: isWorkday });
      return { success: false, reason: 'no dropdown appeared' };
    }

    let options = openedOptions.length ? openedOptions : getDropdownOptions(dd);
    if (!options.length) {
      closeOpenDropdowns({ gentle: isWorkday });
      return { success: false, reason: 'no options in dropdown' };
    }

    function findSearchInput() {
      // Prefer the search box inside the active popup — never a stale document-wide one.
      const inPopup = dd.querySelector('[data-automation-id="searchBox"], input:not([type="hidden"])');
      if (inPopup && (isElementVisible(inPopup) || inPopup.offsetHeight > 0)) return inPopup;
      try {
        const popup = dd.closest?.('[data-automation-widget]') || dd;
        const scoped = popup.querySelector?.('[data-automation-id="searchBox"]');
        if (scoped && (isElementVisible(scoped) || scoped.offsetHeight > 0)) return scoped;
      } catch { /* skip */ }
      return null;
    }

    async function commitOption(match) {
      const selectedText = match.textContent.trim();
      clickOption(match);
      // Workday prompts often confirm on Enter after highlight/click.
      try {
        match.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true,
        }));
      } catch { /* skip */ }

      const stuck = await waitForControlValue(
        trigger,
        [effectiveValue, selectedText, value],
        isWorkday ? 10 : 4,
        isWorkday ? 150 : 80,
      );

      // Only dismiss if the popup is still open. Aggressive Tab/outside-click
      // clears Workday state selections before they commit.
      if (promptStillOpen()) {
        closeOpenDropdowns({ gentle: isWorkday });
        if (isWorkday) {
          await waitForControlValue(trigger, [effectiveValue, selectedText, value], 4, 100);
        }
      }

      if (isWorkday && !controlDisplaysValue(trigger, effectiveValue)
          && !controlDisplaysValue(trigger, selectedText)
          && !controlDisplaysValue(el, effectiveValue)
          && !controlDisplaysValue(el, selectedText)) {
        return { success: false, reason: `selection did not stick for "${effectiveValue}"` };
      }
      if (!stuck && isWorkday) {
        // Value may still have landed on a child label after dismiss.
        if (!controlDisplaysValue(trigger, selectedText) && !controlDisplaysValue(el, selectedText)) {
          return { success: false, reason: `selection did not stick for "${effectiveValue}"` };
        }
      }
      return { success: true, selectedText };
    }

    // Try typing to filter first (for searchable dropdowns).
    const searchInput = findSearchInput();
    if (searchInput) {
      searchInput.focus();
      try {
        simulateTyping(searchInput, effectiveValue);
      } catch {
        setNativeValue(searchInput, effectiveValue);
        dispatchEvents(searchInput, ['input']);
      }
      await sleep(isWorkday ? 600 : 350);

      const filtered = collectPromptOptions(null).filter(o => isElementVisible(o) || o.offsetHeight > 0);
      const filteredOptions = filtered.length ? filtered : getDropdownOptions(dd);
      const match = fuzzyMatchDropdownOption(
        filteredOptions.length ? filteredOptions : options,
        effectiveValue,
        stateHints,
      );
      if (match) {
        const result = await commitOption(match);
        if (result.success) return result;
      } else {
        // Clear filter so the full option list is available for the fallback pass.
        try {
          simulateTyping(searchInput, '');
        } catch {
          setNativeValue(searchInput, '');
          dispatchEvents(searchInput, ['input']);
        }
        await sleep(isWorkday ? 400 : 200);
      }
    }

    // Direct option match without filtering
    options = collectPromptOptions(null).filter(o => isElementVisible(o) || o.offsetHeight > 0);
    if (!options.length) options = getDropdownOptions(dd);
    const match = fuzzyMatchDropdownOption(options, effectiveValue, stateHints);
    if (match) {
      const result = await commitOption(match);
      if (result.success) return result;
      // One reopen + retry helps when the first click raced Workday's portal.
      if (isWorkday) {
        await openDropdown();
        await sleep(500);
        const retryOpts = collectPromptOptions(null).filter(o => isElementVisible(o) || o.offsetHeight > 0);
        const retryMatch = fuzzyMatchDropdownOption(retryOpts.length ? retryOpts : getDropdownOptions(dd), effectiveValue, stateHints);
        if (retryMatch) {
          const retryResult = await commitOption(retryMatch);
          if (retryResult.success) return retryResult;
        }
      }
      return result;
    }

    closeOpenDropdowns({ gentle: isWorkday });
    return { success: false, reason: `no matching option for "${value}"` };
  }

  function clickOption(optionEl) {
    if (isSubmitControl(optionEl)) {
      console.warn('[JobApply] Refusing to click submit control');
      return;
    }
    optionEl.scrollIntoView?.({ block: 'nearest' });
    optionEl.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    optionEl.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    optionEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    optionEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    optionEl.click();
  }

  function closeOpenDropdowns(opts = {}) {
    const gentle = !!opts.gentle;
    try {
      const active = document.activeElement;
      if (!active || active === document.body) {
        if (gentle) {
          try {
            document.dispatchEvent(new KeyboardEvent('keydown', {
              key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true,
            }));
          } catch { /* skip */ }
        }
        return;
      }

      if (gentle) {
        // Workday: Tab / outside-click after option select can clear the value
        // before the prompt commits. Escape only dismisses the open popup.
        active.dispatchEvent(new KeyboardEvent('keydown', {
          key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true,
        }));
        active.dispatchEvent(new KeyboardEvent('keyup', {
          key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true,
        }));
        return;
      }

      // Strategy 1: Tab away — this is what real users do to dismiss dropdowns.
      // Frameworks (React, Angular, Workday) handle Tab to close dropdowns and move focus.
      active.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true, cancelable: true }));
      active.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', code: 'Tab', keyCode: 9, which: 9, bubbles: true, cancelable: true }));

      // Strategy 2: Pointer events (React 17+ uses pointer events, not mouse events)
      // Click outside the dropdown at a neutral position
      const neutralEl = document.querySelector('h1, h2, h3, [role="heading"], header, main') || document.body;
      const rect = neutralEl.getBoundingClientRect?.() || { left: 0, top: 0 };
      const x = rect.left + 5;
      const y = rect.top + 5;
      for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
        neutralEl.dispatchEvent(new PointerEvent(type, {
          bubbles: true, cancelable: true, composed: true,
          clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse',
        }));
      }

      // Strategy 3: Blur active element
      active.blur();
    } catch { /* ignore errors in test/headless environments */ }
  }

  function promptStillOpen() {
    try {
      const opts = collectPromptOptions(null).filter(o => isElementVisible(o));
      if (opts.length >= 1) return true;
      return !!document.querySelector(
        '[data-automation-widget*="popup"]:not([aria-hidden="true"]), [data-automation-widget*="prompt"]:not([aria-hidden="true"])',
      );
    } catch {
      return false;
    }
  }

  async function waitForControlValue(el, values, attempts = 8, delayMs = 120) {
    const targets = (Array.isArray(values) ? values : [values]).filter(Boolean);
    for (let i = 0; i < attempts; i++) {
      if (targets.some(v => controlDisplaysValue(el, v))) return true;
      await sleep(delayMs);
    }
    return targets.some(v => controlDisplaysValue(el, v));
  }

  // ─── Typeahead handling ────────────────────────────────────

  async function typeAndSelectDropdown(el, value, fieldHints) {
    // Clear existing value first
    setNativeValue(el, '');
    dispatchEvents(el, ['input']);
    await sleep(50);

    // Type the value — use simulated typing for better framework compat
    simulateTyping(el, value);

    // Wait for dropdown to appear (check multiple times with increasing delay)
    for (let wait = 0; wait < 6; wait++) {
      await sleep(wait < 3 ? 200 : 400);

      const dropdown = findTypeaheadDropdown(el);
      if (!dropdown) continue;

      const options = getDropdownOptions(dropdown);
      if (!options.length) continue;

      const match = fuzzyMatchDropdownOption(options, value, fieldHints);
      if (match) {
        clickOption(match);
        await sleep(200);
        closeOpenDropdowns();
        return { success: true, selectedText: match.textContent.trim() };
      }

      // If dropdown is open but no good match, try with just the first word
      // (e.g., typing "United States" but dropdown expects just typing "United" first)
      if (wait === 2 && value.includes(' ')) {
        const firstWord = value.split(/[\s,]+/)[0];
        setNativeValue(el, firstWord);
        dispatchEvents(el, ['input']);
        await sleep(300);

        const retryDropdown = findTypeaheadDropdown(el);
        if (retryDropdown) {
          const retryOptions = getDropdownOptions(retryDropdown);
          const retryMatch = fuzzyMatchDropdownOption(retryOptions, value, fieldHints);
          if (retryMatch) {
            clickOption(retryMatch);
            await sleep(200);
            closeOpenDropdowns();
            return { success: true, selectedText: retryMatch.textContent.trim() };
          }
        }
      }

      // Last resort: select first option if it seems reasonable
      // Never for phone-country or location — both clear / wrong-commit easily.
      const locationLikeEarly = /\blocation\b|\bcity\b/.test(
        `${fieldHints?.label || ''} ${fieldHints?.name || ''} ${fieldHints?.id || ''}`
      );
      if (
        wait >= 4
        && options.length <= 3
        && !hintsLookLikePhoneCountry(fieldHints)
        && !locationLikeEarly
      ) {
        clickOption(options[0]);
        await sleep(200);
        closeOpenDropdowns();
        return { success: true, selectedText: options[0].textContent.trim(), fallback: true };
      }
    }

    // Keyboard fallback is unsafe for phone-country and location/autocomplete —
    // it often leaves a transient value that React clears a moment later.
    const locationLike = /\blocation\b|\bcity\b/.test(
      `${fieldHints?.label || ''} ${fieldHints?.name || ''} ${fieldHints?.id || ''}`
    );
    if (!hintsLookLikePhoneCountry(fieldHints) && !locationLike) {
      try {
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', code: 'ArrowDown', bubbles: true }));
        await sleep(100);
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
        await sleep(100);
        closeOpenDropdowns();
        if (el.value !== value && el.value !== '') {
          return { success: true, selectedText: el.value, keyboard: true };
        }
      } catch { /* skip */ }
    }

    closeOpenDropdowns();
    return { success: false };
  }

  // ─── Contenteditable / Rich text editor handling ───────────

  function isRichTextEditor(el) {
    if (el.isContentEditable) return true;
    if (el.getAttribute('role') === 'textbox' && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return true;

    // Check for known WYSIWYG editor wrappers
    const className = (el.className || '').toString().toLowerCase();
    if (/ql-editor|tox-edit-area|ck-editor|fr-element|note-editable|ProseMirror|DraftEditor/.test(className)) return true;

    return false;
  }

  function findRichTextEditor(el) {
    // The element itself might be the editor
    if (el.isContentEditable && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') return el;

    // Check if there's an iframe with a contenteditable body (TinyMCE, CKEditor classic)
    const wrapper = el.closest('[class*="editor"], [class*="wysiwyg"], [class*="rich-text"]') || el.parentElement;
    if (wrapper) {
      const iframe = wrapper.querySelector('iframe');
      if (iframe) {
        try {
          const iDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iDoc?.body?.isContentEditable) return iDoc.body;
        } catch { /* cross-origin */ }
      }

      // Check for contenteditable div inside the wrapper
      const editable = wrapper.querySelector('[contenteditable="true"]');
      if (editable) return editable;
    }

    return null;
  }

  function fillRichText(editorEl, value) {
    try {
      editorEl.focus();

      // Clear existing content safely
      while (editorEl.firstChild) editorEl.removeChild(editorEl.firstChild);

      // Insert as text nodes with <br> for newlines (no innerHTML to avoid XSS)
      const lines = value.split('\n');
      lines.forEach((line, i) => {
        editorEl.appendChild(document.createTextNode(line));
        if (i < lines.length - 1) editorEl.appendChild(document.createElement('br'));
      });

      // Dispatch events that editors listen for
      editorEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
      editorEl.dispatchEvent(new Event('change', { bubbles: true }));

      // For Draft.js and similar, we may need to use execCommand
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, value);
      } catch { /* skip — not all editors support this */ }

      return true;
    } catch (err) {
      console.warn('[JobApply] fillRichText failed:', err.message);
      return false;
    }
  }

  // ─── Date picker handling ──────────────────────────────────

  function isDateField(el) {
    const type = (el.type || '').toLowerCase();
    if (type === 'date' || type === 'month') return true;

    const name = (el.name || '').toLowerCase();
    const id = (el.id || '').toLowerCase();
    const label = findLabel(el).toLowerCase();
    const placeholder = (el.placeholder || '').toLowerCase();

    return /date|month|year|start.?date|end.?date|graduation|from.?date|to.?date/.test(
      `${name} ${id} ${label} ${placeholder}`
    );
  }

  function fillDateField(el, value) {
    try {
      const type = (el.type || '').toLowerCase();

      if (type === 'date') {
        // Native date input: needs YYYY-MM-DD format
        const parsed = parseFlexibleDate(value);
        if (parsed) {
          setNativeValue(el, parsed);
          dispatchEvents(el, ['input', 'change']);
          return true;
        }
      }

      if (type === 'month') {
        // Native month input: needs YYYY-MM format
        const parsed = parseFlexibleDate(value);
        if (parsed) {
          setNativeValue(el, parsed.slice(0, 7));
          dispatchEvents(el, ['input', 'change']);
          return true;
        }
      }

      // For text inputs that are date fields, just set the value directly
      setNativeValue(el, value);
      dispatchEvents(el, ['input', 'change']);
      return true;
    } catch {
      return false;
    }
  }

  function parseFlexibleDate(value) {
    // Try to parse various date formats into YYYY-MM-DD
    if (!value) return null;

    // Already YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;

    // YYYY-MM
    if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`;

    // MM/DD/YYYY or MM-DD-YYYY
    const mdyMatch = value.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (mdyMatch) {
      return `${mdyMatch[3]}-${mdyMatch[1].padStart(2, '0')}-${mdyMatch[2].padStart(2, '0')}`;
    }

    // Month YYYY (e.g., "January 2024")
    const monthNames = ['january', 'february', 'march', 'april', 'may', 'june',
      'july', 'august', 'september', 'october', 'november', 'december'];
    const monthYearMatch = value.match(/^(\w+)\s+(\d{4})$/);
    if (monthYearMatch) {
      const monthIdx = monthNames.indexOf(monthYearMatch[1].toLowerCase());
      if (monthIdx >= 0) {
        return `${monthYearMatch[2]}-${String(monthIdx + 1).padStart(2, '0')}-01`;
      }
    }

    // Just a year
    if (/^\d{4}$/.test(value)) return `${value}-01-01`;

    // Try native Date parsing as last resort
    try {
      const d = new Date(value);
      if (!isNaN(d.getTime())) {
        return d.toISOString().slice(0, 10);
      }
    } catch { /* skip */ }

    return null;
  }

  // ─── Field filling (main) ──────────────────────────────────

  function normalizeComparable(s) {
    return String(s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  }

  function looksLikeLocationField(el, label) {
    const hints = `${label || ''} ${el?.getAttribute?.('aria-label') || ''} ${el?.name || ''} ${el?.id || ''} ${el?.placeholder || ''}`.toLowerCase();
    return /\blocation\b|\bcity\b/.test(hints) && !/\bphone\b|\bdial\b|\bcountry\s*code\b/.test(hints);
  }

  /**
   * Post-fill verification: a dispatched event is not a successful fill.
   * Returns { ok, reason, actual }.
   */
  function verifyFilled(el, expected, action, opts = {}) {
    if (!el) return { ok: false, reason: 'element missing', actual: '' };
    const exp = normalizeComparable(expected);
    const actType = String(action || '');

    if (actType === 'check_checkbox') {
      const shouldCheck = expected === true || expected === 'true' || expected === 'yes' || expected === '1';
      return el.checked === shouldCheck
        ? { ok: true, actual: String(el.checked) }
        : { ok: false, reason: 'checkbox state did not stick', actual: String(el.checked) };
    }

    if (actType === 'click_radio') {
      const name = el.name || el.getAttribute('name');
      if (!name) return { ok: false, reason: 'radio group missing name', actual: '' };
      const root = el.closest('form') || el.getRootNode();
      const checked = root.querySelector(`input[type="radio"][name="${CSS.escape(name)}"]:checked`);
      if (!checked) return { ok: false, reason: 'no radio selected', actual: '' };
      // Prefer the concrete option value we clicked (handles synonym → option mapping).
      const selected = normalizeComparable(opts.selectedValue || '');
      const actual = normalizeComparable(checked.value || findLabel(checked));
      const labelActual = normalizeComparable(findLabel(checked));
      if (selected && (actual === selected || labelActual === selected)) {
        return { ok: true, actual: checked.value };
      }
      if (actual === exp || labelActual === exp || actual.includes(exp) || exp.includes(actual)
          || labelActual.includes(exp) || exp.includes(labelActual)) {
        return { ok: true, actual: checked.value };
      }
      // If the clicked element itself is checked, treat as verified.
      if (el.checked) return { ok: true, actual: el.value };
      return { ok: false, reason: 'radio selection did not stick', actual: checked.value };
    }

    if (el.tagName === 'SELECT' || actType === 'select_dropdown' || actType === 'select_dropdown_safe') {
      const opt = el.options?.[el.selectedIndex];
      const actual = normalizeComparable(opt?.text || opt?.value || el.value || el.textContent);
      if (!exp) return { ok: false, reason: 'empty expected value', actual };
      if (actual === exp || actual.includes(exp) || exp.includes(actual)) {
        return { ok: true, actual };
      }
      return { ok: false, reason: 'selection did not stick', actual };
    }

    // Text / typeahead / contenteditable
    let actualRaw = '';
    if (el.isContentEditable || el.getAttribute?.('contenteditable') === 'true') {
      actualRaw = el.textContent || '';
    } else {
      actualRaw = el.value || '';
    }
    const actual = normalizeComparable(actualRaw);
    // Intentional clear / empty fill
    if (!exp) {
      return actual ? { ok: false, reason: 'expected empty but value remained', actual } : { ok: true, actual };
    }

    if (opts.requireCommit) {
      if (!actual || actual.length < 2) {
        return { ok: false, reason: 'location/autocomplete value did not stick', actual };
      }
      const words = exp.split(/[\s,/|-]+/).filter(w => w.length > 2);
      const hit = words.length === 0
        ? actual.includes(exp) || exp.includes(actual)
        : words.some(w => actual.includes(w));
      if (!hit) {
        return { ok: false, reason: 'committed autocomplete value does not match', actual };
      }
      return { ok: true, actual };
    }

    if (actual === exp || actual.includes(exp) || exp.includes(actual)) {
      return { ok: true, actual };
    }
    // Phone digits: allow formatting differences
    const digA = actual.replace(/\D/g, '');
    const digE = exp.replace(/\D/g, '');
    if (digA && digE && digA.length >= 7 && (digA.endsWith(digE) || digE.endsWith(digA) || digA.includes(digE))) {
      return { ok: true, actual };
    }
    return { ok: false, reason: 'value did not stick', actual };
  }

  function findLocationHiddenCompanion(el) {
    try {
      const scope = el?.closest?.('form, .autocomplete, [class*="autocomplete"], fieldset, div')
        || document;
      const scoped = scope.querySelector(
        '#job_application_location_id, #selected-location, '
        + 'input[name="selectedLocation"], input[name="job_application[location_id]"]'
      );
      if (scoped) return scoped;
      return document.querySelector(
        '#job_application_location_id, #selected-location, '
        + 'input[name="selectedLocation"], input[name="job_application[location_id]"]'
      );
    } catch {
      return null;
    }
  }

  async function withVerification(result, el, expected, action, opts = {}) {
    if (!result?.success || result.skipped) return result;
    const verifyOpts = {
      ...opts,
      selectedValue: opts.selectedValue || result.selectedValue || result.selectedText,
    };
    // Greenhouse/Lever location: React often accepts a typed value then clears it.
    // Once commit fails (missing place ID), never overwrite with visible-text success.
    if (opts.requireCommit) {
      await sleep(550);
      let verified = verifyFilled(el, expected, action, verifyOpts);
      if (!verified.ok) {
        return {
          ...result,
          success: false,
          reason: verified.reason || 'verification failed',
          inventoryCategory: 'failed_verification',
          actualValue: verified.actual,
        };
      }
      const hidden = findLocationHiddenCompanion(el);
      // If a companion identity field exists on this component, require it.
      // Do not invent a document-wide hidden requirement for components that omit it.
      if (hidden && !String(hidden.value || '').trim()) {
        return {
          ...result,
          success: false,
          reason: 'location autocomplete not committed — missing place ID',
          inventoryCategory: 'failed_verification',
          actualValue: el?.value || '',
        };
      }
      await sleep(250);
      verified = verifyFilled(el, expected, action, verifyOpts);
      if (!verified.ok || !String(el?.value || '').trim()) {
        return {
          ...result,
          success: false,
          reason: verified.reason || 'location cleared after settle',
          inventoryCategory: 'failed_verification',
          actualValue: verified.actual || el?.value || '',
        };
      }
      if (hidden && !String(hidden.value || '').trim()) {
        return {
          ...result,
          success: false,
          reason: 'location autocomplete not committed — missing place ID after settle',
          inventoryCategory: 'failed_verification',
          actualValue: el?.value || '',
        };
      }
      return result;
    }

    const verified = verifyFilled(el, expected, action, verifyOpts);
    if (!verified.ok) {
      return {
        ...result,
        success: false,
        reason: verified.reason || 'verification failed',
        inventoryCategory: 'failed_verification',
        actualValue: verified.actual,
      };
    }
    return result;
  }

  function isGreenhouseLocationControl(el) {
    if (!el) return false;
    const id = (el.id || '').toLowerCase();
    const name = (el.name || '').toLowerCase();
    const label = `${findLabel(el) || ''}`.toLowerCase();
    if (id === 'job_application_location' || name === 'job_application[location]') return true;
    if (name === 'job_application[location]' || /job_application.*location/.test(name)) return true;
    // Live Greenhouse Remix: location city autocomplete (not phone country)
    if (/\blocation\b|\bcity\b/.test(label) && !/\bphone\b|\bdial\b/.test(label)
        && (el.getAttribute('role') === 'combobox' || el.getAttribute('aria-autocomplete')
          || el.closest('[class*="autocomplete"], [class*="typeahead"], [class*="select"]'))) {
      return /greenhouse|boards\.greenhouse|job-boards\.greenhouse/i.test(location.href)
        || !!document.querySelector('#grnhse_app, #app_form, #application_form');
    }
    return false;
  }

  function isLeverLocationControl(el) {
    if (!el) return false;
    return el.id === 'location-input'
      || (el.name === 'location' && !!el.closest?.('li.application-question, .application-form'))
      || (el.classList?.contains?.('location-input'));
  }

  function findOwnedLocationDropdown(el) {
    // Only listboxes / results owned by this control or inside its question card.
    const listId = el.getAttribute('aria-controls') || el.getAttribute('aria-owns');
    if (listId) {
      try {
        const owned = document.getElementById(listId);
        if (owned) return owned;
      } catch { /* skip */ }
    }
    const card = el.closest?.(
      'li.application-question, .application-question, .autocomplete, [class*="autocomplete"], form'
    ) || el.parentElement;
    if (!card) return null;
    const local = card.querySelector(
      '[role="listbox"], .dropdown-results, [class*="dropdown-results"], '
      + 'ul[id*="list"], [class*="suggestion"]'
    );
    return local || null;
  }

  function locationCommitLooksGood(el, expected, hidden) {
    const visible = String(el?.value || el?.textContent || '').trim();
    if (!visible) return false;
    const exp = String(expected || '').trim().toLowerCase();
    const city = exp.split(',')[0].trim();
    const vis = visible.toLowerCase();
    if (city && !vis.includes(city) && !exp.includes(vis.slice(0, Math.min(12, vis.length)))) {
      // Visible text unrelated to what we asked for
      if (!vis.includes(exp.slice(0, 8))) return false;
    }
    // If a companion identity field exists, it must be nonempty.
    if (hidden && !String(hidden.value || '').trim()) return false;
    return true;
  }

  /**
   * Greenhouse-specific location: type → owned listbox only → click suggestion →
   * verify visible commit (+ hidden ID when present). Never document-wide / first-option.
   */
  async function fillGreenhouseLocation(el, value) {
    const query = String(value || '').trim();
    if (!query) {
      return { success: false, reason: 'empty location value' };
    }

    setNativeValue(el, '');
    dispatchEvents(el, ['focus', 'input']);
    el.focus?.();
    await sleep(50);
    const typeQuery = query.split(',')[0].trim() || query;
    simulateTyping(el, typeQuery);

    let matched = null;
    let dropdown = null;
    for (let wait = 0; wait < 8; wait++) {
      await sleep(wait < 3 ? 200 : 350);
      dropdown = findOwnedLocationDropdown(el);
      if (!dropdown) continue;
      try {
        if (dropdown.hasAttribute?.('hidden') && el.getAttribute('aria-expanded') === 'true') {
          dropdown.hidden = false;
        }
      } catch { /* skip */ }
      const options = getDropdownOptions(dropdown);
      if (!options.length) continue;
      matched = fuzzyMatchDropdownOption(options, query, { label: 'Location (City)', id: el.id })
        || fuzzyMatchDropdownOption(options, typeQuery, { label: 'Location (City)', id: el.id });
      if (!matched) {
        const tq = typeQuery.toLowerCase();
        matched = options.find((o) => {
          const t = (o.textContent || '').trim().toLowerCase();
          return t === query.toLowerCase() || t.startsWith(tq) || t.includes(tq);
        }) || null;
      }
      if (matched) break;
    }

    if (!matched) {
      dispatchEvents(el, ['blur']);
      return { success: false, reason: 'no matching Greenhouse location suggestion in owned listbox' };
    }

    clickOption(matched);
    await sleep(350);
    const selectedText = (matched.textContent || '').trim() || query;
    const hidden = findLocationHiddenCompanion(el);
    // When the component exposes a place ID, require it. Otherwise require stable visible text.
    if (hidden && !String(hidden.value || '').trim()) {
      return {
        success: false,
        reason: 'location suggestion click did not set place ID',
        selectedText,
      };
    }
    if (!locationCommitLooksGood(el, query, hidden)) {
      return { success: false, reason: 'visible location not committed', selectedText };
    }
    dispatchEvents(el, ['blur']);
    await sleep(400);
    if (!locationCommitLooksGood(el, query, hidden)) {
      return {
        success: false,
        reason: 'Greenhouse cleared location after blur',
        selectedText,
      };
    }
    return { success: true, selectedText: el.value || selectedText };
  }

  /**
   * Lever location (#location-input): type → .dropdown-results in the same
   * application-question → click → verify #selected-location.
   */
  async function fillLeverLocation(el, value) {
    const query = String(value || '').trim();
    if (!query) return { success: false, reason: 'empty location value' };

    setNativeValue(el, '');
    dispatchEvents(el, ['focus', 'input']);
    el.focus?.();
    await sleep(50);
    const typeQuery = query.split(',')[0].trim() || query;
    simulateTyping(el, typeQuery);

    let matched = null;
    for (let wait = 0; wait < 10; wait++) {
      await sleep(wait < 4 ? 250 : 400);
      const dropdown = findOwnedLocationDropdown(el);
      if (!dropdown) continue;
      // Lever options are often direct children of .dropdown-results (not role=option)
      let options = getDropdownOptions(dropdown);
      if (!options.length) {
        options = Array.from(dropdown.children).filter((c) => {
          const t = (c.textContent || '').trim();
          return t && !/no location found|loading/i.test(t);
        });
      }
      if (!options.length) continue;
      const tq = typeQuery.toLowerCase();
      matched = options.find((o) => (o.textContent || '').trim().toLowerCase().includes(tq))
        || fuzzyMatchDropdownOption(options, query, { label: 'Current location', id: el.id })
        || null;
      if (matched) break;
    }

    if (!matched) {
      dispatchEvents(el, ['blur']);
      return { success: false, reason: 'no matching Lever location suggestion' };
    }

    clickOption(matched);
    await sleep(350);
    const selectedText = (matched.textContent || '').trim() || query;
    const hidden = document.getElementById('selected-location')
      || el.closest('li, .application-question')?.querySelector('input[name="selectedLocation"]');
    if (!hidden || !String(hidden.value || '').trim()) {
      return {
        success: false,
        reason: 'Lever location not committed (selectedLocation empty)',
        selectedText,
      };
    }
    dispatchEvents(el, ['blur']);
    await sleep(300);
    if (!String(hidden.value || '').trim() || !String(el.value || '').trim()) {
      return { success: false, reason: 'Lever cleared location after blur', selectedText };
    }
    return { success: true, selectedText: el.value || selectedText };
  }

  async function fillField(selector, value, action, confidence, label) {
    try {
      // Dismiss any stale dropdowns from previous field
      dismissOpenDropdowns();
      await sleep(50);

      const el = resolveElement(selector);
      if (!el) {
        // Selector may have gone stale after DOM mutation; try re-extracting
        return { selector, success: false, reason: 'element not found' };
      }

      if (isSubmitControl(el)) {
        return { selector, success: true, skipped: true, reason: 'refusing to interact with submit control' };
      }

      // Compute field hints once for normalization throughout this fill
      const fieldHints = getFieldHints(el);
      const phoneCountryControl = isPhoneCountryCodeField(el) || isSelectCountryInPhoneWidget(el);
      if (phoneCountryControl) {
        fieldHints.label = `${fieldHints.label || ''} phone country code`.trim();
        fieldHints.fieldKind = 'phone_country';
      }

      // Stage 1 fail-safe: never autofill phone-country / dial-code controls.
      // Wrong Albania (+355) is worse than leaving +1 for the user.
      if (phoneCountryControl || action === 'select_dropdown_safe') {
        // select_dropdown_safe was historically phone-country-only; still refuse.
        if (phoneCountryControl || /phone.?country|country.?code|dial.?code/i.test(`${label || ''} ${fieldHints.label}`)) {
          return {
            selector,
            success: true,
            skipped: true,
            reason: 'phone_country_manual_review',
            action: 'skip',
          };
        }
      }

      // Guard: skip phone extension fields when AI sends a phone number
      if (isPhoneExtensionField(el)) {
        const digits = String(value).replace(/\D/g, '');
        if (digits.length >= 7) {
          return { selector, success: true, skipped: true, reason: 'phone extension field — value looks like a phone number' };
        }
      }

      // Guard: skip phone-number-like values for fields not identified as phone
      if (!isPhoneField(el) && !phoneCountryControl && looksLikePhoneNumber(value)) {
        return { selector, success: true, skipped: true, reason: 'value looks like phone number for non-phone field' };
      }

      // Capture original value before filling (for undo — only recorded on verified success)
      const origVal = getCurrentFieldValue(el);
      const fieldLabel = label || findLabel(el) || el.name || el.id || selector;
      setFieldResult(selector, {
        label: fieldLabel,
        proposedValue: String(value ?? ''),
        originalValue: origVal,
        status: 'pending',
        confidence: confidence || 1,
        action,
      });

      // Stage 1: never overwrite nonempty fields unless explicitly enabled
      if (!overwriteExistingFields && action !== 'skip' && !isEffectivelyEmpty(origVal)) {
        setFieldResult(selector, {
          status: 'already_completed',
          reason: 'nonempty field protected',
        });
        return {
          selector,
          success: true,
          skipped: true,
          reason: 'nonempty field protected',
          alreadyCompleted: true,
        };
      }

      // Scroll element into view so it's interactable
      try {
        el.scrollIntoView({ block: 'nearest', behavior: 'instant' });
      } catch { /* skip */ }

      el.focus();
      dispatchEvents(el, ['focus']);

      switch (action) {
        case 'fill_text': {
          // 1. Check if this is a rich text / contenteditable editor
          const richEditor = findRichTextEditor(el);
          if (richEditor && richEditor !== el) {
            const filled = fillRichText(richEditor, value);
            if (filled) return { selector, success: true, action, richText: true };
          }
          if (isRichTextEditor(el)) {
            const filled = fillRichText(el, value);
            if (filled) return { selector, success: true, action, richText: true };
          }

          // 2. Check if this is a date field
          if (isDateField(el)) {
            const filled = fillDateField(el, value);
            if (filled) return { selector, success: true, action, dateField: true };
          }

          // 3. Phone formatting — normalize and format before text fill
          let fillValue = value;
          if (isPhoneField(el) && window.__jaNormalize) {
            try {
              let digits = window.__jaNormalize.normalizePhone(value);
              // Strip leading country code if a separate country code dropdown exists nearby
              if (digits && digits.length === 11 && digits[0] === '1' && hasNearbyPhoneCountryCode(el)) {
                digits = digits.slice(1);
              }
              if (digits) {
                fillValue = window.__jaNormalize.formatPhoneLike(digits, fieldHints.placeholder);
              }
            } catch { /* skip, use original value */ }
          }

          // 4. Check if this is a custom click-to-open dropdown (not a typeahead)
          if (isCustomDropdownTrigger(el) && el.tagName !== 'INPUT' && el.tagName !== 'TEXTAREA') {
            const result = await handleCustomDropdown(el, fillValue, fieldHints);
            if (result.success) return { selector, success: true, action, selectedText: result.selectedText };
          }

          // 5. Check if this is a typeahead/autocomplete field (has ARIA hints)
          const locationField = looksLikeLocationField(el, label || fieldHints.label);
          // Greenhouse location: dedicated handler (owned listbox + commit verify).
          if (locationField && isGreenhouseLocationControl(el)) {
            const gh = await fillGreenhouseLocation(el, fillValue);
            if (!gh.success) {
              return {
                selector,
                success: false,
                reason: gh.reason || 'Greenhouse location not committed',
                inventoryCategory: 'failed_verification',
              };
            }
            return withVerification(
              { selector, success: true, action, selectedText: gh.selectedText },
              el,
              gh.selectedText || fillValue,
              action,
              { requireCommit: true },
            );
          }
          // Lever location: #location-input + .dropdown-results + selectedLocation
          if (locationField && isLeverLocationControl(el)) {
            const lv = await fillLeverLocation(el, fillValue);
            if (!lv.success) {
              return {
                selector,
                success: false,
                reason: lv.reason || 'Lever location not committed',
                inventoryCategory: 'failed_verification',
              };
            }
            return withVerification(
              { selector, success: true, action, selectedText: lv.selectedText },
              el,
              lv.selectedText || fillValue,
              action,
              { requireCommit: true },
            );
          }
          const isTypeahead = el.getAttribute('role') === 'combobox'
            || el.getAttribute('aria-autocomplete')
            || el.getAttribute('aria-owns')
            || el.getAttribute('aria-controls')
            || el.getAttribute('list')
            || locationField
            || el.closest('[class*="autocomplete"]')
            || el.closest('[class*="typeahead"]')
            || el.closest('[class*="combobox"]');

          if (isTypeahead) {
            const result = await typeAndSelectDropdown(el, fillValue, fieldHints);
            if (result.success) {
              await sleep(locationField ? 400 : 100);
              return withVerification(
                { selector, success: true, action, selectedText: result.selectedText },
                el,
                result.selectedText || fillValue,
                action,
                { requireCommit: locationField },
              );
            }
            // Location/autocomplete: never report success after a bare text set.
            if (locationField) {
              setNativeValue(el, fillValue);
              dispatchEvents(el, ['input', 'change', 'blur']);
              await sleep(400);
              return withVerification(
                { selector, success: true, action },
                el,
                fillValue,
                action,
                { requireCommit: true },
              );
            }
          }

          // 6. Normal text fill
          setNativeValue(el, fillValue);
          dispatchEvents(el, ['input', 'change']);

          // 7. After setting value, check if a dropdown appeared anyway
          await sleep(300);
          const dropdown = findTypeaheadDropdown(el);
          if (dropdown) {
            const options = getDropdownOptions(dropdown);
            if (options.length > 0) {
              const match = fuzzyMatchDropdownOption(options, fillValue, fieldHints);
              if (match) {
                clickOption(match);
                await sleep(100);
                return withVerification(
                  { selector, success: true, action, selectedText: match.textContent.trim() },
                  el,
                  match.textContent.trim() || fillValue,
                  action,
                  { requireCommit: locationField },
                );
              }
            }
          }

          dispatchEvents(el, ['blur']);
          await sleep(locationField ? 350 : 50);
          return withVerification(
            { selector, success: true, action },
            el,
            fillValue,
            action,
            { requireCommit: locationField },
          );
        }

        case 'select_dropdown_safe':
        case 'select_dropdown': {
          // For 'select_dropdown_safe': check if the field already contains the
          // desired value before interacting — avoids opening dropdowns unnecessarily
          if (action === 'select_dropdown_safe') {
            let container = el.closest('[data-automation-id], [class*="combobox"], [role="combobox"], [role="listbox"]') || el.parentElement;
            // Walk up to find chip/pill/tag elements that indicate an already-selected value
            // (e.g., Workday shows "× United States of America (+1)" as a chip)
            let searchEl = container;
            for (let i = 0; i < 5 && searchEl && searchEl !== document.body; i++) {
              // Check for chip elements by selector
              const hasChip = searchEl.querySelector(
                '[data-automation-id*="delete"], [data-automation-id*="Delete"], ' +
                '[data-automation-id*="selectedItem"], [data-automation-id*="SelectedItem"], ' +
                '[class*="chip"], [class*="pill"], [class*="tag-item"], ' +
                '[aria-selected="true"]'
              );
              if (hasChip) {
                container = searchEl;
                break;
              }
              // Also detect chips by text pattern: "×" or "✕" followed by a value
              // (Workday renders chips as plain elements with a close button + text)
              const childText = searchEl.textContent || '';
              if (/[\u00d7\u2715\u2716\u2717\u2718×✕✖]\s*\S/.test(childText)) {
                container = searchEl;
                break;
              }
              searchEl = searchEl.parentElement;
            }
            const existingText = (container?.textContent || el.value || '').toLowerCase();
            const valueLower = value.toLowerCase();
            // Check if the value (or a key part) is already present
            const valueWords = valueLower.split(/[\s()]+/).filter(w => w.length > 2);
            const alreadySet = valueWords.length > 0 && valueWords.every(w => existingText.includes(w));
            if (alreadySet) {
              return { selector, success: true, action, skipped: true, reason: 'already set' };
            }
          }

          // Handle native <select>
          if (el.tagName === 'SELECT') {
            const options = Array.from(el.options || []).map(o => ({ value: o.value, text: o.textContent }));
            const selectHints = isPhoneCountryCodeField(el)
              ? { ...fieldHints, label: `${fieldHints.label || ''} phone country code`.trim() }
              : fieldHints;
            const idx = fuzzyMatchOption(options, value, selectHints);
            if (idx >= 0) {
              el.selectedIndex = idx;
              dispatchEvents(el, ['change', 'blur']);
              return withVerification(
                { selector, success: true, action, selectedValue: options[idx].value },
                el,
                options[idx].text || options[idx].value || value,
                action,
              );
            }
            return { selector, success: false, reason: `no matching option for "${value}"` };
          }

          // Handle custom dropdown (div-based)
          const dropdownHints = isPhoneCountryCodeField(el)
            ? { ...fieldHints, label: `${fieldHints.label || ''} phone country code`.trim() }
            : fieldHints;
          const customResult = await handleCustomDropdown(el, value, dropdownHints);
          if (customResult.success) {
            await sleep(100);
            return withVerification(
              { selector, success: true, action, selectedText: customResult.selectedText },
              el,
              customResult.selectedText || value,
              action,
            );
          }
          return { selector, success: false, reason: customResult.reason || `no matching option for "${value}"` };
        }

        case 'click_radio': {
          const name = el.name || el.getAttribute('name');
          if (name) {
            const root = el.closest('form') || el.getRootNode();
            const radios = root.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`);
            const target = value.toLowerCase().trim();

            // Pass 1: exact match on value or label
            for (const radio of radios) {
              const radioLabel = findLabel(radio).toLowerCase().trim();
              const radioValue = radio.value.toLowerCase();
              if (radioValue === target || radioLabel === target) {
                radio.click();
                return withVerification(
                  { selector, success: true, action, selectedValue: radio.value },
                  radio,
                  radio.value,
                  action,
                  { selectedValue: radio.value },
                );
              }
            }
            // Pass 2: label contains target (but only if target is long enough to be meaningful)
            if (target.length >= 3) {
              for (const radio of radios) {
                const radioLabel = findLabel(radio).toLowerCase().trim();
                if (radioLabel.includes(target)) {
                  radio.click();
                  return withVerification(
                    { selector, success: true, action, selectedValue: radio.value },
                    radio,
                    radio.value,
                    action,
                    { selectedValue: radio.value },
                  );
                }
              }
            }

            // Pass 3: normalization via lookup tables (handles synonyms like Caucasian→White)
            if (window.__jaNormalize) {
              try {
                const norm = window.__jaNormalize;
                const hints = fieldHints || {};
                const hintValues = [hints.label, hints.name, hints.id, hints.placeholder].filter(Boolean);
                const tables = norm.detectFieldCategory(hintValues);
                // Avoid country/misc tables mistaking "no" for Norway on yes/no radios.
                const radioLabels = Array.from(radios).map(r => findLabel(r).trim());
                const simpleYesNo = radioLabels.every(l => /^(yes|no)$/i.test(l.trim()));
                const normIdx = simpleYesNo
                  ? -1
                  : norm.normalizedMatch(radioLabels, value, tables.length ? tables : undefined);
                if (normIdx >= 0) {
                  radios[normIdx].click();
                  return withVerification(
                    { selector, success: true, action, selectedValue: radios[normIdx].value },
                    radios[normIdx],
                    radios[normIdx].value,
                    action,
                    { selectedValue: radios[normIdx].value },
                  );
                }
              } catch { /* normalization unavailable */ }
            }
          }
          // Do not click the unresolved element — that often selects the wrong radio.
          return { selector, success: false, reason: `no matching radio for "${value}"` };
        }

        case 'check_checkbox': {
          const shouldCheck = value === true || value === 'true' || value === 'yes' || value === '1';
          if (el.checked !== shouldCheck) {
            el.click(); // .click() toggles checked and fires events
          }
          return withVerification(
            { selector, success: true, action },
            el,
            shouldCheck ? 'yes' : 'no',
            action,
          );
        }

        case 'upload_file': {
          // Not a verify failure — Stage 1.1 will attach real PDF assets.
          return {
            selector,
            success: true,
            skipped: true,
            reason: 'file upload requires user interaction — résumé asset attach is Stage 1.1',
            inventoryCategory: 'file_attachment_unavailable',
          };
        }

        case 'skip':
          return { selector, success: true, action: 'skip', skipped: true };

        default:
          // Best-effort: try setting value
          setNativeValue(el, value);
          dispatchEvents(el, ['input', 'change', 'blur']);
          return { selector, success: true, action: 'fallback' };
      }
    } catch (err) {
      return { selector, success: false, reason: err.message };
    }
  }

  // ─── File upload helper ──────────────────────────────────────

  let currentJobId = null;

  function getFieldLabel(fileInput) {
    const label = findLabel(fileInput);
    if (label) return label;
    const name = (fileInput.name || '').toLowerCase();
    const id = (fileInput.id || '').toLowerCase();
    return `${name} ${id}`;
  }

  function detectUploadType(fileInput) {
    const text = getFieldLabel(fileInput).toLowerCase();
    if (/cover.?letter/i.test(text)) return 'cover-letter';
    if (/resume|cv|curriculum/i.test(text)) return 'resume';

    // Also check accept attribute for document types
    const accept = (fileInput.getAttribute('accept') || '').toLowerCase();
    if (accept && /pdf|doc|rtf/.test(accept)) {
      // Could be resume or cover letter; check nearby context
      const parent = fileInput.closest('div, fieldset, section, li');
      const parentText = parent ? parent.textContent.toLowerCase() : '';
      if (/cover.?letter/i.test(parentText)) return 'cover-letter';
      if (/resume|cv|curriculum/i.test(parentText)) return 'resume';
    }

    return null;
  }

  function detectFileUploadFields() {
    const fileInputs = deepQuerySelectorAll(document, 'input[type="file"]');

    for (const fileInput of fileInputs) {
      // Skip if already processed
      if (fileInput.dataset.cpUploadHelper) continue;

      const uploadType = detectUploadType(fileInput);
      if (!uploadType) continue;

      fileInput.dataset.cpUploadHelper = uploadType;
      showUploadHelper(fileInput, uploadType);
    }
  }

  function showUploadHelper(fileInput, type) {
    const kind = type === 'cover-letter' ? 'cover letter' : 'resume';
    const messageType = type === 'cover-letter' ? 'downloadCoverLetter' : 'downloadResume';

    // Create a compact sibling banner — do not mutate ATS parent positioning
    // (Lever/Greenhouse layout breaks when parents become position:relative).
    const helper = document.createElement('div');
    helper.className = `${PREFIX}-upload-helper`;
    helper.setAttribute('data-ja-upload-helper', type);

    const text = document.createElement('span');
    text.className = `${PREFIX}-upload-helper-text`;
    text.textContent = currentJobId
      ? `Optional: download a ${kind} from JobApply, then use Attach above.`
      : `File attach is manual for now (Stage 1.1). Use the site's Attach control.`;

    const btn = document.createElement('button');
    btn.className = `${PREFIX}-upload-helper-btn`;
    btn.textContent = currentJobId ? `Download ${kind}` : 'Dismiss';
    btn.type = 'button';

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (!currentJobId) {
        helper.remove();
        return;
      }

      btn.disabled = true;
      btn.textContent = 'Downloading...';

      try {
        const response = await chrome.runtime.sendMessage({
          type: messageType,
          jobId: currentJobId,
        });

        if (response && response.ok) {
          helper.classList.add(`${PREFIX}-upload-helper-downloaded`);
          text.textContent = 'Downloaded. Now click Attach above and choose the file.';
          btn.textContent = 'Done';
        } else {
          text.textContent = `Download failed: ${response?.error || 'unknown error'}. Attach a file manually.`;
          btn.disabled = false;
          btn.textContent = 'Retry download';
        }
      } catch (err) {
        text.textContent = `Download failed: ${err.message}. Attach a file manually.`;
        btn.disabled = false;
        btn.textContent = 'Retry download';
      }
    });

    helper.appendChild(text);
    if (currentJobId) helper.appendChild(btn);
    else helper.appendChild(btn);

    // Prefer placing after the visible attach row, never inside transformed parents.
    const row = fileInput.closest('li, .application-question, .field, [class*="upload"], [class*="resume"]')
      || fileInput.parentElement;
    if (row && row.parentElement) {
      row.insertAdjacentElement('afterend', helper);
    } else {
      fileInput.insertAdjacentElement('afterend', helper);
    }
  }

  // ─── Iterative form fill ──────────────────────────────────────

  async function fillForm(mappings, atsAdapter) {
    const results = [];
    let filledCount = 0;
    // Only fill what the user approved in review — never silent AI second-pass
    // (that caused 15s pauses and 10/6 progress after the review panel).
    const approved = (mappings || []).filter(m => m && m.action !== 'skip');
    const totalMappable = approved.length;
    const mappingBySelector = Object.fromEntries(
      (mappings || []).filter(m => m.selector).map(m => [m.selector, m])
    );

    for (const mapping of mappings || []) {
      if (mapping.action === 'skip') {
        results.push({
          selector: mapping.selector,
          success: true,
          skipped: true,
          reason: mapping.reason || 'skipped',
          action: 'skip',
          inventoryCategory: mapping.inventoryCategory,
          mapping,
        });
        continue;
      }

      let result;
      try {
        result = await withTimeout(
          fillField(mapping.selector, mapping.value, mapping.action, mapping.confidence, mapping.label || mapping.field_label),
          FIELD_TIMEOUT_MS,
          `filling ${mapping.selector}`
        );
      } catch (err) {
        result = { selector: mapping.selector, success: false, reason: err.message };
      }

      result.mapping = mapping;
      results.push(result);

      // Close any dropdowns left open by the previous fill
      closeOpenDropdowns();
      await sleep(100);

      const fieldLabel = mapping.label || mapping.field_label || mapping.selector;
      const proposed = String(mapping.value ?? '');
      if (result.alreadyCompleted) {
        setFieldResult(mapping.selector, {
          label: fieldLabel,
          proposedValue: proposed,
          status: 'already_completed',
          reason: result.reason || 'already completed',
          confidence: mapping.confidence || 1,
          action: mapping.action,
        });
      } else if (result.skipped) {
        setFieldResult(mapping.selector, {
          label: fieldLabel,
          proposedValue: proposed,
          status: 'skipped',
          reason: result.reason || 'skipped',
          confidence: mapping.confidence || 1,
          action: mapping.action,
        });
        try {
          const el = resolveElement(mapping.selector);
          el?.classList.remove(`${PREFIX}-filled`, `${PREFIX}-review`);
        } catch { /* skip */ }
      } else if (result.success) {
        filledCount++;
        updateOverlay('filling', `Filling ${filledCount}/${totalMappable} fields...`);
        // Undo map only for verified successes
        try {
          const el = resolveElement(mapping.selector);
          const prev = fieldResults.get(mapping.selector);
          originalValues.set(mapping.selector, {
            originalValue: prev?.originalValue ?? '',
            label: fieldLabel,
            value: proposed,
            confidence: mapping.confidence || 1,
            action: mapping.action,
            undone: false,
          });
          if (el) {
            const confidence = mapping.confidence || 1;
            el.classList.add(confidence >= 0.8 ? `${PREFIX}-filled` : `${PREFIX}-review`);
          }
        } catch { /* skip */ }
        setFieldResult(mapping.selector, {
          label: fieldLabel,
          proposedValue: proposed,
          status: 'filled',
          reason: '',
          confidence: mapping.confidence || 1,
          action: mapping.action,
        });
      } else {
        setFieldResult(mapping.selector, {
          label: fieldLabel,
          proposedValue: proposed,
          status: 'failed',
          reason: result.reason || 'verification failed',
          confidence: mapping.confidence || 1,
          action: mapping.action,
        });
        // Never leave a green highlight on a failed commit
        try {
          const el = resolveElement(mapping.selector);
          el?.classList.remove(`${PREFIX}-filled`, `${PREFIX}-review`);
          el?.classList.add(`${PREFIX}-failed`);
        } catch { /* skip */ }
        // Ensure failed attempts are not undoable as "filled"
        originalValues.delete(mapping.selector);
      }
    }

    // After filling, detect file upload fields that need user help
    detectFileUploadFields();

    const fillReport = window.__jaAtsAdapters?.buildFillReport
      ? window.__jaAtsAdapters.buildFillReport(results, mappingBySelector)
      : null;

    return { results, filledCount, total: totalMappable, fillReport, mappingBySelector };
  }

  async function getNewMappings() {
    try {
      const formHtml = serializeFormHtml();
      const atsAdapter = window.__jaAtsAdapters
        ? window.__jaAtsAdapters.detectATS(location.href, document)
        : null;
      let structuredFields = [];
      try {
        if (atsAdapter && window.__jaAtsCore?.extractWithAdapter) {
          structuredFields = window.__jaAtsCore.extractWithAdapter(
            atsAdapter,
            document,
            (root) => extractFormData(root),
          );
        } else {
          structuredFields = extractFormData(atsAdapter?.getFormRoot?.(document) || null);
        }
        structuredFields = enrichFieldHints(structuredFields);
      } catch (err) {
        console.warn('[JobApply] getNewMappings extract failed:', err?.message || err);
      }
      const payload = {
        type: 'analyzeForm',
        formHtml,
        structuredFields,
        pageUrl: location.href,
      };
      if (atsAdapter) {
        payload.atsName = atsAdapter.name;
        payload.atsFieldMap = atsAdapter.getFieldMap?.() || {};
      }
      const response = await withTimeout(
        chrome.runtime.sendMessage(payload),
        API_TIMEOUT_MS,
        'API form analysis'
      );
      if (response && response.ok && response.data?.mappings) {
        return response.data.mappings;
      }
    } catch (err) {
      console.warn('[JobApply] Re-analysis failed:', err?.message || err);
    }
    return null;
  }

  // ─── Overlay UI ───────────────────────────────────────────────

  let overlayEl = null;
  let dragState = null;

  function overlayIsLive() {
    try {
      return !!(
        overlayEl
        && overlayEl.isConnected
        && overlayEl.ownerDocument === document
        && document.getElementById(`${PREFIX}-overlay`) === overlayEl
      );
    } catch {
      return false;
    }
  }

  function profileSourcePresentForSemantic(semanticType, presence) {
    if (!presence || !semanticType) return null;
    const st = String(semanticType).toLowerCase();
    const map = {
      current_location: presence.locationPresent,
      location: presence.locationPresent,
      address_city: presence.locationPresent,
      current_company: presence.currentCompanyResolution === 'resolved'
        || presence.currentCompanyResolution === 'resolved_fallback_most_recent',
      preferred_name: presence.preferredNamePresent,
      linkedin_url: presence.linkedinPresent,
      github_url: presence.githubPresent,
      portfolio_url: presence.portfolioPresent,
      website: presence.portfolioPresent,
      university: (presence.educationCount || 0) > 0,
      languages: (presence.languageCount || 0) > 0,
      timezone: presence.timezonePresent,
    };
    return Object.prototype.hasOwnProperty.call(map, st) ? !!map[st] : null;
  }

  function countCandidateControls(root) {
    try {
      return deepQuerySelectorAll(
        root || document,
        'input, select, textarea, [role="combobox"], [contenteditable="true"]',
      ).filter((el) => {
        const type = (el.type || '').toLowerCase();
        return type !== 'hidden' && type !== 'submit' && type !== 'button' && type !== 'image';
      }).length;
    } catch {
      return 0;
    }
  }

  function buildSanitizedDiagnostics(opts = {}) {
    const presence = opts.profilePresence || lastDiagnosticsSnapshot?.profilePresence || null;
    const build = getBuildInfo();
    const pageUrl = opts.pageUrl || (() => { try { return location.href; } catch { return ''; } })();
    const atsAdapter = window.__jaAtsAdapters
      ? window.__jaAtsAdapters.detectATS(pageUrl, document)
      : null;
    const formRoot = atsAdapter?.getFormRoot?.(document) || null;
    const docCount = countCandidateControls(document);
    const rootCount = countCandidateControls(formRoot || document);

    let fields = [];
    try {
      if (atsAdapter && window.__jaAtsCore?.extractWithAdapter) {
        fields = window.__jaAtsCore.extractWithAdapter(
          atsAdapter,
          document,
          (root) => extractFormData(root || formRoot),
        );
      } else {
        fields = extractFormData(formRoot);
      }
      try { fields = enrichFieldHints(fields); } catch { /* skip */ }
    } catch (err) {
      fields = [];
    }

    const inventoryBySel = {};
    for (const item of (opts.inventory?.fields || lastDiagnosticsSnapshot?.inventory?.fields || [])) {
      if (item?.selector) inventoryBySel[item.selector] = item;
    }
    const mappingBySel = {};
    for (const m of (opts.mappings || lastDiagnosticsSnapshot?.mappings || [])) {
      if (m?.selector) mappingBySel[m.selector] = m;
    }
    const verifyBySel = {};
    for (const r of (opts.fillResults || lastDiagnosticsSnapshot?.fillResults || [])) {
      if (r?.selector) verifyBySel[r.selector] = r;
    }

    const fieldRows = fields.map((f) => {
      const st = f.semanticType || null;
      const m = mappingBySel[f.selector] || {};
      const inv = inventoryBySel[f.selector] || {};
      const vr = verifyBySel[f.selector] || {};
      let mappingSource = 'none';
      if (st && atsAdapter?.getFieldMap) {
        const map = atsAdapter.getFieldMap() || {};
        const mapHit = Object.entries(map).some(([, sem]) => sem === st)
          && (f.name || f.id);
        if (mapHit && (f.name || f.id)) mappingSource = 'ats_exact_map_or_label';
      }
      if (f.atsHint) mappingSource = mappingSource === 'none' ? 'ats_hint' : mappingSource;
      if (st) mappingSource = mappingSource === 'none' ? 'semantic_classified' : mappingSource;

      return {
        label: (f.label || '').slice(0, 80) || null,
        nearbyHeading: (f.nearbyHeading || '').slice(0, 80) || null,
        name: f.name || null,
        id: f.id || null,
        tag: f.tag || null,
        type: f.type || null,
        role: f.role || null,
        required: !!f.required,
        selector: f.selector || null,
        semanticType: st,
        atsHint: f.atsHint || null,
        insideAdapterRoot: !!(formRoot && formRoot !== document
          ? (() => {
            try {
              const el = document.querySelector(f.selector);
              return !!(el && formRoot.contains(el));
            } catch { return null; }
          })()
          : true),
        mappingSource,
        profileSourcePresent: profileSourcePresentForSemantic(st, presence),
        proposedAction: m.action || null,
        inventoryCategory: inv.category || m.inventoryCategory || null,
        verification: vr.success === false
          ? { ok: false, reason: vr.reason || 'failed' }
          : (vr.success === true
            ? { ok: true, skipped: !!vr.skipped }
            : null),
        // Never include values / currentValue / URLs / emails
      };
    });

    const classified = fieldRows.filter((r) => r.semanticType).length;
    const mapped = fieldRows.filter((r) => r.proposedAction && r.proposedAction !== 'skip').length;
    const skipped = fieldRows.filter((r) => r.proposedAction === 'skip').length;

    let rootDescription = 'document';
    if (formRoot && formRoot !== document) {
      rootDescription = formRoot.id
        ? `#${formRoot.id}`
        : (formRoot.className ? `.${String(formRoot.className).split(/\s+/).filter(Boolean).join('.')}` : formRoot.tagName);
    }

    return {
      build: {
        extension: build,
        note: 'Compare with backend /api/meta.build.shortSha — must match after reload.',
      },
      page: {
        origin: sanitizePageOrigin(),
        // Path/query identifiers stripped where practical
        host: (() => { try { return location.hostname; } catch { return ''; } })(),
      },
      adapter: {
        name: atsAdapter?.name || null,
        root: rootDescription,
      },
      summary: {
        fieldsInDocument: docCount,
        fieldsInsideAdapterRoot: rootCount,
        fieldsExtracted: fields.length,
        fieldsSemanticallyClassified: classified,
        fieldsMappedFillable: mapped,
        fieldsSkipped: skipped,
      },
      profilePresence: presence,
      fields: fieldRows,
    };
  }

  async function collectAndCopySanitizedDiagnostics(profilePresence) {
    let presence = profilePresence || null;
    if (!presence) {
      try {
        const resp = await chrome.runtime.sendMessage({ type: 'getProfilePresence' });
        if (resp?.ok) presence = resp.presence;
      } catch { /* skip */ }
    }
    const report = buildSanitizedDiagnostics({ profilePresence: presence });
    lastDiagnosticsSnapshot = {
      ...(lastDiagnosticsSnapshot || {}),
      profilePresence: presence,
      report,
    };
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      return { ok: true, report, copied: true };
    } catch {
      return { ok: true, report, copied: false };
    }
  }

  function createOverlay() {
    if (overlayIsLive()) return overlayEl;
    // Workday SPA swaps can detach the previous overlay node — recreate.
    overlayEl = null;

    const build = getBuildInfo();
    overlayEl = document.createElement('div');
    overlayEl.id = `${PREFIX}-overlay`;
    overlayEl.innerHTML = `
      <div class="${PREFIX}-overlay-header">
        <span class="${PREFIX}-overlay-title">JobApply – Application Copilot</span>
        <div class="${PREFIX}-overlay-actions">
          <button type="button" class="${PREFIX}-overlay-minimize" title="Minimize" aria-label="Minimize">&#x2013;</button>
          <button type="button" class="${PREFIX}-overlay-close" title="Close" aria-label="Close">&#x2715;</button>
        </div>
      </div>
      <div class="${PREFIX}-overlay-build">JobApply source: ${build.sourceSha || build.shortSha}</div>
      <div class="${PREFIX}-overlay-body">
        <span class="${PREFIX}-overlay-status">Initializing...</span>
      </div>
    `;

    document.body.appendChild(overlayEl);

    overlayEl.querySelector(`.${PREFIX}-overlay-close`).addEventListener('click', () => {
      dismissOverlayToIdle();
    });

    const minBtn = overlayEl.querySelector(`.${PREFIX}-overlay-minimize`);
    minBtn.addEventListener('click', () => {
      const body = overlayEl.querySelector(`.${PREFIX}-overlay-body`);
      const collapsed = body.style.display === 'none';
      if (collapsed) {
        body.style.display = '';
        minBtn.innerHTML = '&#x2013;';
        minBtn.title = 'Minimize';
        minBtn.setAttribute('aria-label', 'Minimize');
        overlayEl.classList.remove(`${PREFIX}-overlay-collapsed`);
      } else {
        body.style.display = 'none';
        minBtn.innerHTML = '&#x25BC;'; // chevron: expand again
        minBtn.title = 'Expand';
        minBtn.setAttribute('aria-label', 'Expand');
        overlayEl.classList.add(`${PREFIX}-overlay-collapsed`);
      }
    });

    // Drag support on header
    const header = overlayEl.querySelector(`.${PREFIX}-overlay-header`);
    header.addEventListener('mousedown', onDragStart);

    return overlayEl;
  }

  // ─── Drag handling ───────────────────────────────────────────

  function onDragStart(e) {
    // Don't drag when clicking buttons
    if (e.target.closest('button')) return;
    e.preventDefault();

    const rect = overlayEl.getBoundingClientRect();
    dragState = {
      startX: e.clientX,
      startY: e.clientY,
      origLeft: rect.left,
      origTop: rect.top,
    };

    // Switch from bottom/right positioning to top/left for drag
    overlayEl.style.left = rect.left + 'px';
    overlayEl.style.top = rect.top + 'px';
    overlayEl.style.right = 'auto';
    overlayEl.style.bottom = 'auto';

    document.addEventListener('mousemove', onDragMove);
    document.addEventListener('mouseup', onDragEnd);
  }

  function onDragMove(e) {
    if (!dragState) return;
    e.preventDefault();

    const dx = e.clientX - dragState.startX;
    const dy = e.clientY - dragState.startY;

    const newLeft = Math.max(0, Math.min(window.innerWidth - 60, dragState.origLeft + dx));
    const newTop = Math.max(0, Math.min(window.innerHeight - 40, dragState.origTop + dy));

    overlayEl.style.left = newLeft + 'px';
    overlayEl.style.top = newTop + 'px';
  }

  function onDragEnd() {
    dragState = null;
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
  }

  // ─── Overlay mode rendering ──────────────────────────────────

  function getOverlayCounts() {
    let filled = 0;
    let review = 0;
    let failed = 0;
    let undone = 0;
    let already = 0;
    for (const [, entry] of fieldResults) {
      if (entry.status === 'filled') {
        if (entry.confidence < 0.8) review++;
        else filled++;
      } else if (entry.status === 'failed') {
        failed++;
      } else if (entry.status === 'undone') {
        undone++;
      } else if (entry.status === 'already_completed') {
        already++;
      }
    }
    return {
      filled,
      review,
      failed,
      undone,
      already,
      total: fieldResults.size,
    };
  }

  function renderCompactPill() {
    if (!overlayEl) return;

    const { filled, review, failed } = getOverlayCounts();
    const body = overlayEl.querySelector(`.${PREFIX}-overlay-body`);
    if (!body) return;

    overlayEl.classList.add(`${PREFIX}-overlay-compact`);
    overlayEl.classList.remove(`${PREFIX}-overlay-expanded`);
    overlayMode = 'compact';

    const parts = [];
    if (filled > 0) parts.push(`${filled} filled`);
    if (review > 0) parts.push(`${review} review`);
    if (failed > 0) parts.push(`${failed} failed`);
    if (!parts.length) parts.push('0 filled');

    body.innerHTML = `
      <div class="${PREFIX}-overlay-pill" title="Click to expand field list">
        <span class="${PREFIX}-overlay-pill-check">${failed && !filled ? '!' : '&#x2713;'}</span>
        <span class="${PREFIX}-overlay-pill-text">${parts.join(' \u00B7 ')}</span>
        <span class="${PREFIX}-overlay-pill-expand">&#x25BC;</span>
      </div>
    `;

    body.style.display = 'block';
    body.querySelector(`.${PREFIX}-overlay-pill`).addEventListener('click', () => {
      renderExpandedList();
    });
  }

  function renderExpandedList() {
    if (!overlayEl) return;

    const body = overlayEl.querySelector(`.${PREFIX}-overlay-body`);
    if (!body) return;

    overlayEl.classList.remove(`${PREFIX}-overlay-compact`);
    overlayEl.classList.add(`${PREFIX}-overlay-expanded`);
    overlayMode = 'expanded';

    // Show verified outcomes — never treat attempted/failed as green filled
    const entries = Array.from(fieldResults.entries()).filter(([, e]) => (
      e.status === 'filled' || e.status === 'failed' || e.status === 'undone'
      || e.status === 'already_completed'
    ));
    if (!entries.length) {
      body.innerHTML = `<span class="${PREFIX}-overlay-status">No verified fills.</span>`;
      return;
    }

    const rows = entries.map(([selector, entry]) => {
      let dotClass = 'gray';
      let displayValue = '';
      let undoBtnHtml = '';
      if (entry.status === 'filled') {
        dotClass = entry.confidence < 0.8 ? 'yellow' : 'green';
        displayValue = entry.proposedValue || '';
        undoBtnHtml = `<button class="${PREFIX}-undo-btn" data-selector="${escapeHtml(selector)}" title="Undo">&#x21A9;</button>`;
      } else if (entry.status === 'failed') {
        dotClass = 'red';
        displayValue = `failed to commit — manual entry required`;
      } else if (entry.status === 'undone') {
        dotClass = 'gray';
        displayValue = `(undone)`;
      } else if (entry.status === 'already_completed') {
        dotClass = 'gray';
        displayValue = 'already completed';
      }
      // Never show proposed personal values for failed rows
      const truncatedValue = displayValue.length > 50 ? displayValue.slice(0, 47) + '...' : displayValue;
      const label = entry.label || selector;
      const truncatedLabel = label.length > 30 ? label.slice(0, 27) + '...' : label;

      return `
        <div class="${PREFIX}-overlay-field-row ${entry.status === 'failed' ? `${PREFIX}-row-failed` : ''}" data-selector="${escapeHtml(selector)}">
          <span class="${PREFIX}-status-dot ${dotClass}"></span>
          <div class="${PREFIX}-overlay-field-info">
            <span class="${PREFIX}-overlay-field-label">${escapeHtml(truncatedLabel)}</span>
            <span class="${PREFIX}-overlay-field-value">${escapeHtml(truncatedValue)}</span>
          </div>
          ${undoBtnHtml}
        </div>
      `;
    }).join('');

    body.innerHTML = `
      <div class="${PREFIX}-overlay-field-list">
        ${rows}
      </div>
      <div class="${PREFIX}-overlay-collapse" title="Click to collapse">
        <span>&#x25B2; Collapse</span>
      </div>
    `;

    body.style.display = 'block';

    // Undo button handlers — only for verified fills
    body.querySelectorAll(`.${PREFIX}-undo-btn`).forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        undoField(btn.dataset.selector);
      });
    });

    // Collapse handler
    body.querySelector(`.${PREFIX}-overlay-collapse`).addEventListener('click', () => {
      renderCompactPill();
    });
  }

  function undoField(selector) {
    const result = fieldResults.get(selector);
    if (!result || result.status !== 'filled') return;
    const entry = originalValues.get(selector);
    if (!entry) return;

    const el = resolveElement(selector);
    if (!el) return;

    // Restore original value
    setNativeValue(el, entry.originalValue);
    dispatchEvents(el, ['input', 'change']);

    // Remove highlight classes
    el.classList.remove(`${PREFIX}-filled`);
    el.classList.remove(`${PREFIX}-review`);
    el.classList.remove(`${PREFIX}-failed`);

    setFieldResult(selector, { status: 'undone', reason: 'undone by user' });
    originalValues.delete(selector);

    // Re-render the current overlay mode
    if (overlayMode === 'expanded') {
      renderExpandedList();
    } else if (overlayMode === 'compact') {
      renderCompactPill();
    }
  }

  function updateOverlay(state, message, opts = {}) {
    const overlay = createOverlay();
    currentState = state;
    const msg = String(message || state || '');
    const forceStatus = !!opts.forceStatus
      || state === 'error'
      || state === 'analyzing'
      || state === 'review'
      || state === 'filling'
      || opts.unsupported
      || opts.newSection
      || /no form fields|no fillable|cancelled|unsupported|new application section|timed out|error:/i.test(msg);

    // Successful completion with tracked outcomes → compact pill.
    // Errors / unsupported / new-section messages must NEVER be hidden by the old pill.
    if (state === 'done' && fieldResults.size > 0 && !forceStatus) {
      overlayMode = 'compact';
      renderCompactPill();
      return;
    }

    // Status mode: show text message (+ optional Analyze action)
    overlayEl.classList.remove(`${PREFIX}-overlay-compact`);
    overlayEl.classList.remove(`${PREFIX}-overlay-expanded`);
    overlayMode = 'status';

    const body = overlay.querySelector(`.${PREFIX}-overlay-body`);
    if (body) {
      body.style.display = 'block';
      const analyzeBtn = (opts.showAnalyze || opts.newSection || opts.unsupported)
        ? `<div style="margin-top:10px"><button type="button" class="${PREFIX}-analyze-section-btn">Analyze current section</button></div>`
        : '';
      body.innerHTML = `<span class="${PREFIX}-overlay-status">${escapeHtml(msg)}</span>${analyzeBtn}`;
      body.querySelector(`.${PREFIX}-analyze-section-btn`)?.addEventListener('click', () => {
        clearPageScopedState({ keepCumulative: true });
        startFillFlow({ force: true });
      });
    }
  }

  function showOverlay(status) {
    updateOverlay(status, status);
  }

  function removeOverlay() {
    if (overlayEl) {
      try { overlayEl.remove(); } catch { /* ignore */ }
      overlayEl = null;
    }
    // Clean up drag listeners
    document.removeEventListener('mousemove', onDragMove);
    document.removeEventListener('mouseup', onDragEnd);
    dragState = null;
  }

  function dismissOverlayToIdle() {
    removeOverlay();
    currentState = 'idle';
  }

  function clearPageScopedState(opts = {}) {
    originalValues.clear();
    fieldResults.clear();
    preSubmitValues = {};
    overlayMode = 'status';
    try {
      document.querySelectorAll(`.${PREFIX}-highlight`).forEach(el => {
        el.classList.remove(`${PREFIX}-highlight`);
      });
    } catch { /* ignore */ }
    if (!opts.keepCumulative) {
      // full reset also stops multipage when abandoning an application
    }
    if (overlayIsLive()) {
      // Drop prior completion UI so the next message is visible
      overlayEl.classList.remove(`${PREFIX}-overlay-compact`, `${PREFIX}-overlay-expanded`, `${PREFIX}-overlay-review`);
    }
  }

  // ─── Learn prompt (post-submission) ───────────────────────────

  let preSubmitValues = {};

  function captureFormValues() {
    const values = {};
    const fields = extractFormData();
    for (const field of fields) {
      if (field.currentValue) {
        values[field.selector] = {
          value: field.currentValue,
          label: field.label,
          name: field.name,
        };
      }
    }
    return values;
  }

  function showLearnPrompt(newData) {
    if (!newData.length) return;

    // Remove any existing learn prompt
    const existing = document.getElementById(`${PREFIX}-learn-prompt`);
    if (existing) existing.remove();

    const promptEl = document.createElement('div');
    promptEl.id = `${PREFIX}-learn-prompt`;
    promptEl.innerHTML = `
      <div class="${PREFIX}-learn-modal">
        <div class="${PREFIX}-learn-header">
          <h3 class="${PREFIX}-learn-title">Save ${newData.length} new answer${newData.length > 1 ? 's' : ''} to JobApply?</h3>
          <button class="${PREFIX}-learn-close" aria-label="Close">\u00d7</button>
        </div>
        <div class="${PREFIX}-learn-list">
          ${newData.map((item, i) => `
            <label class="${PREFIX}-learn-item">
              <input type="checkbox" checked data-index="${i}">
              <div class="${PREFIX}-learn-item-detail">
                <span class="${PREFIX}-learn-item-label">${escapeHtml(item.label || item.name || 'Unknown field')}</span>
                <span class="${PREFIX}-learn-item-value">${escapeHtml(String(item.value).slice(0, 100))}</span>
              </div>
            </label>
          `).join('')}
        </div>
        <div class="${PREFIX}-learn-actions">
          <button class="${PREFIX}-learn-save">Save Selected</button>
          <button class="${PREFIX}-learn-dismiss">Dismiss</button>
        </div>
      </div>
    `;

    document.body.appendChild(promptEl);

    promptEl.querySelector(`.${PREFIX}-learn-save`).addEventListener('click', async () => {
      const checkboxes = promptEl.querySelectorAll('input[type="checkbox"]');
      const selectedData = [];
      checkboxes.forEach(cb => {
        if (cb.checked) {
          selectedData.push(newData[parseInt(cb.dataset.index)]);
        }
      });
      if (selectedData.length) {
        try {
          await chrome.runtime.sendMessage({
            type: 'saveLearnedData',
            data: { learned_fields: selectedData },
          });
          showToast(`Saved ${selectedData.length} answer${selectedData.length > 1 ? 's' : ''}`, 'success');
        } catch { /* skip */ }
      }
      promptEl.remove();
    });

    promptEl.querySelector(`.${PREFIX}-learn-dismiss`).addEventListener('click', () => {
      promptEl.remove();
    });

    promptEl.querySelector(`.${PREFIX}-learn-close`).addEventListener('click', () => {
      promptEl.remove();
    });
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ─── Toast notifications ─────────────────────────────────────

  function showToast(message, type = 'success') {
    const existing = document.getElementById(`${PREFIX}-toast`);
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.id = `${PREFIX}-toast`;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');

    const bgColor = type === 'success' ? '#22c55e' : type === 'error' ? '#ef4444' : '#3b82f6';
    toast.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 2147483647;
      background: ${bgColor}; color: white; padding: 12px 20px;
      border-radius: 8px; font: 14px/1.4 system-ui, sans-serif;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15); max-width: 360px;
      opacity: 0; transform: translateY(12px);
      transition: opacity 0.3s, transform 0.3s;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);

    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(12px)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);

    return toast;
  }

  // ─── Auto-track applied jobs ────────────────────────────────

  let autoTrackFired = false;

  async function autoTrackApplied() {
    if (autoTrackFired) return;
    autoTrackFired = true;

    try {
      const pageUrl = location.href;
      const result = await chrome.runtime.sendMessage({ type: 'markAppliedByUrl', url: pageUrl });
      if (result && result.ok) {
        showToast('Job marked as applied in JobApply', 'success');
      }
    } catch (err) {
      console.warn('[JobApply] autoTrackApplied failed:', err.message);
    }
  }

  // ─── Submission detection ─────────────────────────────────────

  function detectSubmission() {
    document.addEventListener('submit', handleSubmission, true);

    // Register pushState callback via central interceptor
    historyCallbacks.pushState.add(handleSubmission);

    document.addEventListener('click', (e) => {
      try {
        const btn = e.target.closest('button[type="submit"], input[type="submit"], [role="button"]');
        if (btn && btn.closest('form')) {
          setTimeout(handleSubmission, 1000);
        }
      } catch { /* skip */ }
    }, true);

    // MutationObserver: detect form removal or "thank you" confirmation pages
    const observer = new MutationObserver((mutations) => {
      try {
        for (const mutation of mutations) {
          // Check removed nodes for form elements
          for (const node of mutation.removedNodes) {
            if (node.nodeType !== 1) continue;
            if (node.tagName === 'FORM' || node.querySelector?.('form')) {
              setTimeout(handleSubmission, 500);
              return;
            }
          }

          // Check added nodes for success/confirmation indicators
          for (const node of mutation.addedNodes) {
            if (node.nodeType !== 1) continue;
            const text = (node.textContent || '').toLowerCase();
            if (text.includes('application submitted') ||
                text.includes('thank you for applying') ||
                text.includes('application received') ||
                text.includes('successfully submitted')) {
              handleSubmission();
              return;
            }
          }
        }
      } catch { /* skip */ }
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function handleSubmission() {
    try {
      if (Object.keys(preSubmitValues).length === 0) return;

      const postValues = captureFormValues();
      const newData = [];

      for (const [selector, post] of Object.entries(postValues)) {
        const pre = preSubmitValues[selector];
        if (!pre || pre.value !== post.value) {
          if (post.value && post.value.trim()) {
            newData.push({
              selector,
              label: post.label,
              name: post.name,
              value: post.value,
              previousValue: pre ? pre.value : null,
            });
          }
        }
      }

      if (newData.length > 0) {
        showLearnPrompt(newData);
      }

      // Auto-track this job as applied
      autoTrackApplied();
    } catch (err) {
      console.warn('[JobApply] handleSubmission failed:', err.message);
    }
  }

  // ─── Custom Q&A matching ─────────────────────────────────────

  function fuzzyMatchQA(fieldLabel, qaEntries) {
    if (!fieldLabel || !qaEntries || !qaEntries.length) return null;
    const label = fieldLabel.toLowerCase().trim();
    if (!label) return null;

    const labelWords = label.split(/\s+/).filter(w => w.length > 2);

    let bestMatch = null;
    let bestScore = 0;

    for (const qa of qaEntries) {
      const pattern = (qa.question_pattern || '').toLowerCase().trim();
      if (!pattern) continue;

      // Exact match
      if (label === pattern) return qa;

      // Substring: label contains pattern or pattern contains label
      if (label.includes(pattern) || pattern.includes(label)) {
        const score = 3;
        if (score > bestScore) { bestScore = score; bestMatch = qa; }
        continue;
      }

      // Keyword overlap: count shared words
      const patternWords = pattern.split(/\s+/).filter(w => w.length > 2);
      if (patternWords.length > 0 && labelWords.length > 0) {
        const shared = patternWords.filter(pw => labelWords.some(lw => lw.includes(pw) || pw.includes(lw)));
        const score = shared.length / Math.max(patternWords.length, labelWords.length);
        if (score >= 0.5 && score > bestScore) {
          bestScore = score;
          bestMatch = qa;
        }
      }
    }

    return bestMatch;
  }

  async function applyCustomQA(mappings) {
    let qaEntries;
    try {
      const qaResult = await chrome.runtime.sendMessage({ type: 'getCustomQA' });
      if (!qaResult || !qaResult.ok || !Array.isArray(qaResult.data)) return mappings;
      qaEntries = qaResult.data;
    } catch (err) {
      console.warn('[JobApply] applyCustomQA failed:', err.message);
      return mappings;
    }

    if (!qaEntries.length) return mappings;

    return mappings.map(mapping => {
      if (mapping.action !== 'skip') return mapping;

      const label = mapping.field_label || '';
      const match = fuzzyMatchQA(label, qaEntries);
      if (match && match.answer) {
        return { ...mapping, action: 'fill_text', value: match.answer, qa_matched: true };
      }
      return mapping;
    });
  }

  // ─── Review-before-fill ──────────────────────────────────────

  function fieldLooksLikePhone(mapping) {
    const text = `${mapping.field_label || ''} ${mapping.label || ''} ${mapping.selector || ''}`.toLowerCase();
    return /\bphone\b|\bmobile\b|\bcell\b|\btelephone\b|\btel\b/.test(text)
      || /\[type=["']?tel["']?\]/.test(mapping.selector || '');
  }

  function valueLooksLikePhone(value) {
    const digits = String(value ?? '').replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
  }

  /** Bucket duplicate DOM controls into one logical proposal (City, Phone, …). */
  function mappingLogicalKey(m) {
    if (!m || m.action === 'skip') return null;
    const text = `${m.field_label || ''} ${m.label || ''} ${m.selector || ''}`.toLowerCase();
    // Keep SMS / opt-in / country-code / device-type out of the phone-number bucket.
    if (/\bphone[-_]?sms|sms[-_]?opt|opt[-_]?in|text[-_]?me\b/.test(text)) return 'phone_sms_opt_in';
    if (/\b(phone.?country|country.?phone|country.?code|dial.?code|phone.?code)\b/.test(text)) {
      return 'phone_country';
    }
    if (/\b(phone.?device|device.?type)\b/.test(text)) return 'phone_device';
    if (/\b(phone|mobile|cell|telephone)\b/.test(text) || /\[type=["']?tel["']?\]/.test(m.selector || '')) {
      return 'phone';
    }
    if (/\bcity\b/.test(text)) return 'city';
    // Prefer label/name only for contact-email checkbox — selectors like
    // input[name="contact_pref"][value="email"] must not share this bucket.
    const labelName = `${m.field_label || ''} ${m.label || ''}`.toLowerCase();
    if (
      /contact_by_email/.test(text)
      || /\bcontact\s*me\s*by\s*email\b/.test(labelName)
      || /\bemail\s*me\s*about\b/.test(labelName)
    ) {
      return 'contact_by_email';
    }
    if (/\b(e-?mail|email)\b/.test(labelName) || /\[type=["']?email["']?\]/.test(m.selector || '')) {
      return 'email';
    }
    if (/\bfirst\s*name\b/.test(text)) return 'first_name';
    if (/\bmiddle\s*name\b/.test(text)) return 'middle_name';
    if (/\blast\s*name\b/.test(text)) return 'last_name';
    if (/\b(state|province)\b/.test(text) || /stateprovince/.test(text)) return 'state';
    if (/\b(postal|zip)\b/.test(text)) return 'postal_code';
    return null;
  }

  /** Drop phone numbers mapped onto GPA / essay / address / etc.; collapse duplicate proposals. */
  function sanitizeMappings(mappings) {
    if (!Array.isArray(mappings)) return [];
    const filtered = mappings.filter((m) => {
      if (!m) return false;
      if (m.action === 'skip') return true;
      // Never propose null/None/undefined/blank as a fill value.
      const raw = m.value;
      if (raw == null) return false;
      const s = String(raw).trim();
      if (!s || /^(none|null|undefined|nan)$/i.test(s)) {
        debugLog('Dropped empty/None mapping', m.selector, m.field_label);
        return false;
      }
      if (valueLooksLikePhone(m.value) && !fieldLooksLikePhone(m)) {
        debugLog('Dropped phone-like value on non-phone field', m.selector, m.field_label);
        return false;
      }
      return true;
    });

    const prefer = (a, b) => {
      const ca = a.confidence == null ? 1 : a.confidence;
      const cb = b.confidence == null ? 1 : b.confidence;
      if (ca !== cb) return ca >= cb ? a : b;
      return (a.selector || '').length <= (b.selector || '').length ? a : b;
    };

    const skips = [];
    const winners = new Map(); // dedupe key → mapping
    const order = [];

    for (const m of filtered) {
      if (!m) continue;
      if (m.action === 'skip') {
        skips.push(m);
        continue;
      }
      const logical = mappingLogicalKey(m);
      const key = logical
        || (m.selector ? `sel:${m.selector}` : `row:${order.length}:${m.field_label || ''}:${m.value || ''}`);
      if (winners.has(key)) {
        const prev = winners.get(key);
        winners.set(key, prefer(prev, m));
        debugLog('Deduped duplicate mapping', key, prev.selector, 'vs', m.selector);
      } else {
        winners.set(key, m);
        order.push(key);
      }
    }

    return [...skips, ...order.map((k) => winners.get(k))];
  }

  function reviewMappingsBeforeFill(mappings) {
    if (window.__jaSkipReview || window.__jaAutofillTest) {
      return Promise.resolve(mappings);
    }

    return new Promise((resolve) => {
      currentState = 'review';
      createOverlay();
      overlayEl.classList.add(`${PREFIX}-overlay-review`);
      // Clear drag-position / status-mode inline styles so pin + grid CSS win.
      overlayEl.style.left = '';
      overlayEl.style.top = '';
      overlayEl.style.right = '';
      overlayEl.style.bottom = '';
      overlayEl.style.width = '';
      overlayEl.style.height = '';
      const body = overlayEl.querySelector(`.${PREFIX}-overlay-body`);
      if (body) body.style.display = '';
      // Remove any leftover footer from a prior review pass.
      overlayEl.querySelector(`.${PREFIX}-review-actions`)?.remove();

      const fillable = mappings.filter(m => m.action && m.action !== 'skip');
      const reviewCount = fillable.filter(m => (m.confidence || 1) < 0.8).length;
      // DIV list (not <ul>) — Lever form CSS collapses bare lists and hid Fill.
      // Actions are a direct overlay child (sibling of body), never inside the list.
      const formatReviewValue = (m) => {
        if (m.displayValue) return String(m.displayValue);
        if (m.optionLabel) return String(m.optionLabel);
        if (m.action === 'check_checkbox') {
          const v = String(m.value ?? '').toLowerCase();
          if (v === 'yes' || v === 'true' || v === '1') {
            const fl = String(m.field_label || '');
            const m2 = fl.match(/^language:\s*(.+)$/i);
            if (m2) return m2[1].trim();
            return 'checked';
          }
        }
        return String(m.value ?? '');
      };
      body.innerHTML = `
        <div class="${PREFIX}-review-chrome">
          <p><strong>Review ${fillable.length} proposed fill${fillable.length === 1 ? '' : 's'}</strong></p>
          <p class="${PREFIX}-review-meta">${reviewCount} need review (confidence &lt; 0.8). Nonempty fields stay protected.</p>
          <p class="${PREFIX}-review-meta">Scroll the field list. Fill/Cancel are pinned under it.</p>
          <button type="button" class="${PREFIX}-diag-btn">Copy sanitized diagnostics</button>
          <label class="${PREFIX}-review-overwrite">
            <input type="checkbox" class="${PREFIX}-overwrite-toggle" ${overwriteExistingFields ? 'checked' : ''}/>
            Overwrite existing field values
          </label>
        </div>
        <div class="${PREFIX}-review-list" role="list" tabindex="0" aria-label="Proposed fills (${fillable.length})">
          ${fillable.map(m => {
            const conf = m.confidence == null ? 1 : m.confidence;
            const cls = conf < 0.8 ? 'yellow' : 'green';
            const label = (m.field_label || m.label || m.selector || '').toString().slice(0, 70);
            const val = formatReviewValue(m).slice(0, 80);
            return `<div role="listitem" class="${PREFIX}-review-item ${cls}"><span class="${PREFIX}-dot ${cls}"></span><strong>${escapeHtml(label)}</strong>: ${escapeHtml(val)} <em>(${conf.toFixed(2)})</em></div>`;
          }).join('')}
        </div>
      `;

      const actions = document.createElement('div');
      actions.className = `${PREFIX}-review-actions`;
      actions.innerHTML = `
        <button type="button" class="${PREFIX}-cancel-btn">Cancel — don't fill</button>
        <button type="button" class="${PREFIX}-approve-btn">Fill approved fields</button>
      `;
      overlayEl.appendChild(actions);

      const overwriteToggle = body.querySelector(`.${PREFIX}-overwrite-toggle`);
      overwriteToggle?.addEventListener('change', (e) => {
        overwriteExistingFields = !!e.target.checked;
        try { chrome.storage.local.set({ overwriteExistingFields }); } catch { /* ignore */ }
      });

      body.querySelector(`.${PREFIX}-diag-btn`)?.addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        const prev = btn.textContent;
        btn.textContent = 'Copying…';
        btn.disabled = true;
        try {
          const result = await collectAndCopySanitizedDiagnostics();
          btn.textContent = result.copied ? 'Copied (no PII)' : 'Ready — paste failed';
        } catch {
          btn.textContent = 'Copy failed';
        }
        setTimeout(() => {
          btn.textContent = prev;
          btn.disabled = false;
        }, 2000);
      });

      const finish = (result) => {
        overlayEl?.querySelector(`.${PREFIX}-review-actions`)?.remove();
        overlayEl?.classList.remove(`${PREFIX}-overlay-review`);
        resolve(result);
      };
      actions.querySelector(`.${PREFIX}-approve-btn`).addEventListener('click', () => {
        finish(mappings);
      });
      actions.querySelector(`.${PREFIX}-cancel-btn`).addEventListener('click', () => {
        finish(null);
      });
    });
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ─── Main fill flow ──────────────────────────────────────────

  const OVERALL_TIMEOUT_MS = 90000; // Max time for entire fill flow

  function looksLikeWorkdayMyExperienceCollapsed() {
    try {
      const text = `${document.body?.innerText || ''}`.slice(0, 8000);
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"]'))
        .map(h => (h.textContent || '').trim().toLowerCase())
        .join(' | ');
      const myExp = /my experience/i.test(text) || /my experience/i.test(headings);
      if (!myExp) return false;
      // Collapsed: Add buttons present, few actual text inputs for job/employer.
      const addButtons = Array.from(document.querySelectorAll('button, a[role="button"]'))
        .filter(b => /^(add|\+)$/i.test((b.textContent || '').trim()) || /add/i.test(b.getAttribute('aria-label') || ''));
      const workInputs = document.querySelectorAll(
        'input[data-automation-id*="jobTitle"], input[data-automation-id*="company"], '
        + 'input[name*="company"], input[name*="employer"], textarea[name*="description"]',
      );
      const fileInputs = document.querySelectorAll('input[type="file"]');
      const skills = /type to add skills|skills/i.test(text);
      return addButtons.length >= 1 && workInputs.length === 0 && (fileInputs.length >= 1 || skills);
    } catch {
      return false;
    }
  }

  async function startFillFlow(opts = {}) {
    await loadSafetySettings();
    try {
      // Remove the auto-detection badge if present
      removeBadge();

      // Real ATS iframe owns the form and this frame has no fields — no-op here.
      // Popup/badge/shortcut already broadcast startFill to all frames.
      if (shouldDeferToAtsIframe()) {
        return { deferred: true };
      }

      if (opts.force) {
        clearPageScopedState({ keepCumulative: true });
      }

      // Workday My Experience (collapsed): Add buttons only — Stage 1.1 needed.
      if (looksLikeWorkdayMyExperienceCollapsed()) {
        const msg = 'Workday My Experience detected. Work Experience, Education, '
          + 'Certifications, Websites, and résumé attachment require structured '
          + 'section support (Stage 1.1). Open an individual entry manually with Add, '
          + 'then Analyze current section — or continue after Stage 1.1 is installed.';
        updateOverlay('done', msg, { unsupported: true, showAnalyze: true, forceStatus: true });
        currentState = 'idle';
        return { unsupported: true, reason: 'workday_my_experience_collapsed' };
      }

      currentState = 'analyzing';

      // Look up the job ID by URL if not already set (enables resume/cover letter downloads)
      if (!currentJobId) {
        try {
          const lookupResult = await chrome.runtime.sendMessage({
            type: 'lookupJob',
            url: location.href,
          });
          if (lookupResult?.ok && lookupResult.data?.id) {
            currentJobId = lookupResult.data.id;
          }
        } catch { /* skip — job may not be saved yet */ }
      }

      // Detect ATS-specific adapter
      const atsAdapter = window.__jaAtsAdapters
        ? window.__jaAtsAdapters.detectATS(location.href, document)
        : null;

      if (atsAdapter) {
        showOverlay(`Detected ${atsAdapter.name} \u2014 analyzing form...`);
      } else {
        showOverlay('Analyzing form...');
      }

      // Analyze under timeout. Review waits outside the timeout so a long review
      // panel does not abort the fill.
      let mappings = null;
      let analyzeAborted = false;

      await withTimeout((async () => {
        preSubmitValues = captureFormValues();

        // Use ATS adapter's form root if available
        const formRoot = atsAdapter?.getFormRoot?.(document) || null;

        const formHtml = serializeFormHtml();

        // Extract via ATS adapter pipeline when available (exact semantic map).
        let structuredFields = [];
        let adapterFields = [];
        try {
          if (atsAdapter && window.__jaAtsCore?.extractWithAdapter) {
            structuredFields = window.__jaAtsCore.extractWithAdapter(
              atsAdapter,
              document,
              (root) => extractFormData(root || formRoot),
            );
          } else {
            structuredFields = extractFormData(formRoot);
            if (atsAdapter?.getExtraFields) {
              try { adapterFields = atsAdapter.getExtraFields(document) || []; } catch { /* skip */ }
            }
            if (atsAdapter?.enhanceExtraction) {
              structuredFields = atsAdapter.enhanceExtraction(structuredFields);
            }
          }
        } catch (err) {
          console.warn('[JobApply] ATS extractWithAdapter failed, falling back:', err.message);
          structuredFields = extractFormData(formRoot);
        }

        // In iframes with no form fields, bail silently — avoids showing
        // confusing overlays in tracking/footer/privacy iframes
        if (isInIframe() && !structuredFields.length) {
          removeOverlay();
          analyzeAborted = true;
          return;
        }

        if (!structuredFields.length && !adapterFields.length) {
          updateOverlay(
            'done',
            'No form fields detected on this page. Open the application form, then try Fill again.'
          );
          analyzeAborted = true;
          return;
        }

        // Enrich field hints (e.g. detect dial-code selects as country code fields)
        try {
          structuredFields = enrichFieldHints(structuredFields);
        } catch (err) {
          console.warn('[JobApply] enrichFieldHints failed:', err.message);
        }

        // Debug only (redacted): never log raw profile/answer values by default
        debugLog('Extracted fields:', structuredFields.map(f => ({
          selector: f.selector, tag: f.tag, type: f.type,
          label: f.label ? String(f.label).slice(0, 40) : '',
          name: f.name, role: f.role,
          semanticType: f.semanticType || null,
          fieldKind: f.fieldKind || null,
          currentValue: f.currentValue ? '[set]' : '[empty]',
          optionCount: f.options?.length || 0,
        })));

        // Include ATS metadata in the analysis request (background must forward these)
        const analyzePayload = {
          type: 'analyzeForm',
          formHtml,
          structuredFields,
          pageUrl: location.href,
        };
        if (atsAdapter) {
          analyzePayload.atsName = atsAdapter.name;
          analyzePayload.atsFieldMap = atsAdapter.getFieldMap?.() || {};
          if (adapterFields.length) {
            analyzePayload.adapterFields = adapterFields;
          }
        }

        let response;
        try {
          response = await withTimeout(
            chrome.runtime.sendMessage(analyzePayload),
            API_TIMEOUT_MS,
            'Form analysis'
          );
        } catch (err) {
          updateOverlay('error', `Timed out analyzing form. Is the server running?`);
          analyzeAborted = true;
          return;
        }

        debugLog('Analyze mapping count:', (response?.data?.mappings || []).length,
          (response?.data?.mappings || []).map(m => ({
            selector: m.selector,
            action: m.action,
            confidence: m.confidence,
            value: redactValue(m.value),
          })));

        if (!response || !response.ok) {
          updateOverlay('error', `Error: ${response?.error || 'Analysis failed'}`);
          analyzeAborted = true;
          return;
        }

        mappings = response.data?.mappings || [];
        const analyzeError = response.data?.error || '';
        lastDiagnosticsSnapshot = {
          ...(lastDiagnosticsSnapshot || {}),
          mappings: (mappings || []).map((m) => ({
            selector: m.selector,
            action: m.action,
            inventoryCategory: m.inventoryCategory || null,
            semanticType: m.semanticType || null,
            field_label: (m.field_label || '').slice(0, 80),
            // intentionally omit value
          })),
          inventory: response.data?.inventory || null,
          atsName: atsAdapter?.name || null,
        };

        if (!mappings.length) {
          updateOverlay(
            'done',
            analyzeError
              ? `${analyzeError}. No profile fields could be matched — check Settings → Profile and that Ollama is running.`
              : 'No fillable fields found'
          );
          analyzeAborted = true;
          return;
        }

        if (analyzeError) {
          showOverlay(`${analyzeError} — prepared ${mappings.length} matched profile field(s) for review...`);
        }

        // Post-process: fill skipped fields that match custom Q&A
        mappings = sanitizeMappings(await applyCustomQA(mappings));
        if (!mappings.length) {
          updateOverlay('done', 'No reliable field matches after filtering. Fill remaining fields manually.');
          analyzeAborted = true;
        }
      })(), OVERALL_TIMEOUT_MS, 'Autofill analysis');

      if (analyzeAborted || !mappings?.length) {
        return;
      }

      // Stage 1: review-before-fill (tests may set __jaSkipReview) — not timed
      const approved = await reviewMappingsBeforeFill(mappings);
      if (!approved) {
        updateOverlay('done', 'Fill cancelled — no fields were changed.');
        currentState = 'idle';
        return;
      }
      mappings = approved;

      await withTimeout((async () => {
        currentState = 'filling';
        const result = await fillForm(mappings, atsAdapter);

        const failedCount = result.results.filter(r => !r.success).length;
        let statusMsg = `Filled ${result.filledCount}/${result.total} fields.`;
        if (result.fillReport && window.__jaAtsAdapters?.formatFillReport) {
          statusMsg = window.__jaAtsAdapters.formatFillReport(result.fillReport);
        } else if (failedCount > 0) {
          statusMsg += ` ${failedCount} field${failedCount > 1 ? 's' : ''} need manual review.`;
        } else {
          statusMsg += ' Review highlighted fields.';
        }
        updateOverlay('done', statusMsg);
        // Expose structured report on the overlay for acceptance tests (no PII values).
        try {
          if (overlayEl && result.fillReport) {
            const safeResults = (result.results || []).map(r => ({
              selector: r.selector,
              success: !!r.success,
              skipped: !!r.skipped,
              alreadyCompleted: !!r.alreadyCompleted,
              reason: r.reason || '',
              action: r.action || r.mapping?.action || '',
              field_label: r.mapping?.field_label || r.mapping?.label || '',
            }));
            overlayEl.dataset.fillReport = JSON.stringify(result.fillReport);
            overlayEl.dataset.fillResults = JSON.stringify(safeResults);
          }
        } catch { /* ignore */ }

        preSubmitValues = captureFormValues();
        detectSubmission();

        // Start multi-page tracking or update cumulative progress
        if (multiPageState && multiPageState.currentPage > 1) {
          updateMultiPageProgress(result.filledCount);
        } else {
          startMultiPageTracking(result.filledCount);
        }
      })(), OVERALL_TIMEOUT_MS, 'Autofill fill');
    } catch (err) {
      if (err.message && err.message.includes('timed out')) {
        updateOverlay('error', 'Autofill timed out. The operation took too long — please try again or fill remaining fields manually.');
      } else {
        updateOverlay('error', `Error: ${err.message}`);
      }
    }
  }

  // ─── ATS iframe / embed detection ───────────────────────────

  const ATS_IFRAME_PATTERNS = [
    /(?:boards|job-boards)\.greenhouse\.io/i,
    /jobs\.lever\.co/i,
    /icims\.com/i,
    /taleo\.net/i,
  ];

  const ATS_EMBED_URL_PARAMS = ['gh_jid']; // Greenhouse job ID in parent page URL

  function hasAtsIframe() {
    try {
      const iframes = document.querySelectorAll('iframe');
      for (const iframe of iframes) {
        const src = iframe.src || '';
        for (const pattern of ATS_IFRAME_PATTERNS) {
          if (pattern.test(src)) return true;
        }
      }
    } catch { /* skip */ }
    return false;
  }

  function hasAtsEmbedContainer() {
    return !!(document.getElementById('grnhse_app')
      || document.querySelector('[class*="grnhse"]')
      || document.querySelector('iframe[id*="grnhse"]'));
  }

  function hasAtsUrlParam() {
    try {
      const params = new URLSearchParams(window.location.search);
      return ATS_EMBED_URL_PARAMS.some(p => params.has(p));
    } catch { return false; }
  }

  function isInIframe() {
    try { return window.self !== window.top; } catch { return true; }
  }

  /**
   * Only defer to a child ATS iframe when a real iframe exists and this
   * document has no local fillable fields. Do NOT defer merely because
   * #grnhse_app / gh_jid is present — Greenhouse often mounts the form in
   * the same document inside #grnhse_app.
   */
  function shouldDeferToAtsIframe() {
    if (isInIframe()) return false;
    if (!hasAtsIframe()) return false;
    try {
      const localFields = extractFormData(document);
      if (localFields && localFields.length > 0) return false;
    } catch { /* defer if extraction fails */ }
    return true;
  }

  // ─── Application form auto-detection ────────────────────────

  function detectApplicationForm() {
    const url = window.location.href;
    let confidence = 'none';

    // URL patterns (high confidence)
    const highConfidenceUrls = [
      /myworkdayjobs\.com\/.*\/job\//i,
      /(?:boards|job-boards)\.greenhouse\.io/i,
      /jobs\.lever\.co\/.*\/apply/i,
      /icims\.com\/.*\/job\//i,
      /taleo\.net\/.*\/apply/i,
      /\/careers?\/.*(apply|application)/i,
    ];

    // Parent page with ATS embed signals (e.g. ?gh_jid= for Greenhouse)
    if (hasAtsUrlParam() || hasAtsEmbedContainer()) {
      confidence = 'high';
    }

    for (const pattern of highConfidenceUrls) {
      if (pattern.test(url)) {
        confidence = 'high';
        break;
      }
    }

    // Form field signals — require job-specific fields within actual forms
    if (confidence !== 'high') {
      // Only consider fields inside <form> elements or known ATS containers
      const forms = document.querySelectorAll('form, [role="form"], [data-testid*="application"], .application-form');
      if (forms.length === 0) return 'none';

      const inputs = document.querySelectorAll('form input, form select, form textarea, form [role="textbox"], [role="form"] input, [role="form"] select, [role="form"] textarea');
      if (inputs.length === 0) return 'none';

      // Negative signals: password fields indicate login/registration
      for (const el of inputs) {
        if (el.type === 'password') return 'none';
      }

      // Negative signals: search forms
      for (const form of forms) {
        const formAction = form.getAttribute('action') || '';
        if (form.getAttribute('role') === 'search' || formAction.includes('search')) return 'none';
      }

      // Job-specific signals — fields that only appear on job applications
      const jobSpecificPatterns = /resum[eé]|cv[\b\s_\-.]upload|cover.?letter|work.?auth|visa.?status|salary.?expect|desired.?salary|years?.?of?.?experience|how.?did.?you.?(hear|find)|willing.?to.?relocate|security.?clearance|equal.?opportunity|eeo\b|start.?date|available.?start/i;
      // Generic contact fields
      const genericPatterns = /first.?name|last.?name|email|phone|address|city|state|zip/i;

      let jobSignals = 0;
      let genericSignals = 0;

      for (const el of inputs) {
        if (el.type === 'hidden' || el.type === 'submit' || el.type === 'button') continue;
        const name = el.name || '';
        const id = el.id || '';
        const label = findLabel(el);
        const placeholder = el.placeholder || '';
        const combined = `${name} ${id} ${label} ${placeholder}`;

        if (jobSpecificPatterns.test(combined)) {
          jobSignals++;
        } else if (genericPatterns.test(combined)) {
          genericSignals++;
        }

        // Resume/CV file upload is a very strong signal
        if (el.type === 'file' && /resum[eé]|cv[\b\s_\-.]|upload.?cv/i.test(combined)) {
          jobSignals += 2;
        }
      }

      // Page title must contain job-application-specific terms (not just "career")
      const pageText = document.title;
      const titleMatch = /\bapply\b|application.?form|job.?application|submit.?your.?application/i.test(pageText);

      // Require strong job-specific evidence
      if (jobSignals >= 2) {
        confidence = 'high';
      } else if (jobSignals >= 1 && genericSignals >= 2) {
        confidence = 'high';
      } else if (jobSignals >= 1 && titleMatch) {
        confidence = 'medium';
      } else if (genericSignals >= 3 && titleMatch) {
        confidence = 'medium';
      }
    }

    return confidence;
  }

  // ─── Auto-detection badge ──────────────────────────────────────

  let badgeEl = null;

  function removeBadge() {
    if (badgeEl) {
      badgeEl.remove();
      badgeEl = null;
    }
  }

  function showBadge(confidence) {
    if (badgeEl) return;

    badgeEl = document.createElement('div');
    badgeEl.className = 'ja-auto-badge' + (confidence === 'medium' ? ' ja-badge-medium' : '');
    badgeEl.innerHTML = `
      <span class="ja-auto-badge-main">
        <svg class="ja-auto-badge-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
        Fill with JobApply
      </span>
      <button class="ja-auto-badge-dismiss" title="Dismiss">\u00d7</button>
    `;

    document.body.appendChild(badgeEl);

    // Click main area to start fill
    badgeEl.querySelector('.ja-auto-badge-main').addEventListener('click', () => {
      removeBadge();
      if (shouldDeferToAtsIframe()) {
        chrome.runtime.sendMessage({ type: 'broadcastStartFill' }).catch(() => {});
      } else {
        startFillFlow();
      }
    });

    // Dismiss button: suppress for this hostname
    badgeEl.querySelector('.ja-auto-badge-dismiss').addEventListener('click', async (e) => {
      e.stopPropagation();
      const host = window.location.hostname;
      try {
        const result = await chrome.storage.local.get({ dismissedHosts: [] });
        const hosts = result.dismissedHosts;
        if (!hosts.includes(host)) {
          hosts.push(host);
          // Cap dismissed hosts to prevent unbounded storage growth
          if (hosts.length > 500) hosts.splice(0, hosts.length - 500);
          await chrome.storage.local.set({ dismissedHosts: hosts });
        }
      } catch (err) {
        console.warn('[JobApply] Failed to save dismissed host:', err.message);
      }
      removeBadge();
    });
  }

  async function tryShowBadge() {
    const confidence = detectApplicationForm();
    if (confidence === 'none') return;

    try {
      const result = await chrome.storage.local.get({ dismissedHosts: [] });
      const host = window.location.hostname;
      if (result.dismissedHosts.includes(host)) return;
      showBadge(confidence);
    } catch (err) {
      console.warn('[JobApply] Failed to check dismissed hosts:', err.message);
    }
  }

  // Run detection after page load (with delay for SPA content)
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(tryShowBadge, 500));
  } else {
    setTimeout(tryShowBadge, 500);
  }

  // Watch for SPA navigation via debounced DOM mutations
  let badgeObserverTimeout = null;
  const badgeObserver = new MutationObserver(() => {
    if (badgeObserverTimeout) clearTimeout(badgeObserverTimeout);
    badgeObserverTimeout = setTimeout(() => {
      if (!badgeEl && currentState === 'idle') {
        tryShowBadge();
      }
    }, 1000);
  });
  badgeObserver.observe(document.documentElement, {
    childList: true,
    subtree: true,
  });


  // ─── Multi-page / same-URL section tracking ─────────────────

  let multiPageState = null;
  let cumulativeFillStats = { pages: 0, filled: 0 };

  function buildSectionFingerprint() {
    // Non-PII fingerprint for Workday same-URL section transitions.
    try {
      const url = location.href.split('#')[0];
      const ats = window.__jaAtsAdapters?.detectATS?.(location.href, document);
      const platform = ats?.name || 'unknown';
      const headings = Array.from(document.querySelectorAll('h1, h2, h3, [role="heading"]'))
        .slice(0, 12)
        .map(h => (h.textContent || '').trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 80))
        .filter(Boolean);
      const progress = Array.from(document.querySelectorAll(
        '[data-automation-id*="progress"], [data-automation-id*="step"], '
        + '[aria-current="step"], .css-1yys72e, [class*="progress"]',
      ))
        .slice(0, 6)
        .map(el => (el.getAttribute('data-automation-id') || el.textContent || '')
          .trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 60))
        .filter(Boolean);
      const sectionLabels = [
        'work experience', 'education', 'certifications', 'skills',
        'resume', 'cv', 'websites', 'social', 'my information', 'my experience',
        'application questions', 'voluntary', 'self identify', 'review',
      ].filter(label => {
        try {
          return (document.body?.innerText || '').toLowerCase().includes(label);
        } catch { return false; }
      });
      const fieldSig = Array.from(document.querySelectorAll(
        'input:not([type="hidden"]), select, textarea, [role="combobox"], '
        + 'button[aria-haspopup], [data-automation-id]',
      ))
        .slice(0, 80)
        .map(el => {
          const auto = el.getAttribute('data-automation-id') || '';
          const name = el.getAttribute('name') || '';
          const id = el.id || '';
          const type = (el.getAttribute('type') || el.tagName || '').toLowerCase();
          const req = el.required ? '1' : '0';
          return [auto, name, id, type, req].filter(Boolean).join(':');
        })
        .filter(Boolean)
        .sort();
      return JSON.stringify({
        url,
        platform,
        headings,
        progress,
        sectionLabels,
        fieldSig,
      });
    } catch {
      return JSON.stringify({ url: location.href, platform: 'unknown' });
    }
  }

  function startMultiPageTracking(filledOnThisPage) {
    stopMultiPageTracking();

    const origin = location.origin;
    cumulativeFillStats.pages += 1;
    cumulativeFillStats.filled += filledOnThisPage || 0;
    multiPageState = {
      origin,
      currentPage: 1,
      totalFilled: filledOnThisPage || 0,
      lastUrl: location.href,
      lastFingerprint: buildSectionFingerprint(),
      observer: null,
      debounceTimer: null,
      popstateHandler: null,
      hashchangeHandler: null,
    };

    function onPageChange(mutationList) {
      if (!multiPageState) return;
      if (location.origin !== multiPageState.origin) {
        stopMultiPageTracking();
        return;
      }
      // Ignore mutations that only touch JobApply overlay/badge nodes.
      // Do not include m.target when it is document/body — that would never ignore.
      if (mutationList && mutationList.length) {
        const isJaNode = (n) => {
          if (!n || n.nodeType !== 1) return true;
          const el = /** @type {Element} */ (n);
          if (el === document.body || el === document.documentElement) return false;
          return !!(el.closest?.(`#${PREFIX}-overlay, #${PREFIX}-multipage-badge, .${PREFIX}-badge`)
            || (el.id || '').startsWith(PREFIX)
            || (typeof el.className === 'string' && el.className.includes(PREFIX)));
        };
        const onlyJa = mutationList.every(m => {
          const touched = [...m.addedNodes, ...m.removedNodes];
          if (touched.length) return touched.every(isJaNode);
          return isJaNode(m.target);
        });
        if (onlyJa) return;
      }
      clearTimeout(multiPageState.debounceTimer);
      multiPageState.debounceTimer = setTimeout(() => checkForNewPage(), 800);
    }

    function checkForNewPage() {
      if (!multiPageState) return;
      const currentUrl = location.href;
      const fp = buildSectionFingerprint();
      const urlChanged = currentUrl !== multiPageState.lastUrl;
      const sectionChanged = fp !== multiPageState.lastFingerprint;
      if (!urlChanged && !sectionChanged) return;

      multiPageState.lastUrl = currentUrl;
      multiPageState.lastFingerprint = fp;
      multiPageState.currentPage++;

      // Retire prior page fill state; keep cumulative counters only.
      clearPageScopedState({ keepCumulative: true });
      removeOverlay();
      currentState = 'idle';

      showNewSectionDetected(multiPageState.currentPage);
    }

    // MutationObserver on body for DOM changes (SPA / same-URL Workday steps)
    multiPageState.observer = new MutationObserver((mutations) => onPageChange(mutations));
    multiPageState.observer.observe(document.body, { childList: true, subtree: true });

    // Popstate and hashchange for URL-based navigation
    multiPageState.popstateHandler = () => onPageChange();
    multiPageState.hashchangeHandler = () => onPageChange();
    window.addEventListener('popstate', multiPageState.popstateHandler);
    window.addEventListener('hashchange', multiPageState.hashchangeHandler);

    // Register history callbacks via central interceptor
    multiPageState.pushStateCallback = () => onPageChange();
    multiPageState.replaceStateCallback = () => onPageChange();
    historyCallbacks.pushState.add(multiPageState.pushStateCallback);
    historyCallbacks.replaceState.add(multiPageState.replaceStateCallback);
  }

  function stopMultiPageTracking() {
    if (!multiPageState) return;

    if (multiPageState.observer) {
      multiPageState.observer.disconnect();
    }
    clearTimeout(multiPageState.debounceTimer);

    if (multiPageState.popstateHandler) {
      window.removeEventListener('popstate', multiPageState.popstateHandler);
    }
    if (multiPageState.hashchangeHandler) {
      window.removeEventListener('hashchange', multiPageState.hashchangeHandler);
    }

    // Unregister history callbacks
    if (multiPageState.pushStateCallback) {
      historyCallbacks.pushState.delete(multiPageState.pushStateCallback);
    }
    if (multiPageState.replaceStateCallback) {
      historyCallbacks.replaceState.delete(multiPageState.replaceStateCallback);
    }

    multiPageState = null;
  }

  function showNewSectionDetected(pageNum) {
    const existing = document.getElementById(`${PREFIX}-multipage-badge`);
    if (existing) existing.remove();

    updateOverlay(
      'done',
      `New application section detected${pageNum ? ` (step ${pageNum})` : ''}. `
        + 'Review the page, then analyze — JobApply will not fill automatically.',
      { newSection: true, showAnalyze: true, forceStatus: true },
    );
    // Ready for Analyze / toolbar Fill — not stuck in a completed-fill state.
    currentState = 'idle';
  }

  function showMultiPageBadge(pageNum) {
    showNewSectionDetected(pageNum);
    const existing = document.getElementById(`${PREFIX}-multipage-badge`);
    if (existing) existing.remove();

    const badge = document.createElement('div');
    badge.id = `${PREFIX}-multipage-badge`;
    badge.textContent = `New section detected \u2014 analyze?`;
    badge.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:2147483647;'
      + 'padding:10px 18px;background:#1a73e8;color:#fff;border-radius:8px;'
      + 'font:14px/1.4 -apple-system,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.3);';

    badge.addEventListener('click', async () => {
      badge.remove();
      clearPageScopedState({ keepCumulative: true });
      await startFillFlow({ force: true });
    });
    document.body.appendChild(badge);
  }

  function updateMultiPageProgress(filledOnThisPage) {
    if (!multiPageState) return;
    multiPageState.totalFilled += filledOnThisPage;
    const total = multiPageState.totalFilled;
    const pages = multiPageState.currentPage;
    updateOverlay('done', `Filled ${total} fields across ${pages} page${pages > 1 ? 's' : ''}.`);
  }

  // ─── Queue fill orchestration (content side) ─────────────────

  let queueContext = null; // { queueItemId, jobId, jobTitle, company, position, total }
  let queueBannerEl = null;

  function showQueueBanner(position, total, jobTitle, company) {
    removeQueueBanner();

    queueBannerEl = document.createElement('div');
    queueBannerEl.id = `${PREFIX}-queue-banner`;

    const label = jobTitle
      ? `${jobTitle}${company ? ' at ' + company : ''}`
      : `Application ${position} of ${total}`;

    queueBannerEl.innerHTML = `
      <div class="${PREFIX}-queue-banner-inner">
        <span class="${PREFIX}-queue-banner-progress">${position}/${total}</span>
        <span class="${PREFIX}-queue-banner-label">${escapeHtml(label)}</span>
        <div class="${PREFIX}-queue-banner-actions">
          <button class="${PREFIX}-queue-done-btn" title="Mark as submitted and move to next">Done</button>
          <button class="${PREFIX}-queue-skip-btn" title="Skip this job and move to next">Skip</button>
          <button class="${PREFIX}-queue-cancel-btn" title="Cancel the entire queue">Cancel</button>
        </div>
      </div>
    `;

    document.body.appendChild(queueBannerEl);

    queueBannerEl.querySelector(`.${PREFIX}-queue-done-btn`).addEventListener('click', () => {
      handleQueueAction('submitted');
    });

    queueBannerEl.querySelector(`.${PREFIX}-queue-skip-btn`).addEventListener('click', () => {
      handleQueueAction('skipped');
    });

    queueBannerEl.querySelector(`.${PREFIX}-queue-cancel-btn`).addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'cancelQueue' });
      removeQueueBanner();
      queueContext = null;
    });
  }

  function removeQueueBanner() {
    if (queueBannerEl) {
      queueBannerEl.remove();
      queueBannerEl = null;
    }
  }

  function handleQueueAction(action) {
    if (!queueContext) return;

    chrome.runtime.sendMessage({
      type: 'queueUserAction',
      queueItemId: queueContext.queueItemId,
      action,
    });

    removeQueueBanner();
    queueContext = null;
  }

  async function startQueueFill(message) {
    await loadSafetySettings();
    if (!enableQueueFill && !window.__jaAutofillTest) {
      console.info('[JobApply] Queue fill disabled by default (enableQueueFill=false)');
      return;
    }

    if (shouldDeferToAtsIframe()) {
      return;
    }

    queueContext = {
      queueItemId: message.queueItemId,
      jobId: message.jobId,
      jobTitle: message.jobTitle || '',
      company: message.company || '',
      position: message.queuePosition,
      total: message.queueTotal,
    };

    showQueueBanner(
      queueContext.position,
      queueContext.total,
      queueContext.jobTitle,
      queueContext.company
    );

    // Set jobId and trigger the normal fill flow
    if (message.jobId) currentJobId = message.jobId;
    await startFillFlow();

    // Report fill completed (NOT submitted — user must explicitly submit)
    if (queueContext) {
      try {
        await chrome.runtime.sendMessage({
          type: 'reportFillStatus',
          queueItemId: queueContext.queueItemId,
          status: 'filled',
          details: { state: currentState },
        });
      } catch { /* skip */ }
    }
  }

  // ─── Message handler ──────────────────────────────────────────

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Validate message origin — only accept messages from this extension
    if (sender.id !== chrome.runtime.id) return false;

    try {
      switch (message.type) {
        case 'startFill': {
          if (message.jobId) currentJobId = message.jobId;
          if (currentState === 'analyzing' || currentState === 'filling' || currentState === 'review') {
            sendResponse({
              ok: false,
              accepted: false,
              busy: true,
              state: currentState,
              error: `JobApply is busy (${currentState}). Wait or press Escape, then try again.`,
            });
            return false;
          }
          // Parent page with a real ATS iframe: do not "accept" a silent no-op —
          // the iframe frame must accept instead.
          if (shouldDeferToAtsIframe()) {
            sendResponse({
              ok: true,
              accepted: false,
              deferred: true,
              state: 'idle',
              error: null,
            });
            return false;
          }
          // Acknowledge immediately so the popup can close; run analysis async.
          sendResponse({
            ok: true,
            accepted: true,
            state: 'analyzing',
            fieldCount: null,
          });
          Promise.resolve()
            .then(() => startFillFlow({ force: !!message.force }))
            .catch(err => {
              try {
                updateOverlay('error', `Error: ${err.message}`, { forceStatus: true });
              } catch { /* ignore */ }
            });
          return false;
        }

        case 'queueFill':
          startQueueFill(message).then(() => {
            sendResponse({ ok: true, state: currentState });
          }).catch(err => {
            sendResponse({ ok: false, error: err.message });
          });
          return true;

        case 'getStatus':
          sendResponse({ ok: true, state: currentState, queueActive: !!queueContext });
          return false;

        case 'getSanitizedDiagnostics': {
          const report = buildSanitizedDiagnostics({
            profilePresence: message.profilePresence || null,
          });
          sendResponse({ ok: true, report });
          return false;
        }

        case 'writeClipboardText': {
          const text = message.text || '';
          navigator.clipboard.writeText(text).then(() => {
            sendResponse({ ok: true });
          }).catch(() => {
            sendResponse({ ok: false, error: 'clipboard write failed' });
          });
          return true;
        }

        default:
          return false;
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
      return false;
    }
  });

  // ─── Keyboard shortcut: Escape to dismiss overlay ─────────────

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;

    // Don't intercept Escape when user is focused on a form field
    const active = document.activeElement;
    if (active) {
      const tag = active.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if (active.isContentEditable) return;
    }

    // Dismiss overlay if present
    if (overlayEl || overlayIsLive()) {
      dismissOverlayToIdle();
    }
  });

  // ─── Job Board Detection & Overlay ──────────────────────────────

  const JOB_BOARD_CONFIGS = {
    'linkedin.com': {
      name: 'LinkedIn',
      listingSelector: '.job-card-container, .jobs-search-results__list-item, .scaffold-layout__list-item',
      titleSelector: '.job-card-list__title, .job-card-container__link, a.job-card-list__title--link',
      companySelector: '.job-card-container__primary-description, .artdeco-entity-lockup__subtitle',
      locationSelector: '.job-card-container__metadata-item, .artdeco-entity-lockup__caption',
      getJobUrl: (card) => {
        const link = card.querySelector('a[href*="/jobs/view/"], a[href*="/jobs/collections/"]');
        if (!link) return null;
        try {
          const url = new URL(link.href, window.location.origin);
          url.search = '';
          url.hash = '';
          return url.href;
        } catch { return null; }
      },
    },
    'indeed.com': {
      name: 'Indeed',
      listingSelector: '.job_seen_beacon, .jobsearch-ResultsList .result, .tapItem',
      titleSelector: '.jobTitle a, h2.jobTitle span, .jcs-JobTitle span',
      companySelector: '.companyName, [data-testid="company-name"], .company_location .companyName',
      locationSelector: '.companyLocation, [data-testid="text-location"]',
      getJobUrl: (card) => {
        const link = card.querySelector('a[href*="/viewjob"], a[href*="/rc/clk"], a.jcs-JobTitle');
        if (!link) return null;
        try {
          const url = new URL(link.href, window.location.origin);
          url.search = '';
          url.hash = '';
          return url.href;
        } catch { return null; }
      },
    },
    'dice.com': {
      name: 'Dice',
      listingSelector: '[data-cy="search-card"], .card-content, dhi-search-card',
      titleSelector: 'a.card-title-link, [data-cy="card-title-link"]',
      companySelector: 'a[data-cy="search-result-company-name"], .card-company a',
      locationSelector: 'span[data-cy="search-result-location"], .card-posted-date',
      getJobUrl: (card) => {
        const link = card.querySelector('a[href*="/job-detail/"], a.card-title-link');
        if (!link) return null;
        try {
          const url = new URL(link.href, window.location.origin);
          url.search = '';
          url.hash = '';
          return url.href;
        } catch { return null; }
      },
    },
    'glassdoor.com': {
      name: 'Glassdoor',
      listingSelector: '.JobsList_jobListItem__wjTHv, li[data-test="jobListing"]',
      titleSelector: 'a[data-test="job-title"], .JobCard_jobTitle__GLyJ1',
      companySelector: '.EmployerProfile_compactEmployerName__9MGiV, .JobCard_companyName__N1YM5',
      locationSelector: '.JobCard_location__N_iYE, [data-test="emp-location"]',
      getJobUrl: (card) => {
        const link = card.querySelector('a[href*="/job-listing/"], a[data-test="job-title"]');
        if (!link) return null;
        try {
          const url = new URL(link.href, window.location.origin);
          url.search = '';
          url.hash = '';
          return url.href;
        } catch { return null; }
      },
    },
  };

  function detectJobBoard() {
    const hostname = window.location.hostname;
    for (const [domain, config] of Object.entries(JOB_BOARD_CONFIGS)) {
      if (hostname.includes(domain)) {
        return config;
      }
    }
    return null;
  }

  function parseJobCard(card, config) {
    const titleEl = card.querySelector(config.titleSelector);
    const companyEl = card.querySelector(config.companySelector);
    const locationEl = card.querySelector(config.locationSelector);
    const url = config.getJobUrl(card);

    if (!titleEl || !url) return null;

    return {
      title: titleEl.textContent.trim(),
      company: companyEl ? companyEl.textContent.trim() : '',
      location: locationEl ? locationEl.textContent.trim() : '',
      url,
      source: config.name,
    };
  }

  function createSaveButton(jobData, card) {
    const existing = card.querySelector(`.${OVERLAY_PREFIX}-save-btn`);
    if (existing) return existing;

    const btn = document.createElement('button');
    btn.className = `${OVERLAY_PREFIX}-save-btn`;
    btn.textContent = 'Save to JobApply';
    btn.title = 'Save this job to JobApply';

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      btn.disabled = true;
      btn.textContent = 'Saving...';
      btn.classList.add(`${OVERLAY_PREFIX}-saving`);

      try {
        const response = await chrome.runtime.sendMessage({
          type: 'saveJob',
          jobData,
        });

        if (response && response.ok) {
          btn.textContent = 'Saved';
          btn.classList.remove(`${OVERLAY_PREFIX}-saving`);
          btn.classList.add(`${OVERLAY_PREFIX}-saved`);
          btn.disabled = true;

          if (response.data?.score != null) {
            showScoreBadge(card, response.data.score);
          }
        } else {
          btn.textContent = 'Error — Retry';
          btn.classList.remove(`${OVERLAY_PREFIX}-saving`);
          btn.classList.add(`${OVERLAY_PREFIX}-error`);
          btn.disabled = false;
        }
      } catch {
        btn.textContent = 'Error — Retry';
        btn.classList.remove(`${OVERLAY_PREFIX}-saving`);
        btn.classList.add(`${OVERLAY_PREFIX}-error`);
        btn.disabled = false;
      }
    });

    const wrapper = document.createElement('div');
    wrapper.className = `${OVERLAY_PREFIX}-actions`;
    wrapper.appendChild(btn);
    card.style.position = card.style.position || 'relative';
    card.appendChild(wrapper);

    return btn;
  }

  function showScoreBadge(card, score) {
    let badge = card.querySelector(`.${OVERLAY_PREFIX}-score-badge`);
    if (!badge) {
      badge = document.createElement('span');
      badge.className = `${OVERLAY_PREFIX}-score-badge`;
      card.style.position = card.style.position || 'relative';
      card.appendChild(badge);
    }

    const numScore = Math.round(Number(score));
    badge.textContent = `${numScore}%`;
    badge.title = `JobApply match score: ${numScore}%`;

    badge.classList.remove(
      `${OVERLAY_PREFIX}-score-high`,
      `${OVERLAY_PREFIX}-score-mid`,
      `${OVERLAY_PREFIX}-score-low`
    );

    if (numScore >= 75) {
      badge.classList.add(`${OVERLAY_PREFIX}-score-high`);
    } else if (numScore >= 50) {
      badge.classList.add(`${OVERLAY_PREFIX}-score-mid`);
    } else {
      badge.classList.add(`${OVERLAY_PREFIX}-score-low`);
    }
  }

  async function processJobCards(config) {
    const cards = document.querySelectorAll(config.listingSelector);
    if (!cards.length) return;

    for (const card of cards) {
      if (card.dataset.cpProcessed) continue;
      card.dataset.cpProcessed = 'true';

      const jobData = parseJobCard(card, config);
      if (!jobData) continue;

      try {
        const lookupResp = await chrome.runtime.sendMessage({
          type: 'getScoreForUrl',
          url: jobData.url,
        });

        if (lookupResp && lookupResp.ok && lookupResp.data) {
          const btn = createSaveButton(jobData, card);
          btn.textContent = 'Saved';
          btn.classList.add(`${OVERLAY_PREFIX}-saved`);
          btn.disabled = true;

          if (lookupResp.data.score != null) {
            showScoreBadge(card, lookupResp.data.score);
          }
        } else {
          createSaveButton(jobData, card);
        }
      } catch {
        createSaveButton(jobData, card);
      }
    }
  }

  let scanTimer = null;

  function scheduleScan(config) {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => processJobCards(config), SCAN_DEBOUNCE_MS);
  }

  function initJobBoardOverlay() {
    const config = detectJobBoard();
    if (!config) return;

    processJobCards(config);

    const observer = new MutationObserver(() => scheduleScan(config));
    observer.observe(document.body, { childList: true, subtree: true });
  }

  // Job board overlay is off by default in JobApply Stage 1 (review-first product).
  async function maybeInitJobBoardOverlay() {
    await loadSafetySettings();
    if (!enableJobBoardOverlay) return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', initJobBoardOverlay);
    } else {
      setTimeout(initJobBoardOverlay, 300);
    }
  }
  maybeInitJobBoardOverlay();

  // ─── Export for testing ────────────────────────────────────────

  if (typeof window !== 'undefined' && window.__jaAutofillTest) {
    window.__jaAutofillTestAPI = {
      extractFormData,
      resolveElement,
      fillField,
      findTypeaheadDropdown,
      getDropdownOptions,
      fuzzyMatchDropdownOption,
      fuzzyMatchOption,
      getFieldHints,
      enrichFieldHints,
      looksLikePhoneNumber,
      isPhoneField,
      isPhoneExtensionField,
      isPhoneCountryCodeField,
      hasNearbyPhoneCountryCode,
      isDateField,
      parseFlexibleDate,
      fillDateField,
      isRichTextEditor,
      findRichTextEditor,
      fillRichText,
      isCustomDropdownTrigger,
      handleCustomDropdown,
      typeAndSelectDropdown,
      dismissOpenDropdowns,
      deepQuerySelectorAll,
      deepQuerySelector,
      simulateTyping,
      isElementVisible,
      buildSelector,
      findLabel,
      setNativeValue,
      dispatchEvents,
      clickOption,
      serializeFormHtml,
      fillForm,
      fuzzyMatchQA,
      applyCustomQA,
      detectApplicationForm,
      showBadge,
      removeBadge,
      tryShowBadge,
      undoField,
      originalValues,
      detectFileUploadFields,
      showUploadHelper,
      detectUploadType,

      startMultiPageTracking,
      stopMultiPageTracking,

      // Auto-track API
      showToast,
      autoTrackApplied,
      get autoTrackFired() { return autoTrackFired; },
      set autoTrackFired(v) { autoTrackFired = v; },

      // Job board overlay API
      detectJobBoard,
      parseJobCard,
      createSaveButton,
      showScoreBadge,
      processJobCards,
      initJobBoardOverlay,
      JOB_BOARD_CONFIGS,
      get enableJobBoardOverlay() { return enableJobBoardOverlay; },
      set enableJobBoardOverlay(v) { enableJobBoardOverlay = !!v; },

      // Queue fill API
      showQueueBanner,
      removeQueueBanner,
      handleQueueAction,
      startQueueFill,
      get queueContext() { return queueContext; },
      set queueContext(v) { queueContext = v; },
      get enableQueueFill() { return enableQueueFill; },
      set enableQueueFill(v) { enableQueueFill = !!v; },

      // Safety flags
      get overwriteExistingFields() { return overwriteExistingFields; },
      set overwriteExistingFields(v) { overwriteExistingFields = !!v; },
      isEffectivelyEmpty,
      isSubmitControl,
      reviewMappingsBeforeFill,
      sanitizeMappings,
      verifyFilled,
      withVerification,
      fillGreenhouseLocation,
      fillLeverLocation,
      isGreenhouseLocationControl,
      isLeverLocationControl,
      findLocationHiddenCompanion,
      findOwnedLocationDropdown,
      buildSanitizedDiagnostics,
      collectAndCopySanitizedDiagnostics,
      getBuildInfo,
      get fieldResults() { return fieldResults; },
      getOverlayCounts,
      looksLikeLocationField,
      getNearbyHeading,
      matchPhoneCountryCodeOption,
      extractDialCode,
      isSelectCountryInPhoneWidget,
      findSharedPhoneComponent,

      // Timeout / flow internals for testing
      get API_TIMEOUT_MS() { return API_TIMEOUT_MS; },
      withTimeout,
      startFillFlow,
      getNewMappings,
      updateOverlay,
      createOverlay,
      removeOverlay,
      dismissOverlayToIdle,
      clearPageScopedState,
      buildSectionFingerprint,
      looksLikeWorkdayMyExperienceCollapsed,
      overlayIsLive,
      showNewSectionDetected,
      get currentState() { return currentState; },
      set currentState(v) { currentState = v; },
      get overlayEl() { return overlayEl; },
      set overlayEl(v) { overlayEl = v; },
    };
  }

})();

(() => {
  'use strict';

  if (window.__jaAtsCore) return;

  /**
   * @typedef {Object} FieldDescriptor
   * @property {string} selector
   * @property {string} tag
   * @property {string|null} type
   * @property {string|null} name
   * @property {string|null} id
   * @property {string|null} label
   * @property {string|null} placeholder
   * @property {boolean} required
   * @property {string} currentValue
   * @property {string|null} [atsHint]
   * @property {Array<{value:string,text:string}>} [options]
   */

  /**
   * @typedef {Object} AtsAdapter
   * @property {string} name
   * @property {(url:string, doc:Document) => boolean} detect
   * @property {(doc:Document) => Element|Document} getFormRoot
   * @property {() => Record<string,string>} getFieldMap
   * @property {(fields:FieldDescriptor[]) => FieldDescriptor[]} [enhanceExtraction]
   * @property {(doc:Document) => Element|null} [getNextButton]
   * @property {() => object|null} [getDropdownHandler]
   * @property {(doc:Document) => FieldDescriptor[]} [getExtraFields]
   */

  function createFieldDescriptor(partial) {
    return {
      selector: partial.selector || '',
      tag: partial.tag || 'input',
      type: partial.type ?? null,
      name: partial.name ?? null,
      id: partial.id ?? null,
      label: partial.label ?? null,
      placeholder: partial.placeholder ?? null,
      nearbyHeading: partial.nearbyHeading ?? partial.label ?? null,
      required: !!partial.required,
      currentValue: partial.currentValue ?? '',
      atsHint: partial.atsHint ?? null,
      // Exact ATS map key (linkedin_url, current_company, …) — distinct from atsHint tags.
      semanticType: partial.semanticType ?? null,
      // Phone-country / other classifier output — must survive normalize.
      fieldKind: partial.fieldKind ?? null,
      isContentEditable: !!partial.isContentEditable,
      options: partial.options ?? undefined,
      role: partial.role ?? null,
    };
  }

  function normalizeFieldDescriptor(field) {
    if (!field || typeof field !== 'object') return createFieldDescriptor({});
    return createFieldDescriptor(field);
  }

  function wrapLegacyAdapter(legacy) {
    return {
      name: legacy.name,
      detect(url, doc) {
        return legacy.match(url, doc);
      },
      getFormRoot(doc) {
        return legacy.getFormRoot ? legacy.getFormRoot(doc) : doc;
      },
      getFieldMap() {
        return legacy.getFieldMap ? legacy.getFieldMap() : {};
      },
      enhanceExtraction(fields) {
        return legacy.enhanceExtraction ? legacy.enhanceExtraction(fields) : fields;
      },
      getNextButton(doc) {
        return legacy.getNextButton ? legacy.getNextButton(doc) : null;
      },
      getDropdownHandler() {
        return legacy.getDropdownHandler ? legacy.getDropdownHandler() : null;
      },
      getExtraFields(doc) {
        return legacy.getExtraFields ? legacy.getExtraFields(doc) : [];
      },
      // Preserve legacy reference for gradual migration
      _legacy: legacy,
    };
  }

  function assertAdapterContract(adapter) {
    const required = ['name', 'detect', 'getFormRoot', 'getFieldMap'];
    for (const key of required) {
      if (typeof adapter[key] !== 'function' && key !== 'name') {
        throw new Error(`Adapter ${adapter.name || 'unknown'} missing ${key}`);
      }
      if (key === 'name' && !adapter.name) {
        throw new Error('Adapter missing name');
      }
    }
    return adapter;
  }

  function detectAdapter(adapters, url, doc) {
    try {
      return adapters.find(a => a.detect(url, doc)) || null;
    } catch {
      return null;
    }
  }

  function applyFieldMapHints(fields, fieldMap, doc) {
    if (!fieldMap || !fields?.length) return fields;
    const root = doc || document;
    for (const field of fields) {
      for (const [selector, semantic] of Object.entries(fieldMap)) {
        try {
          const el = root.querySelector(selector);
          if (!el) continue;
          let fieldEl = null;
          try { fieldEl = root.querySelector(field.selector); } catch { /* skip */ }
          if (fieldEl === el) {
            // Prefer dedicated semanticType; do not overwrite atsHint content tags.
            if (!field.semanticType) field.semanticType = semantic;
            if (semantic === 'phone_country_code' || semantic === 'phone_country') {
              field.fieldKind = field.fieldKind || 'phone_country';
            }
          }
        } catch { /* skip */ }
      }
    }
    return fields;
  }

  function extractWithAdapter(adapter, doc, baseExtractFn) {
    const root = adapter.getFormRoot(doc);
    let fields = baseExtractFn ? baseExtractFn(root) : [];
    // Preserve extractor extras (fieldKind/isContentEditable) through normalize.
    fields = fields.map(normalizeFieldDescriptor);
    fields = applyFieldMapHints(fields, adapter.getFieldMap(), root);
    if (adapter.getExtraFields) {
      fields = fields.concat(adapter.getExtraFields(doc).map(normalizeFieldDescriptor));
    }
    if (adapter.enhanceExtraction) {
      fields = adapter.enhanceExtraction(fields);
    }
    return fields;
  }

  const SENSITIVE_SKIP_PATTERNS = [
    /submit control/i,
    /refusing to interact/i,
    /phone extension/i,
    /phone number for non-phone/i,
    /sensitive/i,
    /eeo/i,
    /veteran/i,
    /disabilit/i,
    /race/i,
    /gender/i,
  ];

  function isSensitiveSkip(result) {
    if (!result?.skipped) return false;
    const reason = String(result.reason || '');
    return SENSITIVE_SKIP_PATTERNS.some(re => re.test(reason));
  }

  /**
   * Build fill report from per-field results (+ optional mapping metadata).
   * @param {Array<object>} results
   * @param {Record<string, object>} [mappingBySelector]
   */
  function buildFillReport(results, mappingBySelector = {}) {
    const report = {
      filled: 0,
      filled_from_profile: 0,
      savedAnswers: 0,
      saved_answer_available: 0,
      aiDrafts: 0,
      ai_draft_available: 0,
      needsReview: 0,
      skippedSensitive: 0,
      alreadyCompleted: 0,
      already_completed: 0,
      failed: 0,
      failed_verification: 0,
      file_attachment_unavailable: 0,
      legal_or_consent_manual: 0,
      eeo_skipped: 0,
      explicit_profile_value_missing: 0,
      unsupported: 0,
      conditional_not_applicable: 0,
      total: results?.length || 0,
      categories: [],
    };

    for (const result of results || []) {
      const mapping = mappingBySelector[result.selector] || {};
      const confidence = mapping.confidence ?? 1;
      const reason = String(result.reason || mapping.reason || '');
      const category = result.inventoryCategory
        || mapping.inventoryCategory
        || null;
      const label = (mapping.field_label || result.field_label || result.selector || '').toString().slice(0, 80);

      if (category) {
        report.categories.push({ selector: result.selector, label, category });
        if (report[category] != null) report[category]++;
      }

      if (!result.success) {
        report.failed++;
        if (/did not stick|verif|cleared|empty after/i.test(reason) || category === 'failed_verification') {
          report.failed_verification++;
        }
        if (/file upload|attachment/i.test(reason) || category === 'file_attachment_unavailable') {
          report.file_attachment_unavailable++;
        }
        continue;
      }

      if (result.alreadyCompleted) {
        report.alreadyCompleted++;
        report.already_completed++;
        continue;
      }

      if (result.skipped) {
        if (/manual review|legal|consent|acknowledgment/i.test(reason)
            || category === 'legal_or_consent_manual') {
          report.needsReview++;
          report.legal_or_consent_manual++;
        } else if (/eeo/i.test(reason) || category === 'eeo_skipped') {
          report.skippedSensitive++;
          report.eeo_skipped++;
        } else if (isSensitiveSkip(result)) {
          report.skippedSensitive++;
        } else if (/file upload|attachment/i.test(reason)) {
          report.file_attachment_unavailable++;
        } else if (/missing|no profile/i.test(reason)) {
          report.explicit_profile_value_missing++;
        }
        continue;
      }

      if (mapping.qa_matched || mapping.source === 'custom_qa') {
        report.savedAnswers++;
        report.saved_answer_available++;
        report.filled++;
        report.filled_from_profile++;
        continue;
      }

      if (confidence < 0.8) {
        report.needsReview++;
        report.aiDrafts++;
        report.ai_draft_available++;
        continue;
      }

      if (confidence < 1) {
        report.aiDrafts++;
      }

      report.filled++;
      report.filled_from_profile++;
    }

    return report;
  }

  function formatFillReport(report) {
    const parts = [];
    if (report.filled) parts.push(`${report.filled} filled`);
    if (report.savedAnswers) parts.push(`${report.savedAnswers} saved`);
    if (report.aiDrafts) parts.push(`${report.aiDrafts} AI`);
    if (report.needsReview) parts.push(`${report.needsReview} review`);
    if (report.skippedSensitive) parts.push(`${report.skippedSensitive} sensitive skipped`);
    if (report.alreadyCompleted) parts.push(`${report.alreadyCompleted} already set`);
    if (report.failed_verification) parts.push(`${report.failed_verification} verify failed`);
    if (report.file_attachment_unavailable) parts.push(`${report.file_attachment_unavailable} resume attach N/A`);
    if (report.failed) parts.push(`${report.failed} failed`);
    return parts.length ? parts.join(' · ') : '0 fields';
  }

  window.__jaAtsCore = {
    createFieldDescriptor,
    normalizeFieldDescriptor,
    wrapLegacyAdapter,
    assertAdapterContract,
    detectAdapter,
    applyFieldMapHints,
    extractWithAdapter,
    buildFillReport,
    formatFillReport,
    isSensitiveSkip,
  };
})();

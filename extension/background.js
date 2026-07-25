const DEFAULT_SERVER_URL = 'http://localhost:8085';

async function getServerUrl() {
  const { serverUrl } = await chrome.storage.local.get({ serverUrl: DEFAULT_SERVER_URL });
  const cleaned = serverUrl.replace(/\/+$/, '');
  // Validate URL scheme to prevent fetching non-HTTP URLs
  if (!/^https?:\/\//i.test(cleaned)) {
    throw new Error('Server URL must start with http:// or https://');
  }
  return cleaned;
}

async function apiFetch(path, options = {}) {
  const base = await getServerUrl();
  const url = `${base}${path}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 50000);
  try {
    const resp = await fetch(url, {
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`API ${resp.status}: ${resp.statusText}`);
    }
    return resp;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function checkConnection() {
  try {
    // Prefer /api/meta (always mounted in slim mode). Fall back to /api/health.
    let resp;
    try {
      resp = await apiFetch('/api/meta');
    } catch {
      resp = await apiFetch('/api/health');
    }
    const data = await resp.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function getFullProfile() {
  try {
    const resp = await apiFetch('/api/profile/full');
    return { ok: true, data: await resp.json() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/** Booleans / counts only — never profile values. */
function profilePresenceFrom(profile) {
  if (!profile || typeof profile !== 'object') return null;
  const jobs = Array.isArray(profile.work_history) ? profile.work_history : [];
  const current = jobs.filter((j) => {
    const v = j?.is_current;
    return v === 1 || v === true || v === '1' || String(v).toLowerCase() === 'true' || String(v).toLowerCase() === 'yes';
  });
  let currentCompanyResolution = 'current_company_missing';
  if (current.length > 1) currentCompanyResolution = 'ambiguous_multiple_current_jobs';
  else if (current.length === 1 && String(current[0]?.company || '').trim()) {
    currentCompanyResolution = 'resolved';
  } else if (jobs.some((j) => String(j?.company || '').trim())) {
    currentCompanyResolution = 'resolved_fallback_most_recent';
  }
  return {
    locationPresent: !!(String(profile.location || '').trim() || String(profile.address_city || '').trim()),
    preferredNamePresent: !!String(profile.preferred_name || '').trim(),
    linkedinPresent: !!String(profile.linkedin_url || '').trim(),
    githubPresent: !!String(profile.github_url || '').trim(),
    portfolioPresent: !!(
      String(profile.portfolio_url || '').trim() || String(profile.website_url || '').trim()
    ),
    workHistoryCount: jobs.length,
    currentWorkHistoryCount: current.length,
    currentCompanyResolution,
    educationCount: Array.isArray(profile.education) ? profile.education.length : 0,
    languageCount: Array.isArray(profile.languages) ? profile.languages.length : 0,
    timezonePresent: !!(String(profile.timezone || '').trim() || String(profile.time_zone || '').trim()),
  };
}

async function getProfilePresence() {
  const result = await getFullProfile();
  if (!result.ok) return result;
  return { ok: true, presence: profilePresenceFrom(result.data) };
}

async function copySanitizedDiagnostics(tabId) {
  if (!tabId) return { ok: false, error: 'No tab id' };
  let frames = [{ frameId: 0 }];
  try {
    const all = await chrome.webNavigation.getAllFrames({ tabId });
    if (all?.length) frames = all;
  } catch { /* top only */ }

  const presenceResult = await getProfilePresence();
  const presence = presenceResult.ok ? presenceResult.presence : { error: presenceResult.error };

  let best = null;
  for (const f of frames) {
    try {
      const resp = await chrome.tabs.sendMessage(
        tabId,
        { type: 'getSanitizedDiagnostics', profilePresence: presence },
        { frameId: f.frameId },
      );
      if (resp?.ok && resp.report) {
        const extracted = resp.report?.summary?.fieldsExtracted ?? 0;
        if (!best || extracted > (best.report?.summary?.fieldsExtracted ?? 0)) {
          best = resp;
        }
      }
    } catch { /* frame without content script */ }
  }
  if (!best?.report) {
    return { ok: false, error: 'No application frame returned diagnostics. Open the job form and reload the extension.' };
  }

  const text = JSON.stringify(best.report, null, 2);
  // Prefer writing clipboard from the page context (popup may lose focus).
  for (const f of frames) {
    try {
      const written = await chrome.tabs.sendMessage(
        tabId,
        { type: 'writeClipboardText', text },
        { frameId: f.frameId },
      );
      if (written?.ok) return { ok: true, report: best.report, copied: true };
    } catch { /* try next */ }
  }
  return { ok: true, report: best.report, copied: false, text };
}

async function analyzeForm(formHtml, adapterFields, structuredFields, meta = {}) {
  try {
    const payload = { form_html: formHtml };
    if (structuredFields?.length) {
      payload.fields = structuredFields;
    } else if (adapterFields?.length) {
      payload.fields = adapterFields;
    }
    // Forward ATS semantic context — required for exact field-map fills.
    if (meta.atsName) payload.ats_name = meta.atsName;
    if (meta.atsFieldMap && typeof meta.atsFieldMap === 'object') {
      payload.ats_field_map = meta.atsFieldMap;
    }
    if (meta.pageUrl) payload.page_url = meta.pageUrl;
    if (meta.jobContext && typeof meta.jobContext === 'object') {
      payload.job_context = meta.jobContext;
    }
    // Default Fill never blocks on Qwen; opt-in only.
    payload.include_ai = meta.includeAi === true;
    const resp = await apiFetch('/api/autofill/analyze', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return { ok: true, data: await resp.json() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function getResumeForJob(jobId) {
  try {
    const base = await getServerUrl();
    const resp = await fetch(`${base}/api/jobs/${jobId}/resume.pdf`);
    if (!resp.ok) throw new Error(`${resp.status}`);
    const blob = await resp.blob();
    return { ok: true, data: blob };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function downloadDocument(jobId, docType) {
  try {
    const base = await getServerUrl();
    const endpoint = docType === 'cover-letter'
      ? `/api/jobs/${jobId}/cover-letter.pdf`
      : `/api/jobs/${jobId}/resume.pdf`;
    const resp = await fetch(`${base}${endpoint}`);
    if (!resp.ok) throw new Error(`${resp.status}: ${resp.statusText}`);
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const filename = docType === 'cover-letter'
      ? `cover-letter-${jobId}.pdf`
      : `resume-${jobId}.pdf`;
    await chrome.downloads.download({ url, filename, saveAs: false });
    // Clean up the object URL after a delay
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function saveLearnedData(data) {
  try {
    const resp = await apiFetch('/api/profile/learn', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    return { ok: true, data: await resp.json() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function getCustomQA() {
  try {
    const resp = await apiFetch('/api/custom-qa');
    return { ok: true, data: await resp.json() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function saveJob(jobData) {
  try {
    const resp = await apiFetch('/api/jobs/save-external', {
      method: 'POST',
      body: JSON.stringify(jobData),
    });
    return { ok: true, data: await resp.json() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function lookupJob(url) {
  try {
    const resp = await apiFetch(`/api/jobs/lookup?url=${encodeURIComponent(url)}`);
    return { ok: true, data: await resp.json() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function markAppliedByUrl(url) {
  try {
    const resp = await apiFetch('/api/jobs/mark-applied-by-url', {
      method: 'POST',
      body: JSON.stringify({ url }),
    });
    return { ok: true, data: await resp.json() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function getScoreForUrl(url) {
  try {
    const resp = await apiFetch(`/api/jobs/lookup?url=${encodeURIComponent(url)}`);
    const data = await resp.json();
    return { ok: true, data };
  } catch {
    return { ok: false };
  }
}

// ─── Queue fill orchestration ───────────────────────────────────

let queueState = null; // { items: [], currentIndex: 0, tabId: null }

const QUEUE_STORAGE_KEY = '__jaQueueState';
const TAB_LOAD_TIMEOUT_MS = 30000; // Max wait for tab to reach 'complete'

async function persistQueueState() {
  if (queueState) {
    await chrome.storage.session.set({ [QUEUE_STORAGE_KEY]: queueState });
  } else {
    await chrome.storage.session.remove(QUEUE_STORAGE_KEY);
  }
}

async function restoreQueueState() {
  try {
    const result = await chrome.storage.session.get(QUEUE_STORAGE_KEY);
    if (result[QUEUE_STORAGE_KEY]) {
      queueState = result[QUEUE_STORAGE_KEY];
    }
  } catch { /* session storage may not be available */ }
}

// Restore queue state on service worker wake-up
restoreQueueState();

async function reportFillStatus(queueItemId, status, details = {}) {
  try {
    const resp = await apiFetch(`/api/queue/${queueItemId}/fill-status`, {
      method: 'POST',
      body: JSON.stringify({ status, ...details }),
    });
    return { ok: true, data: await resp.json() };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

async function processNextQueueItem() {
  // Iterative loop instead of recursion to prevent stack overflow on repeated errors
  while (queueState && queueState.currentIndex < queueState.items.length) {
    const item = queueState.items[queueState.currentIndex];

    try {
      const tab = await chrome.tabs.create({ url: item.apply_url, active: true });
      queueState.tabId = tab.id;
      await persistQueueState();

      // Wait for tab to finish loading with timeout fallback
      await new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          chrome.tabs.onUpdated.removeListener(listener);
          chrome.tabs.onRemoved.removeListener(removedListener);
          reject(new Error('Tab load timed out'));
        }, TAB_LOAD_TIMEOUT_MS);

        function listener(tabId, changeInfo) {
          if (tabId !== tab.id || changeInfo.status !== 'complete') return;
          chrome.tabs.onUpdated.removeListener(listener);
          chrome.tabs.onRemoved.removeListener(removedListener);
          clearTimeout(timeoutId);
          resolve();
        }

        function removedListener(tabId) {
          if (tabId !== tab.id) return;
          chrome.tabs.onUpdated.removeListener(listener);
          chrome.tabs.onRemoved.removeListener(removedListener);
          clearTimeout(timeoutId);
          reject(new Error('Tab closed before loading'));
        }

        chrome.tabs.onUpdated.addListener(listener);
        chrome.tabs.onRemoved.addListener(removedListener);
      });

      // Send queueFill to content script with delay for SPA hydration
      setTimeout(() => {
        if (!queueState) return;
        chrome.tabs.sendMessage(tab.id, {
          type: 'queueFill',
          queueItemId: item.id,
          jobId: item.job_id,
          jobTitle: item.title || '',
          company: item.company || '',
          queuePosition: queueState.currentIndex + 1,
          queueTotal: queueState.items.length,
        });
      }, 1500);

      // Report that we started filling
      await reportFillStatus(item.id, 'filling');

      return { ok: true, processing: true, position: queueState.currentIndex + 1, total: queueState.items.length };
    } catch (err) {
      // Report error and move to next item (iterative, not recursive)
      await reportFillStatus(item.id, 'error', { error: err.message });
      queueState.currentIndex++;
      await persistQueueState();
    }
  }

  // Queue complete or exhausted
  if (queueState) {
    const completed = queueState.currentIndex;
    const total = queueState.items.length;
    queueState = null;
    await persistQueueState();
    return { ok: true, done: true, completed, total };
  }
  return { ok: false, error: 'No active queue' };
}

async function handleQueueUserAction(queueItemId, action) {
  if (!queueState) return { ok: false, error: 'No active queue' };

  const currentItem = queueState.items[queueState.currentIndex];
  if (!currentItem || currentItem.id !== queueItemId) {
    return { ok: false, error: 'Queue item mismatch' };
  }

  // Report status to backend
  const status = action === 'submitted' ? 'submitted'
    : action === 'skipped' ? 'skipped'
    : 'filled';
  await reportFillStatus(queueItemId, status);

  // Move to next item
  queueState.currentIndex++;
  await persistQueueState();
  return processNextQueueItem();
}

async function startQueueFill(items) {
  if (!items || !items.length) {
    return { ok: false, error: 'No queue items provided' };
  }

  // Cancel any existing queue
  queueState = {
    items,
    currentIndex: 0,
    tabId: null,
  };
  await persistQueueState();

  return processNextQueueItem();
}

async function cancelQueueFill() {
  if (!queueState) return { ok: false, error: 'No active queue' };

  const remaining = queueState.items.length - queueState.currentIndex;
  queueState = null;
  await persistQueueState();
  return { ok: true, cancelled: true, remaining };
}

function getQueueStatus() {
  if (!queueState) return { ok: true, active: false };
  return {
    ok: true,
    active: true,
    position: queueState.currentIndex + 1,
    total: queueState.items.length,
    currentItem: queueState.items[queueState.currentIndex] || null,
  };
}

// Clean up queue state if the active tab is closed
chrome.tabs.onRemoved.addListener(async (tabId) => {
  if (queueState && queueState.tabId === tabId) {
    const currentItem = queueState.items[queueState.currentIndex];
    if (currentItem) {
      reportFillStatus(currentItem.id, 'skipped', { reason: 'tab_closed' });
    }
    queueState.currentIndex++;
    await persistQueueState();
    if (queueState.currentIndex < queueState.items.length) {
      processNextQueueItem();
    } else {
      queueState = null;
      await persistQueueState();
    }
  }
});

// ─── Keyboard shortcut handler ─────────────────────────────────
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'start-fill') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      let frames = [{ frameId: 0 }];
      try {
        const all = await chrome.webNavigation.getAllFrames({ tabId: tab.id });
        if (all?.length) frames = all;
      } catch { /* top frame only */ }
      await Promise.all(frames.map(f =>
        chrome.tabs.sendMessage(tab.id, { type: 'startFill' }, { frameId: f.frameId })
          .catch(() => null)
      ));
    }
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const handler = async () => {
    try {
      switch (message.type) {
        case 'checkConnection':
          return await checkConnection();
        case 'getFullProfile':
          return await getFullProfile();
        case 'getProfilePresence':
          return await getProfilePresence();
        case 'copySanitizedDiagnostics':
          return await copySanitizedDiagnostics(message.tabId || sender.tab?.id);
        case 'analyzeForm':
          return await analyzeForm(
            message.formHtml,
            message.adapterFields,
            message.structuredFields,
            {
              atsName: message.atsName || message.ats_name,
              atsFieldMap: message.atsFieldMap || message.ats_field_map,
              pageUrl: message.pageUrl || message.page_url,
              jobContext: message.jobContext || message.job_context,
              includeAi: message.includeAi === true || message.include_ai === true,
            },
          );
        case 'getResumeForJob':
          return await getResumeForJob(message.jobId);
        case 'saveLearnedData':
          return await saveLearnedData(message.data);
        case 'getCustomQA':
          return await getCustomQA();
        case 'downloadResume':
          return await downloadDocument(message.jobId, 'resume');
        case 'downloadCoverLetter':
          return await downloadDocument(message.jobId, 'cover-letter');
        case 'saveJob':
          return await saveJob(message.jobData);
        case 'lookupJob':
          return await lookupJob(message.url);
        case 'getScoreForUrl':
          return await getScoreForUrl(message.url);
        case 'markAppliedByUrl':
          return await markAppliedByUrl(message.url);
        case 'fillFromQueue':
          return await startQueueFill(message.items);
        case 'queueUserAction':
          return await handleQueueUserAction(message.queueItemId, message.action);
        case 'cancelQueue':
          return await cancelQueueFill();
        case 'getQueueStatus':
          return getQueueStatus();
        case 'reportFillStatus':
          return await reportFillStatus(message.queueItemId, message.status, message.details);
        case 'broadcastStartFill': {
          // Broadcast startFill to every frame (Greenhouse/Lever embeds are iframes).
          // Default tabs.sendMessage only hits the top frame.
          const tabId = sender.tab?.id || message.tabId;
          if (!tabId) return { ok: false, error: 'No tab context' };
          let frames = [{ frameId: 0 }];
          try {
            const all = await chrome.webNavigation.getAllFrames({ tabId });
            if (all?.length) frames = all;
          } catch { /* permission or API unavailable — top frame only */ }
          const results = await Promise.all(frames.map(async (f) => {
            try {
              const resp = await chrome.tabs.sendMessage(
                tabId,
                { type: 'startFill' },
                { frameId: f.frameId },
              );
              const accepted = !!(resp && resp.ok && resp.accepted);
              return {
                frameId: f.frameId,
                delivered: true,
                accepted,
                state: resp?.state || null,
                fieldCount: resp?.fieldCount ?? null,
                error: resp?.error || null,
                unsupported: !!resp?.unsupported,
              };
            } catch (err) {
              return {
                frameId: f.frameId,
                delivered: false,
                accepted: false,
                state: null,
                fieldCount: null,
                error: err?.message || String(err),
              };
            }
          }));
          const acceptedCount = results.filter(r => r.accepted).length;
          if (!acceptedCount) {
            return {
              ok: false,
              error: 'No application frame accepted Fill Application. Reload the extension and page, then try again.',
              frames: results.length,
              results,
              acceptedCount: 0,
            };
          }
          return {
            ok: true,
            frames: results.length,
            results,
            acceptedCount,
          };
        }
        default:
          return { ok: false, error: `Unknown message type: ${message.type}` };
      }
    } catch (err) {
      return { ok: false, error: err.message };
    }
  };

  handler().then(sendResponse);
  return true; // keep channel open for async response
});

const statusDot = document.getElementById('statusDot');
const statusText = document.getElementById('statusText');
const fillBtn = document.getElementById('fillBtn');
const diagBtn = document.getElementById('diagBtn');
const diagHint = document.getElementById('diagHint');
const buildRow = document.getElementById('buildRow');
const serverUrlInput = document.getElementById('serverUrl');
const saveUrlBtn = document.getElementById('saveUrlBtn');
const settingsLink = document.getElementById('settingsLink');

let isConnected = false;
let backendBuild = null;

function extensionBuild() {
  const info = globalThis.__JA_BUILD_INFO__ || {};
  return {
    shortSha: info.shortSha || 'unknown',
    sha: info.sha || 'unknown',
    branch: info.branch || 'unknown',
  };
}

function renderBuildRow() {
  const ext = extensionBuild();
  const extSha = ext.sourceSha || ext.shortSha;
  const be = backendBuild?.sourceSha || backendBuild?.shortSha || backendBuild?.git_sha;
  let text = `JobApply source: ${extSha}`;
  if (be) {
    text += be === extSha
      ? ` · backend match`
      : ` · backend ${be} (reload/restart)`;
  }
  buildRow.textContent = text;
  buildRow.title = [
    `extension source ${extSha}`,
    ext.sha ? `extension sha ${ext.sha}` : '',
    backendBuild?.sha ? `backend sha ${backendBuild.sha}` : '',
    backendBuild?.liveGit ? 'backend liveGit=true' : '',
  ].filter(Boolean).join('\n');
}

async function init() {
  const { serverUrl } = await chrome.storage.local.get({ serverUrl: 'http://localhost:8085' });
  serverUrlInput.value = serverUrl;
  settingsLink.href = `${serverUrl}/#/settings`;
  renderBuildRow();
  await checkConnection();
}

async function checkConnection() {
  statusDot.className = 'status-dot';
  statusText.textContent = 'Checking...';
  fillBtn.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({ type: 'checkConnection' });
    if (response && response.ok) {
      statusDot.classList.add('connected');
      statusText.textContent = 'Connected to JobApply';
      fillBtn.disabled = false;
      isConnected = true;
      backendBuild = response.data?.build || { shortSha: response.data?.git_sha };
      renderBuildRow();
    } else {
      statusDot.classList.add('disconnected');
      statusText.textContent = response?.error || 'Cannot reach server';
      isConnected = false;
      backendBuild = null;
      renderBuildRow();
    }
  } catch (err) {
    statusDot.classList.add('disconnected');
    statusText.textContent = 'Extension error';
    isConnected = false;
    backendBuild = null;
    renderBuildRow();
  }
}

fillBtn.addEventListener('click', async () => {
  if (!isConnected) return;

  fillBtn.disabled = true;
  fillBtn.textContent = 'Filling...';

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');
    // Broadcast to all frames so Greenhouse/Lever iframe embeds receive startFill.
    const result = await chrome.runtime.sendMessage({ type: 'broadcastStartFill', tabId: tab.id });
    if (!result || result.ok === false || !result.acceptedCount) {
      const msg = result?.error
        || 'No application frame accepted the request. Reload the extension and page.';
      throw new Error(msg);
    }
    // Close only when at least one content frame acknowledged startFill.
    window.close();
  } catch (err) {
    console.error('Fill error:', err);
    fillBtn.textContent = 'Fill Application';
    fillBtn.disabled = false;
    statusText.textContent = err.message || 'Refresh the page and try again';
    statusDot.className = 'status-dot disconnected';
  }
});

diagBtn.addEventListener('click', async () => {
  diagHint.hidden = false;
  diagHint.textContent = 'Collecting…';
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');
    const result = await chrome.runtime.sendMessage({
      type: 'copySanitizedDiagnostics',
      tabId: tab.id,
    });
    if (!result?.ok) throw new Error(result?.error || 'Diagnostics failed');
    diagHint.textContent = 'Copied sanitized diagnostics to clipboard (no PII values).';
  } catch (err) {
    diagHint.textContent = err.message || 'Could not copy diagnostics — open the application tab and retry.';
  }
});

saveUrlBtn.addEventListener('click', async () => {
  let url = serverUrlInput.value.trim().replace(/\/+$/, '');
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) {
    statusDot.className = 'status-dot disconnected';
    statusText.textContent = 'URL must start with http:// or https://';
    return;
  }
  await chrome.storage.local.set({ serverUrl: url });
  settingsLink.href = `${url}/#/settings`;
  await checkConnection();
});

settingsLink.addEventListener('click', async (e) => {
  e.preventDefault();
  const { serverUrl } = await chrome.storage.local.get({ serverUrl: 'http://localhost:8085' });
  chrome.tabs.create({ url: `${serverUrl}/#/settings` });
});

init();

// === Onboarding Wizard ===

const ONBOARDING_KEY = 'careerpulse_onboarded';

function isOnboardingDone() {
    return localStorage.getItem(ONBOARDING_KEY) === 'true';
}

function markOnboardingDone() {
    localStorage.setItem(ONBOARDING_KEY, 'true');
}

async function checkSetupCompleteness() {
    try {
        const [profile, resumesData, aiSettings] = await Promise.all([
            api.request('GET', '/api/profile'),
            api.request('GET', '/api/resumes'),
            api.getAISettings(),
        ]);
        const steps = {
            profile: !!(profile.full_name && profile.email),
            resume: (resumesData.resumes || []).length > 0,
            ai: !!(aiSettings.provider && (aiSettings.api_key || aiSettings.provider === 'ollama')),
        };
        const done = Object.values(steps).filter(Boolean).length;
        const total = Object.keys(steps).length;
        return { steps, done, total, complete: done === total };
    } catch {
        return { steps: {}, done: 0, total: 3, complete: false };
    }
}

async function updateSetupIndicator() {
    const existing = document.getElementById('setup-indicator');
    if (existing) existing.remove();

    const status = await checkSetupCompleteness();
    if (status.complete) {
        markOnboardingDone();
        return;
    }

    const settingsLink = document.querySelector('.nav-link[data-route="settings"]');
    if (settingsLink) {
        const indicator = document.createElement('span');
        indicator.id = 'setup-indicator';
        indicator.className = 'setup-indicator';
        indicator.textContent = `${status.done}/${status.total}`;
        indicator.title = 'Setup incomplete — click Settings to finish';
        settingsLink.style.position = 'relative';
        settingsLink.appendChild(indicator);
    }
}

function showOnboardingWizard() {
    let currentStep = 0;
    const stepData = { name: '', email: '', location: '' };

    const wizard = document.createElement('div');
    wizard.id = 'onboarding-wizard';

    function renderStep() {
        const steps = [renderStep1, renderStep2, renderStep3, renderStep4];
        const dots = [0, 1, 2, 3].map(i =>
            `<div class="onboarding-step-dot ${i === currentStep ? 'active' : (i < currentStep ? 'done' : '')}"></div>`
        ).join('');

        wizard.innerHTML = `
            <div class="modal-overlay">
                <div class="onboarding-modal" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
                    <div class="onboarding-steps">${dots}</div>
                    <div id="onboarding-step-content">${steps[currentStep]()}</div>
                </div>
            </div>
        `;

        if (!wizard.parentNode) document.body.appendChild(wizard);
        attachStepListeners();
    }

    function renderStep1() {
        return `
            <h2 id="onboarding-title" class="onboarding-heading">Welcome to CareerPulse</h2>
            <p class="onboarding-desc">Let's get you set up. First, tell us a bit about yourself.</p>
            <div class="onboarding-form">
                <div class="onboarding-field">
                    <label for="onb-name">Full Name</label>
                    <input type="text" id="onb-name" class="search-input" placeholder="Your name" value="${escapeHtml(stepData.name)}">
                </div>
                <div class="onboarding-field">
                    <label for="onb-email">Email</label>
                    <input type="email" id="onb-email" class="search-input" placeholder="you@example.com" value="${escapeHtml(stepData.email)}">
                </div>
                <div class="onboarding-field">
                    <label for="onb-location">Location</label>
                    <input type="text" id="onb-location" class="search-input" placeholder="City, State" value="${escapeHtml(stepData.location)}">
                </div>
            </div>
            <div class="onboarding-actions">
                <button class="btn btn-primary" id="onb-next">Next</button>
            </div>
        `;
    }

    function renderStep2() {
        return `
            <h2 id="onboarding-title" class="onboarding-heading">Upload Your Resume</h2>
            <p class="onboarding-desc">Upload a resume so we can match you with relevant jobs and tailor applications.</p>
            <div class="onboarding-upload" id="onb-upload-area">
                <div class="onboarding-upload-icon">&#128196;</div>
                <div class="onboarding-upload-text">Drop a file here or click to browse</div>
                <div class="onboarding-upload-hint">PDF, DOCX, or TXT</div>
                <input type="file" id="onb-file" accept=".pdf,.docx,.doc,.txt" style="display:none">
            </div>
            <div id="onb-upload-status"></div>
            <div class="onboarding-actions">
                <button class="btn btn-secondary" id="onb-back">Back</button>
                <button class="btn btn-ghost" id="onb-skip">Skip</button>
                <button class="btn btn-primary" id="onb-next">Next</button>
            </div>
        `;
    }

    function renderStep3() {
        return `
            <h2 id="onboarding-title" class="onboarding-heading">Connect AI Provider</h2>
            <p class="onboarding-desc">CareerPulse uses AI to score jobs and tailor resumes. Connect a provider to get started.</p>
            <div class="onboarding-form">
                <div class="onboarding-field">
                    <label for="onb-provider">Provider</label>
                    <select id="onb-provider" class="filter-select" style="width:100%">
                        <option value="">Select a provider...</option>
                        <option value="anthropic">Anthropic (Claude)</option>
                        <option value="openai">OpenAI (GPT)</option>
                        <option value="google">Google (Gemini)</option>
                        <option value="openrouter">OpenRouter</option>
                        <option value="ollama">Ollama (Local)</option>
                    </select>
                </div>
                <div class="onboarding-field" id="onb-key-field" style="display:none">
                    <label for="onb-api-key">API Key</label>
                    <input type="password" id="onb-api-key" class="search-input" placeholder="sk-...">
                </div>
                <div class="onboarding-field" id="onb-ollama-field" style="display:none">
                    <label for="onb-ollama-url">Ollama URL</label>
                    <input type="text" id="onb-ollama-url" class="search-input" placeholder="http://localhost:11434" value="http://localhost:11434">
                </div>
                <button class="btn btn-secondary btn-sm" id="onb-test-ai" style="display:none">Test Connection</button>
                <div id="onb-ai-status"></div>
            </div>
            <div class="onboarding-actions">
                <button class="btn btn-secondary" id="onb-back">Back</button>
                <button class="btn btn-ghost" id="onb-skip">Skip</button>
                <button class="btn btn-primary" id="onb-next">Next</button>
            </div>
        `;
    }

    function renderStep4() {
        return `
            <h2 id="onboarding-title" class="onboarding-heading">You're All Set!</h2>
            <p class="onboarding-desc">CareerPulse is ready to find and match jobs for you. Start your first scrape to discover opportunities.</p>
            <div class="onboarding-summary">
                <div class="onboarding-summary-item" id="onb-summary"></div>
            </div>
            <div class="onboarding-actions">
                <button class="btn btn-secondary" id="onb-back">Back</button>
                <button class="btn btn-primary" id="onb-scrape">Start Scraping</button>
                <button class="btn btn-ghost" id="onb-later">I'll do this later</button>
            </div>
        `;
    }

    function attachStepListeners() {
        const next = wizard.querySelector('#onb-next');
        const back = wizard.querySelector('#onb-back');
        const skip = wizard.querySelector('#onb-skip');
        const scrape = wizard.querySelector('#onb-scrape');
        const later = wizard.querySelector('#onb-later');

        if (back) back.addEventListener('click', () => { currentStep--; renderStep(); });
        if (skip) skip.addEventListener('click', () => { currentStep++; renderStep(); });

        if (currentStep === 0 && next) {
            const nameInput = wizard.querySelector('#onb-name');
            if (nameInput) nameInput.focus();
            next.addEventListener('click', async () => {
                stepData.name = wizard.querySelector('#onb-name')?.value?.trim() || '';
                stepData.email = wizard.querySelector('#onb-email')?.value?.trim() || '';
                stepData.location = wizard.querySelector('#onb-location')?.value?.trim() || '';
                if (stepData.name || stepData.email) {
                    try {
                        await api.request('POST', '/api/profile', {
                            full_name: stepData.name, email: stepData.email, location: stepData.location
                        });
                    } catch {}
                }
                currentStep++;
                renderStep();
            });
        }

        if (currentStep === 1) {
            const uploadArea = wizard.querySelector('#onb-upload-area');
            const fileInput = wizard.querySelector('#onb-file');
            const statusEl = wizard.querySelector('#onb-upload-status');

            if (uploadArea && fileInput) {
                uploadArea.addEventListener('click', () => fileInput.click());
                uploadArea.addEventListener('dragover', (e) => { e.preventDefault(); uploadArea.classList.add('drag-over'); });
                uploadArea.addEventListener('dragleave', () => uploadArea.classList.remove('drag-over'));
                uploadArea.addEventListener('drop', (e) => {
                    e.preventDefault();
                    uploadArea.classList.remove('drag-over');
                    if (e.dataTransfer.files.length) handleUpload(e.dataTransfer.files[0]);
                });
                fileInput.addEventListener('change', () => {
                    if (fileInput.files.length) handleUpload(fileInput.files[0]);
                });
            }

            async function handleUpload(file) {
                if (statusEl) statusEl.innerHTML = '<span class="spinner"></span> Uploading...';
                try {
                    await api.uploadResume(file);
                    if (statusEl) statusEl.innerHTML = '<span style="color:var(--score-green);font-weight:600">Resume uploaded!</span>';
                } catch (err) {
                    if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">${escapeHtml(err.message)}</span>`;
                }
            }

            if (next) next.addEventListener('click', () => { currentStep++; renderStep(); });
        }

        if (currentStep === 2) {
            const providerSelect = wizard.querySelector('#onb-provider');
            const keyField = wizard.querySelector('#onb-key-field');
            const ollamaField = wizard.querySelector('#onb-ollama-field');
            const testBtn = wizard.querySelector('#onb-test-ai');
            const statusEl = wizard.querySelector('#onb-ai-status');

            if (providerSelect) {
                providerSelect.addEventListener('change', () => {
                    const v = providerSelect.value;
                    if (keyField) keyField.style.display = (v && v !== 'ollama') ? '' : 'none';
                    if (ollamaField) ollamaField.style.display = v === 'ollama' ? '' : 'none';
                    if (testBtn) testBtn.style.display = v ? '' : 'none';
                });
            }

            if (testBtn) {
                testBtn.addEventListener('click', async () => {
                    const provider = providerSelect?.value;
                    const apiKey = wizard.querySelector('#onb-api-key')?.value?.trim();
                    const ollamaUrl = wizard.querySelector('#onb-ollama-url')?.value?.trim();
                    if (!provider) return;
                    testBtn.disabled = true;
                    testBtn.innerHTML = '<span class="spinner"></span> Testing...';
                    try {
                        const settings = { provider, api_key: apiKey || undefined, base_url: ollamaUrl || undefined };
                        await api.testAIConnection(settings);
                        if (statusEl) statusEl.innerHTML = '<span style="color:var(--score-green);font-weight:600">Connected!</span>';
                    } catch (err) {
                        if (statusEl) statusEl.innerHTML = `<span style="color:var(--danger)">${escapeHtml(err.message)}</span>`;
                    } finally {
                        testBtn.disabled = false;
                        testBtn.textContent = 'Test Connection';
                    }
                });
            }

            if (next) {
                next.addEventListener('click', async () => {
                    const provider = providerSelect?.value;
                    if (provider) {
                        const apiKey = wizard.querySelector('#onb-api-key')?.value?.trim();
                        const ollamaUrl = wizard.querySelector('#onb-ollama-url')?.value?.trim();
                        try {
                            await api.updateAISettings({ provider, api_key: apiKey || undefined, base_url: ollamaUrl || undefined });
                        } catch {}
                    }
                    currentStep++;
                    renderStep();
                });
            }
        }

        if (currentStep === 3) {
            const summaryEl = wizard.querySelector('#onb-summary');
            if (summaryEl) {
                checkSetupCompleteness().then(status => {
                    const items = [];
                    items.push(status.steps.profile ? '&#10003; Profile configured' : '&#10007; Profile not set');
                    items.push(status.steps.resume ? '&#10003; Resume uploaded' : '&#10007; No resume yet');
                    items.push(status.steps.ai ? '&#10003; AI provider connected' : '&#10007; AI not configured');
                    summaryEl.innerHTML = items.map(i => `<div class="onboarding-check-item">${i}</div>`).join('');
                });
            }

            if (scrape) {
                scrape.addEventListener('click', async () => {
                    markOnboardingDone();
                    wizard.remove();
                    updateSetupIndicator();
                    handleScrape();
                });
            }

            if (later) {
                later.addEventListener('click', () => {
                    markOnboardingDone();
                    wizard.remove();
                    updateSetupIndicator();
                });
            }
        }

        // Keyboard: Escape to skip
        wizard.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                e.stopPropagation();
                markOnboardingDone();
                wizard.remove();
                updateSetupIndicator();
            }
        });
    }

    renderStep();
}

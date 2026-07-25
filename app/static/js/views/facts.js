async function renderFacts(container) {
    container.innerHTML = `
        <div class="settings-section">
            <h2>Fact Bank</h2>
            <p class="section-desc">Verified facts ground autofill answers and resume tailoring. Import from your resume, then verify each fact.</p>
            <div class="facts-toolbar">
                <button class="btn btn-secondary btn-sm" id="facts-import-btn">Import from Resume</button>
                <button class="btn btn-ghost btn-sm" id="facts-assemble-btn">Assemble Master Resume</button>
                <label class="facts-filter">
                    <input type="checkbox" id="facts-verified-only"/> Verified only
                </label>
            </div>
            <div id="facts-status" class="facts-status"></div>
            <div id="facts-list" class="facts-list"></div>
        </div>
    `;

    const statusEl = container.querySelector('#facts-status');
    const listEl = container.querySelector('#facts-list');
    const verifiedOnlyEl = container.querySelector('#facts-verified-only');

    async function loadFacts() {
        const verifiedOnly = verifiedOnlyEl.checked;
        const qs = verifiedOnly ? '?verified_only=true' : '';
        try {
            const data = await api.request('GET', `/api/facts${qs}`);
            renderList(data.facts || []);
        } catch (err) {
            statusEl.innerHTML = `<span class="error-text">${escapeHtml(err.message)}</span>`;
        }
    }

    function renderList(facts) {
        if (!facts.length) {
            listEl.innerHTML = '<p class="empty-state">No facts yet. Import from your resume to get started.</p>';
            return;
        }
        listEl.innerHTML = facts.map(f => `
            <div class="fact-card ${f.verified ? 'verified' : 'unverified'}" data-id="${escapeHtml(f.id)}">
                <div class="fact-card-header">
                    <span class="fact-category">${escapeHtml(f.category)}</span>
                    ${f.verified
                        ? '<span class="fact-badge verified">Verified</span>'
                        : '<button class="btn btn-primary btn-sm fact-verify-btn">Verify</button>'}
                    <button class="btn btn-ghost btn-sm fact-delete-btn" title="Delete">Delete</button>
                </div>
                <p class="fact-text">${escapeHtml(f.text)}</p>
                ${f.employer || f.role ? `<p class="fact-meta">${escapeHtml([f.role, f.employer].filter(Boolean).join(' @ '))}</p>` : ''}
            </div>
        `).join('');

        listEl.querySelectorAll('.fact-verify-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const card = e.target.closest('.fact-card');
                const id = card.dataset.id;
                try {
                    await api.request('POST', `/api/facts/${id}/verify`);
                    await loadFacts();
                } catch (err) {
                    showToast(err.message, 'error');
                }
            });
        });

        listEl.querySelectorAll('.fact-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                const card = e.target.closest('.fact-card');
                const id = card.dataset.id;
                if (!confirm('Delete this fact?')) return;
                try {
                    await api.request('DELETE', `/api/facts/${id}`);
                    await loadFacts();
                } catch (err) {
                    showToast(err.message, 'error');
                }
            });
        });
    }

    container.querySelector('#facts-import-btn').addEventListener('click', async () => {
        statusEl.innerHTML = '<span class="spinner"></span> Importing...';
        try {
            const data = await api.request('POST', '/api/facts/import-from-resume', { use_ai: false });
            statusEl.innerHTML = `<span style="color:var(--score-green)">Imported ${data.imported} proposed facts (unverified).</span>`;
            await loadFacts();
        } catch (err) {
            statusEl.innerHTML = `<span class="error-text">${escapeHtml(err.message)}</span>`;
        }
    });

    container.querySelector('#facts-assemble-btn').addEventListener('click', async () => {
        try {
            const data = await api.request('POST', '/api/facts/assemble-master-resume');
            if (!data.resume_text) {
                showToast('No verified facts to assemble', 'warning');
                return;
            }
            await navigator.clipboard.writeText(data.resume_text);
            showToast('Master resume copied to clipboard', 'success');
        } catch (err) {
            showToast(err.message, 'error');
        }
    });

    verifiedOnlyEl.addEventListener('change', loadFacts);
    await loadFacts();
}

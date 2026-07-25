async function renderResumeStudio(container) {
    container.innerHTML = `
        <div class="settings-section">
            <h2>Resume Studio</h2>
            <p class="section-desc">Paste a job description to tailor your verified facts. Unsupported requirements appear as gaps — nothing is invented.</p>
            <div class="resume-studio-form">
                <label for="rs-jd">Job Description</label>
                <textarea id="rs-jd" class="search-input" rows="12" placeholder="Paste the full job description here..."></textarea>
                <button class="btn btn-primary" id="rs-tailor-btn">Tailor Resume</button>
            </div>
            <div id="rs-status"></div>
            <div id="rs-results" class="resume-studio-results"></div>
        </div>
    `;

    const statusEl = container.querySelector('#rs-status');
    const resultsEl = container.querySelector('#rs-results');

    container.querySelector('#rs-tailor-btn').addEventListener('click', async () => {
        const jd = container.querySelector('#rs-jd').value.trim();
        if (!jd) {
            showToast('Paste a job description first', 'warning');
            return;
        }
        statusEl.innerHTML = '<span class="spinner"></span> Tailoring...';
        resultsEl.innerHTML = '';
        try {
            const data = await api.request('POST', '/api/resume/tailor', { job_description: jd });
            statusEl.innerHTML = `<span style="color:var(--score-green)">Page estimate: ${data.pageEstimate} lines${data.pdfPageCount ? ` (${data.pdfPageCount} PDF page${data.pdfPageCount > 1 ? 's' : ''})` : ''}</span>`;

            const gaps = data.gaps || [];
            const diffs = data.diffs || [];
            const content = data.content || {};

            resultsEl.innerHTML = `
                ${gaps.length ? `
                    <div class="rs-panel rs-gaps">
                        <h3>Skill Gaps (${gaps.length})</h3>
                        <ul>${gaps.map(g => `<li><strong>${escapeHtml(g.skill)}</strong> — ${escapeHtml(g.reason)}</li>`).join('')}</ul>
                    </div>
                ` : '<p class="rs-ok">All parsed JD skills matched verified facts.</p>'}
                ${diffs.length ? `
                    <div class="rs-panel">
                        <h3>Changes</h3>
                        <ul>${diffs.map(d => `<li>${escapeHtml(JSON.stringify(d))}</li>`).join('')}</ul>
                    </div>
                ` : ''}
                <div class="rs-panel">
                    <h3>Tailored Content</h3>
                    ${content.summary ? `<p><strong>Summary:</strong> ${escapeHtml(content.summary)}</p>` : ''}
                    ${(content.experience || []).length ? `
                        <h4>Experience</h4>
                        <ul>${content.experience.map(b => `<li>${escapeHtml(b.text || b)}</li>`).join('')}</ul>
                    ` : ''}
                    ${content.skills ? `<p><strong>Skills:</strong> ${escapeHtml(content.skills)}</p>` : ''}
                </div>
                <div class="rs-actions">
                    <button class="btn btn-secondary btn-sm" id="rs-copy-btn">Copy Resume Text</button>
                </div>
            `;

            const copyBtn = resultsEl.querySelector('#rs-copy-btn');
            if (copyBtn && data.resumeText) {
                copyBtn.addEventListener('click', () => {
                    navigator.clipboard.writeText(data.resumeText);
                    showToast('Resume text copied', 'success');
                });
            }
        } catch (err) {
            statusEl.innerHTML = `<span class="error-text">${escapeHtml(err.message)}</span>`;
        }
    });
}

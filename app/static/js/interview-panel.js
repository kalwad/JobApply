// === Interview Detail Panel (Slide-Out Drawer with Salary Calculator) ===

function openInterviewPanel(roundId, jobId) {
    closeInterviewPanel();

    const backdrop = document.createElement('div');
    backdrop.id = 'interview-panel';
    backdrop.innerHTML = `
        <div class="interview-drawer-backdrop"></div>
        <div class="interview-drawer" role="dialog" aria-modal="true" aria-labelledby="iv-panel-title">
            <div class="interview-drawer-header">
                <h2 id="iv-panel-title">Interview Detail</h2>
                <div style="display:flex;align-items:center;gap:8px">
                    <button class="edit-toggle-btn" id="iv-panel-edit-toggle">Edit</button>
                    <button class="interview-drawer-close" id="iv-panel-close" aria-label="Close">&times;</button>
                </div>
            </div>
            <div class="interview-drawer-body">
                <div class="interview-drawer-left" id="iv-panel-left">
                    <div class="loading-container"><div class="spinner"></div></div>
                </div>
                <div class="interview-drawer-right calc-readonly" id="iv-panel-right">
                    <div class="loading-container"><div class="spinner"></div></div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(backdrop);
    document.body.style.overflow = 'hidden';

    // Animate in
    requestAnimationFrame(() => {
        backdrop.querySelector('.interview-drawer-backdrop').classList.add('active');
        backdrop.querySelector('.interview-drawer').classList.add('open');
    });

    // Close handlers
    const close = () => closeInterviewPanel();
    backdrop.querySelector('.interview-drawer-backdrop').addEventListener('click', close);
    backdrop.querySelector('#iv-panel-close').addEventListener('click', close);
    backdrop.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') close();
        if (e.key === 'e' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
            backdrop.querySelector('#iv-panel-edit-toggle')?.click();
        }
        // Focus trap
        if (e.key === 'Tab') {
            const focusable = backdrop.querySelectorAll('button, input, select, textarea, a[href]');
            if (focusable.length === 0) return;
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
            else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        }
    });

    // Edit toggle
    backdrop.querySelector('#iv-panel-edit-toggle').addEventListener('click', () => {
        const btn = backdrop.querySelector('#iv-panel-edit-toggle');
        const rightPanel = backdrop.querySelector('#iv-panel-right');
        const isEditing = btn.classList.toggle('active');
        btn.textContent = isEditing ? 'Editing' : 'Edit';
        rightPanel.classList.toggle('calc-readonly', !isEditing);
        rightPanel.classList.toggle('editing', isEditing);
    });

    // Focus the close button
    backdrop.querySelector('#iv-panel-close').focus();

    // Load data
    loadInterviewPanelData(backdrop, roundId, jobId);
}

async function loadInterviewPanelData(backdrop, roundId, jobId) {
    const leftPanel = backdrop.querySelector('#iv-panel-left');
    const rightPanel = backdrop.querySelector('#iv-panel-right');

    try {
        const [roundsData, job] = await Promise.all([
            api.getInterviews(jobId),
            api.getJob(jobId)
        ]);

        const rounds = roundsData.rounds || [];
        const round = rounds.find(r => r.id === roundId) || rounds[0];

        if (!round) {
            leftPanel.innerHTML = `<div class="empty-state empty-state-compact"><div class="empty-state-title">Interview not found</div></div>`;
            rightPanel.innerHTML = '';
            return;
        }

        renderInterviewPanelLeft(leftPanel, round, job);
        renderInterviewPanelRight(rightPanel, job);
    } catch (err) {
        leftPanel.innerHTML = `<div class="empty-state empty-state-compact"><div class="empty-state-title">Failed to load</div><div class="empty-state-desc">${escapeHtml(err.message)}</div></div>`;
        rightPanel.innerHTML = '';
    }
}

function renderInterviewPanelLeft(panel, round, job) {
    const statusColors = {
        scheduled: 'var(--accent)',
        completed: 'var(--score-green)',
        cancelled: 'var(--danger)'
    };
    const statusColor = statusColors[round.status] || 'var(--text-secondary)';

    const formatPanelDate = (isoStr) => {
        if (!isoStr) return 'Not scheduled';
        return new Date(isoStr).toLocaleDateString('en-US', {
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
        });
    };

    const formatPanelTime = (isoStr, durationMin) => {
        if (!isoStr) return '';
        const start = new Date(isoStr);
        const end = new Date(start.getTime() + (durationMin || 60) * 60000);
        const fmt = d => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
        return `${fmt(start)} — ${fmt(end)}`;
    };

    const isUrl = (str) => /^https?:\/\//.test(str || '');

    panel.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:16px">
            <span class="round-badge">Round ${round.round_number}${round.label ? ' — ' + escapeHtml(round.label) : ''}</span>
            <span class="interview-status-badge" data-status="${round.status}" style="background:${statusColor}18;color:${statusColor}">${round.status}</span>
        </div>

        <div style="margin-bottom:20px">
            <div style="font-size:1.125rem;font-weight:700;color:var(--text-primary)">${escapeHtml(job.title)}</div>
            <div style="font-size:0.875rem;color:var(--text-secondary)">${escapeHtml(job.company)}</div>
        </div>

        <div class="interview-details-grid">
            ${round.scheduled_at ? `
                <span class="detail-label">Date</span>
                <span class="detail-value">${formatPanelDate(round.scheduled_at)}</span>
                <span class="detail-label">Time</span>
                <span class="detail-value">${formatPanelTime(round.scheduled_at, round.duration_min)}</span>
            ` : ''}
            ${round.duration_min ? `
                <span class="detail-label">Duration</span>
                <span class="detail-value">${round.duration_min} min</span>
            ` : ''}
            ${round.interviewer_name ? `
                <span class="detail-label">Interviewer</span>
                <span class="detail-value">${escapeHtml(round.interviewer_name)}${round.interviewer_title ? `, ${escapeHtml(round.interviewer_title)}` : ''}</span>
            ` : ''}
            ${round.location ? `
                <span class="detail-label">Location</span>
                <span class="detail-value">${isUrl(round.location) ? `<a href="${sanitizeUrl(round.location)}" target="_blank" rel="noopener noreferrer" style="color:var(--accent)">${escapeHtml(round.location)}</a>` : escapeHtml(round.location)}</span>
            ` : ''}
        </div>

        ${round.notes ? `
            <div style="margin-top:16px">
                <div style="font-size:0.8125rem;font-weight:500;color:var(--text-tertiary);margin-bottom:4px">Notes</div>
                <div style="font-size:0.875rem;color:var(--text-secondary);white-space:pre-line;background:var(--bg-surface-secondary);padding:12px;border-radius:var(--radius-sm);max-height:120px;overflow-y:auto">${escapeHtml(round.notes)}</div>
            </div>
        ` : ''}

        ${round.status === 'scheduled' ? `
            <div style="display:flex;gap:8px;margin-top:20px">
                <button class="btn btn-primary btn-sm" id="iv-panel-complete">Mark Complete</button>
                <button class="btn btn-secondary btn-sm" id="iv-panel-cancel-round">Cancel Round</button>
            </div>
        ` : ''}

        <div style="margin-top:24px;padding-top:16px;border-top:1px solid var(--border)">
            <a href="#/job/${job.id}" class="iv-panel-job-link" id="iv-panel-view-job" style="color:var(--accent);font-size:0.875rem;font-weight:500">View Full Job Detail &rarr;</a>
        </div>
    `;

    // Wire status buttons
    const completeBtn = panel.querySelector('#iv-panel-complete');
    if (completeBtn) {
        completeBtn.addEventListener('click', async () => {
            completeBtn.disabled = true;
            completeBtn.innerHTML = '<span class="spinner"></span>';
            try {
                await api.updateInterview(round.id, { status: 'completed' });
                showToast('Marked complete', 'success');
                loadInterviewPanelData(panel.closest('#interview-panel'), round.id, round.job_id);
            } catch (err) {
                showToast(err.message, 'error');
                completeBtn.disabled = false;
                completeBtn.textContent = 'Mark Complete';
            }
        });
    }

    const cancelBtn = panel.querySelector('#iv-panel-cancel-round');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', async () => {
            cancelBtn.disabled = true;
            try {
                await api.updateInterview(round.id, { status: 'cancelled' });
                showToast('Interview cancelled', 'success');
                loadInterviewPanelData(panel.closest('#interview-panel'), round.id, round.job_id);
            } catch (err) {
                showToast(err.message, 'error');
                cancelBtn.disabled = false;
                cancelBtn.textContent = 'Cancel Round';
            }
        });
    }

    // View job link closes drawer
    const viewJobLink = panel.querySelector('#iv-panel-view-job');
    if (viewJobLink) {
        viewJobLink.addEventListener('click', () => closeInterviewPanel());
    }
}

function renderInterviewPanelRight(panel, job) {
    const prepop = prepopulateCalcFromJob(job);

    if (!prepop.gross || prepop.gross <= 0) {
        panel.innerHTML = `
            <div style="text-align:center;padding:24px 16px">
                <div style="font-size:0.9375rem;font-weight:600;margin-bottom:8px;color:var(--text-primary)">Compensation</div>
                <div style="font-size:0.8125rem;color:var(--text-tertiary)">No salary data available for this job.</div>
            </div>
        `;
        return;
    }

    const result = calculateSalary({
        gross: prepop.gross,
        state: prepop.state,
        filingStatus: prepop.filingStatus,
        employmentType: prepop.employmentType,
        deductions: {},
        c2cMargin: 0
    });

    if (!result) {
        panel.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-tertiary)">Could not calculate</div>`;
        return;
    }

    const isContract = job.employment_type === 'contract';
    let comparisonRow = '';
    if (isContract) {
        const comparison = compareEmploymentTypes(prepop.gross, prepop.state, prepop.filingStatus, {}, 0);
        const monthly = (type) => formatCurrency(Math.round((comparison[type]?.takeHome || 0) / 12));
        comparisonRow = `
            <div class="iv-comparison-row">
                <span>W2: ${monthly('w2')}/mo</span>
                <span class="iv-comparison-divider">|</span>
                <span>1099: ${monthly('1099')}/mo</span>
                <span class="iv-comparison-divider">|</span>
                <span>C2C: ${monthly('c2c')}/mo</span>
            </div>
        `;
    }

    panel.innerHTML = `
        <div style="margin-bottom:16px">
            <div style="font-size:0.9375rem;font-weight:600;margin-bottom:4px;color:var(--text-primary)">Compensation Snapshot</div>
            <div style="font-size:0.75rem;color:var(--text-tertiary)">Changes are for comparison only</div>
        </div>

        <div class="compact-calc-controls" style="display:flex;flex-wrap:wrap;gap:10px;margin-bottom:16px">
            <div class="calc-input-group" style="flex:1;min-width:100px">
                <label>${prepop.payType === 'hourly' ? 'Hourly Rate ($)' : 'Annual Salary ($)'}</label>
                <input type="number" id="iv-calc-gross" value="${prepop.payType === 'hourly' ? prepop.rate : prepop.salary}" min="0" step="${prepop.payType === 'hourly' ? '1' : '1000'}">
            </div>
            <div class="calc-input-group" style="flex:1;min-width:100px">
                <label>Employment</label>
                ${buildToggleGroup('ivEmpType', [
                    { label: 'W-2', value: 'w2' },
                    { label: '1099', value: '1099' },
                    { label: 'C2C', value: 'c2c' }
                ], prepop.employmentType)}
            </div>
            <div class="calc-input-group" style="flex:1;min-width:80px">
                <label>Filing</label>
                ${buildToggleGroup('ivFiling', [
                    { label: 'Single', value: 'single' },
                    { label: 'Married', value: 'married' }
                ], prepop.filingStatus)}
            </div>
            <div class="calc-input-group" style="flex:1;min-width:80px">
                <label>State</label>
                ${buildStateDropdown(prepop.state)}
            </div>
        </div>

        <div class="compact-stat-grid" id="iv-calc-stats">
            <div class="compact-stat-card">
                <div class="stat-number" id="iv-stat-gross">${formatCurrency(result.gross)}</div>
                <div class="stat-label">Gross Annual</div>
            </div>
            <div class="compact-stat-card">
                <div class="stat-number" id="iv-stat-tax">${formatCurrency(result.totalTax)}</div>
                <div class="stat-label">Total Taxes</div>
            </div>
            <div class="compact-stat-card">
                <div class="stat-number" id="iv-stat-takehome" style="color:var(--score-green)">${formatCurrency(result.takeHome)}</div>
                <div class="stat-label">Take-Home</div>
            </div>
            <div class="compact-stat-card">
                <div class="stat-number" id="iv-stat-rate">${(result.effectiveRate * 100).toFixed(1)}%</div>
                <div class="stat-label">Effective Rate</div>
            </div>
        </div>

        ${comparisonRow}

        <div class="compact-chart-wrap">
            <canvas id="iv-calc-donut"></canvas>
        </div>
    `;

    // Render donut chart
    const canvas = panel.querySelector('#iv-calc-donut');
    if (canvas) renderCompactDonut(canvas, result);

    // Wire recalculation on input changes
    wireCompactCalcEvents(panel, prepop);
}

function prepopulateCalcFromJob(job) {
    const gross = job.salary_max || job.salary_min ||
                  job.salary_estimate_max || job.salary_estimate_min || 0;

    const isContract = job.employment_type === 'contract';
    const isHourly = isContract && gross > 0 && gross < 500;

    const stateMatch = (job.location || '').match(/,\s*([A-Z]{2})\b/);
    const state = stateMatch ? stateMatch[1] : (loadCalcSettings().state || 'TX');

    let empType = 'w2';
    if (isContract) empType = '1099';

    return {
        payType: isHourly ? 'hourly' : 'salary',
        gross: isHourly ? gross * 40 * 52 : gross,
        rate: isHourly ? gross : null,
        salary: isHourly ? null : gross,
        employmentType: empType,
        filingStatus: loadCalcSettings().filing || 'single',
        state
    };
}

let compactDonutChart = null;

function renderCompactDonut(canvas, result) {
    if (compactDonutChart) compactDonutChart.destroy();
    if (!result || typeof Chart === 'undefined') return;

    const colors = getChartColors();
    const segments = [
        { label: 'Federal Tax', value: result.federal, color: colors.federal },
        { label: 'State Tax', value: result.state, color: colors.state },
        { label: 'Social Security', value: result.ss, color: colors.ss },
        { label: 'Medicare', value: result.medicare, color: colors.medicare }
    ];
    if (result.seTax > 0) segments.push({ label: 'SE Tax', value: result.seTax, color: colors.seTax });
    segments.push({ label: 'Take-Home', value: Math.max(0, result.takeHome), color: colors.takeHome });
    const filtered = segments.filter(s => s.value > 0);

    compactDonutChart = new Chart(canvas, {
        type: 'doughnut',
        data: {
            labels: filtered.map(s => s.label),
            datasets: [{
                data: filtered.map(s => s.value),
                backgroundColor: filtered.map(s => s.color),
                borderWidth: 2,
                borderColor: colors.surface
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '60%',
            animation: { animateRotate: true, duration: 600, easing: 'easeOutQuart' },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: { color: colors.text, padding: 8, usePointStyle: true, pointStyleWidth: 8, font: { size: 11 } }
                },
                tooltip: {
                    callbacks: {
                        label: ctx => `${ctx.label}: ${formatCurrency(ctx.raw)} (${((ctx.raw / result.gross) * 100).toFixed(1)}%)`
                    }
                }
            }
        }
    });
}

function wireCompactCalcEvents(panel, prepop) {
    let debounceId = null;

    const recalc = () => {
        clearTimeout(debounceId);
        debounceId = setTimeout(() => {
            const grossInput = panel.querySelector('#iv-calc-gross');
            let gross = parseFloat(grossInput?.value) || 0;
            if (prepop.payType === 'hourly') gross = gross * 40 * 52;

            const empBtn = panel.querySelector('.calc-toggle-btn[data-group="ivEmpType"].active');
            const filingBtn = panel.querySelector('.calc-toggle-btn[data-group="ivFiling"].active');
            const stateSelect = panel.querySelector('#calc-state');

            const employmentType = empBtn?.dataset.value || prepop.employmentType;
            const filingStatus = filingBtn?.dataset.value || prepop.filingStatus;
            const state = stateSelect?.value || prepop.state;

            const result = calculateSalary({
                gross, state, filingStatus, employmentType,
                deductions: {}, c2cMargin: 0
            });

            if (!result) return;

            const statGross = panel.querySelector('#iv-stat-gross');
            const statTax = panel.querySelector('#iv-stat-tax');
            const statTakeHome = panel.querySelector('#iv-stat-takehome');
            const statRate = panel.querySelector('#iv-stat-rate');

            if (statGross) statGross.textContent = formatCurrency(result.gross);
            if (statTax) statTax.textContent = formatCurrency(result.totalTax);
            if (statTakeHome) statTakeHome.textContent = formatCurrency(result.takeHome);
            if (statRate) statRate.textContent = (result.effectiveRate * 100).toFixed(1) + '%';

            const canvas = panel.querySelector('#iv-calc-donut');
            if (canvas) renderCompactDonut(canvas, result);
        }, 150);
    };

    // Toggle buttons
    panel.querySelectorAll('.calc-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const group = btn.dataset.group;
            panel.querySelectorAll(`.calc-toggle-btn[data-group="${group}"]`).forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            recalc();
        });
    });

    // Inputs
    panel.querySelectorAll('input, select').forEach(el => {
        el.addEventListener('input', recalc);
        el.addEventListener('change', recalc);
    });
}

function closeInterviewPanel() {
    const existing = document.getElementById('interview-panel');
    if (!existing) return;

    const drawer = existing.querySelector('.interview-drawer');
    const backdrop = existing.querySelector('.interview-drawer-backdrop');

    if (drawer) drawer.classList.remove('open');
    if (backdrop) backdrop.classList.remove('active');

    document.body.style.overflow = '';

    setTimeout(() => existing.remove(), 260);
}

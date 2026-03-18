// === Queue View ===
let queueEventSource = null;

async function renderQueue(container) {
    container.innerHTML = `<div class="loading-container"><div class="spinner spinner-lg"></div><span>Loading queue...</span></div>`;

    // Clean up any existing SSE connection
    if (queueEventSource) { queueEventSource.close(); queueEventSource = null; }

    try {
        const [queueData, resumesData] = await Promise.all([
            api.request('GET', '/api/queue'),
            api.request('GET', '/api/resumes'),
        ]);
        const queue = queueData.queue || [];
        const resumes = resumesData.resumes || [];

        const statusLabels = {
            queued: 'Queued', preparing: 'Preparing', ready: 'Ready',
            review: 'In Review', approved: 'Approved', filling: 'Filling',
            submitted: 'Submitted', rejected: 'Rejected',
            done: 'Done', failed: 'Failed'
        };
        const statusColors = {
            queued: 'var(--accent)', preparing: '#f59e0b', ready: '#22c55e',
            review: '#8b5cf6', approved: '#22c55e', filling: '#3b82f6',
            submitted: 'var(--score-green)', rejected: 'var(--danger)',
            done: 'var(--text-tertiary)', failed: 'var(--danger)'
        };

        const reviewCount = queue.filter(q => q.status === 'review').length;
        const queuedCount = queue.filter(q => q.status === 'queued').length;
        const approvedCount = queue.filter(q => q.status === 'approved').length;
        const fillingCount = queue.filter(q => q.status === 'filling').length;

        container.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
                <h1 style="font-size:1.5rem;font-weight:700;letter-spacing:-0.02em">Application Queue</h1>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                    <button class="btn btn-primary btn-sm" id="queue-prepare-all-btn"${queuedCount === 0 ? ' disabled' : ''}>Prepare All</button>
                    ${reviewCount > 0 ? `
                        <button class="btn btn-sm" id="queue-approve-all-btn" style="background:#22c55e;color:#fff">Approve All (${reviewCount})</button>
                        <button class="btn btn-danger btn-sm" id="queue-reject-all-btn">Reject All</button>
                    ` : ''}
                </div>
            </div>
            ${queue.length > 0 ? `
                <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
                    ${Object.entries(statusLabels).map(([s, label]) => {
                        const count = queue.filter(q => q.status === s).length;
                        if (!count) return '';
                        return `<span style="font-size:0.8rem;color:${statusColors[s]};font-weight:600">${label}: ${count}</span>`;
                    }).join('')}
                </div>
            ` : ''}
            ${queue.length === 0 ? `
                <div class="empty-state">
                    <div class="empty-state-icon">&#128203;</div>
                    <div class="empty-state-title">Queue is empty</div>
                    <div class="empty-state-desc">Add jobs to the queue from the job detail page to batch-prepare applications.</div>
                </div>
            ` : `
                <div style="display:flex;flex-direction:column;gap:8px" id="queue-items">
                    ${queue.map(item => renderQueueItem(item, statusLabels, statusColors)).join('')}
                </div>
            `}
        `;

        // Prepare All
        document.getElementById('queue-prepare-all-btn')?.addEventListener('click', async () => {
            const btn = document.getElementById('queue-prepare-all-btn');
            btn.disabled = true;
            btn.innerHTML = '<span class="spinner"></span> Preparing...';
            try {
                const result = await api.request('POST', '/api/queue/prepare-all');
                showToast(`Prepared ${result.prepared}/${result.total}${result.failed ? `, ${result.failed} failed` : ''}`, result.failed ? 'error' : 'success');
                await renderQueue(container);
            } catch (err) {
                showToast(err.message, 'error');
                btn.disabled = false;
                btn.textContent = 'Prepare All';
            }
        });

        // Batch Approve All
        document.getElementById('queue-approve-all-btn')?.addEventListener('click', async () => {
            try {
                const result = await api.request('POST', '/api/queue/approve-all');
                showToast(`Approved ${result.approved} items`, 'success');
                await renderQueue(container);
            } catch (err) { showToast(err.message, 'error'); }
        });

        // Batch Reject All
        document.getElementById('queue-reject-all-btn')?.addEventListener('click', async () => {
            const ok = await showModal({
                title: 'Reject All',
                message: 'Reject all items in review?',
                confirmText: 'Reject All',
                danger: true,
            });
            if (!ok) return;
            try {
                const result = await api.request('POST', '/api/queue/reject-all');
                showToast(`Rejected ${result.rejected} items`, 'success');
                await renderQueue(container);
            } catch (err) { showToast(err.message, 'error'); }
        });

        // Per-item: Submit for Review
        container.querySelectorAll('.queue-submit-review-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await api.request('POST', `/api/queue/${btn.dataset.id}/submit-for-review`);
                    showToast('Submitted for review', 'success');
                    await renderQueue(container);
                } catch (err) { showToast(err.message, 'error'); }
            });
        });

        // Per-item: Approve
        container.querySelectorAll('.queue-approve-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await api.request('POST', `/api/queue/${btn.dataset.id}/approve`);
                    showToast('Application approved', 'success');
                    await renderQueue(container);
                } catch (err) { showToast(err.message, 'error'); }
            });
        });

        // Per-item: Reject
        container.querySelectorAll('.queue-reject-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await api.request('POST', `/api/queue/${btn.dataset.id}/reject`);
                    showToast('Application rejected', 'info');
                    await renderQueue(container);
                } catch (err) { showToast(err.message, 'error'); }
            });
        });

        // Per-item: Remove
        container.querySelectorAll('.queue-remove-btn').forEach(btn => {
            btn.addEventListener('click', async () => {
                try {
                    await api.request('DELETE', `/api/queue/${btn.dataset.id}`);
                    showToast('Removed from queue', 'success');
                    await renderQueue(container);
                } catch (err) { showToast(err.message, 'error'); }
            });
        });

        // SSE for fill progress (only if items are filling)
        if (fillingCount > 0 || approvedCount > 0) {
            connectQueueSSE(container);
        }
    } catch (err) {
        showToast(err.message, 'error');
        container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Could not load queue</div></div>`;
    }
}

function renderQueueItem(item, statusLabels, statusColors) {
    const status = item.status || 'queued';
    const label = statusLabels[status] || status;
    const color = statusColors[status] || 'var(--text-tertiary)';

    const actionButtons = [];
    if (status === 'ready') {
        actionButtons.push(`<button class="btn btn-sm queue-submit-review-btn" data-id="${item.id}" style="background:#8b5cf6;color:#fff">Submit for Review</button>`);
    }
    if (status === 'review') {
        actionButtons.push(`<button class="btn btn-sm queue-approve-btn" data-id="${item.id}" style="background:#22c55e;color:#fff">Approve</button>`);
        actionButtons.push(`<button class="btn btn-danger btn-sm queue-reject-btn" data-id="${item.id}">Reject</button>`);
    }
    actionButtons.push(`<a href="#/job/${item.job_id}" class="btn btn-secondary btn-sm">Review</a>`);
    if (!['filling', 'submitted'].includes(status)) {
        actionButtons.push(`<button class="btn btn-danger btn-sm queue-remove-btn" data-id="${item.id}">Remove</button>`);
    }

    const progressBar = status === 'filling' && item.fill_progress != null
        ? `<div style="margin-top:8px">
            <div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text-secondary);margin-bottom:4px">
                <span>Filling application...</span>
                <span class="queue-progress-text" data-queue-id="${item.id}">${item.fill_progress || 0}%</span>
            </div>
            <div style="height:6px;background:var(--bg-secondary);border-radius:3px;overflow:hidden">
                <div class="queue-progress-bar" data-queue-id="${item.id}" style="height:100%;width:${item.fill_progress || 0}%;background:var(--accent);border-radius:3px;transition:width 0.3s"></div>
            </div>
          </div>`
        : '';

    return `
        <div class="card queue-item" style="padding:16px" data-queue-id="${item.id}" data-queue-status="${status}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
                <div style="flex:1;min-width:0">
                    <a href="#/job/${item.job_id}" style="font-weight:600;font-size:0.9375rem">${escapeHtml(item.title || 'Job #' + item.job_id)}</a>
                    <div style="font-size:0.8125rem;color:var(--text-secondary)">${escapeHtml(item.company || '')}</div>
                    <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
                        <span class="queue-status-badge" style="font-size:0.75rem;font-weight:600;color:#fff;background:${color};padding:2px 8px;border-radius:10px">${label}</span>
                        ${item.match_score != null ? `<span class="score-badge ${getScoreClass(item.match_score)}" style="font-size:0.75rem">${item.match_score}</span>` : ''}
                    </div>
                    ${progressBar}
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0">
                    ${actionButtons.join('')}
                </div>
            </div>
        </div>
    `;
}

function connectQueueSSE(container) {
    if (queueEventSource) queueEventSource.close();
    queueEventSource = new EventSource('/api/queue/events');

    queueEventSource.addEventListener('fill_progress', (e) => {
        try {
            const data = JSON.parse(e.data);
            const queueId = data.queue_id;
            const progressBar = container.querySelector(`.queue-progress-bar[data-queue-id="${queueId}"]`);
            const progressText = container.querySelector(`.queue-progress-text[data-queue-id="${queueId}"]`);
            if (progressBar) progressBar.style.width = `${data.progress || 0}%`;
            if (progressText) progressText.textContent = `${data.progress || 0}%`;

            if (data.status === 'submitted') {
                showToast('Application submitted!', 'success');
                renderQueue(container);
            } else if (data.status === 'failed') {
                showToast('Fill failed', 'error');
                renderQueue(container);
            }
        } catch {}
    });

    queueEventSource.addEventListener('status_change', (e) => {
        try {
            const data = JSON.parse(e.data);
            const card = container.querySelector(`.queue-item[data-queue-id="${data.queue_id}"]`);
            if (card) renderQueue(container);
        } catch {}
    });

    queueEventSource.onerror = () => {
        queueEventSource.close();
        queueEventSource = null;
    };
}

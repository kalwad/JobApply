// === Pipeline View ===
let pipelineActiveTab = 'board';

async function renderPipeline(container) {
    container.innerHTML = `<div class="loading-container"><div class="spinner spinner-lg"></div><span>Loading pipeline...</span></div>`;

    const statuses = ['interested', 'prepared', 'applied', 'interviewing', 'offered', 'rejected'];
    const statusLabels = {
        interested: 'Interested', prepared: 'Prepared', applied: 'Applied',
        interviewing: 'Interviewing', offered: 'Offered', rejected: 'Rejected'
    };
    const statusColors = {
        interested: 'var(--text-secondary)', prepared: 'var(--accent)',
        applied: 'var(--score-green)', interviewing: 'var(--score-amber)',
        offered: '#22c55e', rejected: 'var(--danger)'
    };

    try {
        const [pipelineResults, offersData] = await Promise.all([
            Promise.all(statuses.map(s => api.request('GET', `/api/pipeline/${s}`))),
            api.request('GET', '/api/offers')
        ]);
        const results = pipelineResults;
        const hasOffers = offersData.offers && offersData.offers.length > 0;
        const offeredIdx = statuses.indexOf('offered');
        const hasOfferedJobs = results[offeredIdx] && results[offeredIdx].count > 0;

        container.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
                <h1 style="font-size:1.5rem;font-weight:700;letter-spacing:-0.02em;margin:0">Pipeline</h1>
                <div style="display:flex;align-items:center;gap:12px">
                    <button id="add-external-job-btn" class="btn btn-primary btn-sm">+ Add Job</button>
                    <div class="tab-bar">
                        <button class="tab-btn ${pipelineActiveTab === 'board' ? 'active' : ''}" data-pipeline-tab="board">Board</button>
                        <button class="tab-btn ${pipelineActiveTab === 'offers' ? 'active' : ''}" data-pipeline-tab="offers">
                            Offers${hasOffers ? ` <span class="badge badge-sm">${offersData.offers.length}</span>` : ''}
                        </button>
                    </div>
                </div>
            </div>
            <div id="pipeline-tab-content"></div>
        `;

        container.querySelector('#add-external-job-btn').addEventListener('click', () => {
            showAddExternalJobModal(container, statuses, statusLabels);
        });

        container.querySelectorAll('[data-pipeline-tab]').forEach(btn => {
            btn.addEventListener('click', () => {
                pipelineActiveTab = btn.dataset.pipelineTab;
                container.querySelectorAll('[data-pipeline-tab]').forEach(b => b.classList.toggle('active', b === btn));
                if (pipelineActiveTab === 'board') {
                    renderPipelineBoard(container.querySelector('#pipeline-tab-content'), results, statuses, statusLabels, statusColors, container);
                } else {
                    renderOffersTab(container.querySelector('#pipeline-tab-content'), offersData.offers, results[offeredIdx]?.jobs || []);
                }
            });
        });

        const tabContent = container.querySelector('#pipeline-tab-content');
        if (pipelineActiveTab === 'offers') {
            renderOffersTab(tabContent, offersData.offers, results[offeredIdx]?.jobs || []);
        } else {
            renderPipelineBoard(tabContent, results, statuses, statusLabels, statusColors, container);
        }
    } catch (err) {
        container.innerHTML = `<div class="empty-state"><div class="empty-state-title">Failed to load pipeline</div><div class="empty-state-desc">${escapeHtml(err.message)}</div></div>`;
    }
}

function renderPipelineBoard(tabContent, results, statuses, statusLabels, statusColors, container) {
    tabContent.innerHTML = `
            <div class="pipeline-board">
                ${statuses.map((status, i) => `
                    <div class="pipeline-column" data-status="${status}">
                        <div class="pipeline-column-header" style="border-top: 3px solid ${statusColors[status]}">
                            <span>${statusLabels[status]}</span>
                            <span class="pipeline-count">${results[i].count}</span>
                        </div>
                        <div class="pipeline-cards" data-status="${status}" role="list" aria-dropeffect="move">
                            ${results[i].jobs.map(job => `
                                <div class="card pipeline-card" draggable="true" data-job-id="${job.id}" data-status="${status}" role="listitem">
                                    <div class="pipeline-card-title">${escapeHtml(job.title)}</div>
                                    <div class="pipeline-card-company">${escapeHtml(job.company)}</div>
                                    ${job.match_score ? `<span class="score-badge ${getScoreClass(job.match_score)}" style="font-size:0.7rem">${job.match_score}</span>` : ''}
                                    ${status === 'interviewing' ? `
                                    <div class="pipeline-quick-actions" onclick="event.stopPropagation()">
                                        <button class="pipeline-qa-btn" data-qa="call" data-job-id="${job.id}" title="Log call">\u{1F4DE}</button>
                                        <button class="pipeline-qa-btn" data-qa="email" data-job-id="${job.id}" title="Log email">\u{1F4E7}</button>
                                        <button class="pipeline-qa-btn" data-qa="note" data-job-id="${job.id}" title="Add note">\u{1F4DD}</button>
                                    </div>` : ''}
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `).join('')}
            </div>
        `;

        // Drag-and-drop handlers
        let draggedCard = null;

        tabContent.querySelectorAll('.pipeline-card[draggable]').forEach(card => {
            card.addEventListener('dragstart', (e) => {
                draggedCard = card;
                card.classList.add('pipeline-card-dragging');
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', card.dataset.jobId);
            });

            card.addEventListener('dragend', () => {
                card.classList.remove('pipeline-card-dragging');
                draggedCard = null;
                tabContent.querySelectorAll('.pipeline-cards').forEach(zone => {
                    zone.classList.remove('pipeline-drop-target');
                });
            });

            card.addEventListener('click', () => {
                navigate(`#/job/${card.dataset.jobId}`);
            });
        });

        tabContent.querySelectorAll('.pipeline-cards').forEach(dropZone => {
            dropZone.addEventListener('dragover', (e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = 'move';
                dropZone.classList.add('pipeline-drop-target');
            });

            dropZone.addEventListener('dragleave', (e) => {
                if (!dropZone.contains(e.relatedTarget)) {
                    dropZone.classList.remove('pipeline-drop-target');
                }
            });

            dropZone.addEventListener('drop', async (e) => {
                e.preventDefault();
                dropZone.classList.remove('pipeline-drop-target');
                if (!draggedCard) return;

                const jobId = draggedCard.dataset.jobId;
                const oldStatus = draggedCard.dataset.status;
                const newStatus = dropZone.dataset.status;
                if (oldStatus === newStatus) return;

                // Optimistic move
                dropZone.appendChild(draggedCard);
                draggedCard.dataset.status = newStatus;

                // Update column counts
                const oldCol = tabContent.querySelector(`.pipeline-column[data-status="${oldStatus}"] .pipeline-count`);
                const newCol = tabContent.querySelector(`.pipeline-column[data-status="${newStatus}"] .pipeline-count`);
                if (oldCol) oldCol.textContent = parseInt(oldCol.textContent) - 1;
                if (newCol) newCol.textContent = parseInt(newCol.textContent) + 1;

                try {
                    await api.updateApplication(jobId, newStatus);
                    showToast(`Moved to ${statusLabels[newStatus]}`, 'success');
                } catch (err) {
                    showToast(`Failed to move: ${err.message}`, 'error');
                    await renderPipeline(container);
                }
            });
        });

        // Pipeline quick-action buttons
        tabContent.querySelectorAll('.pipeline-qa-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const jobId = btn.dataset.jobId;
                const action = btn.dataset.qa;
                showPipelineQuickAction(btn.closest('.pipeline-card'), jobId, action);
            });
        });
}

function showPipelineQuickAction(card, jobId, action) {
    const existing = card.querySelector('.pipeline-qa-form');
    if (existing) existing.remove();

    let formHtml = '';
    if (action === 'call') {
        formHtml = `
            <div class="pipeline-qa-form" onclick="event.stopPropagation()">
                <input type="text" class="search-input" name="who" placeholder="Who?" style="font-size:0.75rem">
                <select class="filter-select" name="duration" style="font-size:0.75rem;padding:4px">
                    <option value="">Duration</option>
                    <option value="5 min">5m</option><option value="15 min">15m</option>
                    <option value="30 min">30m</option><option value="1 hr">1h</option>
                </select>
                <textarea class="search-input" name="notes" placeholder="Notes..." rows="2" style="font-size:0.75rem;resize:vertical"></textarea>
                <div style="display:flex;gap:4px">
                    <button class="btn btn-primary btn-sm pqa-submit" style="flex:1;font-size:0.7rem;padding:3px 6px">Log</button>
                    <button class="btn btn-secondary btn-sm pqa-cancel" style="font-size:0.7rem;padding:3px 6px">X</button>
                </div>
            </div>`;
    } else if (action === 'email') {
        formHtml = `
            <div class="pipeline-qa-form" onclick="event.stopPropagation()">
                <select class="filter-select" name="direction" style="font-size:0.75rem;padding:4px">
                    <option value="Sent">Sent</option><option value="Received">Received</option>
                </select>
                <input type="text" class="search-input" name="subject" placeholder="Subject" style="font-size:0.75rem">
                <textarea class="search-input" name="notes" placeholder="Notes..." rows="2" style="font-size:0.75rem;resize:vertical"></textarea>
                <div style="display:flex;gap:4px">
                    <button class="btn btn-primary btn-sm pqa-submit" style="flex:1;font-size:0.7rem;padding:3px 6px">Log</button>
                    <button class="btn btn-secondary btn-sm pqa-cancel" style="font-size:0.7rem;padding:3px 6px">X</button>
                </div>
            </div>`;
    } else {
        formHtml = `
            <div class="pipeline-qa-form" onclick="event.stopPropagation()">
                <textarea class="search-input" name="notes" placeholder="Add a note..." rows="2" style="font-size:0.75rem;resize:vertical"></textarea>
                <div style="display:flex;gap:4px">
                    <button class="btn btn-primary btn-sm pqa-submit" style="flex:1;font-size:0.7rem;padding:3px 6px">Add</button>
                    <button class="btn btn-secondary btn-sm pqa-cancel" style="font-size:0.7rem;padding:3px 6px">X</button>
                </div>
            </div>`;
    }

    card.insertAdjacentHTML('beforeend', formHtml);
    const form = card.querySelector('.pipeline-qa-form');
    const firstInput = form.querySelector('input, textarea');
    if (firstInput) firstInput.focus();

    form.querySelector('.pqa-cancel').addEventListener('click', (e) => {
        e.stopPropagation();
        form.remove();
    });

    form.querySelector('.pqa-submit').addEventListener('click', async (e) => {
        e.stopPropagation();
        const submitBtn = e.target;
        submitBtn.disabled = true;

        const eventType = action === 'call' ? 'call' : action === 'email' ? 'email_log' : 'note';
        let detail = '';

        if (action === 'note') {
            detail = form.querySelector('[name="notes"]').value.trim();
            if (!detail) { submitBtn.disabled = false; return; }
        } else {
            const data = {};
            form.querySelectorAll('input, select, textarea').forEach(f => {
                if (f.name && f.value.trim()) data[f.name] = f.value.trim();
            });
            if (!data.notes && !data.who && !data.subject) { submitBtn.disabled = false; return; }
            detail = JSON.stringify(data);
        }

        try {
            await api.addEvent(jobId, detail, eventType);
            showToast(action === 'call' ? 'Call logged' : action === 'email' ? 'Email logged' : 'Note added', 'success');
            form.remove();
        } catch (err) {
            showToast(err.message, 'error');
            submitBtn.disabled = false;
        }
    });
}

// === Offers Tab ===

async function renderOffersTab(tabContent, offers, offeredJobs) {
    const jobMap = {};
    offeredJobs.forEach(j => { jobMap[j.id] = j; });
    offers.forEach(o => { if (o.title) jobMap[o.job_id] = { id: o.job_id, title: o.title, company: o.company }; });

    tabContent.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <p style="color:var(--text-secondary);margin:0">${offers.length} offer${offers.length !== 1 ? 's' : ''} tracked</p>
            <div style="display:flex;gap:8px">
                ${offers.length >= 2 ? `<button id="compare-offers-btn" class="btn btn-primary btn-sm">Compare Offers</button>` : ''}
                <button id="add-offer-btn" class="btn btn-primary btn-sm">+ Add Offer</button>
            </div>
        </div>
        <div id="offers-list"></div>
        <div id="offer-form-container" style="display:none"></div>
        <div id="offer-comparison-container" style="display:none"></div>
    `;

    renderOffersList(tabContent, offers, jobMap);

    tabContent.querySelector('#add-offer-btn')?.addEventListener('click', () => {
        showOfferForm(tabContent, null, offeredJobs, offers, jobMap);
    });

    tabContent.querySelector('#compare-offers-btn')?.addEventListener('click', async () => {
        await showOfferComparison(tabContent);
    });
}

function renderOffersList(tabContent, offers, jobMap) {
    const listEl = tabContent.querySelector('#offers-list');
    if (!offers.length) {
        listEl.innerHTML = `<div class="empty-state"><div class="empty-state-title">No offers yet</div><div class="empty-state-desc">Add an offer when a job reaches the "offered" stage</div></div>`;
        return;
    }

    listEl.innerHTML = offers.map(offer => {
        const job = jobMap[offer.job_id] || {};
        const base = offer.base || 0;
        const equity = offer.equity || 0;
        const bonus = offer.bonus || 0;
        const totalCash = base + bonus;
        return `
            <div class="card offer-card" style="margin-bottom:12px;padding:16px">
                <div style="display:flex;justify-content:space-between;align-items:flex-start">
                    <div>
                        <div style="font-weight:600;font-size:0.95rem">${escapeHtml(job.title || 'Unknown Position')}</div>
                        <div style="color:var(--text-secondary);font-size:0.85rem">${escapeHtml(job.company || '')}${offer.location ? ` \u2022 ${escapeHtml(offer.location)}` : ''}</div>
                    </div>
                    <div style="display:flex;gap:6px">
                        <button class="btn btn-ghost btn-sm offer-edit-btn" data-offer-id="${offer.id}" title="Edit">Edit</button>
                        <button class="btn btn-ghost btn-sm offer-delete-btn" data-offer-id="${offer.id}" title="Delete" style="color:var(--danger)">Delete</button>
                    </div>
                </div>
                <div class="offer-comp-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-top:12px">
                    <div><div style="font-size:0.75rem;color:var(--text-secondary)">Base</div><div style="font-weight:600">${formatCurrency(base)}</div></div>
                    <div><div style="font-size:0.75rem;color:var(--text-secondary)">Bonus</div><div style="font-weight:600">${formatCurrency(bonus)}</div></div>
                    <div><div style="font-size:0.75rem;color:var(--text-secondary)">Equity</div><div style="font-weight:600">${formatCurrency(equity)}</div></div>
                    <div><div style="font-size:0.75rem;color:var(--text-secondary)">Total Cash</div><div style="font-weight:600;color:var(--accent)">${formatCurrency(totalCash)}</div></div>
                    ${offer.pto_days ? `<div><div style="font-size:0.75rem;color:var(--text-secondary)">PTO</div><div style="font-weight:600">${offer.pto_days} days</div></div>` : ''}
                    ${offer.remote_days ? `<div><div style="font-size:0.75rem;color:var(--text-secondary)">Remote</div><div style="font-weight:600">${offer.remote_days} days/wk</div></div>` : ''}
                </div>
                ${offer.notes ? `<div style="margin-top:8px;font-size:0.85rem;color:var(--text-secondary)">${escapeHtml(offer.notes)}</div>` : ''}
            </div>
        `;
    }).join('');

    listEl.querySelectorAll('.offer-edit-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const offerId = parseInt(btn.dataset.offerId);
            const offer = offers.find(o => o.id === offerId);
            if (offer) showOfferForm(tabContent, offer, Object.values(jobMap), offers, jobMap);
        });
    });

    listEl.querySelectorAll('.offer-delete-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const ok = await showModal({
                title: 'Delete Offer',
                message: 'Are you sure you want to delete this offer?',
                confirmText: 'Delete',
                danger: true,
            });
            if (!ok) return;
            try {
                await api.request('DELETE', `/api/offers/${btn.dataset.offerId}`);
                showToast('Offer deleted', 'success');
                const refreshed = await api.request('GET', '/api/offers');
                offers.length = 0;
                refreshed.offers.forEach(o => offers.push(o));
                renderOffersList(tabContent, offers, jobMap);
            } catch (err) {
                showToast(`Failed to delete: ${err.message}`, 'error');
            }
        });
    });
}

function showOfferForm(tabContent, existingOffer, availableJobs, offers, jobMap) {
    const formContainer = tabContent.querySelector('#offer-form-container');
    formContainer.style.display = 'block';
    const isEdit = !!existingOffer;

    const jobOptions = (Array.isArray(availableJobs) ? availableJobs : []).map(j => {
        const job = j.id ? j : { id: j.job_id, title: j.title, company: j.company };
        const selected = existingOffer && existingOffer.job_id === job.id ? 'selected' : '';
        return `<option value="${job.id}" ${selected}>${escapeHtml(job.title || '')} - ${escapeHtml(job.company || '')}</option>`;
    }).join('');

    formContainer.innerHTML = `
        <div class="card" style="padding:20px;margin-bottom:16px;border:2px solid var(--accent)">
            <h3 style="margin:0 0 16px;font-size:1rem">${isEdit ? 'Edit' : 'Add'} Offer</h3>
            <form id="offer-form">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                    <div style="grid-column:1/-1">
                        <label class="form-label">Job</label>
                        <select name="job_id" class="form-input" required>${jobOptions}</select>
                    </div>
                    <div>
                        <label class="form-label">Base Salary ($)</label>
                        <input type="number" name="base" class="form-input" value="${existingOffer?.base || ''}" placeholder="120000">
                    </div>
                    <div>
                        <label class="form-label">Bonus ($)</label>
                        <input type="number" name="bonus" class="form-input" value="${existingOffer?.bonus || ''}" placeholder="15000">
                    </div>
                    <div>
                        <label class="form-label">Equity ($/yr)</label>
                        <input type="number" name="equity" class="form-input" value="${existingOffer?.equity || ''}" placeholder="25000">
                    </div>
                    <div>
                        <label class="form-label">Health Value ($/yr)</label>
                        <input type="number" name="health_value" class="form-input" value="${existingOffer?.health_value || ''}" placeholder="8000">
                    </div>
                    <div>
                        <label class="form-label">Retirement Match (%)</label>
                        <input type="number" name="retirement_match" class="form-input" step="0.1" value="${existingOffer?.retirement_match || ''}" placeholder="6">
                    </div>
                    <div>
                        <label class="form-label">Relocation ($)</label>
                        <input type="number" name="relocation" class="form-input" value="${existingOffer?.relocation || ''}" placeholder="5000">
                    </div>
                    <div>
                        <label class="form-label">PTO Days</label>
                        <input type="number" name="pto_days" class="form-input" value="${existingOffer?.pto_days || ''}" placeholder="20">
                    </div>
                    <div>
                        <label class="form-label">Remote Days/Week</label>
                        <input type="number" name="remote_days" class="form-input" value="${existingOffer?.remote_days || ''}" placeholder="3">
                    </div>
                    <div style="grid-column:1/-1">
                        <label class="form-label">Location</label>
                        <input type="text" name="location" class="form-input" value="${escapeHtml(existingOffer?.location || '')}" placeholder="City, State">
                    </div>
                    <div style="grid-column:1/-1">
                        <label class="form-label">Notes</label>
                        <textarea name="notes" class="form-input" rows="2" placeholder="Additional details...">${escapeHtml(existingOffer?.notes || '')}</textarea>
                    </div>
                </div>
                <div style="display:flex;gap:8px;margin-top:16px">
                    <button type="submit" class="btn btn-primary btn-sm">${isEdit ? 'Update' : 'Add'} Offer</button>
                    <button type="button" id="cancel-offer-form" class="btn btn-ghost btn-sm">Cancel</button>
                </div>
            </form>
        </div>
    `;

    formContainer.querySelector('#cancel-offer-form').addEventListener('click', () => {
        formContainer.style.display = 'none';
        formContainer.innerHTML = '';
    });

    formContainer.querySelector('#offer-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const body = {};
        for (const [k, v] of fd.entries()) {
            if (v === '') continue;
            body[k] = ['job_id', 'base', 'bonus', 'equity', 'health_value', 'retirement_match', 'relocation', 'pto_days', 'remote_days'].includes(k)
                ? Number(v) : v;
        }

        try {
            if (isEdit) {
                await api.request('PUT', `/api/offers/${existingOffer.id}`, body);
                showToast('Offer updated', 'success');
            } else {
                await api.request('POST', '/api/offers', body);
                showToast('Offer added', 'success');
            }
            formContainer.style.display = 'none';
            formContainer.innerHTML = '';
            const refreshed = await api.request('GET', '/api/offers');
            offers.length = 0;
            refreshed.offers.forEach(o => offers.push(o));
            refreshed.offers.forEach(o => { if (o.title) jobMap[o.job_id] = { id: o.job_id, title: o.title, company: o.company }; });
            renderOffersList(tabContent, offers, jobMap);
            // Update compare button visibility
            const btnArea = tabContent.querySelector('#compare-offers-btn');
            if (!btnArea && offers.length >= 2) {
                const addBtn = tabContent.querySelector('#add-offer-btn');
                if (addBtn) {
                    const cmpBtn = document.createElement('button');
                    cmpBtn.id = 'compare-offers-btn';
                    cmpBtn.className = 'btn btn-primary btn-sm';
                    cmpBtn.textContent = 'Compare Offers';
                    cmpBtn.addEventListener('click', () => showOfferComparison(tabContent));
                    addBtn.parentElement.insertBefore(cmpBtn, addBtn);
                }
            }
        } catch (err) {
            showToast(`Failed to save offer: ${err.message}`, 'error');
        }
    });
}

async function showOfferComparison(tabContent) {
    const compContainer = tabContent.querySelector('#offer-comparison-container');
    compContainer.style.display = 'block';
    compContainer.innerHTML = `<div class="loading-container"><div class="spinner"></div><span>Calculating...</span></div>`;

    try {
        const { comparison } = await api.request('GET', '/api/offers/compare');
        if (!comparison || !comparison.length) {
            compContainer.innerHTML = `<div class="empty-state"><div class="empty-state-desc">No offers to compare</div></div>`;
            return;
        }

        const compFields = [
            { key: 'base', label: 'Base Salary' },
            { key: 'bonus', label: 'Bonus' },
            { key: 'equity', label: 'Equity' },
            { key: 'health_value', label: 'Health Benefits' },
            { key: 'retirement_value', label: 'Retirement (calc)' },
            { key: 'relocation', label: 'Relocation' },
            { key: 'pto_value', label: 'PTO Value' },
            { key: 'total_cash', label: 'Total Cash' },
            { key: 'total_comp', label: 'Total Comp' },
            { key: 'total_with_pto', label: 'Total + PTO Value' },
        ];

        const bestTotal = comparison[0]?.total_comp || 0;

        compContainer.innerHTML = `
            <div class="card" style="padding:20px;margin-top:16px;overflow-x:auto">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h3 style="margin:0;font-size:1rem">Offer Comparison</h3>
                    <button id="close-comparison" class="btn btn-ghost btn-sm">Close</button>
                </div>
                <table class="comparison-table" style="width:100%">
                    <thead>
                        <tr>
                            <th style="text-align:left;padding:8px 12px;min-width:140px">Component</th>
                            ${comparison.map((c, i) => `
                                <th style="text-align:right;padding:8px 12px;min-width:140px">
                                    <div style="font-weight:600">${escapeHtml(c.location || `Offer ${i + 1}`)}</div>
                                    ${i === 0 ? '<span class="badge badge-sm" style="background:var(--score-green);color:#fff;font-size:0.65rem">Best</span>' : ''}
                                </th>
                            `).join('')}
                        </tr>
                    </thead>
                    <tbody>
                        ${compFields.map(f => {
                            const isTotal = f.key.startsWith('total');
                            return `
                                <tr style="${isTotal ? 'font-weight:600;border-top:2px solid var(--border)' : ''}">
                                    <td style="padding:8px 12px;color:var(--text-secondary);font-size:0.85rem">${f.label}</td>
                                    ${comparison.map(c => {
                                        const val = c[f.key] || 0;
                                        const isBest = isTotal && val === bestTotal && f.key === 'total_comp';
                                        return `<td style="padding:8px 12px;text-align:right;${isBest ? 'color:var(--score-green)' : ''}">${formatCurrency(val)}</td>`;
                                    }).join('')}
                                </tr>
                            `;
                        }).join('')}
                        <tr style="border-top:2px solid var(--border)">
                            <td style="padding:8px 12px;color:var(--text-secondary);font-size:0.85rem">vs Best</td>
                            ${comparison.map(c => {
                                const diff = c.vs_best || 0;
                                const color = diff === 0 ? 'var(--score-green)' : 'var(--danger)';
                                return `<td style="padding:8px 12px;text-align:right;color:${color};font-weight:600">${diff === 0 ? '-' : formatCurrency(diff)}</td>`;
                            }).join('')}
                        </tr>
                    </tbody>
                </table>

                ${comparison.length > 0 ? `
                    <div style="margin-top:20px">
                        <h4 style="font-size:0.9rem;margin-bottom:12px">Compensation Breakdown</h4>
                        <div style="display:flex;gap:16px;flex-wrap:wrap">
                            ${comparison.map((c, i) => {
                                const total = c.total_comp || 1;
                                const segments = [
                                    { label: 'Base', val: c.base, color: 'var(--accent)' },
                                    { label: 'Bonus', val: c.bonus, color: 'var(--score-green)' },
                                    { label: 'Equity', val: c.equity, color: 'var(--score-amber)' },
                                    { label: 'Benefits', val: (c.health_value || 0) + (c.retirement_value || 0) + (c.relocation || 0), color: '#8b5cf6' },
                                ];
                                return `
                                    <div style="flex:1;min-width:200px">
                                        <div style="font-size:0.8rem;font-weight:600;margin-bottom:6px">${escapeHtml(c.location || `Offer ${i + 1}`)}</div>
                                        <div style="height:24px;display:flex;border-radius:6px;overflow:hidden;background:var(--bg-secondary)">
                                            ${segments.filter(s => s.val > 0).map(s => `
                                                <div title="${s.label}: ${formatCurrency(s.val)}" style="width:${(s.val / total * 100).toFixed(1)}%;background:${s.color};min-width:2px"></div>
                                            `).join('')}
                                        </div>
                                        <div style="display:flex;gap:8px;margin-top:4px;flex-wrap:wrap">
                                            ${segments.filter(s => s.val > 0).map(s => `
                                                <span style="font-size:0.7rem;color:var(--text-secondary);display:flex;align-items:center;gap:3px">
                                                    <span style="width:8px;height:8px;border-radius:50%;background:${s.color};display:inline-block"></span>
                                                    ${s.label}
                                                </span>
                                            `).join('')}
                                        </div>
                                    </div>
                                `;
                            }).join('')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;

        compContainer.querySelector('#close-comparison').addEventListener('click', () => {
            compContainer.style.display = 'none';
            compContainer.innerHTML = '';
        });
    } catch (err) {
        compContainer.innerHTML = `<div class="empty-state"><div class="empty-state-desc">Failed to compare: ${escapeHtml(err.message)}</div></div>`;
    }
}

// === Add External Job Modal ===

function showAddExternalJobModal(container, statuses, statusLabels) {
    const existing = document.getElementById('add-job-modal');
    if (existing) existing.remove();

    const statusOptions = statuses.map(s =>
        `<option value="${s}" ${s === 'interested' ? 'selected' : ''}>${escapeHtml(statusLabels[s])}</option>`
    ).join('');

    const modal = document.createElement('div');
    modal.id = 'add-job-modal';
    modal.innerHTML = `
        <div class="modal-overlay" onclick="document.getElementById('add-job-modal')?.remove()">
            <div class="modal-content" style="max-width:540px" onclick="event.stopPropagation()">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
                    <h2 class="modal-title" style="margin:0">Add External Job</h2>
                    <button class="btn btn-ghost btn-sm" onclick="document.getElementById('add-job-modal')?.remove()">Close</button>
                </div>
                <form id="add-job-form">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                        <div style="grid-column:1/-1">
                            <label class="form-label">Job URL</label>
                            <input type="url" name="url" class="form-input" id="add-job-url" placeholder="https://..." autocomplete="off">
                            <div id="add-job-fetch-status" style="font-size:0.75rem;color:var(--text-tertiary);margin-top:4px"></div>
                        </div>
                        <div>
                            <label class="form-label">Title *</label>
                            <input type="text" name="title" class="form-input" id="add-job-title" required>
                        </div>
                        <div>
                            <label class="form-label">Company *</label>
                            <input type="text" name="company" class="form-input" id="add-job-company" required>
                        </div>
                        <div style="grid-column:1/-1">
                            <label class="form-label">Description</label>
                            <textarea name="description" class="form-input" id="add-job-description" rows="3" placeholder="Paste or auto-filled from URL..."></textarea>
                        </div>
                        <div>
                            <label class="form-label">Location</label>
                            <input type="text" name="location" class="form-input" id="add-job-location" placeholder="City, State or Remote">
                        </div>
                        <div>
                            <label class="form-label">Salary</label>
                            <input type="text" name="salary" class="form-input" id="add-job-salary" placeholder="e.g. 150000 or 150k-180k">
                        </div>
                        <div>
                            <label class="form-label">Initial Status</label>
                            <select name="status" class="form-input" id="add-job-status">${statusOptions}</select>
                        </div>
                        <div style="display:flex;align-items:flex-end">
                            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:0.875rem">
                                <input type="checkbox" id="add-job-interview-toggle" style="width:16px;height:16px">
                                Add First Interview
                            </label>
                        </div>
                    </div>
                    <div id="add-job-interview-fields" style="display:none;margin-top:12px;padding:12px;background:var(--bg-surface-secondary);border-radius:var(--radius-sm)">
                        <div style="font-size:0.8125rem;font-weight:600;margin-bottom:8px">Interview Details</div>
                        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                            <div>
                                <label class="form-label">Round Label</label>
                                <input type="text" name="interview_label" class="form-input" placeholder="e.g. Phone Screen">
                            </div>
                            <div>
                                <label class="form-label">Date & Time</label>
                                <input type="datetime-local" name="interview_date" class="form-input">
                            </div>
                            <div>
                                <label class="form-label">Duration (min)</label>
                                <input type="number" name="interview_duration" class="form-input" value="60" min="15" step="15">
                            </div>
                            <div>
                                <label class="form-label">Interviewer Name</label>
                                <input type="text" name="interviewer_name" class="form-input" placeholder="Optional">
                            </div>
                        </div>
                    </div>
                    <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
                        <button type="button" class="btn btn-ghost btn-sm" onclick="document.getElementById('add-job-modal')?.remove()">Cancel</button>
                        <button type="submit" class="btn btn-primary btn-sm" id="add-job-submit">Add Job</button>
                    </div>
                </form>
            </div>
        </div>
    `;
    document.body.appendChild(modal);

    // Toggle interview fields
    modal.querySelector('#add-job-interview-toggle').addEventListener('change', (e) => {
        modal.querySelector('#add-job-interview-fields').style.display = e.target.checked ? 'block' : 'none';
    });

    // Auto-fetch on URL blur
    const urlInput = modal.querySelector('#add-job-url');
    const fetchStatus = modal.querySelector('#add-job-fetch-status');
    let fetchAbort = null;

    urlInput.addEventListener('blur', async () => {
        const url = urlInput.value.trim();
        if (!url || !url.startsWith('http')) return;

        if (fetchAbort) fetchAbort.abort();
        fetchAbort = new AbortController();
        fetchStatus.textContent = 'Fetching job details...';

        try {
            const data = await api.request('POST', '/api/jobs/lookup', { url });
            if (data.title) modal.querySelector('#add-job-title').value = data.title;
            if (data.company) modal.querySelector('#add-job-company').value = data.company;
            if (data.description) modal.querySelector('#add-job-description').value = data.description;
            if (data.location) modal.querySelector('#add-job-location').value = data.location;
            if (data.salary) modal.querySelector('#add-job-salary').value = data.salary;
            fetchStatus.textContent = 'Details auto-filled from URL';
            fetchStatus.style.color = 'var(--score-green)';
        } catch {
            fetchStatus.textContent = 'Could not fetch details — fill in manually';
            fetchStatus.style.color = 'var(--score-amber)';
        }
    });

    // Submit handler
    modal.querySelector('#add-job-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = modal.querySelector('#add-job-submit');
        submitBtn.disabled = true;
        submitBtn.textContent = 'Adding...';

        const fd = new FormData(e.target);
        const salaryRaw = fd.get('salary') || '';
        let salaryMin = null, salaryMax = null;
        const salaryMatch = salaryRaw.match(/(\d[\d,]*)/g);
        if (salaryMatch) {
            salaryMin = parseInt(salaryMatch[0].replace(/,/g, ''), 10);
            if (salaryMatch[1]) salaryMax = parseInt(salaryMatch[1].replace(/,/g, ''), 10);
            // Handle shorthand like 150k
            if (salaryMin < 1000 && salaryRaw.toLowerCase().includes('k')) salaryMin *= 1000;
            if (salaryMax && salaryMax < 1000 && salaryRaw.toLowerCase().includes('k')) salaryMax *= 1000;
        }

        const jobData = {
            title: fd.get('title'),
            company: fd.get('company'),
            url: fd.get('url') || '',
            description: fd.get('description') || '',
            location: fd.get('location') || '',
            salary_min: salaryMin,
            salary_max: salaryMax,
            source: 'external',
        };

        try {
            const result = await api.saveExternalJob(jobData);
            const jobId = result.job_id;

            // Apply status if not default
            const status = fd.get('status');
            if (status && status !== 'interested') {
                await api.updateApplication(jobId, status);
            } else if (status === 'interested') {
                await api.updateApplication(jobId, 'interested');
            }

            // Create interview if toggled
            if (modal.querySelector('#add-job-interview-toggle').checked) {
                const interviewData = {
                    label: fd.get('interview_label') || 'Round 1',
                    scheduled_at: fd.get('interview_date') || null,
                    duration_min: parseInt(fd.get('interview_duration') || '60', 10),
                    interviewer_name: fd.get('interviewer_name') || '',
                };
                try {
                    await api.createInterview(jobId, interviewData);
                } catch {
                    // Interview API may not be ready yet
                }
            }

            modal.remove();
            showToast('Job added to pipeline', 'success');
            await renderPipeline(container);
        } catch (err) {
            showToast(`Failed to add job: ${err.message}`, 'error');
            submitBtn.disabled = false;
            submitBtn.textContent = 'Add Job';
        }
    });
}

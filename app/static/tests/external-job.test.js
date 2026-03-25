import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScripts } from './setup.js';

beforeAll(() => {
    document.body.innerHTML = `
        <div id="toast-container"></div>
        <div id="app"></div>
    `;

    globalThis.showToast = vi.fn();
    globalThis.showModal = vi.fn().mockResolvedValue(true);
    globalThis.navigate = vi.fn();
    globalThis.registerViewCleanup = vi.fn();
    globalThis.getScoreClass = (score) => score >= 80 ? 'score-high' : 'score-low';

    loadScripts('utils.js', 'api.js', 'views/pipeline.js');
});

beforeEach(() => {
    vi.restoreAllMocks();
    document.getElementById('app').innerHTML = '';
});

describe('showAddExternalJobModal', () => {
    const statuses = ['interested', 'prepared', 'applied', 'interviewing', 'offered', 'rejected'];
    const statusLabels = {
        interested: 'Interested', prepared: 'Prepared', applied: 'Applied',
        interviewing: 'Interviewing', offered: 'Offered', rejected: 'Rejected',
    };

    it('creates modal in DOM', () => {
        showAddExternalJobModal(document.getElementById('app'), statuses, statusLabels);
        const modal = document.getElementById('add-job-modal');
        expect(modal).not.toBeNull();
        expect(modal.innerHTML).toContain('Add External Job');
        modal.remove();
    });

    it('has all required form fields', () => {
        showAddExternalJobModal(document.getElementById('app'), statuses, statusLabels);
        const modal = document.getElementById('add-job-modal');

        expect(modal.querySelector('input[name="url"]')).not.toBeNull();
        expect(modal.querySelector('input[name="title"]')).not.toBeNull();
        expect(modal.querySelector('input[name="company"]')).not.toBeNull();
        expect(modal.querySelector('textarea[name="description"]')).not.toBeNull();
        expect(modal.querySelector('input[name="location"]')).not.toBeNull();
        expect(modal.querySelector('input[name="salary"]')).not.toBeNull();
        expect(modal.querySelector('select[name="status"]')).not.toBeNull();

        modal.remove();
    });

    it('has all status options in dropdown', () => {
        showAddExternalJobModal(document.getElementById('app'), statuses, statusLabels);
        const modal = document.getElementById('add-job-modal');

        const select = modal.querySelector('select[name="status"]');
        const options = Array.from(select.querySelectorAll('option'));
        expect(options.length).toBe(6);
        expect(options.map(o => o.value)).toEqual(statuses);

        modal.remove();
    });

    it('defaults to interested status', () => {
        showAddExternalJobModal(document.getElementById('app'), statuses, statusLabels);
        const modal = document.getElementById('add-job-modal');

        const select = modal.querySelector('select[name="status"]');
        expect(select.value).toBe('interested');

        modal.remove();
    });

    it('has interview toggle', () => {
        showAddExternalJobModal(document.getElementById('app'), statuses, statusLabels);
        const modal = document.getElementById('add-job-modal');

        const toggle = modal.querySelector('#add-job-interview-toggle');
        expect(toggle).not.toBeNull();
        expect(toggle.type).toBe('checkbox');

        modal.remove();
    });

    it('interview fields hidden by default', () => {
        showAddExternalJobModal(document.getElementById('app'), statuses, statusLabels);
        const modal = document.getElementById('add-job-modal');

        const fields = modal.querySelector('#add-job-interview-fields');
        expect(fields.style.display).toBe('none');

        modal.remove();
    });

    it('toggles interview fields visibility', () => {
        showAddExternalJobModal(document.getElementById('app'), statuses, statusLabels);
        const modal = document.getElementById('add-job-modal');

        const toggle = modal.querySelector('#add-job-interview-toggle');
        const fields = modal.querySelector('#add-job-interview-fields');

        toggle.checked = true;
        toggle.dispatchEvent(new Event('change'));
        expect(fields.style.display).toBe('block');

        toggle.checked = false;
        toggle.dispatchEvent(new Event('change'));
        expect(fields.style.display).toBe('none');

        modal.remove();
    });

    it('title and company fields are required', () => {
        showAddExternalJobModal(document.getElementById('app'), statuses, statusLabels);
        const modal = document.getElementById('add-job-modal');

        const titleInput = modal.querySelector('input[name="title"]');
        const companyInput = modal.querySelector('input[name="company"]');
        expect(titleInput.required).toBe(true);
        expect(companyInput.required).toBe(true);

        modal.remove();
    });

    it('removes existing modal before creating new one', () => {
        showAddExternalJobModal(document.getElementById('app'), statuses, statusLabels);
        showAddExternalJobModal(document.getElementById('app'), statuses, statusLabels);
        const modals = document.querySelectorAll('#add-job-modal');
        expect(modals.length).toBe(1);
        modals[0].remove();
    });
});

describe('api.saveExternalJob', () => {
    it('calls correct endpoint', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ ok: true, job_id: 123 }),
        });

        const result = await api.saveExternalJob({
            title: 'Engineer',
            company: 'Acme',
            url: 'https://example.com',
        });

        expect(fetch.mock.calls[0][0]).toBe('/api/jobs/save-external');
        expect(fetch.mock.calls[0][1].method).toBe('POST');
        expect(result.job_id).toBe(123);
    });
});

describe('api interview methods', () => {
    beforeEach(() => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ rounds: [] }),
        });
    });

    it('getInterviews calls correct endpoint', async () => {
        await api.getInterviews(42);
        expect(fetch.mock.calls[0][0]).toBe('/api/jobs/42/interviews');
    });

    it('createInterview sends POST with data', async () => {
        const data = { label: 'Phone Screen', scheduled_at: '2026-03-25T14:00:00' };
        await api.createInterview(42, data);
        expect(fetch.mock.calls[0][0]).toBe('/api/jobs/42/interviews');
        expect(fetch.mock.calls[0][1].method).toBe('POST');
        expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(data);
    });

    it('updateInterview sends PUT', async () => {
        await api.updateInterview(7, { status: 'completed' });
        expect(fetch.mock.calls[0][0]).toBe('/api/interviews/7');
        expect(fetch.mock.calls[0][1].method).toBe('PUT');
    });

    it('deleteInterview sends DELETE', async () => {
        await api.deleteInterview(7);
        expect(fetch.mock.calls[0][0]).toBe('/api/interviews/7');
        expect(fetch.mock.calls[0][1].method).toBe('DELETE');
    });

    it('promoteInterviewer sends POST', async () => {
        await api.promoteInterviewer(7, { name: 'Jane' });
        expect(fetch.mock.calls[0][0]).toBe('/api/interviews/7/promote-interviewer');
        expect(fetch.mock.calls[0][1].method).toBe('POST');
    });
});

describe('api calendar methods', () => {
    beforeEach(() => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
        });
    });

    it('getCalendarEvents builds query string', async () => {
        await api.getCalendarEvents({ start: '2026-03-01', end: '2026-03-31' });
        const url = fetch.mock.calls[0][0];
        expect(url).toContain('/api/calendar?');
        expect(url).toContain('start=2026-03-01');
        expect(url).toContain('end=2026-03-31');
    });

    it('getIcalToken calls correct endpoint', async () => {
        await api.getIcalToken();
        expect(fetch.mock.calls[0][0]).toBe('/api/calendar/ical-token');
    });

    it('regenerateIcalToken sends POST', async () => {
        await api.regenerateIcalToken();
        expect(fetch.mock.calls[0][0]).toBe('/api/calendar/ical-token');
        expect(fetch.mock.calls[0][1].method).toBe('POST');
    });
});

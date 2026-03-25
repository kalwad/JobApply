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
    globalThis.copyToClipboard = vi.fn();

    loadScripts('utils.js', 'api.js', 'views/detail.js');
});

beforeEach(() => {
    vi.restoreAllMocks();
    document.getElementById('app').innerHTML = '';
});

function mockFetch(responseMap = {}) {
    globalThis.fetch = vi.fn((url, opts) => {
        for (const [pattern, data] of Object.entries(responseMap)) {
            if (url.includes(pattern)) {
                return Promise.resolve({
                    ok: true,
                    json: () => Promise.resolve(data),
                });
            }
        }
        return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({}),
        });
    });
}

const sampleRounds = [
    {
        id: 1, job_id: 42, round_number: 1, label: 'Phone Screen',
        scheduled_at: '2026-03-25T14:00:00', duration_min: 30,
        interviewer_name: 'Jane Doe', interviewer_title: 'Recruiter',
        contact_id: null, location: 'Zoom', notes: 'Intro call',
        status: 'scheduled',
    },
    {
        id: 2, job_id: 42, round_number: 2, label: 'Technical',
        scheduled_at: '2026-04-01T10:00:00', duration_min: 60,
        interviewer_name: 'Bob Smith', interviewer_title: 'Sr Engineer',
        contact_id: 5, location: 'Office', notes: '',
        status: 'completed',
    },
];

describe('renderInterviewTimeline', () => {
    it('renders rounds sorted by round_number', () => {
        const html = renderInterviewTimeline(sampleRounds, 42);
        const container = document.createElement('div');
        container.innerHTML = html;

        const cards = container.querySelectorAll('.interview-round-card');
        expect(cards.length).toBe(2);
        expect(cards[0].innerHTML).toContain('Phone Screen');
        expect(cards[1].innerHTML).toContain('Technical');
    });

    it('shows empty state when no rounds', () => {
        const html = renderInterviewTimeline([], 42);
        expect(html).toContain('No interview rounds yet');
    });

    it('shows add round button', () => {
        const html = renderInterviewTimeline([], 42);
        expect(html).toContain('Add Round');
    });

    it('renders status badges', () => {
        const html = renderInterviewTimeline(sampleRounds, 42);
        expect(html).toContain('scheduled');
        expect(html).toContain('completed');
    });

    it('shows Save to Network for interviewers not in contacts', () => {
        const html = renderInterviewTimeline(sampleRounds, 42);
        const container = document.createElement('div');
        container.innerHTML = html;

        // Round 1 has no contact_id — should show Save to Network
        const saveBtn = container.querySelector('.interview-save-contact-btn[data-round-id="1"]');
        expect(saveBtn).not.toBeNull();
        expect(saveBtn.textContent).toContain('Save to Network');

        // Round 2 has contact_id — should show In Network
        const card2 = container.querySelector('.interview-round-card[data-round-id="2"]');
        expect(card2.innerHTML).toContain('In Network');
    });

    it('shows edit and delete buttons per round', () => {
        const html = renderInterviewTimeline(sampleRounds, 42);
        const container = document.createElement('div');
        container.innerHTML = html;

        const editBtns = container.querySelectorAll('.interview-edit-btn');
        const deleteBtns = container.querySelectorAll('.interview-delete-btn');
        expect(editBtns.length).toBe(2);
        expect(deleteBtns.length).toBe(2);
    });

    it('shows interviewer info', () => {
        const html = renderInterviewTimeline(sampleRounds, 42);
        expect(html).toContain('Jane Doe');
        expect(html).toContain('Recruiter');
        expect(html).toContain('Bob Smith');
        expect(html).toContain('Sr Engineer');
    });

    it('shows location when present', () => {
        const html = renderInterviewTimeline(sampleRounds, 42);
        expect(html).toContain('Zoom');
        expect(html).toContain('Office');
    });

    it('shows notes when present', () => {
        const html = renderInterviewTimeline(sampleRounds, 42);
        expect(html).toContain('Intro call');
    });
});

describe('showInterviewForm', () => {
    it('shows add form with empty fields', () => {
        const container = document.createElement('div');
        container.innerHTML = `<div id="interview-add-form-container" style="display:none"></div>`;

        showInterviewForm(container, 42, null, document.getElementById('app'), {}, null, []);

        const formContainer = container.querySelector('#interview-add-form-container');
        expect(formContainer.style.display).toBe('block');
        expect(formContainer.innerHTML).toContain('Add Interview Round');
        expect(formContainer.querySelector('input[name="label"]')).not.toBeNull();
        expect(formContainer.querySelector('input[name="scheduled_at"]')).not.toBeNull();
    });

    it('shows edit form pre-populated with round data', () => {
        const container = document.createElement('div');
        container.innerHTML = `<div id="interview-add-form-container" style="display:none"></div>`;

        showInterviewForm(container, 42, sampleRounds[0], document.getElementById('app'), {}, null, []);

        const formContainer = container.querySelector('#interview-add-form-container');
        expect(formContainer.innerHTML).toContain('Edit Interview Round');
        expect(formContainer.querySelector('input[name="label"]').value).toBe('Phone Screen');
    });

    it('has label suggestion pills', () => {
        const container = document.createElement('div');
        container.innerHTML = `<div id="interview-add-form-container" style="display:none"></div>`;

        showInterviewForm(container, 42, null, document.getElementById('app'), {}, null, []);

        const pills = container.querySelectorAll('.iv-label-pill');
        expect(pills.length).toBeGreaterThan(0);
        expect(pills[0].dataset.label).toBeTruthy();
    });

    it('cancel button hides form', () => {
        const container = document.createElement('div');
        container.innerHTML = `<div id="interview-add-form-container" style="display:none"></div>`;

        showInterviewForm(container, 42, null, document.getElementById('app'), {}, null, []);

        const cancelBtn = container.querySelector('#cancel-interview-form');
        cancelBtn.click();

        const formContainer = container.querySelector('#interview-add-form-container');
        expect(formContainer.style.display).toBe('none');
        expect(formContainer.innerHTML).toBe('');
    });
});

describe('renderQuickActions', () => {
    it('shows action bar for interviewing jobs', () => {
        const job = { id: 1, application: { status: 'interviewing' }, events: [] };
        const html = renderQuickActions(job);
        const container = document.createElement('div');
        container.innerHTML = html;
        expect(container.querySelectorAll('.crm-action-btn').length).toBe(3);
        expect(container.querySelector('[data-action="call"]')).not.toBeNull();
        expect(container.querySelector('[data-action="email"]')).not.toBeNull();
        expect(container.querySelector('[data-action="note"]')).not.toBeNull();
    });

    it('hides action bar for non-interviewing jobs', () => {
        const job = { id: 1, application: { status: 'interested' }, events: [] };
        const html = renderQuickActions(job);
        const container = document.createElement('div');
        container.innerHTML = html;
        expect(container.querySelectorAll('.crm-action-btn').length).toBe(0);
    });

    it('shows default note input', () => {
        const job = { id: 1, events: [] };
        const html = renderQuickActions(job);
        const container = document.createElement('div');
        container.innerHTML = html;
        expect(container.querySelector('#add-note-input')).not.toBeNull();
        expect(container.querySelector('#add-note-btn')).not.toBeNull();
    });
});

describe('getCrmFormHtml', () => {
    it('returns call form', () => {
        const html = getCrmFormHtml('call');
        const container = document.createElement('div');
        container.innerHTML = html;
        expect(container.querySelector('[name="who"]')).not.toBeNull();
        expect(container.querySelector('[name="duration"]')).not.toBeNull();
        expect(container.querySelector('[name="notes"]')).not.toBeNull();
    });

    it('returns email form', () => {
        const html = getCrmFormHtml('email');
        const container = document.createElement('div');
        container.innerHTML = html;
        expect(container.querySelector('[name="direction"]')).not.toBeNull();
        expect(container.querySelector('[name="subject"]')).not.toBeNull();
    });

    it('returns note form', () => {
        const html = getCrmFormHtml('note');
        const container = document.createElement('div');
        container.innerHTML = html;
        expect(container.querySelector('#add-note-input')).not.toBeNull();
    });
});

describe('renderTimeline with structured events', () => {
    it('renders call events with structured display', () => {
        const events = [{
            event_type: 'call',
            detail: JSON.stringify({ who: 'Jane', duration: '15 min', notes: 'Discussed role' }),
            created_at: '2026-03-24T10:00:00',
        }];
        const html = renderTimeline(events);
        expect(html).toContain('Call');
        expect(html).toContain('Jane');
        expect(html).toContain('15 min');
        expect(html).toContain('Discussed role');
    });

    it('renders email events with structured display', () => {
        const events = [{
            event_type: 'email_log',
            detail: JSON.stringify({ direction: 'Sent', subject: 'Follow up', notes: 'Asked about timeline' }),
            created_at: '2026-03-24T10:00:00',
        }];
        const html = renderTimeline(events);
        expect(html).toContain('Email');
        expect(html).toContain('Sent');
        expect(html).toContain('Follow up');
        expect(html).toContain('Asked about timeline');
    });

    it('falls back to plain text for malformed JSON', () => {
        const events = [{
            event_type: 'call',
            detail: 'plain text call log',
            created_at: '2026-03-24T10:00:00',
        }];
        const html = renderTimeline(events);
        expect(html).toContain('plain text call log');
    });
});

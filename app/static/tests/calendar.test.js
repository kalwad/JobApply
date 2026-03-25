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

    loadScripts('utils.js', 'api.js', 'views/calendar.js');
});

beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ events: [] }),
    });
});

describe('toDateStr', () => {
    it('formats date as YYYY-MM-DD', () => {
        const d = new Date(2026, 2, 24);
        expect(toDateStr(d)).toBe('2026-03-24');
    });

    it('zero-pads month and day', () => {
        const d = new Date(2026, 0, 5);
        expect(toDateStr(d)).toBe('2026-01-05');
    });
});

describe('buildCalendarGrid', () => {
    it('renders correct number of day cells for a full month', () => {
        // March 2026: starts on Sunday, 31 days, need 5 rows = 35 cells
        const html = buildCalendarGrid(2026, 2, [], '2026-03-24');
        const container = document.createElement('div');
        container.innerHTML = html;
        const days = container.querySelectorAll('.calendar-day');
        // 31 days + leading 0 (Sun start) = 35 cells (5 weeks)
        expect(days.length).toBe(35);
    });

    it('marks today cell with calendar-day-today class', () => {
        const todayStr = '2026-03-15';
        const html = buildCalendarGrid(2026, 2, [], todayStr);
        const container = document.createElement('div');
        container.innerHTML = html;
        const todayCell = container.querySelector('.calendar-day-today');
        expect(todayCell).not.toBeNull();
        expect(todayCell.dataset.date).toBe(todayStr);
    });

    it('marks other-month days with calendar-day-other class', () => {
        // April 2026 starts on Wednesday, so Mon/Tue should be from March
        const html = buildCalendarGrid(2026, 3, [], '2026-04-15');
        const container = document.createElement('div');
        container.innerHTML = html;
        const otherDays = container.querySelectorAll('.calendar-day-other');
        expect(otherDays.length).toBeGreaterThan(0);
    });

    it('renders event chips with correct colors', () => {
        const events = [
            { type: 'interview', date: '2026-03-10', company: 'Acme', label: 'Phone Screen' },
            { type: 'reminder', date: '2026-03-10', label: 'Follow up' },
        ];
        const html = buildCalendarGrid(2026, 2, events, '2026-03-24');
        const container = document.createElement('div');
        container.innerHTML = html;
        const interviewChip = container.querySelector('.calendar-chip-interview');
        const reminderChip = container.querySelector('.calendar-chip-reminder');
        expect(interviewChip).not.toBeNull();
        expect(reminderChip).not.toBeNull();
    });

    it('shows +N more when more than 3 events on a day', () => {
        const events = [
            { type: 'interview', date: '2026-03-10', label: 'A' },
            { type: 'interview', date: '2026-03-10', label: 'B' },
            { type: 'interview', date: '2026-03-10', label: 'C' },
            { type: 'reminder', date: '2026-03-10', label: 'D' },
        ];
        const html = buildCalendarGrid(2026, 2, events, '2026-03-24');
        const container = document.createElement('div');
        container.innerHTML = html;
        const more = container.querySelector('.calendar-chip-more');
        expect(more).not.toBeNull();
        expect(more.textContent).toBe('+1 more');
    });

    it('marks days with events using calendar-day-has-events class', () => {
        const events = [
            { type: 'interview', date: '2026-03-15', label: 'Screen' },
        ];
        const html = buildCalendarGrid(2026, 2, events, '2026-03-24');
        const container = document.createElement('div');
        container.innerHTML = html;
        const dayCell = container.querySelector('[data-date="2026-03-15"]');
        expect(dayCell.classList.contains('calendar-day-has-events')).toBe(true);
    });
});

describe('renderAgenda', () => {
    it('shows empty message when no events', () => {
        const html = renderAgenda([]);
        expect(html).toContain('No upcoming events');
    });

    it('renders event items with labels', () => {
        const events = [
            { type: 'interview', scheduled_at: '2026-03-25T14:00:00', company: 'TestCo', job_id: 1 },
        ];
        const html = renderAgenda(events);
        expect(html).toContain('TestCo');
        expect(html).toContain('calendar-chip-interview');
        expect(html).toContain('#/job/1');
    });

    it('renders reminder events with amber styling', () => {
        const events = [
            { type: 'reminder', date: '2026-03-25', label: 'Follow up call' },
        ];
        const html = renderAgenda(events);
        expect(html).toContain('Follow up call');
        expect(html).toContain('calendar-chip-reminder');
    });
});

describe('showDayDetailModal', () => {
    it('creates a modal in the DOM', () => {
        const events = [
            { type: 'interview', label: 'Phone Screen', scheduled_at: '2026-03-25T10:00:00', company: 'Acme', job_id: 5 },
        ];
        showDayDetailModal('2026-03-25', events);
        const modal = document.getElementById('cal-day-modal');
        expect(modal).not.toBeNull();
        expect(modal.innerHTML).toContain('Phone Screen');
        expect(modal.innerHTML).toContain('Acme');
        modal.remove();
    });

    it('removes existing modal before creating new one', () => {
        showDayDetailModal('2026-03-25', [{ type: 'interview', label: 'First' }]);
        showDayDetailModal('2026-03-26', [{ type: 'reminder', label: 'Second' }]);
        const modals = document.querySelectorAll('#cal-day-modal');
        expect(modals.length).toBe(1);
        expect(modals[0].innerHTML).toContain('Second');
        modals[0].remove();
    });
});

describe('showIcalModal', () => {
    it('creates subscribe modal', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ token: 'abc123' }),
        });

        await showIcalModal();
        const modal = document.getElementById('ical-modal');
        expect(modal).not.toBeNull();
        expect(modal.innerHTML).toContain('Subscribe to Calendar');
        const urlInput = modal.querySelector('#ical-url');
        expect(urlInput.value).toContain('abc123');
        modal.remove();
    });

    it('shows fallback when no token', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
            json: () => Promise.resolve({ detail: 'Not found' }),
        });

        await showIcalModal();
        const modal = document.getElementById('ical-modal');
        expect(modal).not.toBeNull();
        expect(modal.innerHTML).toContain('not available yet');
        modal.remove();
    });
});

describe('renderCalendar', () => {
    it('renders the full calendar view', async () => {
        const app = document.getElementById('app');
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ events: [] }),
        });

        await renderCalendar(app);
        expect(app.querySelector('.calendar-grid')).not.toBeNull();
        expect(app.querySelector('.calendar-sidebar')).not.toBeNull();
        expect(app.querySelector('#cal-prev')).not.toBeNull();
        expect(app.querySelector('#cal-next')).not.toBeNull();
        expect(app.querySelector('#cal-today')).not.toBeNull();
        expect(app.querySelector('#cal-subscribe')).not.toBeNull();
    });
});

import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScripts } from './setup.js';

beforeAll(() => {
    document.body.innerHTML = `
        <div id="toast-container"></div>
        <div class="nav-links">
            <a class="nav-link" data-route="feed">Jobs</a>
            <a class="nav-link" data-route="stats">Dashboard</a>
            <a class="nav-link" data-route="pipeline">Pipeline</a>
            <a class="nav-link" data-route="calendar">Calendar</a>
            <a class="nav-link" data-route="queue">Queue</a>
            <a class="nav-link" data-route="network">Network</a>
            <a class="nav-link" data-route="calculator">Calculator</a>
            <a class="nav-link" data-route="settings">Settings</a>
        </div>
        <div id="app"></div>
    `;
    // Load utils first (needed by app.js), then api (needed by app.js filter code)
    loadScripts('utils.js', 'api.js');

    // Stub out view render functions that handleRoute calls
    globalThis.renderFeed = async () => {};
    globalThis.renderJobDetail = async () => {};
    globalThis.renderStats = async () => {};
    globalThis.renderPipeline = async () => {};
    globalThis.renderQueue = async () => {};
    globalThis.renderNetwork = async () => {};
    globalThis.renderSettings = async () => {};
    globalThis.renderCalendar = async () => {};
    globalThis.renderSalaryCalculator = async () => {};

    // Stub triage globals referenced by app.js keyboard shortcuts
    globalThis.enterTriageMode = () => {};
    globalThis.exitTriageMode = () => {};
    globalThis.triageActive = false;
    globalThis.triageJobs = [];
    globalThis.triageIndex = 0;
    globalThis.triageUndoStack = [];

    loadScripts('app.js');
});

beforeEach(() => {
    window.location.hash = '#/';
});

describe('getRoute', () => {
    it('returns feed for default hash', () => {
        window.location.hash = '#/';
        expect(getRoute()).toEqual({ view: 'feed' });
    });

    it('returns feed for empty hash', () => {
        window.location.hash = '';
        expect(getRoute()).toEqual({ view: 'feed' });
    });

    it('returns stats for #/stats', () => {
        window.location.hash = '#/stats';
        expect(getRoute()).toEqual({ view: 'stats' });
    });

    it('returns pipeline for #/pipeline', () => {
        window.location.hash = '#/pipeline';
        expect(getRoute()).toEqual({ view: 'pipeline' });
    });

    it('returns queue for #/queue', () => {
        window.location.hash = '#/queue';
        expect(getRoute()).toEqual({ view: 'queue' });
    });

    it('returns network for #/network', () => {
        window.location.hash = '#/network';
        expect(getRoute()).toEqual({ view: 'network' });
    });

    it('returns settings for #/settings', () => {
        window.location.hash = '#/settings';
        expect(getRoute()).toEqual({ view: 'settings' });
    });

    it('returns calendar for #/calendar', () => {
        window.location.hash = '#/calendar';
        expect(getRoute()).toEqual({ view: 'calendar' });
    });

    it('returns calculator for #/calculator', () => {
        window.location.hash = '#/calculator';
        expect(getRoute()).toEqual({ view: 'calculator' });
    });

    it('parses job detail routes with id', () => {
        window.location.hash = '#/job/42';
        expect(getRoute()).toEqual({ view: 'detail', id: 42 });
    });

    it('defaults to feed for unknown hashes', () => {
        window.location.hash = '#/unknown';
        expect(getRoute()).toEqual({ view: 'feed' });
    });
});

describe('navigate', () => {
    it('sets window.location.hash', () => {
        navigate('#/stats');
        expect(window.location.hash).toBe('#/stats');
    });
});

describe('updateActiveNav', () => {
    it('highlights the correct nav link for feed', () => {
        window.location.hash = '#/';
        updateActiveNav();
        const feedLink = document.querySelector('[data-route="feed"]');
        const statsLink = document.querySelector('[data-route="stats"]');
        expect(feedLink.classList.contains('active')).toBe(true);
        expect(statsLink.classList.contains('active')).toBe(false);
    });

    it('highlights the correct nav link for stats', () => {
        window.location.hash = '#/stats';
        updateActiveNav();
        const feedLink = document.querySelector('[data-route="feed"]');
        const statsLink = document.querySelector('[data-route="stats"]');
        expect(feedLink.classList.contains('active')).toBe(false);
        expect(statsLink.classList.contains('active')).toBe(true);
    });
});

describe('filter persistence', () => {
    let mockStorage;

    beforeEach(() => {
        mockStorage = {};
        vi.stubGlobal('localStorage', {
            getItem: (key) => mockStorage[key] ?? null,
            setItem: (key, val) => { mockStorage[key] = String(val); },
            removeItem: (key) => { delete mockStorage[key]; },
        });
    });

    it('saves and loads filter state', () => {
        // Create filter elements
        document.body.innerHTML += `
            <input id="filter-search" value="python">
            <select id="filter-score"><option value="60" selected>60+</option></select>
        `;

        saveFilterState();
        const loaded = loadSavedFilterState();
        expect(loaded['filter-search']).toBe('python');
        expect(loaded['filter-score']).toBe('60');

        // Cleanup
        document.getElementById('filter-search')?.remove();
        document.getElementById('filter-score')?.remove();
    });

    it('returns null when no saved state', () => {
        expect(loadSavedFilterState()).toBeNull();
    });

    it('applyFilterState sets element values', () => {
        document.body.innerHTML += `
            <input id="filter-search" value="">
            <select id="filter-score">
                <option value="">All</option>
                <option value="60">60+</option>
            </select>
        `;

        applyFilterState({ 'filter-search': 'react', 'filter-score': '60' });
        expect(document.getElementById('filter-search').value).toBe('react');
        expect(document.getElementById('filter-score').value).toBe('60');

        // Cleanup
        document.getElementById('filter-search')?.remove();
        document.getElementById('filter-score')?.remove();
    });
});

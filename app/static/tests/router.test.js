import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScripts } from './setup.js';

beforeAll(() => {
    document.body.innerHTML = `
        <div id="toast-container"></div>
        <div class="nav-links">
            <a class="nav-link" data-route="settings">Settings</a>
            <a class="nav-link" data-route="facts">Fact Bank</a>
            <a class="nav-link" data-route="resume-studio">Resume Studio</a>
        </div>
        <div id="app"></div>
    `;
    loadScripts('utils.js', 'api.js');

    globalThis.renderSettings = async () => {};
    globalThis.renderFacts = async () => {};
    globalThis.renderResumeStudio = async () => {};

    globalThis.enterTriageMode = () => {};
    globalThis.exitTriageMode = () => {};
    globalThis.triageActive = false;
    globalThis.triageJobs = [];
    globalThis.triageIndex = 0;
    globalThis.triageUndoStack = [];

    loadScripts('app.js');
});

beforeEach(() => {
    window.location.hash = '#/settings';
});

describe('getRoute', () => {
    it('returns settings for default hash', () => {
        window.location.hash = '#/';
        expect(getRoute()).toEqual({ view: 'settings' });
    });

    it('returns settings for empty hash', () => {
        window.location.hash = '';
        expect(getRoute()).toEqual({ view: 'settings' });
    });

    it('returns settings for legacy #/stats', () => {
        window.location.hash = '#/stats';
        expect(getRoute()).toEqual({ view: 'settings' });
    });

    it('returns settings for legacy #/pipeline', () => {
        window.location.hash = '#/pipeline';
        expect(getRoute()).toEqual({ view: 'settings' });
    });

    it('returns settings for legacy #/queue', () => {
        window.location.hash = '#/queue';
        expect(getRoute()).toEqual({ view: 'settings' });
    });

    it('returns settings for legacy #/network', () => {
        window.location.hash = '#/network';
        expect(getRoute()).toEqual({ view: 'settings' });
    });

    it('returns settings for #/settings', () => {
        window.location.hash = '#/settings';
        expect(getRoute()).toEqual({ view: 'settings' });
    });

    it('returns facts for #/facts', () => {
        window.location.hash = '#/facts';
        expect(getRoute()).toEqual({ view: 'facts' });
    });

    it('returns resume-studio for #/resume-studio', () => {
        window.location.hash = '#/resume-studio';
        expect(getRoute()).toEqual({ view: 'resume-studio' });
    });
});

describe('navigate', () => {
    it('sets window.location.hash', () => {
        navigate('#/settings');
        expect(window.location.hash).toBe('#/settings');
    });
});

describe('updateActiveNav', () => {
    it('highlights settings for default route', () => {
        window.location.hash = '#/';
        updateActiveNav();
        const settingsLink = document.querySelector('[data-route="settings"]');
        const factsLink = document.querySelector('[data-route="facts"]');
        expect(settingsLink.classList.contains('active')).toBe(true);
        expect(factsLink.classList.contains('active')).toBe(false);
    });

    it('highlights facts for #/facts', () => {
        window.location.hash = '#/facts';
        updateActiveNav();
        const settingsLink = document.querySelector('[data-route="settings"]');
        const factsLink = document.querySelector('[data-route="facts"]');
        expect(settingsLink.classList.contains('active')).toBe(false);
        expect(factsLink.classList.contains('active')).toBe(true);
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
        document.body.innerHTML += `
            <input id="filter-search" value="python">
            <select id="filter-score"><option value="60" selected>60+</option></select>
        `;

        saveFilterState();
        const loaded = loadSavedFilterState();
        expect(loaded['filter-search']).toBe('python');
        expect(loaded['filter-score']).toBe('60');

        document.getElementById('filter-search')?.remove();
        document.getElementById('filter-score')?.remove();
    });

    it('returns null when no saved state', () => {
        expect(loadSavedFilterState()).toBeNull();
    });

    it('applyFilterState sets element values', () => {
        document.body.innerHTML += `<input id="filter-search" value="">`;
        applyFilterState({ 'filter-search': 'rust' });
        expect(document.getElementById('filter-search').value).toBe('rust');
        document.getElementById('filter-search')?.remove();
    });
});

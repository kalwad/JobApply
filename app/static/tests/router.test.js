import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScripts } from './setup.js';

beforeAll(() => {
    document.body.innerHTML = `
        <div id="toast-container"></div>
        <div class="nav-links">
            <a class="nav-link" data-route="settings">Settings</a>
        </div>
        <div id="app"></div>
    `;
    loadScripts('utils.js', 'api.js');
    globalThis.renderSettings = async () => {};
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

    it('returns settings for #/settings', () => {
        window.location.hash = '#/settings';
        expect(getRoute()).toEqual({ view: 'settings' });
    });
});

describe('navigate', () => {
    it('sets window.location.hash', () => {
        navigate('#/settings');
        expect(window.location.hash).toBe('#/settings');
    });
});

describe('updateActiveNav', () => {
    it('highlights settings', () => {
        window.location.hash = '#/settings';
        updateActiveNav();
        const settingsLink = document.querySelector('[data-route="settings"]');
        expect(settingsLink.classList.contains('active')).toBe(true);
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
});

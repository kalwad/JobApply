// JobApply Stage 1 — Settings-first slim shell

const _viewCleanups = [];

function registerViewCleanup(fn) {
    _viewCleanups.push(fn);
}

function cleanupCurrentView() {
    while (_viewCleanups.length) _viewCleanups.pop()();
}

function getRoute() {
    const hash = window.location.hash || '#/settings';
    if (hash === '#/' || hash === '' || hash === '#') {
        return { view: 'settings' };
    }
    if (hash === '#/settings') return { view: 'settings' };
    // Legacy CareerPulse routes redirect into Settings in slim mode.
    return { view: 'settings' };
}

function navigate(hash) {
    window.location.hash = hash;
}

function updateActiveNav() {
    const route = getRoute();
    document.querySelectorAll('.nav-link').forEach(link => {
        const r = link.dataset.route;
        link.classList.toggle('active', r === 'settings' && route.view === 'settings');
    });
}

async function handleRoute() {
    cleanupCurrentView();
    const route = getRoute();
    updateActiveNav();
    const app = document.getElementById('app');
    if (typeof renderSettings === 'function') {
        await renderSettings(app);
    } else {
        app.innerHTML = '<p>Settings unavailable.</p>';
    }
    app.setAttribute('tabindex', '-1');
    app.focus({ preventScroll: true });
}

// Filter helpers retained for settings tests / inherited utils
const FILTER_IDS = ['filter-search', 'filter-exclude', 'filter-score', 'filter-sort', 'filter-work-type', 'filter-employment', 'filter-location', 'filter-region', 'filter-posted-within', 'filter-clearance'];
const FILTER_STORAGE_KEY = 'jobapply_filters';

function getFilterState() {
    const state = {};
    FILTER_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) state[id] = el.value;
    });
    return state;
}

function applyFilterState(state) {
    FILTER_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el && state[id] !== undefined) el.value = state[id];
    });
}

function saveFilterState() {
    try { localStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify(getFilterState())); } catch {}
}

function loadSavedFilterState() {
    try {
        const raw = localStorage.getItem(FILTER_STORAGE_KEY);
        if (!raw) return null;
        const state = JSON.parse(raw);
        applyFilterState(state);
        return state;
    } catch {
        return null;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const themeBtn = document.getElementById('theme-toggle');
    if (themeBtn) {
        themeBtn.addEventListener('click', () => {
            const html = document.documentElement;
            const next = html.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            html.setAttribute('data-theme', next);
        });
    }
    window.addEventListener('hashchange', handleRoute);
    if (!window.location.hash || window.location.hash === '#/') {
        window.location.hash = '#/settings';
    }
    handleRoute();
    if (typeof maybeStartOnboarding === 'function') {
        maybeStartOnboarding();
    }
});

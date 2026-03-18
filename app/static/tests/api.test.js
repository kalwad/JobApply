import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { loadScript } from './setup.js';

beforeAll(() => {
    loadScript('api.js');
});

beforeEach(() => {
    vi.restoreAllMocks();
});

describe('api.request', () => {
    it('makes GET requests', async () => {
        const mockResponse = { jobs: [] };
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve(mockResponse),
        });

        const result = await api.request('GET', '/api/jobs');
        expect(fetch).toHaveBeenCalledWith('/api/jobs', {
            method: 'GET',
            headers: {},
        });
        expect(result).toEqual(mockResponse);
    });

    it('makes POST requests with JSON body', async () => {
        const body = { status: 'applied' };
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ success: true }),
        });

        await api.request('POST', '/api/jobs/1/application', body);
        expect(fetch).toHaveBeenCalledWith('/api/jobs/1/application', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    });

    it('throws on non-ok responses', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 404,
            json: () => Promise.resolve({ detail: 'Not found' }),
        });

        await expect(api.request('GET', '/api/jobs/999'))
            .rejects.toThrow('Not found');
    });

    it('handles non-JSON error responses', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: false,
            status: 500,
            statusText: 'Internal Server Error',
            json: () => Promise.reject(new Error('not json')),
        });

        await expect(api.request('GET', '/api/fail'))
            .rejects.toThrow('Internal Server Error');
    });
});

describe('api.getJobs', () => {
    it('builds query string from params', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ jobs: [] }),
        });

        await api.getJobs({ limit: 50, offset: 0, search: 'python' });
        const url = fetch.mock.calls[0][0];
        expect(url).toContain('limit=50');
        expect(url).toContain('offset=0');
        expect(url).toContain('search=python');
    });

    it('omits null/undefined/empty params', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ jobs: [] }),
        });

        await api.getJobs({ limit: 50, search: '', min_score: null });
        const url = fetch.mock.calls[0][0];
        expect(url).toContain('limit=50');
        expect(url).not.toContain('search=');
        expect(url).not.toContain('min_score');
    });
});

describe('api.getJob', () => {
    it('calls the correct endpoint', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ id: 42, title: 'Engineer' }),
        });

        await api.getJob(42);
        expect(fetch.mock.calls[0][0]).toBe('/api/jobs/42');
    });
});

describe('api.dismissJob', () => {
    it('POSTs to dismiss endpoint', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ success: true }),
        });

        await api.dismissJob(5);
        expect(fetch.mock.calls[0][0]).toBe('/api/jobs/5/dismiss');
        expect(fetch.mock.calls[0][1].method).toBe('POST');
    });
});

describe('api.prepareApplication', () => {
    it('sends resume_id when provided', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
        });

        await api.prepareApplication(10, 3);
        const call = fetch.mock.calls[0];
        expect(call[0]).toBe('/api/jobs/10/prepare');
        expect(JSON.parse(call[1].body)).toEqual({ resume_id: 3 });
    });

    it('sends null body when no resume_id', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
        });

        await api.prepareApplication(10);
        const call = fetch.mock.calls[0];
        expect(call[1].body).toBeUndefined();
    });
});

describe('api.uploadResume', () => {
    it('uses FormData and does not set Content-Type', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ id: 1 }),
        });

        const file = new File(['test'], 'resume.pdf', { type: 'application/pdf' });
        await api.uploadResume(file);

        const call = fetch.mock.calls[0];
        expect(call[0]).toBe('/api/resume/upload');
        expect(call[1].method).toBe('POST');
        expect(call[1].body).toBeInstanceOf(FormData);
    });
});

describe('api.triggerScrape', () => {
    it('POSTs to scrape endpoint', async () => {
        globalThis.fetch = vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({}),
        });

        await api.triggerScrape();
        expect(fetch.mock.calls[0][0]).toBe('/api/scrape');
        expect(fetch.mock.calls[0][1].method).toBe('POST');
    });
});

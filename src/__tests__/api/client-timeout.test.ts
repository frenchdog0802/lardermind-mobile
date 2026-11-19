import { api, TIMEOUT_MESSAGE, REQUEST_TIMEOUT_MS } from '../../api/client';

jest.mock('../../api/auth-helper', () => ({
    authHelper: {
        getJWT: jest.fn(async () => 'tok'),
        authenticate: jest.fn(),
        clearJWT: jest.fn(),
        isAuthenticated: jest.fn(),
    },
}));

describe('api client timeout', () => {
    const originalFetch = global.fetch;

    afterEach(() => {
        global.fetch = originalFetch;
        jest.useRealTimers();
    });

    it('aborts a hanging request after the timeout and returns a clear error', async () => {
        jest.useFakeTimers();
        global.fetch = jest.fn(
            (_url: unknown, init?: RequestInit) =>
                new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                }),
        ) as unknown as typeof fetch;

        const pending = api.get('recipes');
        // Let request() get past the token read and register the timer.
        await jest.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS + 10);
        const res = await pending;
        expect(res.success).toBe(false);
        expect(res.message).toBe(TIMEOUT_MESSAGE);
        // Offline sync classifies this as a retryable network failure.
        expect(res.message?.toLowerCase()).toContain('network');
    });
});

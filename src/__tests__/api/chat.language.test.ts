import { fetch as expoFetch } from 'expo/fetch';
import i18n from '../../i18n';
import { chatApi } from '../../api/chat';
import { normalizeChatLanguage } from '../../utils/chatLanguage';

jest.mock('expo/fetch', () => ({
    fetch: jest.fn(),
}));

jest.mock('../../api/auth-helper', () => ({
    authHelper: {
        getJWT: jest.fn(async () => 'test-jwt'),
        authenticate: jest.fn(),
        clearJWT: jest.fn(),
        isAuthenticated: jest.fn(),
    },
}));

function okJson(): Response {
    return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ success: true, data: { type: 'text', message: 'hi' } }),
    } as unknown as Response;
}

function lastJsonBody(mock: jest.Mock): Record<string, unknown> {
    const init = mock.mock.calls[mock.mock.calls.length - 1][1] as RequestInit;
    return JSON.parse(String(init.body));
}

describe('normalizeChatLanguage', () => {
    it.each([
        ['zh', 'zh-TW'],
        ['zh-TW', 'zh-TW'],
        ['zh-Hant-HK', 'zh-TW'],
        ['en', 'en'],
        ['en-US', 'en'],
    ])('%s -> %s', (input, expected) => {
        expect(normalizeChatLanguage(input)).toBe(expected);
    });

    it.each([[undefined], [null], [''], ['cimode'], ['fr-FR'], ['ja']])(
        'unknown %p -> undefined',
        (input) => {
            expect(normalizeChatLanguage(input as string | undefined)).toBeUndefined();
        },
    );
});

describe('chat requests send the app language', () => {
    const originalFetch = global.fetch;
    let fetchMock: jest.Mock;

    beforeEach(async () => {
        jest.clearAllMocks();
        fetchMock = jest.fn(async () => okJson());
        global.fetch = fetchMock as unknown as typeof fetch;
        (expoFetch as jest.Mock).mockResolvedValue({
            ok: false,
            status: 500,
            text: async () => 'boom',
        });
    });

    afterEach(async () => {
        global.fetch = originalFetch;
        await i18n.changeLanguage('en');
    });

    it('sends language=zh-TW on send, stream and resume when the app is in Chinese', async () => {
        await i18n.changeLanguage('zh');

        await chatApi.send('hello', { sessionId: 's1' });
        expect(lastJsonBody(fetchMock)).toEqual(
            expect.objectContaining({ message: 'hello', sessionId: 's1', language: 'zh-TW' }),
        );

        await chatApi.resume({ sessionId: 's1', decision: 'approve', interruptId: 'int-1' });
        expect(String(fetchMock.mock.calls[1][0])).toContain('chat/resume');
        expect(lastJsonBody(fetchMock)).toEqual({
            sessionId: 's1',
            decision: 'approve',
            interruptId: 'int-1',
            language: 'zh-TW',
        });

        await chatApi.streamSend({ message: 'yo' }, { onToken: jest.fn(), onDone: jest.fn(), onError: jest.fn() } as never);
        expect(lastJsonBody(expoFetch as jest.Mock)).toEqual(
            expect.objectContaining({ message: 'yo', language: 'zh-TW' }),
        );
    });

    it('sends language=en when the app is in English', async () => {
        await i18n.changeLanguage('en');
        await chatApi.send('hello');
        expect(lastJsonBody(fetchMock).language).toBe('en');
    });

    it('omits the key entirely when the app language is unknown', async () => {
        await i18n.changeLanguage('fr');

        await chatApi.send('hello');
        expect(lastJsonBody(fetchMock)).not.toHaveProperty('language');

        await chatApi.resume({ sessionId: 's1', decision: 'reject' });
        expect(lastJsonBody(fetchMock)).toEqual({ sessionId: 's1', decision: 'reject' });

        await chatApi.streamSend({ message: 'yo' }, { onToken: jest.fn(), onDone: jest.fn(), onError: jest.fn() } as never);
        expect(lastJsonBody(expoFetch as jest.Mock)).not.toHaveProperty('language');
    });

    it('keeps an explicit language from the caller', async () => {
        await i18n.changeLanguage('zh');
        await chatApi.resume({ sessionId: 's1', decision: 'approve', language: 'en' });
        expect(lastJsonBody(fetchMock).language).toBe('en');
    });
});

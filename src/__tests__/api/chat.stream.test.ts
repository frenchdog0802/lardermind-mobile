import { fetch as expoFetch } from 'expo/fetch';
import { chatApi } from '../../api/chat';

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

function sseStream(payload: string): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(payload));
            controller.close();
        },
    });
}

describe('chatApi.streamSend', () => {
    const originalFetch = global.fetch;

    beforeEach(() => {
        jest.clearAllMocks();
        // Simulate React Native global fetch: HTTP OK but no ReadableStream body.
        global.fetch = jest.fn(async () =>
            ({
                ok: true,
                body: null,
                text: async () => '',
            }) as unknown as Response,
        );
    });

    afterEach(() => {
        global.fetch = originalFetch;
    });

    it('uses expo/fetch so a null global response.body does not surface Stream response had no body', async () => {
        const donePayload = {
            type: 'text',
            message: 'Try a simple omelette.',
            data: {},
        };
        (expoFetch as jest.Mock).mockResolvedValue({
            ok: true,
            body: sseStream(
                `event: done\ndata: ${JSON.stringify(donePayload)}\n\n`,
            ),
        });

        const onToken = jest.fn();
        const onDone = jest.fn();
        const onError = jest.fn();

        await chatApi.streamSend(
            { message: 'What can I cook with what I have?' },
            { onToken, onDone, onError },
        );

        expect(expoFetch).toHaveBeenCalled();
        expect(global.fetch).not.toHaveBeenCalled();
        expect(onError).not.toHaveBeenCalled();
        expect(onDone).toHaveBeenCalledWith(donePayload);
    });
});

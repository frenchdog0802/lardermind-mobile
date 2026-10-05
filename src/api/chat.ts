import { fetch as expoFetch } from 'expo/fetch';
import { api } from './client';
import { authHelper } from './auth-helper';
import { ApiResponse } from '../types';

export type ChatResponseType =
    | 'text'
    | 'recipe_created'
    | 'recipe_imported'
    | 'recipe_updated'
    | 'shopping_list_updated'
    | 'meal_plan_updated'
    | 'pantry_updated'
    | 'meal_suggestions'
    | 'multi_action'
    | 'action_result'
    | 'interrupt'
    | 'error';

export interface ChatRequest {
    message: string;
    sessionId?: string;
    recipeContext?: {
        recipeId: string;
        recipeName: string;
    };
}

export interface ChatResumeRequest {
    sessionId: string;
    decision: 'approve' | 'reject';
    note?: string;
}

export interface ChatResponseData {
    type: ChatResponseType;
    message: string;
    data?: Record<string, unknown>;
}

export interface ChatSession {
    id: string;
    title: string;
    isDefault: boolean;
    updatedAt: number | null;
    createdAt: number | null;
}

export interface HistoryMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    createdAt: number;
    responseType?: string;
    cardData?: Record<string, unknown>;
}

export interface PendingToolSummary {
    name: string;
    argsSummary: string;
    id?: string;
}

export interface StreamSendHandlers {
    onToken: (token: string) => void;
    onDone: (response: ChatResponseData) => void;
    onError: (message: string) => void;
    onStatus?: (status: { tool?: string; message: string }) => void;
    onInterrupt?: (response: ChatResponseData) => void;
    onSessionTitle?: (payload: { sessionId: string; title: string }) => void;
}

export const CARD_RESPONSE_TYPES: ChatResponseType[] = [
    'recipe_created',
    'recipe_imported',
    'recipe_updated',
    'shopping_list_updated',
    'meal_plan_updated',
    'pantry_updated',
    'meal_suggestions',
    'multi_action',
    'action_result',
];

const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8080/api/';

function decodeSseData(data: string): string {
    if (!data) return '';
    try {
        const parsed: unknown = JSON.parse(data);
        if (typeof parsed === 'string') {
            return parsed;
        }
    } catch {
        // Fall through to raw data when not JSON.
    }
    return data;
}

function parseSseEvent(block: string, handlers: StreamSendHandlers) {
    const lines = block.split('\n');
    let eventName = 'message';
    const dataLines: string[] = [];

    for (const line of lines) {
        if (line.startsWith('event:')) {
            eventName = line.slice(6).trim();
        } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trimStart());
        }
    }

    const data = dataLines.join('\n');
    if (!data) return;

    if (eventName === 'token') {
        handlers.onToken(decodeSseData(data));
        return;
    }

    if (eventName === 'status') {
        try {
            const parsed = JSON.parse(data) as { tool?: string; message?: string };
            handlers.onStatus?.({
                tool: parsed.tool,
                message: parsed.message ?? 'Working on it…',
            });
        } catch {
            handlers.onStatus?.({ message: data || 'Working on it…' });
        }
        return;
    }

    if (eventName === 'interrupt') {
        try {
            const parsed = JSON.parse(data) as ChatResponseData;
            handlers.onInterrupt?.(parsed);
        } catch {
            handlers.onInterrupt?.({
                type: 'interrupt',
                message: data,
                data: {},
            });
        }
        return;
    }

    if (eventName === 'done') {
        handlers.onDone(JSON.parse(data) as ChatResponseData);
        return;
    }

    if (eventName === 'session_title') {
        try {
            const parsed = JSON.parse(data) as { sessionId?: string; title?: string };
            if (parsed.sessionId?.trim() && parsed.title?.trim()) {
                handlers.onSessionTitle?.({
                    sessionId: parsed.sessionId.trim(),
                    title: parsed.title.trim(),
                });
            }
        } catch {
            // ignore malformed title events
        }
        return;
    }

    if (eventName === 'error') {
        try {
            const parsed = JSON.parse(data) as { message?: string };
            handlers.onError(parsed.message ?? 'Something went wrong. Please try again.');
        } catch {
            handlers.onError(data);
        }
    }
}

async function consumeSseStream(
    body: ReadableStream<Uint8Array>,
    handlers: StreamSendHandlers,
    signal?: AbortSignal,
) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let receivedTerminalEvent = false;

    const wrappedHandlers: StreamSendHandlers = {
        onToken: handlers.onToken,
        onStatus: handlers.onStatus,
        onInterrupt: handlers.onInterrupt,
        onSessionTitle: handlers.onSessionTitle,
        onDone: (response) => {
            receivedTerminalEvent = true;
            handlers.onDone(response);
        },
        onError: (message) => {
            receivedTerminalEvent = true;
            handlers.onError(message);
        },
    };

    try {
        while (true) {
            if (signal?.aborted) {
                await reader.cancel();
                throw new DOMException('Stream aborted', 'AbortError');
            }

            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const events = buffer.split('\n\n');
            buffer = events.pop() ?? '';

            for (const eventBlock of events) {
                if (eventBlock.trim()) {
                    parseSseEvent(eventBlock, wrappedHandlers);
                }
            }
        }

        if (buffer.trim()) {
            parseSseEvent(buffer, wrappedHandlers);
        }
    } finally {
        if (!receivedTerminalEvent && !signal?.aborted) {
            handlers.onError('The reply was interrupted. Please try again.');
        }
    }
}

export const chatApi = {
    send: (message: string, options?: { sessionId?: string; recipeContext?: ChatRequest['recipeContext'] }) =>
        api.post<ChatResponseData>('chat/send', {
            message,
            sessionId: options?.sessionId,
            recipeContext: options?.recipeContext,
        }),

    resume: (body: ChatResumeRequest) =>
        api.post<ChatResponseData>('chat/resume', body),

    streamSend: async (
        data: ChatRequest,
        handlers: StreamSendHandlers,
        signal?: AbortSignal,
    ) => {
        let token = '';
        try {
            token = (await authHelper.getJWT()) || '';
        } catch {
            // continue without token
        }

        const url = `${BASE_URL}chat/stream`.replace(/([^:]\/)\/+/g, '$1');
        if (__DEV__) {
            console.log(`[api] POST ${url} (sse)`);
        }

        // Expo SDK 54: global fetch is RN's (response.body is often null).
        // expo/fetch exposes a ReadableStream body required for SSE.
        const response = await expoFetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Accept: 'text/event-stream',
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify(data),
            signal,
        });

        if (!response.ok) {
            const text = await response.text().catch(() => '');
            handlers.onError(text || `Stream request failed (${response.status})`);
            return;
        }

        if (!response.body) {
            handlers.onError('Stream response had no body');
            return;
        }

        await consumeSseStream(response.body, handlers, signal);
    },

    listSessions: () => api.get<{ sessions: ChatSession[] }>('chat/sessions'),

    createSession: (title?: string) =>
        api.post<ChatSession>('chat/sessions', title ? { title } : {}),

    deleteSession: (id: string) =>
        api.delete<{ deleted: boolean }>(`chat/sessions/${id}`),

    getHistory: (sessionId?: string) =>
        api.get<{ sessionId: string; messages: HistoryMessage[] }>(
            sessionId ? `chat/history?sessionId=${encodeURIComponent(sessionId)}` : 'chat/history',
        ),

    clearHistory: (sessionId?: string) =>
        api.delete<{ cleared: boolean }>(
            sessionId ? `chat/history?sessionId=${encodeURIComponent(sessionId)}` : 'chat/history',
        ),

    getActions: () => api.get<{ actions: string[]; description: string }>('chat/actions'),
};

export type { ApiResponse };

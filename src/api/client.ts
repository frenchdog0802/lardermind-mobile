/**
 * API Client for React Native
 * Uses fetch with SecureStore JWT via authHelper
 */
import { ApiResponse } from '../types';
import { authHelper } from './auth-helper';

/**
 * Configure your API base URL.
 * For Android APK testing, set EXPO_PUBLIC_API_BASE_URL to a public HTTPS backend.
 * See .env.example — do not leave localhost for real devices.
 */
const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:8080/api/';
if (__DEV__) {
    console.log('[api] BASE_URL =', BASE_URL);
}

type UnauthorizedHandler = () => void | Promise<void>;
let unauthorizedHandler: UnauthorizedHandler | null = null;
let unauthorizedInFlight = false;

export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
    unauthorizedHandler = handler;
}

async function notifyUnauthorized(): Promise<void> {
    if (!unauthorizedHandler || unauthorizedInFlight) return;
    unauthorizedInFlight = true;
    try {
        await unauthorizedHandler();
    } finally {
        unauthorizedInFlight = false;
    }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<ApiResponse<T>> {
    let token = '';
    try {
        token = (await authHelper.getJWT()) || '';
    } catch {
        // Token read failed, continue without token
    }

    const headers = new Headers(options.headers);
    const isFormData =
        typeof FormData !== 'undefined' && options.body instanceof FormData;
    if (
        options.body !== undefined &&
        !headers.has('Content-Type') &&
        !isFormData
    ) {
        headers.set('Content-Type', 'application/json');
    }
    if (!headers.has('Accept')) {
        // Without this, RN/Android may send Accept: text/html and Spring returns
        // Whitelabel HTML error pages that break res.json().
        headers.set('Accept', 'application/json');
    }
    if (token) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    const url = `${BASE_URL}${path.replace(/^\//, '')}`;
    if (__DEV__) {
        console.log(`[api] ${options.method ?? 'GET'} ${url}`);
    }

    try {
        const res = await fetch(url, {
            ...options,
            headers,
        });

        if (res.status === 401) {
            await notifyUnauthorized();
        }

        const raw = await res.text();
        let responseBody: ApiResponse<T>;
        try {
            responseBody = raw ? (JSON.parse(raw) as ApiResponse<T>) : { success: false, message: `Empty response (${res.status})` };
        } catch {
            if (__DEV__) {
                console.error(`API ${options.method ?? 'GET'} ${path} non-JSON (${res.status}):`, raw.slice(0, 200));
            }
            return {
                success: false,
                message: `Unexpected response (${res.status})`,
                statusCode: res.status,
            };
        }
        if (responseBody.statusCode == null) {
            responseBody.statusCode = res.status;
        }
        if (res.status === 401 || responseBody.statusCode === 401) {
            await notifyUnauthorized();
        }
        if (__DEV__) {
            console.log(`[api] ${options.method ?? 'GET'} ${path} ->`, responseBody?.success, responseBody?.message);
        }
        return responseBody;
    } catch (error) {
        if (__DEV__) {
            console.error(`API ${options.method ?? 'GET'} ${path} failed:`, error);
        }
        return {
            success: false,
            message: 'Network error occurred',
        };
    }
}

export default request;

export const api = {
    get: <T>(path: string) => request<T>(path),
    post: <T>(path: string, body?: unknown) =>
        request<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) }),
    postForm: <T>(path: string, formData: FormData) =>
        request<T>(path, {
            method: 'POST',
            body: formData,
            headers: {
                // Let fetch set multipart boundary; do not force JSON.
                Accept: 'application/json',
            },
        }),
    put: <T>(path: string, body?: unknown) =>
        request<T>(path, { method: 'PUT', body: JSON.stringify(body ?? {}) }),
    patch: <T>(path: string, body?: unknown) =>
        request<T>(path, { method: 'PATCH', body: JSON.stringify(body ?? {}) }),
    delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

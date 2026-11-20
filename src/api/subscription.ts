/**
 * Subscription API
 */

import request from './client';
import type { ApiResponse } from '../types';

export interface UsageSummary {
    aiMessagesUsed: number;
    aiMessagesLimit: number;
    recipeImportsUsed: number;
    recipeImportsLimit: number;
    recipeCount: number;
    recipeLimit: number;
    imageUploadsUsed: number;
    imageUploadsLimit: number;
}

export interface SubscriptionStatus {
    isPro: boolean;
    isTrial: boolean;
    trialEndsAt?: number;
    expiresAt?: number;
    productId?: string;
    planName?: string;
    /** Which billing source currently grants Pro. Informational only; never shown to users. */
    source?: 'apple' | 'stripe';
    usage: UsageSummary;
}

export interface IosPurchaseSyncRequest {
    /** StoreKit 2 signed transaction (JWS) — `purchaseToken` on iOS in react-native-iap. */
    receipt: string;
    productId: string;
}

export class SubscriptionApiError extends Error {
    statusCode?: number;
    constructor(message: string, statusCode?: number) {
        super(message);
        this.name = 'SubscriptionApiError';
        this.statusCode = statusCode;
    }
}

function unwrap<T>(response: ApiResponse<T>): T {
    if (!response.success || response.data === undefined) {
        throw new SubscriptionApiError(
            response.message ?? 'Subscription request failed',
            response.statusCode,
        );
    }
    return response.data;
}

export const subscriptionApi = {
    getStatus: async (): Promise<SubscriptionStatus> => {
        const response = await request<SubscriptionStatus>('subscription/status');
        return unwrap(response);
    },

    /**
     * Send a verified-by-Apple signed transaction to the backend, which validates the JWS
     * and grants Pro. Resolves with the fresh subscription status.
     */
    syncIosPurchase: async (data: IosPurchaseSyncRequest): Promise<SubscriptionStatus> => {
        const response = await request<{ success: boolean; status: SubscriptionStatus }>(
            'subscription/sync',
            {
                method: 'POST',
                body: JSON.stringify({ platform: 'ios', ...data }),
            },
        );
        return unwrap(response).status;
    },
};

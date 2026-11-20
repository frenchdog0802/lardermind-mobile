/* eslint-disable @typescript-eslint/no-explicit-any */
const mockListeners: { updated?: (p: any) => void; error?: (e: any) => void } = {};

jest.mock('react-native-iap', () => ({
    ErrorCode: { UserCancelled: 'user-cancelled' },
    initConnection: jest.fn(async () => true),
    endConnection: jest.fn(async () => true),
    fetchProducts: jest.fn(),
    isEligibleForIntroOfferIOS: jest.fn(),
    requestPurchase: jest.fn(),
    finishTransaction: jest.fn(async () => undefined),
    restorePurchases: jest.fn(async () => undefined),
    getAvailablePurchases: jest.fn(),
    showManageSubscriptionsIOS: jest.fn(async () => []),
    purchaseUpdatedListener: jest.fn((cb: any) => {
        mockListeners.updated = cb;
        return { remove: jest.fn() };
    }),
    purchaseErrorListener: jest.fn((cb: any) => {
        mockListeners.error = cb;
        return { remove: jest.fn() };
    }),
}));

jest.mock('../../api/subscription', () => {
    class SubscriptionApiError extends Error {
        statusCode?: number;
        constructor(message: string, statusCode?: number) {
            super(message);
            this.statusCode = statusCode;
        }
    }
    return {
        SubscriptionApiError,
        subscriptionApi: { syncIosPurchase: jest.fn(), getStatus: jest.fn() },
    };
});

import * as RNIap from 'react-native-iap';
import { subscriptionApi, SubscriptionApiError } from '../../api/subscription';
import {
    disconnectIAP,
    formatPeriod,
    formatTrialLength,
    initializeIAP,
    loadProducts,
    mapProduct,
    purchaseSubscription,
    restoreSubscription,
    subscribeToStatus,
} from '../../services/iapService';

const iap = RNIap as unknown as Record<string, jest.Mock>;
const api = subscriptionApi as unknown as { syncIosPurchase: jest.Mock };

const proStatus = { isPro: true, isTrial: true, source: 'apple', usage: {} } as any;

function sub(over: Record<string, any> = {}, id = 'com.lardermind.pro.monthly') {
    return {
        id,
        type: 'subs',
        platform: 'ios',
        title: 'LarderMind Pro Monthly',
        displayName: 'Pro Monthly',
        description: 'desc',
        displayPrice: 'CA$6.99',
        price: 6.99,
        currency: 'CAD',
        subscriptionInfoIOS: {
            subscriptionGroupId: 'grp',
            subscriptionPeriod: { unit: 'month', value: 1 },
            introductoryOffer: {
                paymentMode: 'free-trial',
                period: { unit: 'week', value: 1 },
                periodCount: 1,
            },
        },
        ...over,
    };
}

async function flush() {
    await new Promise((r) => setImmediate(r));
}

beforeEach(async () => {
    await disconnectIAP();
    jest.clearAllMocks();
    iap.finishTransaction.mockResolvedValue(undefined);
    iap.isEligibleForIntroOfferIOS.mockResolvedValue(true);
});

describe('product mapping (prices and trial come from StoreKit)', () => {
    it('uses the StoreKit localized price and normalises a 1-week trial to 7 days', () => {
        const p = mapProduct(sub() as any, true);
        expect(p.displayPrice).toBe('CA$6.99');
        expect(p.period).toEqual({ unit: 'month', value: 1 });
        expect(p.trial).toEqual({ unit: 'day', value: 7 });
        expect(formatTrialLength(p.trial!)).toBe('7-day');
        expect(formatPeriod(p.period)).toBe('month');
    });

    it('drops the trial when the Apple ID is not eligible for the intro offer', () => {
        expect(mapProduct(sub() as any, false).trial).toBeNull();
    });

    it('ignores non-free-trial intro offers', () => {
        const p = mapProduct(
            sub({
                subscriptionInfoIOS: {
                    subscriptionGroupId: 'grp',
                    subscriptionPeriod: { unit: 'year', value: 1 },
                    introductoryOffer: { paymentMode: 'pay-as-you-go', period: { unit: 'month', value: 1 }, periodCount: 3 },
                },
            }) as any,
            true,
        );
        expect(p.trial).toBeNull();
        expect(formatPeriod(p.period)).toBe('year');
    });

    it('loadProducts fetches both SKUs, checks eligibility per group and orders monthly first', async () => {
        iap.fetchProducts.mockResolvedValue([
            sub({ displayPrice: '$39.99' }, 'com.lardermind.pro.yearly'),
            sub({ displayPrice: '$4.99' }),
        ]);
        const products = await loadProducts();
        expect(iap.fetchProducts).toHaveBeenCalledWith({
            skus: ['com.lardermind.pro.monthly', 'com.lardermind.pro.yearly'],
            type: 'subs',
        });
        expect(iap.isEligibleForIntroOfferIOS).toHaveBeenCalledWith('grp');
        expect(products.map((p) => p.productId)).toEqual([
            'com.lardermind.pro.monthly',
            'com.lardermind.pro.yearly',
        ]);
        expect(products[0].displayPrice).toBe('$4.99');
    });
});

describe('purchase flow', () => {
    const purchase = {
        id: 't1',
        transactionId: 't1',
        productId: 'com.lardermind.pro.monthly',
        purchaseToken: 'aaa.bbb.ccc',
        purchaseState: 'purchased',
    };

    it('sends the signed transaction to the backend, finishes it and emits the new status', async () => {
        api.syncIosPurchase.mockResolvedValue(proStatus);
        iap.requestPurchase.mockImplementation(async () => {
            setImmediate(() => mockListeners.updated!(purchase));
        });
        const seen: any[] = [];
        const off = subscribeToStatus((s) => seen.push(s));

        const outcome = await purchaseSubscription('com.lardermind.pro.monthly');

        expect(outcome).toBe('success');
        expect(iap.requestPurchase).toHaveBeenCalledWith({
            type: 'subs',
            request: { apple: { sku: 'com.lardermind.pro.monthly' } },
        });
        expect(api.syncIosPurchase).toHaveBeenCalledWith({
            receipt: 'aaa.bbb.ccc',
            productId: 'com.lardermind.pro.monthly',
        });
        expect(iap.finishTransaction).toHaveBeenCalledWith({ purchase, isConsumable: false });
        expect(seen).toEqual([proStatus]);
        off();
    });

    it('does NOT finish the transaction when the backend is unreachable (StoreKit will redeliver)', async () => {
        api.syncIosPurchase.mockRejectedValue(new SubscriptionApiError('Network error occurred'));
        iap.requestPurchase.mockImplementation(async () => {
            setImmediate(() => mockListeners.updated!(purchase));
        });
        await expect(purchaseSubscription('com.lardermind.pro.monthly')).rejects.toThrow(/retried automatically/);
        expect(iap.finishTransaction).not.toHaveBeenCalled();
    });

    it('finishes but reports the error when the subscription belongs to another account (409)', async () => {
        api.syncIosPurchase.mockRejectedValue(
            new SubscriptionApiError('already linked to another LarderMind account', 409),
        );
        iap.requestPurchase.mockImplementation(async () => {
            setImmediate(() => mockListeners.updated!(purchase));
        });
        await expect(purchaseSubscription('com.lardermind.pro.monthly')).rejects.toThrow(/another LarderMind account/);
        expect(iap.finishTransaction).toHaveBeenCalledTimes(1);
    });

    it('treats a user cancel as a silent cancelled outcome', async () => {
        iap.requestPurchase.mockImplementation(async () => {
            setImmediate(() => mockListeners.error!({ code: 'user-cancelled', message: 'cancelled' }));
        });
        expect(await purchaseSubscription('com.lardermind.pro.monthly')).toBe('cancelled');
        expect(api.syncIosPurchase).not.toHaveBeenCalled();
    });

    it('reports pending (Ask to Buy) without calling the backend', async () => {
        iap.requestPurchase.mockImplementation(async () => {
            setImmediate(() => mockListeners.updated!({ ...purchase, purchaseState: 'pending' }));
        });
        expect(await purchaseSubscription('com.lardermind.pro.monthly')).toBe('pending');
        expect(api.syncIosPurchase).not.toHaveBeenCalled();
    });

    it('confirms a redelivered unfinished transaction at connect time and ignores foreign products', async () => {
        api.syncIosPurchase.mockResolvedValue(proStatus);
        await initializeIAP();
        mockListeners.updated!({ ...purchase, productId: 'com.other.sku' });
        mockListeners.updated!(purchase);
        await flush();
        expect(api.syncIosPurchase).toHaveBeenCalledTimes(1);
        expect(iap.finishTransaction).toHaveBeenCalledTimes(1);
    });
});

describe('restore purchases', () => {
    it('syncs the newest active subscription transaction to the backend', async () => {
        api.syncIosPurchase.mockResolvedValue({ ...proStatus, isTrial: false });
        iap.getAvailablePurchases.mockResolvedValue([
            { id: 'a', productId: 'com.lardermind.pro.monthly', purchaseToken: 'old.jws.x', expirationDateIOS: 100 },
            { id: 'b', productId: 'com.lardermind.pro.yearly', purchaseToken: 'new.jws.y', expirationDateIOS: 900 },
            { id: 'c', productId: 'com.other.sku', purchaseToken: 'zzz.zzz.zzz', expirationDateIOS: 9999 },
        ]);
        const result = await restoreSubscription();
        expect(iap.restorePurchases).toHaveBeenCalled();
        expect(iap.getAvailablePurchases).toHaveBeenCalledWith({ onlyIncludeActiveItemsIOS: true });
        expect(api.syncIosPurchase).toHaveBeenCalledWith({
            receipt: 'new.jws.y',
            productId: 'com.lardermind.pro.yearly',
        });
        expect(result.outcome).toBe('restored');
    });

    it('reports none when the Apple ID has no active LarderMind subscription', async () => {
        iap.getAvailablePurchases.mockResolvedValue([]);
        const result = await restoreSubscription();
        expect(result).toEqual({ outcome: 'none', status: null });
        expect(api.syncIosPurchase).not.toHaveBeenCalled();
    });
});

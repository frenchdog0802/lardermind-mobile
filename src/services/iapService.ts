/**
 * IAP service â€” real StoreKit (iOS) via react-native-iap.
 *
 * Flow: StoreKit purchase -> signed transaction (JWS, `purchaseToken`) -> backend `subscription/sync`
 * (verifies Apple's signature and grants Pro) -> `finishTransaction`. Transactions that could not be
 * confirmed with the backend are left unfinished so StoreKit re-delivers them on the next
 * `initConnection()` (the app calls it again whenever the user signs in).
 *
 * Prices and trial terms always come from StoreKit (localized); nothing is hard-coded.
 */

import { useCallback, useEffect, useState } from 'react';
import { Platform } from 'react-native';
import * as RNIap from 'react-native-iap';
import type { Purchase, ProductSubscriptionIOS } from 'react-native-iap';
import {
    subscriptionApi,
    SubscriptionApiError,
    type SubscriptionStatus,
} from '../api/subscription';

export const PRODUCT_ID_MONTHLY = 'com.lardermind.pro.monthly';
export const PRODUCT_ID_YEARLY = 'com.lardermind.pro.yearly';

export const PRODUCT_IDS = {
    ios: [PRODUCT_ID_MONTHLY, PRODUCT_ID_YEARLY],
    android: [] as string[],
};

export function isIapSupported(): boolean {
    return Platform.OS === 'ios';
}

export function getProductIds(): string[] {
    return isIapSupported() ? PRODUCT_IDS.ios : [];
}

export type PeriodUnit = 'day' | 'week' | 'month' | 'year';

export interface IAPPeriod {
    unit: PeriodUnit;
    value: number;
}

export interface IAPProduct {
    productId: string;
    title: string;
    description: string;
    /** StoreKit-localized price string, e.g. "$4.99". */
    displayPrice: string;
    price: number | null;
    currency: string;
    /** Billing period of the subscription. */
    period: IAPPeriod | null;
    /** Free-trial length if the product has one AND this Apple ID is still eligible. */
    trial: IAPPeriod | null;
}

export type PurchaseOutcome = 'success' | 'cancelled' | 'pending';
export type RestoreOutcome = 'restored' | 'none';

const PERIOD_UNITS: PeriodUnit[] = ['day', 'week', 'month', 'year'];

function asUnit(unit: string | null | undefined): PeriodUnit | null {
    return PERIOD_UNITS.includes(unit as PeriodUnit) ? (unit as PeriodUnit) : null;
}

/** Normalise "1 week" -> 7 days so trials read "7-day free trial". */
export function normalizePeriod(period: IAPPeriod): IAPPeriod {
    if (period.unit === 'week') return { unit: 'day', value: period.value * 7 };
    return period;
}

function billingPeriod(p: ProductSubscriptionIOS): IAPPeriod | null {
    const info = p.subscriptionInfoIOS?.subscriptionPeriod;
    const unit = asUnit(info?.unit ?? p.subscriptionPeriodUnitIOS);
    if (!unit) return null;
    const value = info?.value ?? (Number(p.subscriptionPeriodNumberIOS) || 1);
    return { unit, value };
}

/** Free-trial introductory offer, or null. */
function freeTrial(p: ProductSubscriptionIOS): IAPPeriod | null {
    const intro = p.subscriptionInfoIOS?.introductoryOffer;
    if (intro && intro.paymentMode === 'free-trial') {
        const unit = asUnit(intro.period?.unit);
        if (!unit) return null;
        return normalizePeriod({ unit, value: (intro.period.value || 1) * (intro.periodCount || 1) });
    }
    if (!intro && p.introductoryPricePaymentModeIOS === 'free-trial') {
        const unit = asUnit(p.introductoryPriceSubscriptionPeriodIOS);
        if (!unit) return null;
        return normalizePeriod({
            unit,
            value: Number(p.introductoryPriceNumberOfPeriodsIOS) || 1,
        });
    }
    return null;
}

export function mapProduct(p: ProductSubscriptionIOS, introEligible: boolean): IAPProduct {
    const trial = freeTrial(p);
    return {
        productId: p.id,
        title: p.displayName || p.title,
        description: p.description,
        displayPrice: p.displayPrice,
        price: p.price ?? null,
        currency: p.currency,
        period: billingPeriod(p),
        trial: introEligible ? trial : null,
    };
}

// ---------------------------------------------------------------------------- connection

type EventSub = { remove: () => void };

let connected = false;
let connecting: Promise<boolean> | null = null;
let eventSubs: EventSub[] = [];

type Pending = {
    resolve: (o: PurchaseOutcome) => void;
    reject: (e: Error) => void;
};
let pending: Pending | null = null;

const statusListeners = new Set<(s: SubscriptionStatus) => void>();
const inFlight = new Set<string>();

export function subscribeToStatus(listener: (s: SubscriptionStatus) => void): () => void {
    statusListeners.add(listener);
    return () => {
        statusListeners.delete(listener);
    };
}

function emitStatus(status: SubscriptionStatus) {
    statusListeners.forEach((l) => l(status));
}

function errorMessage(e: unknown, fallback: string): string {
    return e instanceof Error && e.message ? e.message : fallback;
}

function settle(fn: (p: Pending) => void) {
    const p = pending;
    pending = null;
    if (p) fn(p);
}

/**
 * Send a purchase's signed transaction to the backend and finish it.
 * Returns the new status. Throws if the backend could not confirm it.
 */
async function confirmWithBackend(purchase: Purchase): Promise<SubscriptionStatus> {
    const jws = purchase.purchaseToken;
    if (!jws) {
        throw new Error('Apple did not return a signed transaction. Please try Restore Purchases.');
    }
    let status: SubscriptionStatus;
    try {
        status = await subscriptionApi.syncIosPurchase({ receipt: jws, productId: purchase.productId });
    } catch (e) {
        // 409: this Apple subscription belongs to another LarderMind account. Finishing stops StoreKit
        // from re-delivering it forever; the user can still see it under Restore on the right account.
        if (e instanceof SubscriptionApiError && e.statusCode === 409) {
            await RNIap.finishTransaction({ purchase, isConsumable: false }).catch(() => undefined);
        }
        throw e;
    }
    await RNIap.finishTransaction({ purchase, isConsumable: false }).catch(() => undefined);
    return status;
}

async function handlePurchaseUpdate(purchase: Purchase) {
    if (!getProductIds().includes(purchase.productId)) return;

    if (purchase.purchaseState === 'pending') {
        // Ask to Buy / SCA: nothing to confirm yet; the final result arrives as another update.
        settle((p) => p.resolve('pending'));
        return;
    }

    const key = String(purchase.transactionId ?? purchase.id ?? purchase.productId);
    if (inFlight.has(key)) return;
    inFlight.add(key);
    try {
        const status = await confirmWithBackend(purchase);
        emitStatus(status);
        settle((p) => p.resolve('success'));
    } catch (e) {
        settle((p) =>
            p.reject(
                new Error(
                    e instanceof SubscriptionApiError && e.statusCode === 409
                        ? e.message
                        : "We couldn't confirm your purchase yet. You won't be charged twice â€” it will be retried automatically.",
                ),
            ),
        );
    } finally {
        inFlight.delete(key);
    }
}

function handlePurchaseError(error: { code?: string; message?: string }) {
    if (error.code === RNIap.ErrorCode.UserCancelled) {
        settle((p) => p.resolve('cancelled'));
        return;
    }
    settle((p) => p.reject(new Error(error.message || 'Purchase failed')));
}

export async function initializeIAP(): Promise<boolean> {
    if (!isIapSupported()) return false;
    if (connected) return true;
    if (connecting) return connecting;
    connecting = (async () => {
        try {
            await RNIap.initConnection();
            eventSubs = [
                RNIap.purchaseUpdatedListener((p) => void handlePurchaseUpdate(p)),
                RNIap.purchaseErrorListener((e) => handlePurchaseError(e)),
            ];
            connected = true;
            return true;
        } catch {
            connected = false;
            return false;
        } finally {
            connecting = null;
        }
    })();
    return connecting;
}

export async function disconnectIAP(): Promise<void> {
    eventSubs.forEach((s) => s.remove());
    eventSubs = [];
    pending = null;
    if (!connected) return;
    connected = false;
    await RNIap.endConnection().catch(() => undefined);
}

// ---------------------------------------------------------------------------- operations

export async function loadProducts(): Promise<IAPProduct[]> {
    if (!(await initializeIAP())) return [];
    const result = await RNIap.fetchProducts({ skus: getProductIds(), type: 'subs' });
    const subs = (result ?? []).filter(
        (p): p is ProductSubscriptionIOS => p.type === 'subs' && p.platform === 'ios',
    );
    const mapped = await Promise.all(
        subs.map(async (p) => {
            const groupId = p.subscriptionInfoIOS?.subscriptionGroupId;
            let eligible = false;
            if (groupId) {
                eligible = await RNIap.isEligibleForIntroOfferIOS(groupId).catch(() => false);
            }
            return mapProduct(p, eligible);
        }),
    );
    // Stable order: monthly first, then yearly.
    return mapped.sort(
        (a, b) => getProductIds().indexOf(a.productId) - getProductIds().indexOf(b.productId),
    );
}

export async function purchaseSubscription(productId: string): Promise<PurchaseOutcome> {
    if (!(await initializeIAP())) {
        throw new Error('In-app purchases are not available on this device.');
    }
    if (pending) throw new Error('A purchase is already in progress.');
    const outcome = new Promise<PurchaseOutcome>((resolve, reject) => {
        pending = { resolve, reject };
    });
    try {
        await RNIap.requestPurchase({
            type: 'subs',
            request: { apple: { sku: productId } },
        });
    } catch (e) {
        // Errors normally arrive via purchaseErrorListener; handle a rejected call defensively.
        const code = (e as { code?: string })?.code;
        if (code === RNIap.ErrorCode.UserCancelled) {
            settle((p) => p.resolve('cancelled'));
        } else {
            settle((p) => p.reject(new Error(errorMessage(e, 'Purchase failed'))));
        }
    }
    return outcome;
}

function expiryOf(p: Purchase): number {
    return (p as { expirationDateIOS?: number | null }).expirationDateIOS ?? 0;
}

/**
 * Restore Purchases: re-sync with the App Store, then hand the newest active subscription
 * transaction to the backend so the signed-in account gets Pro.
 */
export async function restoreSubscription(): Promise<{
    outcome: RestoreOutcome;
    status: SubscriptionStatus | null;
}> {
    if (!(await initializeIAP())) {
        throw new Error('In-app purchases are not available on this device.');
    }
    await RNIap.restorePurchases().catch(() => undefined);
    const purchases = await RNIap.getAvailablePurchases({ onlyIncludeActiveItemsIOS: true });
    const ours = (purchases ?? [])
        .filter((p) => getProductIds().includes(p.productId) && !!p.purchaseToken)
        .sort((a, b) => expiryOf(b) - expiryOf(a));
    const latest = ours[0];
    if (!latest) return { outcome: 'none', status: null };

    const status = await confirmWithBackend(latest);
    emitStatus(status);
    return { outcome: status.isPro ? 'restored' : 'none', status };
}

export async function openManageSubscriptions(): Promise<void> {
    if (!isIapSupported()) return;
    await RNIap.showManageSubscriptionsIOS().catch(() => undefined);
}

// ---------------------------------------------------------------------------- display helpers

const UNIT_LABEL: Record<PeriodUnit, [string, string]> = {
    day: ['day', 'days'],
    week: ['week', 'weeks'],
    month: ['month', 'months'],
    year: ['year', 'years'],
};

/** "month" / "year" / "3 months" */
export function formatPeriod(period: IAPPeriod | null): string {
    if (!period) return '';
    const [one, many] = UNIT_LABEL[period.unit];
    return period.value === 1 ? one : `${period.value} ${many}`;
}

/** "7-day", "1-month" â€” for "{n}-day free trial". */
export function formatTrialLength(trial: IAPPeriod): string {
    return `${trial.value}-${trial.unit}`;
}

export function getSubscriptionPeriodLabel(productId: string): string {
    if (productId.includes('monthly')) return 'month';
    if (productId.includes('yearly')) return 'year';
    return '';
}

// ---------------------------------------------------------------------------- hook

export interface UseSubscriptionResult {
    iapSupported: boolean;
    products: IAPProduct[];
    loading: boolean;
    purchasing: boolean;
    restoring: boolean;
    isPro: boolean;
    isTrial: boolean;
    expiresAt: number | null;
    /** True when Apple is the billing source (so "Manage subscription" applies). */
    managedByApple: boolean;
    error: string | null;
    fetchProducts: () => Promise<void>;
    purchase: (productId: string) => Promise<PurchaseOutcome | 'error'>;
    restore: () => Promise<RestoreOutcome | 'error'>;
    refreshStatus: () => Promise<void>;
    manage: () => Promise<void>;
}

export function useSubscription(): UseSubscriptionResult {
    const [products, setProducts] = useState<IAPProduct[]>([]);
    const [loading, setLoading] = useState(true);
    const [purchasing, setPurchasing] = useState(false);
    const [restoring, setRestoring] = useState(false);
    const [status, setStatus] = useState<SubscriptionStatus | null>(null);
    const [error, setError] = useState<string | null>(null);

    const refreshStatus = useCallback(async () => {
        try {
            setStatus(await subscriptionApi.getStatus());
        } catch {
            // Keep last known state when offline / unauthenticated.
        }
    }, []);

    const fetchProducts = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const [list] = await Promise.all([
                isIapSupported() ? loadProducts() : Promise.resolve([]),
                refreshStatus(),
            ]);
            setProducts(list);
        } catch (e) {
            setError(errorMessage(e, 'Failed to load subscription options'));
        } finally {
            setLoading(false);
        }
    }, [refreshStatus]);

    useEffect(() => {
        void fetchProducts();
    }, [fetchProducts]);

    useEffect(() => subscribeToStatus(setStatus), []);

    const purchase = useCallback(async (productId: string) => {
        setPurchasing(true);
        setError(null);
        try {
            const outcome = await purchaseSubscription(productId);
            if (outcome === 'success') await refreshStatus();
            return outcome;
        } catch (e) {
            setError(errorMessage(e, 'Purchase failed'));
            return 'error' as const;
        } finally {
            setPurchasing(false);
        }
    }, [refreshStatus]);

    const restore = useCallback(async () => {
        setRestoring(true);
        setError(null);
        try {
            const { outcome } = await restoreSubscription();
            return outcome;
        } catch (e) {
            setError(errorMessage(e, 'Restore failed'));
            return 'error' as const;
        } finally {
            setRestoring(false);
        }
    }, []);

    return {
        iapSupported: isIapSupported(),
        products,
        loading,
        purchasing,
        restoring,
        isPro: status?.isPro ?? false,
        isTrial: status?.isTrial ?? false,
        expiresAt: status?.expiresAt ?? null,
        managedByApple: status?.source === 'apple',
        error,
        fetchProducts,
        purchase,
        restore,
        refreshStatus,
        manage: openManageSubscriptions,
    };
}

export default {
    initializeIAP,
    disconnectIAP,
    getProductIds,
    getSubscriptionPeriodLabel,
    PRODUCT_IDS,
    useSubscription,
};

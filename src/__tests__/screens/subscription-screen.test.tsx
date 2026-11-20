/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { Linking } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import SubscriptionScreen from '../../screens/SubscriptionScreen';

// Translate with the real English strings (the global jest mock only maps a few auth keys).
jest.mock('react-i18next', () => {
    const en = require('../../i18n/locales/en.json');
    const t = (key: string, opts?: Record<string, string>) => {
        const raw = key.split('.').reduce((o: any, k: string) => (o ? o[k] : undefined), en);
        const str = typeof raw === 'string' ? raw : key;
        return str.replace(/\{\{(\w+)\}\}/g, (_m: string, k: string) => String(opts?.[k] ?? ''));
    };
    return { useTranslation: () => ({ t, i18n: { language: 'en' } }) };
});

let mockState: any;
const mockPurchase = jest.fn();
const mockRestore = jest.fn();

jest.mock('../../services/iapService', () => {
    const actual = jest.requireActual('../../services/iapService');
    return {
        ...actual,
        useSubscription: () => mockState,
    };
});
jest.mock('react-native-iap', () => ({ ErrorCode: {} }));
jest.mock('../../contexts/authContext', () => ({ useAuth: () => ({ isGuest: false }) }));
jest.mock('../../components/AppHeader', () => () => null);
jest.mock('@react-navigation/native', () => ({
    ...jest.requireActual('@react-navigation/native'),
    useNavigation: () => ({ navigate: jest.fn() }),
}));

const monthly = {
    productId: 'com.lardermind.pro.monthly',
    title: 'Pro Monthly',
    description: '',
    displayPrice: '€4,99',
    price: 4.99,
    currency: 'EUR',
    period: { unit: 'month', value: 1 },
    trial: { unit: 'day', value: 7 },
};
const yearly = {
    ...monthly,
    productId: 'com.lardermind.pro.yearly',
    title: 'Pro Yearly',
    displayPrice: '€39,99',
    period: { unit: 'year', value: 1 },
    trial: null,
};

function baseState(over: Record<string, any> = {}) {
    return {
        iapSupported: true,
        products: [monthly, yearly],
        loading: false,
        purchasing: false,
        restoring: false,
        isPro: false,
        isTrial: false,
        expiresAt: null,
        managedByApple: false,
        error: null,
        fetchProducts: jest.fn(),
        purchase: mockPurchase,
        restore: mockRestore,
        refreshStatus: jest.fn(),
        manage: jest.fn(),
        ...over,
    };
}

function allText(root: any): string {
    return JSON.stringify(root.toJSON());
}

describe('SubscriptionScreen (paywall)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockState = baseState();
    });

    it('shows StoreKit-localized prices and trial terms', () => {
        const r = render(<SubscriptionScreen />);
        expect(r.getByTestId('price-com.lardermind.pro.monthly').props.children).toContain('€4,99');
        expect(r.getByTestId('price-com.lardermind.pro.yearly').props.children).toContain('€39,99');
        expect(r.getByTestId('trial-com.lardermind.pro.monthly')).toBeTruthy();
        expect(allText(r)).toContain('7-day free trial, then');
        expect(r.queryByTestId('trial-com.lardermind.pro.yearly')).toBeNull();
    });

    it('has Restore Purchases, the auto-renew disclosure and Terms/Privacy links', async () => {
        const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined as never);
        const r = render(<SubscriptionScreen />);
        expect(r.getByTestId('restore-purchases')).toBeTruthy();
        const disclosure = JSON.stringify(r.getByTestId('auto-renew-disclosure').props.children);
        expect(disclosure).toMatch(/automatically renews unless it is canceled at least 24 hours/);
        expect(disclosure).toMatch(/Apple ID/);

        fireEvent.press(r.getByTestId('link-terms'));
        fireEvent.press(r.getByTestId('link-privacy'));
        await waitFor(() => expect(open).toHaveBeenCalledTimes(2));
        expect(open).toHaveBeenCalledWith('https://lardermind.com/legal/terms-of-service');
        expect(open).toHaveBeenCalledWith('https://lardermind.com/legal/privacy-policy');
    });

    it('never mentions Stripe or web purchase', () => {
        const text = allText(render(<SubscriptionScreen />)).toLowerCase();
        expect(text).not.toContain('stripe');
        expect(text).not.toContain('lardermind.com/pricing');
        expect(text).not.toMatch(/website|web checkout|on the web/);
    });

    it('subscribe button purchases the chosen product', async () => {
        mockPurchase.mockResolvedValue('cancelled');
        const r = render(<SubscriptionScreen />);
        fireEvent.press(r.getByTestId('subscribe-com.lardermind.pro.yearly'));
        await waitFor(() => expect(mockPurchase).toHaveBeenCalledWith('com.lardermind.pro.yearly'));
    });

    it('restore button calls restore', async () => {
        mockRestore.mockResolvedValue('error');
        const r = render(<SubscriptionScreen />);
        fireEvent.press(r.getByTestId('restore-purchases'));
        await waitFor(() => expect(mockRestore).toHaveBeenCalledTimes(1));
    });

    it('shows Pro state from the backend with manage link for Apple-managed subscriptions', () => {
        mockState = baseState({ isPro: true, isTrial: true, managedByApple: true, expiresAt: 1900000000 });
        const r = render(<SubscriptionScreen />);
        expect(r.getByTestId('pro-title')).toBeTruthy();
        expect(r.getByTestId('manage-subscription')).toBeTruthy();
        expect(r.getByTestId('link-terms')).toBeTruthy();
        expect(r.queryByTestId('restore-purchases')).toBeNull();
    });

    it('shows an inline error from a failed purchase', () => {
        mockState = baseState({ error: 'Purchase failed' });
        expect(render(<SubscriptionScreen />).getByTestId('paywall-error')).toBeTruthy();
    });
});

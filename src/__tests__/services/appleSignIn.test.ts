/**
 * appleSignIn service — maps expo-apple-authentication results to a credential / typed errors
 */
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { AppleSignInError, signInWithApple, isAppleSignInAvailable } from '../../services/appleSignIn';

const mockedApple = AppleAuthentication as jest.Mocked<typeof AppleAuthentication>;

describe('appleSignIn', () => {
    const platformOS = Platform.OS;

    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });
    });

    afterAll(() => {
        Object.defineProperty(Platform, 'OS', { configurable: true, get: () => platformOS });
    });

    it('returns identityToken plus name/email on first sign-in', async () => {
        mockedApple.signInAsync.mockResolvedValue({
            identityToken: 'tok',
            email: 'a@privaterelay.appleid.com',
            fullName: { givenName: 'Ann', familyName: 'Lee', middleName: null, namePrefix: null, nameSuffix: null, nickname: null },
        } as never);
        await expect(signInWithApple()).resolves.toEqual({
            identityToken: 'tok',
            email: 'a@privaterelay.appleid.com',
            fullName: { givenName: 'Ann', familyName: 'Lee' },
        });
        expect(mockedApple.signInAsync).toHaveBeenCalledWith({ requestedScopes: [0, 1] });
    });

    it('omits name/email on later sign-ins (Apple sends them once)', async () => {
        mockedApple.signInAsync.mockResolvedValue({ identityToken: 'tok', email: null, fullName: null } as never);
        await expect(signInWithApple()).resolves.toEqual({ identityToken: 'tok' });
    });

    it('maps ERR_REQUEST_CANCELED to a cancelled error', async () => {
        mockedApple.signInAsync.mockRejectedValue(Object.assign(new Error('x'), { code: 'ERR_REQUEST_CANCELED' }));
        await expect(signInWithApple()).rejects.toMatchObject({ name: 'AppleSignInError', code: 'cancelled' });
    });

    it('fails with missing_token when Apple returns no identity token', async () => {
        mockedApple.signInAsync.mockResolvedValue({ identityToken: null } as never);
        await expect(signInWithApple()).rejects.toMatchObject({ code: 'missing_token' });
    });

    it('wraps other native failures', async () => {
        mockedApple.signInAsync.mockRejectedValue(new Error('boom'));
        const err = await signInWithApple().catch((e) => e);
        expect(err).toBeInstanceOf(AppleSignInError);
        expect(err).toMatchObject({ code: 'native', message: 'boom' });
    });

    it('is unavailable off iOS', async () => {
        Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
        await expect(signInWithApple()).rejects.toMatchObject({ code: 'unavailable' });
        await expect(isAppleSignInAvailable()).resolves.toBe(false);
    });
});

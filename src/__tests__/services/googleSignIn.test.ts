/**
 * googleSignIn service — maps native responses to ID token / typed errors
 */
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import {
    GoogleSignInError,
    configureGoogleSignIn,
    signInForIdToken,
} from '../../services/googleSignIn';

const mockedGoogle = GoogleSignin as jest.Mocked<typeof GoogleSignin>;

describe('googleSignIn', () => {
    const originalEnv = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID =
            '603047692060-llk1cjf1b0f5bpdb9it5cvogk2b8haio.apps.googleusercontent.com';
        // allow re-configure in each test by resetting module state via configure call path
        configureGoogleSignIn();
    });

    afterAll(() => {
        process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = originalEnv;
    });

    it('returns idToken on success', async () => {
        mockedGoogle.hasPlayServices.mockResolvedValue(true);
        mockedGoogle.signIn.mockResolvedValue({
            type: 'success',
            data: {
                idToken: 'id-token-abc',
                serverAuthCode: null,
                scopes: [],
                user: {
                    id: '1',
                    name: 'Test',
                    email: 't@test.com',
                    photo: null,
                    familyName: null,
                    givenName: null,
                },
            },
        } as never);

        await expect(signInForIdToken()).resolves.toBe('id-token-abc');
    });

    it('throws cancelled when user dismisses', async () => {
        mockedGoogle.hasPlayServices.mockResolvedValue(true);
        mockedGoogle.signIn.mockResolvedValue({ type: 'cancelled', data: null } as never);

        await expect(signInForIdToken()).rejects.toMatchObject({
            name: 'GoogleSignInError',
            code: 'cancelled',
        } satisfies Partial<GoogleSignInError>);
    });

    it('throws missing_token when idToken absent', async () => {
        mockedGoogle.hasPlayServices.mockResolvedValue(true);
        mockedGoogle.signIn.mockResolvedValue({
            type: 'success',
            data: {
                idToken: null,
                serverAuthCode: null,
                scopes: [],
                user: {
                    id: '1',
                    name: 'Test',
                    email: 't@test.com',
                    photo: null,
                    familyName: null,
                    givenName: null,
                },
            },
        } as never);

        await expect(signInForIdToken()).rejects.toMatchObject({ code: 'missing_token' });
    });
});

/**
 * app.config.js — Google iOS URL scheme derived from EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID; Apple sign-in config
 */
const appJson = require('../../app.json');
const makeConfig = require('../../app.config.js');

const GOOGLE = '@react-native-google-signin/google-signin';

describe('app config', () => {
    const prev = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
    afterEach(() => {
        if (prev === undefined) delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
        else process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = prev;
    });

    it('enables Sign in with Apple', () => {
        expect(appJson.expo.ios.usesAppleSignIn).toBe(true);
        expect(appJson.expo.plugins).toContain('expo-apple-authentication');
    });

    it('reverses the iOS client id into the URL scheme', () => {
        process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = '123-abc.apps.googleusercontent.com';
        const cfg = makeConfig({ config: appJson.expo });
        expect(cfg.plugins).toContainEqual([GOOGLE, { iosUrlScheme: 'com.googleusercontent.apps.123-abc' }]);
        expect(cfg.plugins).not.toContain(GOOGLE);
    });

    it('keeps the plain plugin when no iOS client id is configured', () => {
        delete process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
        const cfg = makeConfig({ config: appJson.expo });
        expect(cfg.plugins).toContain(GOOGLE);
    });

    it('rejects a malformed iOS client id', () => {
        process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID = 'not-a-client-id';
        expect(() => makeConfig({ config: appJson.expo })).toThrow(/EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID/);
    });
});

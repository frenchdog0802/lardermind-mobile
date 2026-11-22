/**
 * Sign in with Apple (iOS only). Requires a development/production build with the
 * `com.apple.developer.applesignin` entitlement (app.json: ios.usesAppleSignIn).
 */
import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';

export type AppleSignInErrorCode = 'cancelled' | 'missing_token' | 'unavailable' | 'native';

export class AppleSignInError extends Error {
  readonly code: AppleSignInErrorCode;

  constructor(code: AppleSignInErrorCode, message: string) {
    super(message);
    this.name = 'AppleSignInError';
    this.code = code;
  }
}

export interface AppleCredentialResult {
  identityToken: string;
  /** Only present the first time the person authorizes the app. */
  fullName?: { givenName?: string; familyName?: string };
  email?: string;
}

export async function isAppleSignInAvailable(): Promise<boolean> {
  if (Platform.OS !== 'ios') return false;
  try {
    return await AppleAuthentication.isAvailableAsync();
  } catch {
    return false;
  }
}

/** Interactive Apple sign-in; returns the identity token (+ name/email on first sign-in). */
export async function signInWithApple(): Promise<AppleCredentialResult> {
  if (Platform.OS !== 'ios') {
    throw new AppleSignInError('unavailable', 'Sign in with Apple is only available on iOS');
  }
  try {
    const credential = await AppleAuthentication.signInAsync({
      requestedScopes: [
        AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
        AppleAuthentication.AppleAuthenticationScope.EMAIL,
      ],
    });
    if (!credential.identityToken) {
      throw new AppleSignInError('missing_token', 'Apple identity token missing from response');
    }
    const { fullName } = credential;
    const result: AppleCredentialResult = { identityToken: credential.identityToken };
    if (fullName && (fullName.givenName || fullName.familyName)) {
      result.fullName = {
        ...(fullName.givenName ? { givenName: fullName.givenName } : {}),
        ...(fullName.familyName ? { familyName: fullName.familyName } : {}),
      };
    }
    if (credential.email) result.email = credential.email;
    return result;
  } catch (error) {
    if (error instanceof AppleSignInError) throw error;
    const code = (error as { code?: string } | null)?.code;
    if (code === 'ERR_REQUEST_CANCELED') {
      throw new AppleSignInError('cancelled', 'Apple sign-in was cancelled');
    }
    const message = error instanceof Error ? error.message : 'Apple sign-in failed';
    throw new AppleSignInError('native', message);
  }
}

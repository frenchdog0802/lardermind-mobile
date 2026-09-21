/**
 * Native Google Sign-In (Android). Requires a development build — not Expo Go.
 */
import {
  GoogleSignin,
  isCancelledResponse,
  isSuccessResponse,
  statusCodes,
  isErrorWithCode,
} from '@react-native-google-signin/google-signin';

export type GoogleSignInErrorCode = 'cancelled' | 'missing_token' | 'not_configured' | 'native';

export class GoogleSignInError extends Error {
  readonly code: GoogleSignInErrorCode;

  constructor(code: GoogleSignInErrorCode, message: string) {
    super(message);
    this.name = 'GoogleSignInError';
    this.code = code;
  }
}

let configured = false;

export function configureGoogleSignIn(): void {
  if (configured) return;

  const webClientId = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '').trim();
  if (!webClientId) {
    if (__DEV__) {
      console.warn(
        '[googleSignIn] EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID is missing; Google Sign-In will fail until set.',
      );
    }
    return;
  }

  GoogleSignin.configure({
    webClientId,
    offlineAccess: false,
  });
  configured = true;
}

/**
 * Interactive Google Sign-In; returns a Google ID token for backend verify.
 */
export async function signInForIdToken(): Promise<string> {
  configureGoogleSignIn();

  const webClientId = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '').trim();
  if (!webClientId) {
    throw new GoogleSignInError('not_configured', 'Google Sign-In is not configured');
  }

  try {
    await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const response = await GoogleSignin.signIn();

    if (isCancelledResponse(response)) {
      throw new GoogleSignInError('cancelled', 'Google sign-in was cancelled');
    }

    if (!isSuccessResponse(response)) {
      throw new GoogleSignInError('native', 'Google sign-in failed');
    }

    const idToken = response.data.idToken;
    if (!idToken) {
      throw new GoogleSignInError('missing_token', 'Google ID token missing from response');
    }

    return idToken;
  } catch (error) {
    if (error instanceof GoogleSignInError) {
      throw error;
    }
    if (isErrorWithCode(error) && error.code === statusCodes.SIGN_IN_CANCELLED) {
      throw new GoogleSignInError('cancelled', 'Google sign-in was cancelled');
    }
    const message = error instanceof Error ? error.message : 'Google sign-in failed';
    throw new GoogleSignInError('native', message);
  }
}

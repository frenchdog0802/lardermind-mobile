/**
 * Authentication API — email/password + Google ID token login + guest mint
 */
import { api } from './client';
import { ApiResponse, User } from '../types';

interface AuthData {
    user: User;
    token: string;
    claimed?: boolean;
}

export interface GuestMintData {
    token: string;
    user: User & { is_guest?: boolean; expires_at?: number | null };
    expires_in: number;
}

export const auth = {
    signin: (
        email: string,
        password: string,
        guestToken?: string | null,
    ): Promise<ApiResponse<AuthData>> => {
        return api.post<AuthData>('auth/signin', {
            email,
            password,
            ...(guestToken ? { guest_token: guestToken } : {}),
        });
    },

    signup: (
        user: User,
        password: string,
        guestToken?: string | null,
    ): Promise<ApiResponse<AuthData>> => {
        return api.post<AuthData>('auth/signup', {
            ...user,
            password,
            ...(guestToken ? { guest_token: guestToken } : {}),
        });
    },

    /** Exchange Google ID token for app JWT (Worker: POST /api/auth/google-login). */
    googleLogin: (
        idToken: string,
        guestToken?: string | null,
    ): Promise<ApiResponse<AuthData>> => {
        return api.post<AuthData>('auth/google-login', {
            token: idToken,
            ...(guestToken ? { guest_token: guestToken } : {}),
        });
    },

    /** Exchange an Apple identity token for the app JWT (Worker: POST /api/auth/apple-login). */
    appleLogin: (
        credential: {
            identityToken: string;
            fullName?: { givenName?: string; familyName?: string };
            email?: string;
        },
        guestToken?: string | null,
    ): Promise<ApiResponse<AuthData>> => {
        return api.post<AuthData>('auth/apple-login', {
            ...credential,
            ...(guestToken ? { guest_token: guestToken } : {}),
        });
    },

    mintGuest: (): Promise<ApiResponse<GuestMintData>> => {
        return api.post<GuestMintData>('auth/guest', {});
    },

    /** Permanently delete the authenticated account (Apple 5.1.1(v)). */
    deleteAccount: (): Promise<ApiResponse<null>> => {
        return api.delete<null>('auth/account');
    },

    /** Always answers with a generic success (429 when rate limited). */
    requestPasswordReset: (email: string): Promise<ApiResponse<unknown>> => {
        return api.post<unknown>('auth/password-reset/request', { email });
    },

    /** 400 with code `reset_token_invalid` when the token is wrong/expired. */
    confirmPasswordReset: (token: string, password: string): Promise<ApiResponse<unknown>> => {
        return api.post<unknown>('auth/password-reset/confirm', { token, password });
    },
};

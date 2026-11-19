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

    mintGuest: (): Promise<ApiResponse<GuestMintData>> => {
        return api.post<GuestMintData>('auth/guest', {});
    },
};

/**
 * Authentication API — email/password + Google ID token login
 */
import { api } from './client';
import { ApiResponse, User } from '../types';

interface AuthData {
    user: User;
    token: string;
}

export const auth = {
    signin: (email: string, password: string): Promise<ApiResponse<AuthData>> => {
        return api.post<AuthData>('auth/signin', { email, password });
    },

    signup: (user: User, password: string): Promise<ApiResponse<AuthData>> => {
        return api.post<AuthData>('auth/signup', { ...user, password });
    },

    /** Exchange Google ID token for app JWT (Worker: POST /api/auth/google-login). */
    googleLogin: (idToken: string): Promise<ApiResponse<AuthData>> => {
        return api.post<AuthData>('auth/google-login', { token: idToken });
    },
};

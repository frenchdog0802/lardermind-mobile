import React, { useEffect, useState, createContext, useContext, useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth } from '../api/api-auth';
import { authHelper, isJwtExpired } from '../api/auth-helper';
import { setUnauthorizedHandler } from '../api/client';
import { User } from '../types';
import { GoogleSignInError, signInForIdToken } from '../services/googleSignIn';

import { clearUserOfflineData, clearBackoff } from '../services/shoppingListOffline';

const OFFLINE_OWNER_KEY = '@lardermind/offline-owner';

export interface AuthResponse {
    success: boolean;
    message?: string;
}

interface AuthContextType {
    user: User | null;
    /** True only while restoring session on app launch */
    initializing: boolean;
    /** True while login/signup request is in flight */
    submitting: boolean;
    /** @deprecated use initializing — kept so AuthCheck migration is obvious */
    loading: boolean;
    signUp: (user: User, password: string) => Promise<AuthResponse>;
    login: (email: string, password: string) => Promise<AuthResponse>;
    loginWithGoogle: () => Promise<AuthResponse>;
    continueAsGuest: () => Promise<AuthResponse>;
    logout: () => Promise<void>;
    /** Permanently deletes the account on the server, then clears session + offline data. */
    deleteAccount: () => Promise<AuthResponse>;
    isAuthenticated: boolean;
    isGuest: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [initializing, setInitializing] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const userRef = useRef<User | null>(null);
    userRef.current = user;

    /**
     * Session expired / rejected (HTTP 401): drop JWT + user only. The offline
     * shopping snapshot/queue is deliberately kept so pending edits can flush
     * after the same user signs in again. A different user signing in later
     * causes the old data to be cleared (see persistSession).
     */
    const expireSession = useCallback(async (): Promise<void> => {
        setUser(null);
        await authHelper.clearJWT();
        await AsyncStorage.removeItem('user');
    }, []);

    /** Explicit user sign-out: also wipes this user's offline data. */
    const logout = useCallback(async (): Promise<void> => {
        const previousUserId = userRef.current?.id;
        await expireSession();
        if (previousUserId) {
            clearBackoff(previousUserId);
            await clearUserOfflineData(previousUserId);
        }
        try {
            await AsyncStorage.removeItem(OFFLINE_OWNER_KEY);
        } catch {
            // ignore
        }
    }, [expireSession]);

    const deleteAccount = useCallback(async (): Promise<AuthResponse> => {
        try {
            const response = await auth.deleteAccount();
            if (!response?.success) {
                return { success: false, message: response?.message || 'Could not delete account' };
            }
            await logout();
            return { success: true };
        } catch (error) {
            console.error('Error deleting account:', error);
            return { success: false, message: 'Could not delete account' };
        }
    }, [logout]);

    useEffect(() => {
        setUnauthorizedHandler(() => {
            void expireSession();
        });
        return () => {
            setUnauthorizedHandler(null);
        };
    }, [expireSession]);

    useEffect(() => {
        const checkAuth = async () => {
            try {
                const storedUser = await AsyncStorage.getItem('user');
                const jwtToken = await authHelper.getJWT();

                if (storedUser && jwtToken) {
                    if (isJwtExpired(jwtToken)) {
                        await authHelper.clearJWT();
                        await AsyncStorage.removeItem('user');
                    } else {
                        const parsedUser = JSON.parse(storedUser) as User;
                        if (parsedUser && parsedUser.name && parsedUser.id) {
                            setUser(parsedUser);
                        } else {
                            console.warn('Incomplete user data, clearing...');
                            await AsyncStorage.removeItem('user');
                            await authHelper.clearJWT();
                        }
                    }
                }
            } catch (error) {
                console.error('Auth check error:', error);
                await AsyncStorage.removeItem('user');
                await authHelper.clearJWT();
            } finally {
                setInitializing(false);
            }
        };

        void checkAuth();
    }, []);

    const persistSession = async (token: string, nextUser: User): Promise<void> => {
        // If a different user signs in than the one whose offline data is on this
        // device, wipe the previous user's snapshot/queue so nothing leaks across accounts.
        try {
            const ownerId = await AsyncStorage.getItem(OFFLINE_OWNER_KEY);
            if (ownerId && nextUser.id && ownerId !== nextUser.id) {
                clearBackoff(ownerId);
                await clearUserOfflineData(ownerId);
            }
            if (nextUser.id) await AsyncStorage.setItem(OFFLINE_OWNER_KEY, nextUser.id);
        } catch {
            // non-fatal
        }
        await authHelper.authenticate(token);
        setUser(nextUser);
        await AsyncStorage.setItem('user', JSON.stringify(nextUser));
    };

    /** If current session is guest, return JWT for claim-on-signup. */
    const takeGuestTokenIfPresent = async (): Promise<string | null> => {
        if (!userRef.current?.is_guest) return null;
        return authHelper.getJWT();
    };

    const signUp = async (userData: User, password: string): Promise<AuthResponse> => {
        setSubmitting(true);
        const authResponse: AuthResponse = { success: false };

        try {
            const guestToken = await takeGuestTokenIfPresent();
            if (__DEV__) {
                console.log('[auth] signup start', userData.email);
            }
            const response = await auth.signup(userData, password, guestToken);
            if (__DEV__) {
                console.log('[auth] signup response', response?.success, response?.message);
            }

            if (response && response.success && response.data) {
                await persistSession(response.data.token, {
                    ...response.data.user,
                    is_guest: false,
                });
                authResponse.success = true;
            } else {
                authResponse.success = false;
                authResponse.message = response.message || 'Sign up failed';
            }
        } catch (error) {
            console.error('Error during sign up:', error);
            authResponse.message = 'An error occurred during sign up';
        } finally {
            setSubmitting(false);
        }

        return authResponse;
    };

    const login = async (email: string, password: string): Promise<AuthResponse> => {
        setSubmitting(true);
        const authResponse: AuthResponse = { success: false };

        try {
            const guestToken = await takeGuestTokenIfPresent();
            if (__DEV__) {
                console.log('[auth] login start', email);
            }
            const response = await auth.signin(email, password, guestToken);
            if (__DEV__) {
                console.log('[auth] login response', response?.success, response?.message);
            }

            if (response && response.data && response.success) {
                await persistSession(response.data.token, {
                    ...response.data.user,
                    is_guest: false,
                });
                authResponse.success = true;
            } else {
                authResponse.success = false;
                authResponse.message = response.message || 'Login failed';
            }
        } catch (error) {
            console.error('Error logging in:', error);
            authResponse.message = 'An error occurred during login';
        } finally {
            setSubmitting(false);
        }

        return authResponse;
    };

    const loginWithGoogle = async (): Promise<AuthResponse> => {
        setSubmitting(true);
        const authResponse: AuthResponse = { success: false };

        try {
            const guestToken = await takeGuestTokenIfPresent();
            const idToken = await signInForIdToken();
            if (__DEV__) {
                console.log('[auth] google login start');
            }
            const response = await auth.googleLogin(idToken, guestToken);
            if (__DEV__) {
                console.log('[auth] google login response', response?.success, response?.message);
            }

            if (response && response.success && response.data) {
                await persistSession(response.data.token, {
                    ...response.data.user,
                    is_guest: false,
                });
                authResponse.success = true;
            } else {
                authResponse.success = false;
                authResponse.message = response.message || 'Google login failed';
            }
        } catch (error) {
            if (error instanceof GoogleSignInError && error.code === 'cancelled') {
                authResponse.message = 'cancelled';
            } else if (error instanceof GoogleSignInError) {
                console.error('Google sign-in error:', error.code, error.message);
                authResponse.message = error.message;
            } else {
                console.error('Error during Google login:', error);
                authResponse.message = 'An error occurred during Google login';
            }
        } finally {
            setSubmitting(false);
        }

        return authResponse;
    };

    const continueAsGuest = async (): Promise<AuthResponse> => {
        setSubmitting(true);
        const authResponse: AuthResponse = { success: false };
        try {
            const response = await auth.mintGuest();
            if (response?.success && response.data?.token) {
                const guestUser: User = {
                    ...response.data.user,
                    name: response.data.user.name || 'Guest',
                    first_name: response.data.user.first_name || 'Guest',
                    last_name: response.data.user.last_name || '',
                    email: response.data.user.email || '',
                    is_guest: true,
                };
                await persistSession(response.data.token, guestUser);
                authResponse.success = true;
            } else {
                authResponse.message = response?.message || 'Guest session failed';
            }
        } catch (error) {
            console.error('Error minting guest:', error);
            authResponse.message = 'Could not start guest session';
        } finally {
            setSubmitting(false);
        }
        return authResponse;
    };

    const isGuest = Boolean(user?.is_guest);

    const value = useMemo(
        () => ({
            user,
            initializing,
            submitting,
            loading: initializing,
            login,
            loginWithGoogle,
            continueAsGuest,
            logout,
            deleteAccount,
            isAuthenticated: !!user,
            isGuest,
            signUp,
        }),
        [user, initializing, submitting, logout, deleteAccount, isGuest],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth() {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
}

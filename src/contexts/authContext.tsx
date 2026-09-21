import React, { useEffect, useState, createContext, useContext, useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { auth } from '../api/api-auth';
import { authHelper, isJwtExpired } from '../api/auth-helper';
import { setUnauthorizedHandler } from '../api/client';
import { User } from '../types';
import { GoogleSignInError, signInForIdToken } from '../services/googleSignIn';

import { clearUserOfflineData, clearBackoff } from '../services/shoppingListOffline';

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
    logout: () => Promise<void>;
    isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [initializing, setInitializing] = useState(true);
    const [submitting, setSubmitting] = useState(false);
    const userRef = useRef<User | null>(null);
    userRef.current = user;

    const logout = useCallback(async (): Promise<void> => {
        const previousUserId = userRef.current?.id;
        setUser(null);
        await authHelper.clearJWT();
        await AsyncStorage.removeItem('user');
        if (previousUserId) {
            clearBackoff(previousUserId);
            await clearUserOfflineData(previousUserId);
        }
    }, []);

    useEffect(() => {
        setUnauthorizedHandler(() => {
            void logout();
        });
        return () => {
            setUnauthorizedHandler(null);
        };
    }, [logout]);

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
        await authHelper.authenticate(token);
        setUser(nextUser);
        await AsyncStorage.setItem('user', JSON.stringify(nextUser));
    };

    const signUp = async (userData: User, password: string): Promise<AuthResponse> => {
        setSubmitting(true);
        const authResponse: AuthResponse = { success: false };

        try {
            if (__DEV__) {
                console.log('[auth] signup start', userData.email);
            }
            const response = await auth.signup(userData, password);
            if (__DEV__) {
                console.log('[auth] signup response', response?.success, response?.message);
            }

            if (response && response.success && response.data) {
                await persistSession(response.data.token, response.data.user);
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
            if (__DEV__) {
                console.log('[auth] login start', email);
            }
            const response = await auth.signin(email, password);
            if (__DEV__) {
                console.log('[auth] login response', response?.success, response?.message);
            }

            if (response && response.data && response.success) {
                await persistSession(response.data.token, response.data.user);
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
            const idToken = await signInForIdToken();
            if (__DEV__) {
                console.log('[auth] google login start');
            }
            const response = await auth.googleLogin(idToken);
            if (__DEV__) {
                console.log('[auth] google login response', response?.success, response?.message);
            }

            if (response && response.success && response.data) {
                await persistSession(response.data.token, response.data.user);
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

    const value = useMemo(
        () => ({
            user,
            initializing,
            submitting,
            loading: initializing,
            login,
            loginWithGoogle,
            logout,
            isAuthenticated: !!user,
            signUp,
        }),
        [user, initializing, submitting, logout],
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

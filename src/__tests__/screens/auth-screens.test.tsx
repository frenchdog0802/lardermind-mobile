/**
 * Login / SignUp screen smoke tests — email + Android Google CTA
 */
import React from 'react';
import { Platform } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import LoginScreen from '../../screens/LoginScreen';
import SignUpScreen from '../../screens/SignUpScreen';

const mockLogin = jest.fn();
const mockSignUp = jest.fn();
const mockLoginWithGoogle = jest.fn();

jest.mock('../../contexts/authContext', () => ({
    useAuth: () => ({
        login: mockLogin,
        signUp: mockSignUp,
        loginWithGoogle: mockLoginWithGoogle,
        initializing: false,
        submitting: false,
        loading: false,
        user: null,
        isAuthenticated: false,
        logout: jest.fn(),
    }),
}));

describe('LoginScreen', () => {
    const platformOS = Platform.OS;

    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });
    });

    afterAll(() => {
        Object.defineProperty(Platform, 'OS', { configurable: true, get: () => platformOS });
    });

    it('shows email login UI without social SSO buttons on iOS', () => {
        const { getByText, getByPlaceholderText, queryByText, queryByTestId } = render(
            <LoginScreen />,
        );

        expect(getByText('LarderMind')).toBeTruthy();
        expect(getByText('Sign in with email')).toBeTruthy();
        expect(getByPlaceholderText('you@example.com')).toBeTruthy();
        expect(getByPlaceholderText('••••••••')).toBeTruthy();
        expect(getByText('Sign in')).toBeTruthy();
        expect(getByText('Sign up')).toBeTruthy();

        expect(queryByText('Sign in with Google')).toBeNull();
        expect(queryByTestId('login-google')).toBeNull();
        expect(queryByText('Continue with Apple')).toBeNull();
    });

    it('shows Google button on Android and calls loginWithGoogle', async () => {
        Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
        mockLoginWithGoogle.mockResolvedValue({ success: true });

        const { getByText, getByTestId } = render(<LoginScreen />);

        expect(getByText('Sign in with Google')).toBeTruthy();
        fireEvent.press(getByTestId('login-google'));

        await waitFor(() => {
            expect(mockLoginWithGoogle).toHaveBeenCalled();
        });
    });

    it('calls login with email and password', async () => {
        mockLogin.mockResolvedValue({ success: true });
        const { getByPlaceholderText, getByText } = render(<LoginScreen />);

        fireEvent.changeText(getByPlaceholderText('you@example.com'), 'tester@example.com');
        fireEvent.changeText(getByPlaceholderText('••••••••'), 'secret123');
        fireEvent.press(getByText('Sign in'));

        await waitFor(() => {
            expect(mockLogin).toHaveBeenCalledWith('tester@example.com', 'secret123');
        });
    });

    it('shows validation error when fields are empty', async () => {
        const { getByText } = render(<LoginScreen />);
        fireEvent.press(getByText('Sign in'));
        expect(getByText('Please enter email and password')).toBeTruthy();
        expect(mockLogin).not.toHaveBeenCalled();
    });
});

describe('SignUpScreen', () => {
    const platformOS = Platform.OS;

    beforeEach(() => {
        jest.clearAllMocks();
        Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'ios' });
    });

    afterAll(() => {
        Object.defineProperty(Platform, 'OS', { configurable: true, get: () => platformOS });
    });

    it('shows email signup UI without Google button on iOS', () => {
        const { getByText, getByPlaceholderText, queryByText, queryByTestId } = render(
            <SignUpScreen />,
        );

        expect(getByText('LarderMind')).toBeTruthy();
        expect(getByText('Create your account with email')).toBeTruthy();
        expect(getByPlaceholderText('John')).toBeTruthy();
        expect(getByPlaceholderText('Doe')).toBeTruthy();
        expect(getByPlaceholderText('you@example.com')).toBeTruthy();
        expect(getByText('Sign up')).toBeTruthy();
        expect(getByText('Log in')).toBeTruthy();

        expect(queryByText('Sign up with Google')).toBeNull();
        expect(queryByTestId('signup-google')).toBeNull();
        expect(queryByText(/^or$/)).toBeNull();
    });

    it('shows Google button on Android and calls loginWithGoogle', async () => {
        Object.defineProperty(Platform, 'OS', { configurable: true, get: () => 'android' });
        mockLoginWithGoogle.mockResolvedValue({ success: true });

        const { getByText, getByTestId } = render(<SignUpScreen />);

        expect(getByText('Sign up with Google')).toBeTruthy();
        fireEvent.press(getByTestId('signup-google'));

        await waitFor(() => {
            expect(mockLoginWithGoogle).toHaveBeenCalled();
        });
    });

    it('validates password confirmation', () => {
        const { getByText, getByPlaceholderText, getAllByPlaceholderText } = render(<SignUpScreen />);

        fireEvent.changeText(getByPlaceholderText('John'), 'Ada');
        fireEvent.changeText(getByPlaceholderText('Doe'), 'Lovelace');
        fireEvent.changeText(getByPlaceholderText('you@example.com'), 'ada@example.com');

        const passwordFields = getAllByPlaceholderText('••••••••');
        fireEvent.changeText(passwordFields[0], 'secret123');
        fireEvent.changeText(passwordFields[1], 'different');
        fireEvent.press(getByText('Sign up'));

        expect(getByText('Passwords do not match')).toBeTruthy();
        expect(mockSignUp).not.toHaveBeenCalled();
    });
});

import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import ResetPasswordScreen from '../../screens/ResetPasswordScreen';
import ForgotPasswordScreen from '../../screens/ForgotPasswordScreen';
import { auth } from '../../api/api-auth';

jest.mock('../../api/api-auth', () => ({
    auth: {
        requestPasswordReset: jest.fn(),
        confirmPasswordReset: jest.fn(),
    },
}));
jest.mock('@react-navigation/native', () => ({
    ...jest.requireActual('@react-navigation/native'),
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn() }),
}));

const mocked = auth as jest.Mocked<typeof auth>;

describe('ResetPasswordScreen', () => {
    beforeEach(() => jest.clearAllMocks());

    it('extracts the token from a pasted link and shows success', async () => {
        mocked.confirmPasswordReset.mockResolvedValue({ success: true });
        const { getByTestId, findByTestId } = render(<ResetPasswordScreen />);
        fireEvent.changeText(getByTestId('reset-token'), 'https://x.io/reset-password?token=abc123');
        fireEvent.changeText(getByTestId('reset-password'), 'newpassword1');
        fireEvent.changeText(getByTestId('reset-confirm'), 'newpassword1');
        fireEvent.press(getByTestId('reset-submit'));
        await findByTestId('reset-done');
        expect(mocked.confirmPasswordReset).toHaveBeenCalledWith('abc123', 'newpassword1');
    });

    it('shows an invalid-token message for reset_token_invalid', async () => {
        mocked.confirmPasswordReset.mockResolvedValue({
            success: false,
            statusCode: 400,
            code: 'reset_token_invalid',
        });
        const { getByTestId, findByTestId } = render(<ResetPasswordScreen />);
        fireEvent.changeText(getByTestId('reset-token'), 'bad');
        fireEvent.changeText(getByTestId('reset-password'), 'newpassword1');
        fireEvent.changeText(getByTestId('reset-confirm'), 'newpassword1');
        fireEvent.press(getByTestId('reset-submit'));
        const err = await findByTestId('reset-error');
        expect(String(err.props.children)).toBe('auth.resetTokenInvalid');
    });

    it('rejects short passwords locally without calling the API', () => {
        const { getByTestId } = render(<ResetPasswordScreen />);
        fireEvent.changeText(getByTestId('reset-token'), 'tok');
        fireEvent.changeText(getByTestId('reset-password'), 'short');
        fireEvent.changeText(getByTestId('reset-confirm'), 'short');
        fireEvent.press(getByTestId('reset-submit'));
        expect(mocked.confirmPasswordReset).not.toHaveBeenCalled();
    });
});

describe('ForgotPasswordScreen', () => {
    beforeEach(() => jest.clearAllMocks());

    it('shows the generic confirmation after requesting a reset', async () => {
        mocked.requestPasswordReset.mockResolvedValue({ success: true });
        const { getByTestId, findByTestId } = render(<ForgotPasswordScreen />);
        fireEvent.changeText(getByTestId('forgot-email'), 'a@b.com');
        fireEvent.press(getByTestId('forgot-submit'));
        await findByTestId('forgot-sent');
        expect(mocked.requestPasswordReset).toHaveBeenCalledWith('a@b.com');
    });

    it('shows a rate-limit message on 429', async () => {
        mocked.requestPasswordReset.mockResolvedValue({ success: false, statusCode: 429 });
        const { getByTestId, findByTestId } = render(<ForgotPasswordScreen />);
        fireEvent.changeText(getByTestId('forgot-email'), 'a@b.com');
        fireEvent.press(getByTestId('forgot-submit'));
        const err = await findByTestId('forgot-error');
        expect(String(err.props.children)).toBe('auth.resetRateLimited');
        await waitFor(() => expect(mocked.requestPasswordReset).toHaveBeenCalledTimes(1));
    });
});

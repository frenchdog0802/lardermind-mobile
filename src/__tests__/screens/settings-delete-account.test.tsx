import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import SettingsScreen from '../../screens/SettingsScreen';

const mockDeleteAccount = jest.fn();
let mockIsGuest = false;

jest.mock('../../contexts/authContext', () => ({
    useAuth: () => ({
        logout: jest.fn(),
        deleteAccount: mockDeleteAccount,
        user: { id: 'u1', name: 'A', email: 'a@b.com' },
        isGuest: mockIsGuest,
    }),
}));
jest.mock('../../contexts/pantryContext', () => ({
    usePantry: () => ({ userSettings: { measurement_unit: 'metric' }, updateUserSettings: jest.fn() }),
}));
jest.mock('../../api/userPreferences', () => ({
    userPreferencesApi: { get: jest.fn(async () => null), update: jest.fn() },
}));
jest.mock('../../components/AppHeader', () => () => null);
jest.mock('@react-navigation/native', () => ({
    ...jest.requireActual('@react-navigation/native'),
    useNavigation: () => ({ navigate: jest.fn() }),
}));

type AlertButton = { style?: string; onPress?: () => void };

describe('SettingsScreen delete account', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockIsGuest = false;
    });

    it('shows the delete section and only deletes after destructive confirmation', async () => {
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
        mockDeleteAccount.mockResolvedValue({ success: true });
        const { getByTestId } = render(<SettingsScreen />);

        fireEvent.press(getByTestId('delete-account-button'));
        expect(mockDeleteAccount).not.toHaveBeenCalled();
        expect(alertSpy).toHaveBeenCalledTimes(1);
        const buttons = alertSpy.mock.calls[0][2] as AlertButton[];
        const destructive = buttons.find((b) => b.style === 'destructive');
        expect(destructive).toBeTruthy();

        destructive!.onPress!();
        await waitFor(() => expect(mockDeleteAccount).toHaveBeenCalledTimes(1));
    });

    it('shows an error when deletion fails', async () => {
        const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
        mockDeleteAccount.mockResolvedValue({ success: false, message: 'Server down' });
        const { getByTestId, findByTestId } = render(<SettingsScreen />);
        fireEvent.press(getByTestId('delete-account-button'));
        const buttons = alertSpy.mock.calls[0][2] as AlertButton[];
        buttons.find((b) => b.style === 'destructive')!.onPress!();
        const err = await findByTestId('delete-account-error');
        expect(err.props.children).toBe('Server down');
    });
});

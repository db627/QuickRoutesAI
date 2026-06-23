import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import ChangePasswordScreen from '../screens/ChangePasswordScreen';
import {
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from 'firebase/auth';

jest.mock('../config/firebase', () => ({
  auth: { currentUser: { uid: 'driver123', email: 'driver@example.com' } },
}));

jest.mock('firebase/auth', () => ({
  EmailAuthProvider: { credential: jest.fn(() => 'mock-credential') },
  reauthenticateWithCredential: jest.fn(),
  updatePassword: jest.fn(),
}));

const mockGoBack = jest.fn();
const navigation = { goBack: mockGoBack };

describe('ChangePasswordScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  it('shows error when fields are empty', () => {
    const { getByText } = render(<ChangePasswordScreen navigation={navigation} />);
    fireEvent.press(getByText('Update Password'));
    expect(getByText('Please fill in all fields.')).toBeTruthy();
    expect(reauthenticateWithCredential).not.toHaveBeenCalled();
  });

  it('rejects new passwords shorter than 8 characters', () => {
    const { getByText, getByPlaceholderText } = render(
      <ChangePasswordScreen navigation={navigation} />,
    );
    fireEvent.changeText(getByPlaceholderText(/^•/), 'oldpassword');
    fireEvent.changeText(getByPlaceholderText('At least 8 characters'), 'short');
    fireEvent.changeText(getByPlaceholderText('Re-enter new password'), 'short');
    fireEvent.press(getByText('Update Password'));
    expect(getByText('New password must be at least 8 characters.')).toBeTruthy();
  });

  it('rejects mismatched new passwords', () => {
    const { getByText, getByPlaceholderText } = render(
      <ChangePasswordScreen navigation={navigation} />,
    );
    fireEvent.changeText(getByPlaceholderText(/^•/), 'oldpassword');
    fireEvent.changeText(getByPlaceholderText('At least 8 characters'), 'newpassword1');
    fireEvent.changeText(getByPlaceholderText('Re-enter new password'), 'newpassword2');
    fireEvent.press(getByText('Update Password'));
    expect(getByText('New passwords do not match.')).toBeTruthy();
  });

  it('rejects when new password equals current password', () => {
    const { getByText, getByPlaceholderText } = render(
      <ChangePasswordScreen navigation={navigation} />,
    );
    fireEvent.changeText(getByPlaceholderText(/^•/), 'samepassword');
    fireEvent.changeText(getByPlaceholderText('At least 8 characters'), 'samepassword');
    fireEvent.changeText(getByPlaceholderText('Re-enter new password'), 'samepassword');
    fireEvent.press(getByText('Update Password'));
    expect(getByText('New password must be different from current password.')).toBeTruthy();
  });

  it('reauthenticates and updates password on success', async () => {
    (reauthenticateWithCredential as jest.Mock).mockResolvedValue(undefined);
    (updatePassword as jest.Mock).mockResolvedValue(undefined);

    const { getByText, getByPlaceholderText } = render(
      <ChangePasswordScreen navigation={navigation} />,
    );
    fireEvent.changeText(getByPlaceholderText(/^•/), 'oldpassword');
    fireEvent.changeText(getByPlaceholderText('At least 8 characters'), 'newpassword1');
    fireEvent.changeText(getByPlaceholderText('Re-enter new password'), 'newpassword1');
    fireEvent.press(getByText('Update Password'));

    await waitFor(() => {
      expect(EmailAuthProvider.credential).toHaveBeenCalledWith('driver@example.com', 'oldpassword');
      expect(reauthenticateWithCredential).toHaveBeenCalled();
      expect(updatePassword).toHaveBeenCalledWith(expect.anything(), 'newpassword1');
      expect(Alert.alert).toHaveBeenCalledWith(
        'Success',
        'Your password has been updated.',
        expect.any(Array),
      );
    });
  });

  it('shows friendly error when current password is wrong', async () => {
    (reauthenticateWithCredential as jest.Mock).mockRejectedValue({ code: 'auth/wrong-password' });

    const { getByText, getByPlaceholderText, findByText } = render(
      <ChangePasswordScreen navigation={navigation} />,
    );
    fireEvent.changeText(getByPlaceholderText(/^•/), 'wrongpass');
    fireEvent.changeText(getByPlaceholderText('At least 8 characters'), 'newpassword1');
    fireEvent.changeText(getByPlaceholderText('Re-enter new password'), 'newpassword1');
    fireEvent.press(getByText('Update Password'));

    expect(await findByText('Current password is incorrect.')).toBeTruthy();
    expect(updatePassword).not.toHaveBeenCalled();
  });

  it('calls goBack when Cancel pressed', () => {
    const { getByText } = render(<ChangePasswordScreen navigation={navigation} />);
    fireEvent.press(getByText('Cancel'));
    expect(mockGoBack).toHaveBeenCalled();
  });
});

import React from 'react';
import { View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';

type AppleSignInButtonProps = {
  /** 'sign-in' or 'sign-up' — Apple localizes the label itself. */
  variant?: 'sign-in' | 'sign-up';
  onPress: () => void;
  disabled?: boolean;
  className?: string;
  testID?: string;
};

/**
 * Apple's official button (HIG: must be the system control, at least as prominent as other
 * third-party sign-in buttons). Black on our light UI; same 48pt height as the Google button.
 */
export function AppleSignInButton({
  variant = 'sign-in',
  onPress,
  disabled = false,
  className = '',
  testID,
}: AppleSignInButtonProps) {
  return (
    <View className={`w-full ${className}`} style={{ opacity: disabled ? 0.7 : 1 }}>
      <AppleAuthentication.AppleAuthenticationButton
        testID={testID}
        buttonType={
          variant === 'sign-up'
            ? AppleAuthentication.AppleAuthenticationButtonType.SIGN_UP
            : AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN
        }
        buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.BLACK}
        cornerRadius={8}
        onPress={disabled ? () => undefined : onPress}
        style={{ width: '100%', height: 48 }}
      />
    </View>
  );
}

import React from 'react';
import { TouchableOpacity, Text, View, type GestureResponderEvent } from 'react-native';
import { GoogleLogo } from './GoogleLogo';

/** Google Identity light-theme button colors (branding guidelines). */
const GOOGLE_BTN = {
  fill: '#FFFFFF',
  stroke: '#747775',
  text: '#1F1F1F',
} as const;

type GoogleSignInButtonProps = {
  label: string;
  onPress: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  className?: string;
  testID?: string;
};

/**
 * Google-branded auth CTA (light theme): white fill, gray stroke, dark text, color "G".
 * @see https://developers.google.com/identity/branding-guidelines
 */
export function GoogleSignInButton({
  label,
  onPress,
  disabled = false,
  className = '',
  testID,
}: GoogleSignInButtonProps) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      className={`w-full flex-row items-center justify-center py-3 px-4 rounded-lg ${className}`}
      style={{
        opacity: disabled ? 0.7 : 1,
        backgroundColor: GOOGLE_BTN.fill,
        borderWidth: 1,
        borderColor: GOOGLE_BTN.stroke,
      }}
    >
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <GoogleLogo size={20} />
      </View>
      <Text className="ml-3 text-center font-medium text-base" style={{ color: GOOGLE_BTN.text }}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

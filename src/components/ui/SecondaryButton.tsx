import React from 'react';
import { TouchableOpacity, Text, type GestureResponderEvent } from 'react-native';

type SecondaryButtonProps = {
  label: string;
  onPress: (event: GestureResponderEvent) => void;
  disabled?: boolean;
  className?: string;
  testID?: string;
};

export function SecondaryButton({
  label,
  onPress,
  disabled = false,
  className = '',
  testID,
}: SecondaryButtonProps) {
  return (
    <TouchableOpacity
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      className={`w-full items-center justify-center py-3 px-4 rounded-lg border border-line bg-transparent ${className}`}
      style={{ opacity: disabled ? 0.7 : 1 }}
    >
      <Text className="text-herb text-center font-medium text-base">{label}</Text>
    </TouchableOpacity>
  );
}

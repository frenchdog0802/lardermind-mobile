import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { colors } from '../../theme/tokens';

type ErrorBannerProps = {
  message?: string;
  onRetry?: () => void;
  testID?: string;
};

/** Inline "couldn't load" notice with a Retry button. */
export function ErrorBanner({ message, onRetry, testID }: ErrorBannerProps) {
  const { t } = useTranslation();
  return (
    <View
      className="flex-row items-center justify-between bg-surface border border-line rounded-lg px-3 py-2 mb-3"
      testID={testID}
    >
      <Text className="flex-1 text-sm mr-3" style={{ color: colors.danger }}>
        {message ?? t('common.loadError')}
      </Text>
      {onRetry ? (
        <TouchableOpacity
          onPress={onRetry}
          accessibilityRole="button"
          hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          testID={testID ? `${testID}-retry` : undefined}
        >
          <Text className="text-herb font-medium text-sm">{t('common.retry')}</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

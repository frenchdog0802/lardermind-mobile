import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../contexts/authContext';
import { greetingPeriodNow } from '../../utils/chatGreeting';

interface ChatEmptyStateProps {
  /** Override clock for tests */
  now?: Date;
  suggestedPrompts?: string[];
  onSelectPrompt?: (prompt: string) => void;
}

export default function ChatEmptyState({
  now,
  suggestedPrompts = [],
  onSelectPrompt,
}: ChatEmptyStateProps) {
  const { t } = useTranslation();
  const { user } = useAuth();

  const period = greetingPeriodNow(now);
  const greetingKey =
    period === 'morning'
      ? 'ai.greetingMorning'
      : period === 'afternoon'
        ? 'ai.greetingAfternoon'
        : 'ai.greetingEvening';

  const displayName = user?.first_name || user?.name || '';
  const periodGreeting = t(greetingKey);
  const headline = displayName
    ? t('home.welcomeBack', { name: displayName })
    : periodGreeting;

  return (
    <View className="flex-1 items-center justify-center px-8 py-6" testID="chat-empty-state">
      <Text className="font-display text-2xl font-semibold text-ink text-center mb-2">
        {headline}
      </Text>
      {displayName ? (
        <Text className="font-display text-lg text-ink text-center mb-3">{periodGreeting}</Text>
      ) : null}
      <Text className="text-muted text-center text-base mb-6" testID="chat-empty-hint">
        {t('ai.emptyHint')}
      </Text>
      {suggestedPrompts.length > 0 && onSelectPrompt ? (
        <View className="w-full max-w-sm gap-2" testID="chat-empty-suggestions">
          {suggestedPrompts.map((prompt) => (
            <TouchableOpacity
              key={prompt}
              onPress={() => onSelectPrompt(prompt)}
              className="bg-sage px-4 py-3 rounded-full border border-line"
              accessibilityRole="button"
              accessibilityLabel={prompt}
            >
              <Text className="text-herb-deep text-sm text-center" numberOfLines={3}>
                {prompt.length > 80 ? `${prompt.slice(0, 77)}…` : prompt}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

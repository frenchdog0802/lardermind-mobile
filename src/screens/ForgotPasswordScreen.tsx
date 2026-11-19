import React, { useState } from 'react';
import { View, Text, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChefHat } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { auth } from '../api/api-auth';
import { PrimaryButton, TextField } from '../components/ui';
import { colors } from '../theme/tokens';

/** Step 1: ask for the account email; the server always answers with a generic success. */
export default function ForgotPasswordScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [email, setEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const goToConfirm = () =>
    (navigation as unknown as { navigate: (name: string, params?: object) => void }).navigate(
      'ResetPassword',
      { email: email.trim() },
    );

  const handleSubmit = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError(t('auth.enterEmail'));
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const res = await auth.requestPasswordReset(trimmed);
      if (res.success) {
        setSent(true);
      } else if (res.statusCode === 429) {
        setError(t('auth.resetRateLimited'));
      } else {
        setError(t('auth.resetRequestFailed'));
      }
    } catch {
      setError(t('auth.resetRequestFailed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-linen">
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} className="flex-1">
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="w-full max-w-md mx-auto">
            <View className="items-center mb-8">
              <View className="w-12 h-12 rounded-lg bg-herb items-center justify-center mb-4">
                <ChefHat size={24} color={colors.onHerb} />
              </View>
              <Text className="font-display text-3xl font-semibold text-ink text-center">
                {t('auth.forgotPasswordTitle')}
              </Text>
              <Text className="mt-2 text-base text-muted text-center">
                {t('auth.forgotPasswordHint')}
              </Text>
            </View>

            {error ? (
              <View className="bg-sage/60 border border-line px-4 py-3 rounded-lg mb-4">
                <Text className="text-herb-deep text-sm text-center" testID="forgot-error">{error}</Text>
              </View>
            ) : null}

            {sent ? (
              <View className="bg-sage/60 border border-line px-4 py-3 rounded-lg mb-4">
                <Text className="text-herb-deep text-sm text-center" testID="forgot-sent">
                  {t('auth.resetEmailSent')}
                </Text>
              </View>
            ) : null}

            <TextField
              label={t('auth.email')}
              containerClassName="mb-4"
              placeholder="you@example.com"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              editable={!submitting}
              testID="forgot-email"
            />

            <PrimaryButton
              label={sent ? t('auth.resendEmail') : t('auth.sendResetEmail')}
              onPress={handleSubmit}
              loading={submitting}
              disabled={submitting}
              className="mb-4"
              testID="forgot-submit"
            />

            <TouchableOpacity
              onPress={goToConfirm}
              className="py-3 items-center"
              testID="forgot-have-code"
            >
              <Text className="text-herb font-medium">{t('auth.haveResetCode')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => navigation.goBack()}
              className="py-3 items-center"
              testID="forgot-back"
            >
              <Text className="text-muted text-sm">{t('auth.backToSignIn')}</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

import React, { useState } from 'react';
import { View, Text, TouchableOpacity, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChefHat } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import { auth } from '../api/api-auth';
import { PrimaryButton, TextField } from '../components/ui';
import { colors } from '../theme/tokens';
import { extractResetToken, RESET_PASSWORD_MIN, RESET_PASSWORD_MAX } from '../utils/resetToken';

/** Step 2: enter the code/link from the email plus a new password. */
export default function ResetPasswordScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [tokenInput, setTokenInput] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const goToLogin = () => navigation.navigate('Login' as never);

  const handleSubmit = async () => {
    const token = extractResetToken(tokenInput);
    if (!token) {
      setError(t('auth.resetTokenRequired'));
      return;
    }
    if (password.length < RESET_PASSWORD_MIN || password.length > RESET_PASSWORD_MAX) {
      setError(t('auth.resetPasswordLength', { min: RESET_PASSWORD_MIN, max: RESET_PASSWORD_MAX }));
      return;
    }
    if (password !== confirmPassword) {
      setError(t('auth.passwordsMismatch'));
      return;
    }
    setError('');
    setSubmitting(true);
    try {
      const res = await auth.confirmPasswordReset(token, password);
      if (res.success) {
        setDone(true);
      } else if (res.code === 'reset_token_invalid') {
        setError(t('auth.resetTokenInvalid'));
      } else if (res.statusCode === 429) {
        setError(t('auth.resetRateLimited'));
      } else {
        setError(res.message || t('auth.resetFailed'));
      }
    } catch {
      setError(t('auth.resetFailed'));
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
          keyboardDismissMode="interactive"
        >
          <View className="w-full max-w-md mx-auto">
            <View className="items-center mb-8">
              <View className="w-12 h-12 rounded-lg bg-herb items-center justify-center mb-4">
                <ChefHat size={24} color={colors.onHerb} />
              </View>
              <Text className="font-display text-3xl font-semibold text-ink text-center">
                {t('auth.resetPasswordTitle')}
              </Text>
              <Text className="mt-2 text-base text-muted text-center">
                {t('auth.resetPasswordHint')}
              </Text>
            </View>

            {done ? (
              <View>
                <View className="bg-sage/60 border border-line px-4 py-3 rounded-lg mb-6">
                  <Text className="text-herb-deep text-sm text-center" testID="reset-done">
                    {t('auth.resetSuccess')}
                  </Text>
                </View>
                <PrimaryButton
                  label={t('auth.backToSignIn')}
                  onPress={goToLogin}
                  testID="reset-to-login"
                />
              </View>
            ) : (
              <>
                {error ? (
                  <View className="bg-sage/60 border border-line px-4 py-3 rounded-lg mb-4">
                    <Text className="text-herb-deep text-sm text-center" testID="reset-error">{error}</Text>
                  </View>
                ) : null}

                <TextField
                  label={t('auth.resetCode')}
                  containerClassName="mb-4"
                  placeholder={t('auth.resetCodePlaceholder')}
                  value={tokenInput}
                  onChangeText={setTokenInput}
                  autoCapitalize="none"
                  autoCorrect={false}
                  editable={!submitting}
                  testID="reset-token"
                />
                <TextField
                  label={t('auth.newPassword')}
                  containerClassName="mb-4"
                  placeholder="••••••••"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="new-password"
                  editable={!submitting}
                  testID="reset-password"
                />
                <TextField
                  label={t('auth.confirmPassword')}
                  containerClassName="mb-6"
                  placeholder="••••••••"
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  autoComplete="new-password"
                  editable={!submitting}
                  testID="reset-confirm"
                />

                <PrimaryButton
                  label={t('auth.resetPasswordCta')}
                  onPress={handleSubmit}
                  loading={submitting}
                  disabled={submitting}
                  className="mb-4"
                  testID="reset-submit"
                />

                <TouchableOpacity onPress={goToLogin} className="py-3 items-center" testID="reset-back">
                  <Text className="text-muted text-sm">{t('auth.backToSignIn')}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

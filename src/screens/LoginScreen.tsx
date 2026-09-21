import React, { useState } from 'react';
import { View, Text, TouchableOpacity, KeyboardAvoidingView, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChefHat } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../contexts/authContext';
import { useNavigation } from '@react-navigation/native';
import { PrimaryButton, GoogleSignInButton, TextField } from '../components/ui';
import { colors } from '../theme/tokens';

interface LoginProps {
  onLoginSuccess?: () => void;
  onSignUp?: () => void;
}

export default function LoginScreen({ onLoginSuccess, onSignUp }: LoginProps = {}) {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(false);
  const [error, setError] = useState('');

  const { login, loginWithGoogle, submitting } = useAuth();
  const showGoogle = Platform.OS === 'android';

  const handleSubmit = async () => {
    if (!email || !password) {
      setError(t('auth.enterEmailPassword'));
      return;
    }
    setError('');
    try {
      const success = await login(email, password);
      if (success.success) {
        onLoginSuccess?.();
      } else {
        setError(success.message || t('auth.invalidCredentials'));
      }
    } catch {
      setError(t('auth.genericError'));
    }
  };

  const handleGoogle = async () => {
    setError('');
    try {
      const result = await loginWithGoogle();
      if (result.success) {
        onLoginSuccess?.();
        return;
      }
      if (result.message === 'cancelled') {
        setError(t('auth.googleCancelled'));
      } else {
        setError(result.message || t('auth.googleRetry'));
      }
    } catch {
      setError(t('auth.googleRetry'));
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-linen">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
        <View className="flex-1 justify-center px-6">
          <View className="w-full max-w-md mx-auto">
            <View className="items-center mb-10">
              <View className="w-12 h-12 rounded-lg bg-herb items-center justify-center mb-4">
                <ChefHat size={24} color={colors.onHerb} />
              </View>
              <Text className="font-display text-4xl font-semibold text-ink">LarderMind</Text>
              <Text className="mt-2 text-base text-muted">{t('auth.signInTitle')}</Text>
            </View>

            {error ? (
              <View className="bg-sage/60 border border-line px-4 py-3 rounded-lg mb-4">
                <Text className="text-herb-deep text-sm text-center">{error}</Text>
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
              testID="login-email"
            />

            <TextField
              label={t('auth.password')}
              containerClassName="mb-4"
              placeholder="••••••••"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="password"
              editable={!submitting}
              testID="login-password"
            />

            <View className="flex-row justify-between items-center mb-6">
              <TouchableOpacity
                onPress={() => setRememberMe(!rememberMe)}
                className="flex-row items-center"
                disabled={submitting}
              >
                <View
                  className={`w-5 h-5 border-2 rounded border-line mr-3 items-center justify-center ${
                    rememberMe ? 'bg-herb border-herb' : 'bg-surface'
                  }`}
                >
                  {rememberMe ? (
                    <Text className="text-white text-center text-xs font-bold">✓</Text>
                  ) : null}
                </View>
                <Text className="text-sm text-ink">{t('auth.rememberMe')}</Text>
              </TouchableOpacity>
            </View>

            <PrimaryButton
              label={t('auth.signIn')}
              onPress={handleSubmit}
              loading={submitting}
              disabled={submitting}
              className="mb-6"
              testID="login-submit"
            />

            {showGoogle ? (
              <>
                <View className="flex-row items-center mb-6">
                  <View className="flex-1 h-px bg-line" />
                  <Text className="mx-3 text-sm text-muted">{t('common.or')}</Text>
                  <View className="flex-1 h-px bg-line" />
                </View>
                <GoogleSignInButton
                  label={t('auth.signInGoogle')}
                  onPress={handleGoogle}
                  disabled={submitting}
                  className="mb-6"
                  testID="login-google"
                />
              </>
            ) : null}

            <View className="items-center">
              <Text className="text-sm text-muted">
                {t('auth.noAccount')}{' '}
                <Text
                  onPress={() =>
                    onSignUp ? onSignUp() : navigation.navigate('SignUp' as never)
                  }
                  className="text-herb font-medium"
                >
                  {t('auth.signUp')}
                </Text>
              </Text>
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, ScrollView, TextInput, Alert, ActivityIndicator } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Languages } from 'lucide-react-native';
import { useAuth } from '../contexts/authContext';
import { usePantry } from '../contexts/pantryContext';
import { useNavigation } from '@react-navigation/native';
import { UserIcon, SettingsIcon, SaveIcon, CheckIcon } from 'lucide-react-native';
import AppHeader from '../components/AppHeader';
import { userPreferencesApi } from '../api/userPreferences';
import { colors } from '../theme/tokens';
import i18n, { AppLanguage, persistLanguage } from '../i18n';

export default function SettingsScreen() {
  const { t } = useTranslation();
  const { logout, deleteAccount, user, isGuest } = useAuth();
  const { userSettings, updateUserSettings } = usePantry();
  const navigation = useNavigation();

  const [activeTab, setActiveTab] = useState('profile');
  const [units, setUnits] = useState(
    userSettings.measurement_unit === 'imperial' ? 'imperial' : 'metric',
  );
  const [assumeBasicSeasonings, setAssumeBasicSeasonings] = useState(true);
  const [language, setLanguage] = useState<AppLanguage>(
    i18n.language?.startsWith('zh') ? 'zh' : 'en',
  );
  const [name, setName] = useState(user?.name || '');
  const [email, setEmail] = useState(user?.email || '');
  const [showSaveMessage, setShowSaveMessage] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const prefs = await userPreferencesApi.get();
        if (!cancelled && prefs) {
          if (prefs.measurementUnit) {
            setUnits(prefs.measurementUnit);
            updateUserSettings({
              ...userSettings,
              measurement_unit: prefs.measurementUnit,
            });
          }
          setAssumeBasicSeasonings(prefs.assumeBasicSeasonings !== false);
        }
      } catch {
        // ignore load errors on settings open
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleLogout = async () => {
    await logout();
  };

  const runDeleteAccount = async () => {
    setDeleteError('');
    setDeleting(true);
    try {
      const result = await deleteAccount();
      if (!result.success) {
        setDeleteError(result.message || t('settings.deleteAccountError'));
        setDeleting(false);
      }
      // On success the session is cleared and navigation returns to the auth screen.
    } catch {
      setDeleteError(t('settings.deleteAccountError'));
      setDeleting(false);
    }
  };

  const handleDeleteAccount = () => {
    if (deleting) return;
    Alert.alert(
      t('settings.deleteAccountConfirmTitle'),
      isGuest ? t('settings.deleteAccountConfirmGuest') : t('settings.deleteAccountConfirmMessage'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('settings.deleteAccountConfirmAction'),
          style: 'destructive',
          onPress: () => void runDeleteAccount(),
        },
      ],
    );
  };

  const applyLanguage = async (lng: AppLanguage) => {
    setLanguage(lng);
    await persistLanguage(lng);
    await i18n.changeLanguage(lng);
    updateUserSettings({
      ...userSettings,
      language: lng,
    });
  };

  const handleSave = async () => {
    setErrorMessage('');
    try {
      const measurementUnit = units === 'imperial' ? 'imperial' : 'metric';
      const saved = await userPreferencesApi.update({
        measurementUnit,
        assumeBasicSeasonings,
      });
      if (!saved) {
        setErrorMessage(t('settings.savePrefsError'));
        return;
      }
      updateUserSettings({
        ...userSettings,
        measurement_unit: saved.measurementUnit,
      });
      setAssumeBasicSeasonings(saved.assumeBasicSeasonings !== false);
      setShowSaveMessage(true);
      setTimeout(() => {
        setShowSaveMessage(false);
      }, 3000);
    } catch {
      setErrorMessage(t('settings.savePrefsError'));
    }
  };

  const RadioButton = ({
    selected,
    onPress,
    label,
  }: {
    selected: boolean;
    onPress: () => void;
    label: string;
  }) => (
    <TouchableOpacity onPress={onPress} className="flex-row items-center py-2">
      <View
        className={`w-5 h-5 rounded-full border-2 mr-3 items-center justify-center ${
          selected ? 'border-herb' : 'border-line'
        }`}
      >
        {selected ? <View className="w-2.5 h-2.5 rounded-full bg-herb" /> : null}
      </View>
      <Text className="text-ink">{label}</Text>
    </TouchableOpacity>
  );

  return (
    <View className="flex-1 bg-linen">
            <AppHeader title={t('settings.title')} showMenuButton />
      <ScrollView
        className="flex-1"
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="interactive"
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={{ paddingBottom: 32 }}
      >
        <View className="p-4">
          <View className="bg-surface rounded-xl overflow-hidden border border-line">
            <View className="flex-row border-b border-line">
              <TouchableOpacity
                className={`flex-1 flex-row items-center justify-center py-4 ${
                  activeTab === 'profile' ? 'border-b-2 border-herb' : ''
                }`}
                onPress={() => setActiveTab('profile')}
              >
                <UserIcon
                  size={16}
                  color={activeTab === 'profile' ? colors.herb : colors.muted}
                />
                <Text
                  className={`ml-1 text-sm font-medium ${
                    activeTab === 'profile' ? 'text-herb' : 'text-muted'
                  }`}
                >
                  {t('settings.profile')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                className={`flex-1 flex-row items-center justify-center py-4 ${
                  activeTab === 'preferences' ? 'border-b-2 border-herb' : ''
                }`}
                onPress={() => setActiveTab('preferences')}
              >
                <SettingsIcon
                  size={16}
                  color={activeTab === 'preferences' ? colors.herb : colors.muted}
                />
                <Text
                  className={`ml-1 text-sm font-medium ${
                    activeTab === 'preferences' ? 'text-herb' : 'text-muted'
                  }`}
                >
                  {t('settings.preferences')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                className={`flex-1 flex-row items-center justify-center py-4 ${
                  activeTab === 'language' ? 'border-b-2 border-herb' : ''
                }`}
                onPress={() => setActiveTab('language')}
              >
                <Languages
                  size={16}
                  color={activeTab === 'language' ? colors.herb : colors.muted}
                />
                <Text
                  className={`ml-1 text-sm font-medium ${
                    activeTab === 'language' ? 'text-herb' : 'text-muted'
                  }`}
                >
                  {t('settings.language')}
                </Text>
              </TouchableOpacity>
            </View>

            <View className="p-4">
              {activeTab === 'profile' && (
                <View>
                  <Text className="text-lg font-semibold text-ink mb-4">
                    {t('settings.profileInfo')}
                  </Text>
                  <View className="mb-4">
                    <Text className="text-sm font-medium text-ink mb-1">{t('settings.name')}</Text>
                    <TextInput
                      value={name}
                      onChangeText={setName}
                      className="w-full px-4 py-3 border border-line rounded-lg bg-linen text-ink"
                      placeholder={t('settings.name')}
                    />
                  </View>
                  <View className="mb-4">
                    <Text className="text-sm font-medium text-ink mb-1">{t('settings.email')}</Text>
                    <TextInput
                      value={email}
                      onChangeText={setEmail}
                      keyboardType="email-address"
                      autoCapitalize="none"
                      className="w-full px-4 py-3 border border-line rounded-lg bg-linen text-ink"
                      placeholder={t('auth.email')}
                    />
                  </View>
                  <TouchableOpacity
                    onPress={handleSave}
                    className="bg-herb py-3 px-4 rounded-lg flex-row items-center justify-center"
                  >
                    <SaveIcon size={18} color={colors.onHerb} />
                    <Text className="text-white font-medium ml-2">{t('common.save')}</Text>
                  </TouchableOpacity>
                </View>
              )}

              {activeTab === 'preferences' && (
                <View>
                  <Text className="text-lg font-semibold text-ink mb-4">
                    {t('settings.measurementUnits')}
                  </Text>
                  <View className="space-y-2">
                    <RadioButton
                      selected={units === 'imperial'}
                      onPress={() => setUnits('imperial')}
                      label={t('settings.imperial')}
                    />
                    <RadioButton
                      selected={units === 'metric'}
                      onPress={() => setUnits('metric')}
                      label={t('settings.metric')}
                    />
                  </View>
                  <Text className="text-lg font-semibold text-ink mb-2 mt-6">
                    {t('settings.assumeBasicSeasonings')}
                  </Text>
                  <Text className="text-sm text-muted mb-3">
                    {t('settings.assumeBasicSeasoningsHint')}
                  </Text>
                  <View className="flex-row gap-2 mb-2">
                    <TouchableOpacity
                      onPress={() => setAssumeBasicSeasonings(true)}
                      className={`flex-1 py-3 rounded-lg border ${
                        assumeBasicSeasonings
                          ? 'bg-sage border-herb'
                          : 'bg-linen border-line'
                      }`}
                    >
                      <Text className="text-center text-ink font-medium">
                        {t('settings.on')}
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => setAssumeBasicSeasonings(false)}
                      className={`flex-1 py-3 rounded-lg border ${
                        !assumeBasicSeasonings
                          ? 'bg-sage border-herb'
                          : 'bg-linen border-line'
                      }`}
                    >
                      <Text className="text-center text-ink font-medium">
                        {t('settings.off')}
                      </Text>
                    </TouchableOpacity>
                  </View>
                  <TouchableOpacity
                    onPress={handleSave}
                    className="bg-herb py-3 px-4 rounded-lg flex-row items-center justify-center mt-4"
                  >
                    <SaveIcon size={18} color={colors.onHerb} />
                    <Text className="text-white font-medium ml-2">{t('common.save')}</Text>
                  </TouchableOpacity>
                  {errorMessage ? (
                    <Text className="text-sm mt-2" style={{ color: colors.danger }}>
                      {errorMessage}
                    </Text>
                  ) : null}
                </View>
              )}

              {activeTab === 'language' && (
                <View>
                  <Text className="text-lg font-semibold text-ink mb-2">
                    {t('settings.language')}
                  </Text>
                  <Text className="text-sm text-muted mb-4">{t('settings.languageHint')}</Text>
                  <View className="space-y-2">
                    <RadioButton
                      selected={language === 'en'}
                      onPress={() => void applyLanguage('en')}
                      label={t('settings.langEn')}
                    />
                    <RadioButton
                      selected={language === 'zh'}
                      onPress={() => void applyLanguage('zh')}
                      label={t('settings.langZh')}
                    />
                  </View>
                </View>
              )}
            </View>
          </View>

          <TouchableOpacity
            onPress={() => navigation.navigate('Subscription' as never)}
            className="bg-surface border border-line py-4 rounded-lg mt-4"
          >
            <Text className="text-herb text-center font-medium">Upgrade</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={handleLogout}
            className="bg-linen border border-line py-4 rounded-lg mt-4"
          >
            <Text className="text-ink text-center font-medium">{t('settings.signOut')}</Text>
          </TouchableOpacity>

          <View className="mt-8 border border-line rounded-xl bg-surface p-4" testID="delete-account-section">
            <Text className="text-lg font-semibold text-ink mb-1">
              {t('settings.deleteAccount')}
            </Text>
            <Text className="text-sm text-muted mb-4">
              {isGuest ? t('settings.deleteAccountHintGuest') : t('settings.deleteAccountHint')}
            </Text>
            {deleteError ? (
              <Text className="text-sm mb-3" style={{ color: colors.danger }} testID="delete-account-error">
                {deleteError}
              </Text>
            ) : null}
            <TouchableOpacity
              onPress={handleDeleteAccount}
              disabled={deleting}
              accessibilityRole="button"
              className="py-3 rounded-lg items-center flex-row justify-center"
              style={{ borderWidth: 1, borderColor: colors.danger, opacity: deleting ? 0.6 : 1 }}
              testID="delete-account-button"
            >
              {deleting ? <ActivityIndicator size="small" color={colors.danger} /> : null}
              <Text
                className={`font-medium ${deleting ? 'ml-2' : ''}`}
                style={{ color: colors.danger }}
              >
                {deleting ? t('settings.deleting') : t('settings.deleteAccount')}
              </Text>
            </TouchableOpacity>
          </View>

          {showSaveMessage ? (
            <View className="absolute bottom-4 left-4 right-4 bg-sage border border-line p-4 rounded-lg flex-row items-center">
              <CheckIcon size={20} color={colors.herbDeep} />
              <Text className="text-herb-deep ml-2">{t('common.savedSuccess')}</Text>
            </View>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

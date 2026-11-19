import React from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowLeft, Menu } from 'lucide-react-native';
import { DrawerActions, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { colors } from '../theme/tokens';

interface AppHeaderProps {
  title: string;
  showBackButton?: boolean;
  showMenuButton?: boolean;
  onBack?: () => void;
  rightElement?: React.ReactNode;
  onRightPress?: () => void;
  /** @deprecated Prefer quiet linen chrome; kept for call-site compatibility */
  variant?: 'quiet' | 'surface' | 'primary' | 'white';
  onLayoutHeight?: (height: number) => void;
}

export default function AppHeader({
  title,
  showBackButton = false,
  showMenuButton = false,
  onBack,
  rightElement,
  onRightPress,
  variant = 'quiet',
  onLayoutHeight,
}: AppHeaderProps) {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();

  const handleBack = () => {
    if (onBack) {
      onBack();
    } else {
      navigation.goBack();
    }
  };

  const handleMenu = () => {
    navigation.dispatch(DrawerActions.openDrawer());
  };

  const bgClass = variant === 'surface' ? 'bg-surface' : 'bg-linen';

  return (
    <View
      className={bgClass}
      style={{
        paddingTop: insets.top + 12,
      }}
      onLayout={(e) => onLayoutHeight?.(e.nativeEvent.layout.height)}
    >
      <View className="flex-row items-center justify-between px-4 pb-3 border-b border-line">
        {showMenuButton ? (
          <TouchableOpacity hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={handleMenu}
            testID="header-menu"
            accessibilityRole="button"
            accessibilityLabel={t('nav.openMenu')}
            className="w-10 h-10 items-center justify-center rounded-full"
            activeOpacity={0.7}
          >
            <Menu size={24} color={colors.ink} />
          </TouchableOpacity>
        ) : showBackButton ? (
          <TouchableOpacity hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            onPress={handleBack}
            className="w-10 h-10 items-center justify-center rounded-full"
            activeOpacity={0.7}
          >
            <ArrowLeft size={24} color={colors.ink} />
          </TouchableOpacity>
        ) : (
          <View className="w-10" />
        )}

        <Text
          className="font-display text-xl font-semibold text-ink flex-1 text-center"
          numberOfLines={1}
        >
          {title}
        </Text>

        {rightElement ? (
          <TouchableOpacity
            onPress={onRightPress}
            className="w-10 h-10 items-center justify-center rounded-full"
            activeOpacity={0.7}
          >
            {rightElement}
          </TouchableOpacity>
        ) : (
          <View className="w-10" />
        )}
      </View>
    </View>
  );
}

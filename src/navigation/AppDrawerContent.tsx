import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  DeviceEventEmitter,
} from 'react-native';
import {
  DrawerContentScrollView,
  useDrawerStatus,
  type DrawerContentComponentProps,
} from '@react-navigation/drawer';
import { useTranslation } from 'react-i18next';
import {
  MessageSquare,
  Calendar as CalendarIcon,
  Package,
  ShoppingCart,
  Utensils,
  Settings,
  CreditCard,
  Plus,
} from 'lucide-react-native';
import { chatApi, type ChatSession } from '../api/chat';
import { colors } from '../theme/tokens';

type PrimaryRoute =
  | 'Chat'
  | 'Calendar'
  | 'Inventory'
  | 'Shopping'
  | 'Recipes';

const PRIMARY: Array<{
  route: PrimaryRoute;
  icon: typeof MessageSquare;
  labelKey: string;
  testID: string;
}> = [
  { route: 'Chat', icon: MessageSquare, labelKey: 'nav.aiChat', testID: 'drawer-chat' },
  { route: 'Calendar', icon: CalendarIcon, labelKey: 'nav.calendar', testID: 'drawer-calendar' },
  { route: 'Inventory', icon: Package, labelKey: 'nav.inventory', testID: 'drawer-inventory' },
  { route: 'Shopping', icon: ShoppingCart, labelKey: 'nav.shopping', testID: 'drawer-shopping' },
  { route: 'Recipes', icon: Utensils, labelKey: 'nav.recipes', testID: 'drawer-recipes' },
];

export default function AppDrawerContent(props: DrawerContentComponentProps) {
  const { t } = useTranslation();
  const { navigation, state } = props;
  const activeRoute = state.routeNames[state.index] ?? 'Chat';
  const drawerStatus = useDrawerStatus();

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const [sessionsError, setSessionsError] = useState(false);

  const refreshSessions = useCallback(async () => {
    setLoadingSessions(true);
    setSessionsError(false);
    try {
      const res = await chatApi.listSessions();
      const list = res.data?.sessions ?? [];
      const sorted = [...list].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      setSessions(sorted);
    } catch {
      setSessions([]);
      setSessionsError(true);
    } finally {
      setLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    if (drawerStatus === 'open') {
      void refreshSessions();
    }
  }, [drawerStatus, refreshSessions]);

  useEffect(() => {
    const sub = DeviceEventEmitter.addListener(
      'lardermind:chat-session-title',
      (payload: { sessionId?: string; title?: string }) => {
        const sessionId = payload?.sessionId?.trim();
        const title = payload?.title?.trim();
        if (!sessionId || !title) return;
        setSessions((prev) => {
          const idx = prev.findIndex((s) => s.id === sessionId);
          if (idx === -1) {
            return [
              {
                id: sessionId,
                title,
                isDefault: false,
                updatedAt: Math.floor(Date.now() / 1000),
                createdAt: Math.floor(Date.now() / 1000),
              },
              ...prev,
            ];
          }
          return prev.map((s) => (s.id === sessionId ? { ...s, title } : s));
        });
      },
    );
    return () => sub.remove();
  }, []);

  const go = (route: string, params?: object) => {
    // Drawer screens are registered dynamically; keep navigate loosely typed.
    (navigation.navigate as (name: string, params?: object) => void)(route, params);
    navigation.closeDrawer();
  };

  return (
    <View className="flex-1 bg-linen">
      <DrawerContentScrollView
        {...props}
        contentContainerStyle={{ paddingTop: 8, paddingBottom: 16 }}
      >
        <Text className="font-display text-2xl font-semibold text-ink px-4 mb-4">
          LarderMind
        </Text>

        {PRIMARY.map(({ route, icon: Icon, labelKey, testID }) => {
          const active = activeRoute === route;
          return (
            <TouchableOpacity
              key={route}
              testID={testID}
              accessibilityRole="button"
              accessibilityLabel={t(labelKey)}
              onPress={() => go(route)}
              className={`flex-row items-center mx-2 mb-1 px-3 py-3 rounded-xl ${
                active ? 'bg-sage' : ''
              }`}
            >
              <Icon size={20} color={active ? colors.herb : colors.ink} />
              <Text
                className={`ml-3 text-base ${active ? 'text-herb-deep font-semibold' : 'text-ink'}`}
              >
                {t(labelKey)}
              </Text>
            </TouchableOpacity>
          );
        })}

        <Text className="text-xs uppercase tracking-wide text-muted px-4 mt-6 mb-2">
          {t('nav.recents')}
        </Text>

        {loadingSessions ? (
          <View className="py-4 items-center">
            <ActivityIndicator size="small" color={colors.herb} />
          </View>
        ) : sessionsError ? (
          <Text className="text-sm text-muted px-4 py-2">{t('nav.recentsLoadError')}</Text>
        ) : sessions.length === 0 ? (
          <Text className="text-sm text-muted px-4 py-2">{t('nav.recentsEmpty')}</Text>
        ) : (
          sessions.map((session) => (
            <TouchableOpacity
              key={session.id}
              testID={`drawer-recent-${session.id}`}
              accessibilityRole="button"
              onPress={() => go('Chat', { sessionId: session.id })}
              className="flex-row items-center mx-2 mb-0.5 px-3 py-2.5 rounded-lg"
            >
              <View className="w-1.5 h-1.5 rounded-full bg-muted mr-3" />
              <Text className="text-ink text-sm flex-1" numberOfLines={1}>
                {session.title?.trim() || t('nav.aiChat')}
              </Text>
            </TouchableOpacity>
          ))
        )}
      </DrawerContentScrollView>

      <View className="border-t border-line px-3 pt-3 pb-4 bg-linen">
        <TouchableOpacity
          testID="drawer-new-chat"
          accessibilityRole="button"
          accessibilityLabel={t('nav.newChat')}
          onPress={() => go('Chat', { newChat: true })}
          className="flex-row items-center justify-center bg-herb py-3 rounded-full mb-3"
        >
          <Plus size={18} color={colors.onHerb} />
          <Text className="ml-2 text-base font-semibold text-white">{t('nav.newChat')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="drawer-settings"
          accessibilityRole="button"
          onPress={() => go('Settings')}
          className={`flex-row items-center px-3 py-3 rounded-xl mb-1 ${
            activeRoute === 'Settings' ? 'bg-sage' : ''
          }`}
        >
          <Settings size={20} color={colors.ink} />
          <Text className="ml-3 text-base text-ink">{t('nav.settings')}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          testID="drawer-subscription"
          accessibilityRole="button"
          onPress={() => go('Subscription')}
          className={`flex-row items-center px-3 py-3 rounded-xl ${
            activeRoute === 'Subscription' ? 'bg-sage' : ''
          }`}
        >
          <CreditCard size={20} color={colors.ink} />
          <Text className="ml-3 text-base text-ink">{t('nav.subscription')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

import './global.css';
import './src/i18n';
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { createDrawerNavigator } from '@react-navigation/drawer';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { useTranslation } from 'react-i18next';
import {
  Fraunces_400Regular,
  Fraunces_500Medium,
  Fraunces_600SemiBold,
  Fraunces_700Bold,
} from '@expo-google-fonts/fraunces';
import {
  SourceSans3_300Light,
  SourceSans3_400Regular,
  SourceSans3_500Medium,
  SourceSans3_600SemiBold,
  SourceSans3_700Bold,
} from '@expo-google-fonts/source-sans-3';

import LoadingScreen from './src/screens/LoadingScreen';
import LoginScreen from './src/screens/LoginScreen';
import SignUpScreen from './src/screens/SignUpScreen';
import AppDrawerContent from './src/navigation/AppDrawerContent';
import { colors } from './src/theme/tokens';

import { AuthProvider, useAuth } from './src/contexts/authContext';
import { PantryProvider } from './src/contexts/pantryContext';
import { initI18n } from './src/i18n';

const Stack = createStackNavigator();
const Drawer = createDrawerNavigator();

function AuthCheck({ children }: { children: React.ReactNode }) {
  const { initializing } = useAuth();

  if (initializing) {
    return <LoadingScreen fullScreen />;
  }

  return <>{children}</>;
}

function RootNavigator() {
  const { isAuthenticated } = useAuth();

  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {isAuthenticated ? (
        <Stack.Screen name="Main" component={MainDrawer} />
      ) : (
        <Stack.Screen name="Auth" component={AuthStack} />
      )}
    </Stack.Navigator>
  );
}

function AuthStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="SignUp" component={SignUpScreen} />
    </Stack.Navigator>
  );
}

function MainDrawer() {
  const { t } = useTranslation();

  return (
    <Drawer.Navigator
      initialRouteName="Chat"
      drawerContent={(props) => <AppDrawerContent {...props} />}
      screenOptions={{
        headerShown: false,
        lazy: true,
        drawerType: 'front',
        swipeEdgeWidth: 28,
        overlayColor: 'rgba(31, 36, 32, 0.35)',
        drawerStyle: {
          backgroundColor: colors.linen,
          width: 304,
        },
      }}
    >
      <Drawer.Screen
        name="Chat"
        getComponent={() => require('./src/screens/AICookingAssistantScreen').default}
        options={{ title: t('ai.title'), drawerItemStyle: { display: 'none' } }}
      />
      <Drawer.Screen
        name="Calendar"
        getComponent={() => require('./src/screens/CalendarScreen').default}
        options={{ title: t('nav.calendar'), drawerItemStyle: { display: 'none' } }}
      />
      <Drawer.Screen
        name="Inventory"
        getComponent={() => require('./src/screens/PantryInventoryScreen').default}
        options={{ title: t('nav.inventory'), drawerItemStyle: { display: 'none' } }}
      />
      <Drawer.Screen
        name="Shopping"
        getComponent={() => require('./src/screens/ShoppingListScreen').default}
        options={{ title: t('nav.shopping'), drawerItemStyle: { display: 'none' } }}
      />
      <Drawer.Screen
        name="Recipes"
        getComponent={() => require('./src/screens/RecipeManagerScreen').default}
        options={{ title: t('nav.recipes'), drawerItemStyle: { display: 'none' } }}
      />
      <Drawer.Screen
        name="Settings"
        getComponent={() => require('./src/screens/SettingsScreen').default}
        options={{ title: t('nav.settings'), drawerItemStyle: { display: 'none' } }}
      />
      <Drawer.Screen
        name="Subscription"
        getComponent={() => require('./src/screens/SubscriptionScreen').default}
        options={{ title: t('nav.subscription'), drawerItemStyle: { display: 'none' } }}
      />
      <Drawer.Screen
        name="PantryImageReview"
        getComponent={() => require('./src/screens/PantryImageReviewScreen').default}
        options={{ title: t('pantryVision.reviewTitle'), drawerItemStyle: { display: 'none' } }}
      />
    </Drawer.Navigator>
  );
}

function App() {
  const [i18nReady, setI18nReady] = useState(false);
  const [fontsLoaded, fontError] = useFonts({
    Fraunces_400Regular,
    Fraunces_500Medium,
    Fraunces_600SemiBold,
    Fraunces_700Bold,
    SourceSans3_300Light,
    SourceSans3_400Regular,
    SourceSans3_500Medium,
    SourceSans3_600SemiBold,
    SourceSans3_700Bold,
  });

  useEffect(() => {
    void initI18n().finally(() => setI18nReady(true));
  }, []);

  if ((!fontsLoaded && !fontError) || !i18nReady) {
    return (
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <LoadingScreen fullScreen />
        </SafeAreaProvider>
      </GestureHandlerRootView>
    );
  }

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <PantryProvider>
            <NavigationContainer>
              <StatusBar style="dark" />
              <AuthCheck>
                <RootNavigator />
              </AuthCheck>
            </NavigationContainer>
          </PantryProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

export default App;

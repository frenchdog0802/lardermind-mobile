/**
 * Jest Global Setup
 */

jest.setTimeout(15000);

global.__reanimatedWorkletInit = jest.fn();

jest.mock('@react-native-community/netinfo', () => ({
    __esModule: true,
    default: {
        fetch: jest.fn(() =>
            Promise.resolve({
                isConnected: true,
                isInternetReachable: true,
                type: 'wifi',
            }),
        ),
        addEventListener: jest.fn(() => jest.fn()),
    },
}));

jest.mock('@react-native-async-storage/async-storage', () =>
    require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('expo-secure-store', () => {
    const store = new Map();
    return {
        __esModule: true,
        __store: store,
        setItemAsync: jest.fn(async (key, value) => {
            store.set(key, value);
        }),
        getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
        deleteItemAsync: jest.fn(async (key) => {
            store.delete(key);
        }),
    };
});

jest.mock('expo-secure-store', () => {
    const store = new Map();
    return {
        __esModule: true,
        setItemAsync: jest.fn(async (key, value) => {
            store.set(key, value);
        }),
        getItemAsync: jest.fn(async (key) => (store.has(key) ? store.get(key) : null)),
        deleteItemAsync: jest.fn(async (key) => {
            store.delete(key);
        }),
        __reset: () => store.clear(),
    };
});

jest.mock('react-native-worklets', () => ({
    __esModule: true,
    default: {},
    createSerializable: (v) => v,
    createWorkletRuntime: () => ({}),
    runOnUI: (fn) => fn,
    runOnJS: (fn) => fn,
}));

jest.mock('react-native-reanimated', () => {
    const React = require('react');
    const { View } = require('react-native');
    return {
        __esModule: true,
        default: {
            View,
            createAnimatedComponent: (Component) => Component,
            call: () => {},
        },
        View,
        createAnimatedComponent: (Component) => Component,
        useSharedValue: (init) => ({ value: init }),
        useAnimatedStyle: () => ({}),
        withTiming: (v) => v,
        withRepeat: (v) => v,
        Easing: { inOut: () => ({}), out: () => ({}), ease: {}, quad: {} },
        FadeIn: {},
        FadeOut: {},
    };
});

jest.mock('@shopify/flash-list', () => {
    const React = require('react');
    const { FlatList } = require('react-native');
    return {
        FlashList: React.forwardRef((props, ref) =>
            React.createElement(FlatList, { ...props, ref }),
        ),
    };
});

jest.mock('expo-image', () => {
    const React = require('react');
    const { Image } = require('react-native');
    return {
        Image: (props) => React.createElement(Image, props),
    };
});

jest.mock('react-native-gesture-handler', () => {
    const React = require('react');
    const { View, TouchableOpacity } = require('react-native');
    return {
        GestureHandlerRootView: ({ children }) => React.createElement(View, null, children),
        Pressable: TouchableOpacity,
        TouchableOpacity,
        ScrollView: require('react-native').ScrollView,
        Swipeable: View,
        DrawerLayout: View,
        State: {},
        Directions: {},
    };
});

jest.mock('react-native-safe-area-context', () => ({
    SafeAreaProvider: ({ children }) => children,
    SafeAreaView: ({ children }) => children,
    useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

jest.mock('@react-navigation/native', () => ({
    useNavigation: () => ({ navigate: jest.fn(), goBack: jest.fn(), reset: jest.fn() }),
    useRoute: () => ({ params: {} }),
    useFocusEffect: jest.fn(),
    useIsFocused: () => true,
}));

jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));

jest.mock('@react-native-google-signin/google-signin', () => ({
    GoogleSignin: {
        configure: jest.fn(),
        hasPlayServices: jest.fn(async () => true),
        signIn: jest.fn(async () => ({ type: 'cancelled', data: null })),
        signOut: jest.fn(async () => null),
    },
    statusCodes: {
        SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED',
        IN_PROGRESS: 'IN_PROGRESS',
        PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE',
    },
    isSuccessResponse: (r) => r?.type === 'success',
    isCancelledResponse: (r) => r?.type === 'cancelled',
    isErrorWithCode: (e) => Boolean(e && typeof e === 'object' && 'code' in e),
}));

jest.mock('react-i18next', () => ({
    useTranslation: () => ({
        t: (key, opts) => {
            const map = {
                'common.loading': 'Loading...',
                'common.or': 'or',
                'auth.signInTitle': 'Sign in with email',
                'auth.signUpTitle': 'Create your account with email',
                'auth.signIn': 'Sign in',
                'auth.signUp': 'Sign up',
                'auth.signInGoogle': 'Sign in with Google',
                'auth.signUpGoogle': 'Sign up with Google',
                'auth.logIn': 'Log in',
                'auth.email': 'Email',
                'auth.password': 'Password',
                'auth.firstName': 'First Name',
                'auth.lastName': 'Last Name',
                'auth.confirmPassword': 'Confirm Password',
                'auth.enterEmailPassword': 'Please enter email and password',
                'auth.passwordsMismatch': 'Passwords do not match',
                'auth.noAccount': "Don't have an account?",
                'auth.haveAccount': 'Already have an account?',
                'auth.rememberMe': 'Remember me',
                'auth.googleCancelled': 'Google login was cancelled or failed.',
                'auth.googleRetry': 'Google login failed. Please try again.',
                'auth.googleSignUpCancelled': 'Google sign up was cancelled or failed.',
                'auth.googleSignUpRetry': 'Google sign up failed. Please try again.',
                'nav.home': 'Home',
                'nav.calendar': 'Calendar',
                'nav.pantry': 'Pantry',
                'nav.shopping': 'Shopping',
                'nav.recipes': 'Recipes',
                'nav.settings': 'Settings',
                'settings.title': 'Settings',
            };
            if (typeof opts === 'object' && opts?.defaultValue) return map[key] || opts.defaultValue;
            return map[key] || key;
        },
        i18n: { language: 'en', changeLanguage: jest.fn() },
    }),
    initReactI18next: { type: '3rdParty', init: jest.fn() },
}));


jest.mock('expo-font', () => ({
    useFonts: () => [true, null],
    loadAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock('@expo-google-fonts/fraunces', () => ({
    useFonts: () => [true, null],
    Fraunces_400Regular: 'Fraunces_400Regular',
    Fraunces_500Medium: 'Fraunces_500Medium',
    Fraunces_600SemiBold: 'Fraunces_600SemiBold',
    Fraunces_700Bold: 'Fraunces_700Bold',
}));

jest.mock('@expo-google-fonts/source-sans-3', () => ({
    useFonts: () => [true, null],
    SourceSans3_300Light: 'SourceSans3_300Light',
    SourceSans3_400Regular: 'SourceSans3_400Regular',
    SourceSans3_500Medium: 'SourceSans3_500Medium',
    SourceSans3_600SemiBold: 'SourceSans3_600SemiBold',
    SourceSans3_700Bold: 'SourceSans3_700Bold',
}));

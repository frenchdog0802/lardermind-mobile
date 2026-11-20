import React from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator,
    Alert,
    Linking,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import AppHeader from '../components/AppHeader';
import { useTranslation } from 'react-i18next';
import {
    useSubscription,
    formatPeriod,
    formatTrialLength,
    type IAPProduct,
} from '../services/iapService';
import { useAuth } from '../contexts/authContext';
import { PRIVACY_POLICY_URL, TERMS_OF_USE_URL } from '../constants/legal';
import { colors } from '../theme/tokens';

export default function SubscriptionScreen() {
    const { t, i18n } = useTranslation();
    const navigation = useNavigation();
    const { isGuest } = useAuth();
    const {
        iapSupported,
        products,
        loading,
        purchasing,
        restoring,
        isPro,
        isTrial,
        expiresAt,
        managedByApple,
        error,
        fetchProducts,
        purchase,
        restore,
        manage,
    } = useSubscription();

    const openLink = (url: string) => {
        Linking.openURL(url).catch(() => Alert.alert(t('paywall.linkError')));
    };

    const onPurchase = async (productId: string) => {
        const outcome = await purchase(productId);
        if (outcome === 'success') {
            Alert.alert(t('paywall.successTitle'), t('paywall.successBody'));
        } else if (outcome === 'pending') {
            Alert.alert(t('paywall.pendingTitle'), t('paywall.pendingBody'));
        }
        // 'cancelled' is silent; 'error' is shown inline via `error`.
    };

    const onRestore = async () => {
        const outcome = await restore();
        if (outcome === 'restored') {
            Alert.alert(t('paywall.restoredTitle'), t('paywall.restoredBody'));
        } else if (outcome === 'none') {
            Alert.alert(t('paywall.restoreNoneTitle'), t('paywall.restoreNoneBody'));
        }
    };

    const renewalDate = expiresAt
        ? new Date(expiresAt * 1000).toLocaleDateString(i18n.language?.startsWith('zh') ? 'zh-TW' : 'en-US')
        : null;

    if (isPro) {
        return (
            <View className="flex-1 bg-linen">
                <AppHeader title={t('nav.subscription')} showMenuButton />
                <ScrollView contentContainerStyle={{ padding: 24, alignItems: 'center' }}>
                    <Text className="text-4xl mb-4">✨</Text>
                    <Text className="text-2xl font-bold text-ink mb-2 text-center" testID="pro-title">
                        {isTrial ? t('paywall.proTrialTitle') : t('paywall.proTitle')}
                    </Text>
                    <Text className="text-muted text-center">
                        {isTrial ? t('paywall.proTrialBody') : t('paywall.proBody')}
                    </Text>
                    {renewalDate && (
                        <Text className="text-muted text-center mt-3" testID="pro-renewal">
                            {t('paywall.validUntil', { date: renewalDate })}
                        </Text>
                    )}
                    {managedByApple && (
                        <TouchableOpacity
                            onPress={manage}
                            className="mt-6 py-3 px-6 rounded-xl border border-line"
                            testID="manage-subscription"
                        >
                            <Text className="text-herb font-medium">{t('paywall.manage')}</Text>
                        </TouchableOpacity>
                    )}
                    <LegalLinks onOpen={openLink} />
                </ScrollView>
            </View>
        );
    }

    return (
        <View className="flex-1 bg-linen">
            <AppHeader title={t('nav.subscription')} showMenuButton />

            <ScrollView contentContainerStyle={{ padding: 16 }}>
                <Text className="text-2xl font-bold text-center mb-2 text-ink">
                    {t('paywall.title')}
                </Text>
                <Text className="text-muted text-center mb-6">{t('paywall.subtitle')}</Text>

                <View className="mb-6 gap-2 self-center">
                    <FeatureRow text={t('paywall.featureAi')} />
                    <FeatureRow text={t('paywall.featureImports')} />
                    <FeatureRow text={t('paywall.featureUnlimited')} />
                </View>

                {!iapSupported ? (
                    <Text className="text-muted text-center py-6" testID="iap-unsupported">
                        {t('paywall.unsupported')}
                    </Text>
                ) : isGuest ? (
                    <View className="items-center py-6 gap-3">
                        <Text className="text-muted text-center">{t('paywall.guest')}</Text>
                        <TouchableOpacity
                            onPress={() => navigation.navigate('SaveKitchen' as never)}
                            className="py-3 px-6 rounded-xl bg-herb"
                        >
                            <Text className="text-white font-bold">{t('auth.guestBannerCta')}</Text>
                        </TouchableOpacity>
                    </View>
                ) : loading ? (
                    <ActivityIndicator size="large" color={colors.herb} />
                ) : (
                    <View className="gap-4">
                        {products.map((product) => (
                            <ProductCard
                                key={product.productId}
                                product={product}
                                busy={purchasing}
                                onPress={() => onPurchase(product.productId)}
                            />
                        ))}

                        {products.length === 0 && (
                            <View className="items-center py-8" testID="no-products">
                                <Text className="text-muted">{t('paywall.noProducts')}</Text>
                                <TouchableOpacity onPress={fetchProducts} className="mt-3 py-2 px-4">
                                    <Text className="text-herb font-medium">{t('paywall.retry')}</Text>
                                </TouchableOpacity>
                            </View>
                        )}
                    </View>
                )}

                {error && (
                    <Text className="text-center mt-4" style={{ color: colors.danger }} testID="paywall-error">
                        {error}
                    </Text>
                )}

                {iapSupported && !isGuest && (
                    <TouchableOpacity
                        onPress={onRestore}
                        disabled={restoring || purchasing}
                        className="mt-6 py-3 items-center"
                        testID="restore-purchases"
                    >
                        {restoring ? (
                            <ActivityIndicator color={colors.herb} />
                        ) : (
                            <Text className="text-herb font-medium">{t('paywall.restore')}</Text>
                        )}
                    </TouchableOpacity>
                )}

                <View className="mt-4 items-center gap-2">
                    <Text className="text-muted text-xs text-center" testID="auto-renew-disclosure">
                        {t('paywall.disclosure')}
                    </Text>
                </View>
                <LegalLinks onOpen={openLink} />
            </ScrollView>
        </View>
    );
}

function ProductCard({
    product,
    busy,
    onPress,
}: {
    product: IAPProduct;
    busy: boolean;
    onPress: () => void;
}) {
    const { t } = useTranslation();
    const period = formatPeriod(product.period);
    const priceLine = period
        ? t('paywall.pricePerPeriod', { price: product.displayPrice, period })
        : product.displayPrice;
    const trialLine = product.trial
        ? t('paywall.trialThenPrice', {
              length: formatTrialLength(product.trial),
              price: priceLine,
          })
        : null;

    return (
        <View className="bg-surface p-6 rounded-2xl border border-line" testID={`product-${product.productId}`}>
            <Text className="text-xl font-bold text-ink">{product.title}</Text>
            <Text className="text-ink text-2xl font-bold mt-2" testID={`price-${product.productId}`}>
                {priceLine}
            </Text>
            {trialLine && (
                <Text className="text-herb-deep font-medium mt-1" testID={`trial-${product.productId}`}>
                    {trialLine}
                </Text>
            )}
            <Text className="text-muted text-xs mt-2">{t('paywall.autoRenews')}</Text>

            <TouchableOpacity
                onPress={onPress}
                disabled={busy}
                testID={`subscribe-${product.productId}`}
                className={`mt-4 py-4 rounded-xl items-center ${busy ? 'bg-sage' : 'bg-herb'}`}
            >
                {busy ? (
                    <ActivityIndicator color={colors.onHerb} />
                ) : (
                    <Text className="text-white font-bold text-lg">
                        {product.trial
                            ? t('paywall.startTrial', { length: formatTrialLength(product.trial) })
                            : t('paywall.subscribe')}
                    </Text>
                )}
            </TouchableOpacity>
        </View>
    );
}

function LegalLinks({ onOpen }: { onOpen: (url: string) => void }) {
    const { t } = useTranslation();
    return (
        <View className="flex-row justify-center gap-6 mt-4 mb-6">
            <TouchableOpacity onPress={() => onOpen(TERMS_OF_USE_URL)} testID="link-terms">
                <Text className="text-herb text-sm underline">{t('paywall.terms')}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onOpen(PRIVACY_POLICY_URL)} testID="link-privacy">
                <Text className="text-herb text-sm underline">{t('paywall.privacy')}</Text>
            </TouchableOpacity>
        </View>
    );
}

function FeatureRow({ text }: { text: string }) {
    return (
        <View className="flex-row items-center gap-2">
            <Text className="text-herb">✓</Text>
            <Text className="text-muted">{text}</Text>
        </View>
    );
}

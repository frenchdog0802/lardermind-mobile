import React, { useCallback, useMemo, useState } from 'react';
import {
    View,
    Text,
    TextInput,
    TouchableOpacity,
    ScrollView,
    Alert,
    Image,
    ActivityIndicator,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { TrashIcon } from 'lucide-react-native';
import AppHeader from '../components/AppHeader';
import {
    pantryVisionApi,
    type RecognizedPantryItem,
} from '../api/pantryVision';
import { usePantry } from '../contexts/pantryContext';
import { colors } from '../theme/tokens';

export type PantryImageReviewParams = {
    items: RecognizedPantryItem[];
    imageUri?: string;
    source: 'pantry' | 'chat';
    emptyMessage?: string;
};

type ReviewRoute = RouteProp<
    { PantryImageReview: PantryImageReviewParams },
    'PantryImageReview'
>;

type DraftRow = RecognizedPantryItem & { key: string };

export default function PantryImageReviewScreen() {
    const { t } = useTranslation();
    const navigation = useNavigation();
    const route = useRoute<ReviewRoute>();
    const { fetchAllPantryItems } = usePantry();

    const initialItems = route.params?.items ?? [];
    const imageUri = route.params?.imageUri;
    const emptyMessage = route.params?.emptyMessage;

    const [rows, setRows] = useState<DraftRow[]>(() =>
        initialItems.map((item, index) => ({
            ...item,
            key: `${item.name}-${index}`,
        })),
    );
    const [saving, setSaving] = useState(false);

    const validRows = useMemo(
        () => rows.filter((row) => row.name.trim().length > 0),
        [rows],
    );
    const canConfirm = validRows.length > 0 && !saving;

    const updateRow = useCallback((key: string, patch: Partial<RecognizedPantryItem>) => {
        setRows((prev) =>
            prev.map((row) => (row.key === key ? { ...row, ...patch } : row)),
        );
    }, []);

    const removeRow = useCallback((key: string) => {
        setRows((prev) => prev.filter((row) => row.key !== key));
    }, []);

    const handleCancel = useCallback(() => {
        navigation.goBack();
    }, [navigation]);

    const handleConfirm = useCallback(async () => {
        if (!canConfirm) return;
        setSaving(true);
        try {
            const payload = validRows.map(({ category, name, quantity, unit }) => ({
                category: category || 'other',
                name: name.trim(),
                quantity: Number(quantity) || 0,
                unit: unit?.trim() || 'pcs',
            }));
            const res = await pantryVisionApi.apply(payload);
            if (!res.success) {
                Alert.alert(
                    t('pantryVision.errorTitle'),
                    res.message || t('pantryVision.errorApply'),
                );
                return;
            }
            await fetchAllPantryItems();
            Alert.alert(
                t('pantryVision.successTitle'),
                t('pantryVision.successBody', {
                    count: payload.length,
                }),
            );
            navigation.goBack();
        } catch {
            Alert.alert(t('pantryVision.errorTitle'), t('pantryVision.errorApply'));
        } finally {
            setSaving(false);
        }
    }, [canConfirm, validRows, fetchAllPantryItems, navigation, t]);

    return (
        <View className="flex-1 bg-linen">
            <AppHeader title={t('pantryVision.reviewTitle')} showBackButton />
            <ScrollView
                className="flex-1 px-4"
                contentContainerStyle={{ paddingBottom: 32 }}
                keyboardShouldPersistTaps="handled"
            >
                {imageUri ? (
                    <Image
                        source={{ uri: imageUri }}
                        className="w-full h-40 rounded-xl mb-3 bg-surface"
                        resizeMode="cover"
                    />
                ) : null}

                <Text className="text-sm text-muted mb-3">
                    {t('pantryVision.approxHint')}
                </Text>

                {rows.length === 0 ? (
                    <View className="bg-surface border border-line rounded-xl p-6 items-center">
                        <Text className="text-muted text-center">
                            {emptyMessage || t('pantryVision.empty')}
                        </Text>
                    </View>
                ) : (
                    rows.map((row) => (
                        <View
                            key={row.key}
                            className="bg-surface border border-line rounded-xl p-3 mb-3"
                        >
                            <View className="flex-row items-center justify-between mb-2">
                                <TextInput
                                    value={row.category}
                                    onChangeText={(category) =>
                                        updateRow(row.key, { category })
                                    }
                                    placeholder={t('pantryVision.category')}
                                    className="flex-1 text-sm text-muted mr-2"
                                />
                                <TouchableOpacity
                                    onPress={() => removeRow(row.key)}
                                    accessibilityLabel={t('common.delete')}
                                >
                                    <TrashIcon size={18} color={colors.muted} />
                                </TouchableOpacity>
                            </View>
                            <TextInput
                                value={row.name}
                                onChangeText={(name) => updateRow(row.key, { name })}
                                placeholder={t('pantryVision.name')}
                                className="text-ink font-medium mb-2 border-b border-line pb-1"
                            />
                            <View className="flex-row gap-2">
                                <TextInput
                                    value={String(row.quantity)}
                                    onChangeText={(text) => {
                                        const quantity = Number(text.replace(/[^0-9.]/g, ''));
                                        updateRow(row.key, {
                                            quantity: Number.isFinite(quantity)
                                                ? quantity
                                                : 0,
                                        });
                                    }}
                                    keyboardType="decimal-pad"
                                    className="flex-1 border border-line rounded-lg px-3 py-2"
                                    placeholder={t('pantry.quantity')}
                                />
                                <TextInput
                                    value={row.unit}
                                    onChangeText={(unit) => updateRow(row.key, { unit })}
                                    className="w-24 border border-line rounded-lg px-3 py-2"
                                    placeholder={t('pantry.unit')}
                                />
                            </View>
                        </View>
                    ))
                )}
            </ScrollView>

            <View className="flex-row gap-3 px-4 pb-6 pt-2 border-t border-line bg-linen">
                <TouchableOpacity
                    onPress={handleCancel}
                    disabled={saving}
                    className="flex-1 border border-line rounded-xl py-3 items-center bg-surface"
                >
                    <Text className="text-ink">{t('pantryVision.cancel')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                    onPress={() => {
                        void handleConfirm();
                    }}
                    disabled={!canConfirm}
                    className={`flex-1 rounded-xl py-3 items-center ${
                        canConfirm ? 'bg-herb' : 'bg-sage'
                    }`}
                >
                    {saving ? (
                        <ActivityIndicator color={colors.onHerb} />
                    ) : (
                        <Text
                            className={canConfirm ? 'text-on-herb font-medium' : 'text-muted'}
                        >
                            {t('pantryVision.confirm')}
                        </Text>
                    )}
                </TouchableOpacity>
            </View>
        </View>
    );
}

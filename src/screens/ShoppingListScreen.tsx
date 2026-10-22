import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    TextInput,
    Modal,
    ScrollView,
    Alert,
} from 'react-native';
import { FlashList, type FlashListRef } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import { usePantry } from '../contexts/pantryContext';
import { PlusIcon, CheckIcon, SearchIcon, XIcon } from 'lucide-react-native';
import AppHeader from '../components/AppHeader';
import { UnitSelect, preferredUnitForIngredient } from '../components/UnitSelect';
import { ShoppingListRow, type ShoppingListRowItem } from '../components/shopping/ShoppingListRow';
import { SkeletonList } from '../components/ui/Skeleton';
import type { MeasurementSystem } from '../utils/units';
import { colors } from '../theme/tokens';
import { DRAW_DISTANCE } from '../constants/listPerf';

type ReviewDraft = {
    id: string;
    name: string;
    quantity: string;
    unit: string;
    selected: boolean;
    hasIngredient: boolean;
};

export default function ShoppingListScreen() {
    const { t } = useTranslation();
    const {
        shoppingList: oriShoppingList,
        shoppingListSyncStatus,
        fetchAllShoppingListItems,
        updateShoppingListItem,
        addShoppingListItem,
        removeShoppingListItem,
        markAllShoppingListChecked,
        retryShoppingListSync,
        syncShoppingItemsToPantry,
        unsyncShoppingItemsFromPantry,
        ingredients,
        userSettings,
        loading,
    } = usePantry();

    const measurementSystem = (userSettings.measurement_unit === 'imperial' ? 'imperial' : 'metric') as MeasurementSystem;
    const shoppingList = useMemo(
        () => (Array.isArray(oriShoppingList) ? oriShoppingList : []) as ShoppingListRowItem[],
        [oriShoppingList],
    );
    const [showMessage, setShowMessage] = useState(false);
    const [message, setMessage] = useState('');
    const [undoIds, setUndoIds] = useState<string[] | null>(null);
    const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [isAddingItem, setIsAddingItem] = useState(false);
    const [isCompletingAll, setIsCompletingAll] = useState(false);
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
    const [showReview, setShowReview] = useState(false);
    const [reviewDrafts, setReviewDrafts] = useState<ReviewDraft[]>([]);
    const [isSyncing, setIsSyncing] = useState(false);
    const [newItem, setNewItem] = useState({
        name: '',
        quantity: '1',
        unit: 'pcs',
    });
    const listRef = useRef<FlashListRef<ShoppingListRowItem> | null>(null);
    const shoppingListRef = useRef(shoppingList);
    shoppingListRef.current = shoppingList;

    useEffect(() => {
        void (async () => {
            await fetchAllShoppingListItems();
            setHasLoadedOnce(true);
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        return () => {
            if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        };
    }, []);

    const filteredItems = useMemo(() => {
        const list = Array.isArray(shoppingList) ? shoppingList : [];
        if (!searchQuery.trim()) {
            return list;
        }
        return list.filter(item => {
            return item.name && item.name.toLowerCase().includes(searchQuery.toLowerCase());
        });
    }, [shoppingList, searchQuery]);

    const pendingSyncItems = useMemo(
        () => shoppingList.filter(item => item.checked && !item.synced_to_pantry),
        [shoppingList],
    );

    const showSkeleton = !hasLoadedOnce && loading && filteredItems.length === 0;

    const showToast = useCallback((text: string, idsForUndo?: string[]) => {
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        setMessage(text);
        setShowMessage(true);
        setUndoIds(idsForUndo ?? null);
        undoTimerRef.current = setTimeout(() => {
            setShowMessage(false);
            setUndoIds(null);
        }, idsForUndo ? 10000 : 2000);
    }, []);

    const handleUpdateQuantity = useCallback((item: ShoppingListRowItem, delta: number) => {
        const current = shoppingListRef.current.find((i) => i.id === item.id) ?? item;
        const next = current.quantity + delta;
        if (next >= 0) {
            void updateShoppingListItem({ ...current, quantity: next });
        }
    }, [updateShoppingListItem]);

    const handleTogglePurchased = useCallback((id: string) => {
        const item = shoppingListRef.current.find((i) => i.id === id);
        if (!item) return;

        if (item.checked && item.synced_to_pantry) {
            Alert.alert(
                t('shopping.title'),
                t('shopping.uncheckSyncedConfirm'),
                [
                    { text: t('shopping.syncCancel'), style: 'cancel' },
                    {
                        text: t('shopping.uncheckSyncedNo'),
                        onPress: () => {
                            void updateShoppingListItem({ ...item, checked: false });
                        },
                    },
                    {
                        text: t('shopping.uncheckSyncedYes'),
                        style: 'destructive',
                        onPress: () => {
                            void (async () => {
                                await unsyncShoppingItemsFromPantry([item.id]);
                                await updateShoppingListItem({ ...item, checked: false });
                            })();
                        },
                    },
                ],
            );
            return;
        }

        void updateShoppingListItem({ ...item, checked: !item.checked });
    }, [t, updateShoppingListItem, unsyncShoppingItemsFromPantry]);

    const handleRemove = useCallback((id: string) => {
        void removeShoppingListItem(id);
    }, [removeShoppingListItem]);

    const uncheckedCount = useMemo(
        () => (Array.isArray(shoppingList) ? shoppingList : []).filter(item => !item.checked).length,
        [shoppingList]
    );

    const handleCompleteAll = async () => {
        const unchecked = (Array.isArray(shoppingList) ? shoppingList : []).filter(item => !item.checked);
        if (unchecked.length === 0 || isCompletingAll) return;

        setIsCompletingAll(true);
        try {
            const count = await markAllShoppingListChecked();
            showToast(t('shopping.allPurchased', { count }));
        } finally {
            setIsCompletingAll(false);
        }
    };

    const handleAddItem = async () => {
        if (!newItem.name.trim()) return;

        await addShoppingListItem({
            name: newItem.name,
            quantity: parseFloat(newItem.quantity) || 1,
            unit: newItem.unit || 'pcs',
            checked: false,
        });

        setNewItem({ name: '', quantity: '1', unit: 'pcs' });
        setIsAddingItem(false);
        showToast(t('shopping.itemAdded'));
        requestAnimationFrame(() => {
            listRef.current?.scrollToOffset({ offset: 0, animated: true });
        });
    };

    const openReviewSheet = () => {
        if (!shoppingListSyncStatus.isOnline) {
            showToast(t('shopping.syncToPantryOffline'));
            return;
        }
        setReviewDrafts(
            pendingSyncItems.map(item => ({
                id: item.id,
                name: item.name,
                quantity: String(item.quantity),
                unit: item.unit,
                selected: Boolean(item.ingredient_id),
                hasIngredient: Boolean(item.ingredient_id),
            })),
        );
        setShowReview(true);
    };

    const handleConfirmSync = async () => {
        const selected = reviewDrafts.filter(d => d.selected);
        if (selected.length === 0) {
            showToast(t('shopping.syncEmpty'));
            return;
        }
        setIsSyncing(true);
        try {
            const res = await syncShoppingItemsToPantry(
                selected.map(d => ({
                    id: d.id,
                    quantity: parseFloat(d.quantity) || 0,
                    unit: d.unit,
                })),
            );
            if (res.success && res.data) {
                const ids = res.data.synced.map(i => i.id);
                setShowReview(false);
                showToast(t('shopping.syncSuccess', { n: ids.length }), ids);
            }
        } finally {
            setIsSyncing(false);
        }
    };

    const handleUndoSync = async () => {
        if (!undoIds?.length) return;
        const ids = undoIds;
        setUndoIds(null);
        setShowMessage(false);
        if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
        await unsyncShoppingItemsFromPantry(ids);
    };

    const renderItem = useCallback(({ item }: { item: ShoppingListRowItem }) => (
        <ShoppingListRow
            item={item}
            measurementSystem={measurementSystem}
            onToggle={handleTogglePurchased}
            onUpdateQuantity={handleUpdateQuantity}
            onRemove={handleRemove}
        />
    ), [measurementSystem, handleTogglePurchased, handleUpdateQuantity, handleRemove]);

    const failedCount = shoppingListSyncStatus.failedCount ?? 0;
    const showSyncBanner =
        !shoppingListSyncStatus.isOnline ||
        failedCount > 0 ||
        (Boolean(shoppingListSyncStatus.lastSyncError) &&
            shoppingListSyncStatus.pendingCount > 0);

    const syncBannerMessage = !shoppingListSyncStatus.isOnline
        ? t('shopping.syncOffline')
        : failedCount > 0
          ? shoppingListSyncStatus.lastSyncError || t('shopping.syncFailed', { count: failedCount })
          : shoppingListSyncStatus.lastSyncError ?? t('shopping.syncPending', { count: shoppingListSyncStatus.pendingCount });

    return (
        <View className="flex-1 bg-linen" testID="shopping-screen">
            <AppHeader title={t('shopping.title')} showMenuButton />

            <View className="flex-1 p-4">
                {showSyncBanner && (
                    <View className="mb-4 p-3 bg-sage border border-line rounded-xl">
                        <Text className="text-herb-deep text-sm font-medium">
                            {syncBannerMessage}
                        </Text>
                        {shoppingListSyncStatus.isOnline &&
                            (failedCount > 0 ||
                                (shoppingListSyncStatus.lastSyncError &&
                                    shoppingListSyncStatus.pendingCount > 0)) && (
                                <TouchableOpacity
                                    onPress={() => void retryShoppingListSync()}
                                    className="mt-2 self-start bg-herb px-3 py-1.5 rounded-lg"
                                >
                                    <Text className="text-white text-sm font-medium">
                                        {t('shopping.syncRetry')}
                                    </Text>
                                </TouchableOpacity>
                            )}
                    </View>
                )}

                {showMessage && (
                    <View className="mb-4 p-3 bg-sage border border-line rounded-xl flex-row items-center justify-between">
                        <Text className="text-herb-deep text-sm font-medium flex-1">{message}</Text>
                        {undoIds ? (
                            <TouchableOpacity onPress={() => void handleUndoSync()} className="ml-2">
                                <Text className="text-herb-deep text-sm font-bold underline">
                                    {t('shopping.undo')}
                                </Text>
                            </TouchableOpacity>
                        ) : null}
                    </View>
                )}

                <View className="relative mb-4">
                    <View className="absolute left-3 top-3 z-10">
                        <SearchIcon size={18} color={colors.muted} />
                    </View>
                    <TextInput
                        placeholder={t('shopping.searchPlaceholder')}
                        value={searchQuery}
                        onChangeText={setSearchQuery}
                        className="w-full pl-10 pr-4 py-3 bg-surface rounded-xl border border-line text-ink"
                    />
                </View>

                {!isAddingItem ? (
                    <TouchableOpacity
                        testID="shopping-add-button"
                        onPress={() => setIsAddingItem(true)}
                        className="flex-row items-center justify-center bg-surface border border-line py-3 px-4 rounded-xl mb-4"
                    >
                        <PlusIcon size={18} color={colors.ink} />
                        <Text className="text-ink font-medium ml-2">{t('shopping.addItem')}</Text>
                    </TouchableOpacity>
                ) : (
                    <View className="bg-surface p-4 rounded-xl border border-line mb-4">
                        <View className="flex-row justify-between items-center mb-3">
                            <Text className="font-medium text-ink">{t('shopping.addItemTitle')}</Text>
                            <TouchableOpacity onPress={() => setIsAddingItem(false)}>
                                <XIcon size={20} color={colors.muted} />
                            </TouchableOpacity>
                        </View>

                        <TextInput
                            testID="shopping-item-name"
                            placeholder={t('shopping.itemNamePlaceholder')}
                            value={newItem.name}
                            onChangeText={(text) => setNewItem({ ...newItem, name: text })}
                            className="w-full p-3 border border-line rounded-lg mb-3 bg-linen text-ink"
                        />

                        <View className="flex-row gap-2 mb-3">
                            <TextInput
                                placeholder={t('pantry.quantity')}
                                value={newItem.quantity}
                                onChangeText={(text) => setNewItem({ ...newItem, quantity: text })}
                                keyboardType="numeric"
                                className="flex-1 p-3 border border-line rounded-lg bg-linen text-ink"
                            />
                            <View className="flex-[2]">
                                <UnitSelect
                                    kind={preferredUnitForIngredient(
                                        (Array.isArray(ingredients) ? ingredients : []).find(i => i.name.toLowerCase() === newItem.name.toLowerCase()) || {
                                            default_unit: newItem.unit,
                                        },
                                        measurementSystem,
                                    ).kind}
                                    value={newItem.unit}
                                    onChange={unit => setNewItem({ ...newItem, unit })}
                                    measurementSystem={measurementSystem}
                                    preferSystemUnits
                                />
                            </View>
                        </View>

                        <View className="flex-row gap-2">
                            <TouchableOpacity
                                onPress={() => {
                                    setNewItem({ name: '', quantity: '1', unit: 'pcs' });
                                    setIsAddingItem(false);
                                }}
                                className="flex-1 bg-linen border border-line py-3 rounded-lg"
                            >
                                <Text className="text-ink text-center font-medium">{t('common.cancel')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                testID="shopping-save-item"
                                onPress={() => void handleAddItem()}
                                className="flex-1 bg-herb py-3 rounded-lg"
                            >
                                <Text className="text-white text-center font-medium">{t('common.add')}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                )}

                {pendingSyncItems.length > 0 && (
                    <TouchableOpacity
                        onPress={openReviewSheet}
                        className="mb-4 bg-herb py-3 px-4 rounded-xl items-center"
                    >
                        <Text className="text-white font-medium">
                            {t('shopping.syncToPantry', { n: pendingSyncItems.length })}
                        </Text>
                    </TouchableOpacity>
                )}

                <View className="bg-surface rounded-xl overflow-hidden flex-1 border border-line">
                    <View className="p-4 border-b border-line bg-linen flex-row items-center justify-between">
                        <Text className="font-semibold text-ink">{t('shopping.itemsToBuy')}</Text>
                        <TouchableOpacity
                            onPress={() => void handleCompleteAll()}
                            disabled={uncheckedCount === 0 || isCompletingAll}
                            className={`flex-row items-center px-3 py-1.5 rounded-lg ${
                                uncheckedCount === 0 || isCompletingAll ? 'bg-sage' : 'bg-herb'
                            }`}
                        >
                            <CheckIcon
                                size={14}
                                color={uncheckedCount === 0 || isCompletingAll ? colors.muted : colors.onHerb}
                            />
                            <Text
                                className={`ml-1.5 text-sm font-medium ${
                                    uncheckedCount === 0 || isCompletingAll ? 'text-muted' : 'text-white'
                                }`}
                            >
                                {isCompletingAll ? t('shopping.completing') : t('shopping.completeAll')}
                            </Text>
                        </TouchableOpacity>
                    </View>

                    {showSkeleton ? (
                        <SkeletonList count={5} />
                    ) : filteredItems.length === 0 ? (
                        <View className="p-6 items-center">
                            <Text className="text-muted">{t('shopping.empty')}</Text>
                            {searchQuery ? (
                                <Text className="text-muted text-sm mt-1">{t('common.tryDifferentSearch')}</Text>
                            ) : null}
                        </View>
                    ) : (
                        <FlashList
                            ref={listRef}
                            data={filteredItems}
                            renderItem={renderItem}
                            keyExtractor={(item) => item.id.toString()}
                            contentContainerStyle={{ padding: 12 }}
                            drawDistance={DRAW_DISTANCE}
                        />
                    )}
                </View>
            </View>

            <Modal visible={showReview} animationType="slide" transparent onRequestClose={() => setShowReview(false)}>
                <View className="flex-1 justify-end bg-black/40">
                    <View className="bg-surface rounded-t-2xl max-h-[85%] border border-line">
                        <View className="p-4 border-b border-line">
                            <Text className="text-ink font-semibold text-lg">{t('shopping.syncReviewTitle')}</Text>
                            <Text className="text-muted text-sm mt-1">{t('shopping.syncNonFoodHint')}</Text>
                        </View>
                        <ScrollView className="px-4">
                            {reviewDrafts.map((draft, idx) => (
                                <View key={draft.id} className="py-3 border-b border-line">
                                    <TouchableOpacity
                                        onPress={() =>
                                            setReviewDrafts(prev =>
                                                prev.map((d, i) =>
                                                    i === idx ? { ...d, selected: !d.selected } : d,
                                                ),
                                            )
                                        }
                                        className="flex-row items-center mb-2"
                                    >
                                        <View
                                            className={`w-5 h-5 rounded border-2 mr-3 items-center justify-center ${
                                                draft.selected ? 'bg-herb border-herb' : 'border-line'
                                            }`}
                                        >
                                            {draft.selected ? <CheckIcon size={12} color="#fff" /> : null}
                                        </View>
                                        <Text className="text-ink font-medium capitalize flex-1">{draft.name}</Text>
                                    </TouchableOpacity>
                                    <View className="flex-row gap-2 ml-8">
                                        <TextInput
                                            value={draft.quantity}
                                            onChangeText={(text) =>
                                                setReviewDrafts(prev =>
                                                    prev.map((d, i) =>
                                                        i === idx ? { ...d, quantity: text } : d,
                                                    ),
                                                )
                                            }
                                            keyboardType="numeric"
                                            className="flex-1 p-2 border border-line rounded-lg bg-linen text-ink"
                                        />
                                        <TextInput
                                            value={draft.unit}
                                            onChangeText={(text) =>
                                                setReviewDrafts(prev =>
                                                    prev.map((d, i) =>
                                                        i === idx ? { ...d, unit: text } : d,
                                                    ),
                                                )
                                            }
                                            className="flex-[2] p-2 border border-line rounded-lg bg-linen text-ink"
                                        />
                                    </View>
                                </View>
                            ))}
                        </ScrollView>
                        <View className="p-4 flex-row gap-2 border-t border-line">
                            <TouchableOpacity
                                onPress={() => setShowReview(false)}
                                disabled={isSyncing}
                                className="flex-1 bg-linen border border-line py-3 rounded-xl"
                            >
                                <Text className="text-ink text-center font-medium">{t('shopping.syncCancel')}</Text>
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={() => void handleConfirmSync()}
                                disabled={isSyncing || reviewDrafts.every(d => !d.selected)}
                                className="flex-1 bg-herb py-3 rounded-xl"
                            >
                                <Text className="text-white text-center font-medium">{t('shopping.syncConfirm')}</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

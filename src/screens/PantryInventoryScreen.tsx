import React, { useEffect, useMemo, useState, useCallback } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    TextInput,
    Alert,
    ActivityIndicator,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import {
    PlusIcon,
    SearchIcon,
    PackageIcon,
    CameraIcon,
} from 'lucide-react-native';
import { usePantry } from '../contexts/pantryContext';
import useSearchIngredients from '../hooks/useSearchIngredient';
import { PantryItem } from '../types';
import AppHeader from '../components/AppHeader';
import { UnitSelect, preferredUnitForIngredient } from '../components/UnitSelect';
import { PantryItemRow } from '../components/pantry/PantryItemRow';
import { SkeletonList } from '../components/ui/Skeleton';
import type { MeasurementSystem } from '../utils/units';
import { colors } from '../theme/tokens';
import { DRAW_DISTANCE } from '../constants/listPerf';
import { pickPantryImage } from '../utils/pantryImagePick';
import { pantryVisionApi } from '../api/pantryVision';

export default function PantryInventoryScreen() {
    const { t } = useTranslation();
    const navigation = useNavigation();
    const {
        pantryItems: oriPantryItems,
        updatePantryItem,
        addPantryItem,
        removePantryItem,
        ingredients,
        fetchAllPantryItems,
        userSettings,
        loading,
    } = usePantry();

    const measurementSystem = (userSettings.measurement_unit === 'imperial' ? 'imperial' : 'metric') as MeasurementSystem;
    const pantryItems = useMemo(
        () => (Array.isArray(oriPantryItems) ? oriPantryItems : []),
        [oriPantryItems],
    );
    const [searchQuery, setSearchQuery] = useState('');
    const [isAddingItem, setIsAddingItem] = useState(false);
    const [newItem, setNewItem] = useState({
        name: '',
        quantity: 1,
        unit: 'pcs',
    });
    const [showDropdown, setShowDropdown] = useState(false);
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
    const [recognizing, setRecognizing] = useState(false);

    useEffect(() => {
        void (async () => {
            await fetchAllPantryItems();
            setHasLoadedOnce(true);
        })();
        // Only load on mount; list updates flow through pantry context.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const { filteredIngredients, loading: searchLoading } = useSearchIngredients(
        newItem.name,
        ingredients
    );

    const filteredItems = useMemo(() => {
        const list = Array.isArray(pantryItems) ? pantryItems : [];
        if (!searchQuery.trim()) {
            return list;
        }
        return list.filter(item =>
            item.name && item.name.toLowerCase().includes(searchQuery.toLowerCase())
        );
    }, [pantryItems, searchQuery]);

    const showSkeleton = !hasLoadedOnce && loading && filteredItems.length === 0;

    const handleAddItem = useCallback(() => {
        if (!newItem.name.trim()) return;

        const existing = pantryItems.find(
            i => i.name.toLowerCase() === newItem.name.toLowerCase()
        );

        if (existing) {
            void updatePantryItem({ ...existing, quantity: newItem.quantity });
        } else {
            void addPantryItem(newItem);
        }

        setNewItem({ name: '', quantity: 1, unit: 'pcs' });
        setIsAddingItem(false);
        setShowDropdown(false);
    }, [newItem, pantryItems, updatePantryItem, addPantryItem]);

    const handleUpdateQuantity = useCallback((item: PantryItem, delta: number) => {
        const next = item.quantity + delta;
        if (next >= 0) {
            void updatePantryItem({ ...item, quantity: next });
        }
    }, [updatePantryItem]);

    const handleRemove = useCallback((id: string) => {
        void removePantryItem(id);
    }, [removePantryItem]);

    const handleScan = useCallback(async () => {
        if (recognizing) return;
        const picked = await pickPantryImage(t);
        if (!picked) return;
        setRecognizing(true);
        try {
            const res = await pantryVisionApi.recognize(picked.uri);
            if (!res.success || !res.data) {
                Alert.alert(
                    t('pantryVision.errorTitle'),
                    res.message || t('pantryVision.errorRecognize'),
                );
                return;
            }
            navigation.navigate({
                name: 'PantryImageReview',
                params: {
                    items: res.data.items ?? [],
                    imageUri: picked.uri,
                    source: 'pantry',
                    emptyMessage: res.data.message || undefined,
                },
            } as never);
        } catch {
            Alert.alert(
                t('pantryVision.errorTitle'),
                t('pantryVision.errorRecognize'),
            );
        } finally {
            setRecognizing(false);
        }
    }, [recognizing, t, navigation]);

    const renderItem = useCallback(({ item }: { item: PantryItem }) => (
        <PantryItemRow
            item={item}
            measurementSystem={measurementSystem}
            onUpdateQuantity={handleUpdateQuantity}
            onRemove={handleRemove}
        />
    ), [measurementSystem, handleUpdateQuantity, handleRemove]);

    const listHeader = useMemo(() => (
        <View className="pb-2">
            <View className="flex-row items-center bg-surface rounded-xl px-3 mb-4 border border-line">
                <SearchIcon size={18} color={colors.muted} />
                <TextInput
                    placeholder="Search ingredients..."
                    value={searchQuery}
                    onChangeText={setSearchQuery}
                    className="flex-1 p-3"
                />
            </View>

            {!isAddingItem ? (
                <View className="flex-row gap-2 mb-4">
                    <TouchableOpacity
                        onPress={() => setIsAddingItem(true)}
                        className="flex-1 bg-surface border border-line rounded-xl p-4 flex-row justify-center items-center"
                    >
                        <PlusIcon size={18} color={colors.ink} />
                        <Text className="ml-2 font-medium text-ink">{t('pantry.addItem')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={() => {
                            void handleScan();
                        }}
                        disabled={recognizing}
                        accessibilityLabel={t('pantryVision.scan')}
                        className="bg-herb rounded-xl px-4 flex-row justify-center items-center"
                    >
                        {recognizing ? (
                            <ActivityIndicator color={colors.onHerb} />
                        ) : (
                            <CameraIcon size={20} color={colors.onHerb} />
                        )}
                    </TouchableOpacity>
                </View>
            ) : (
                <View className="bg-surface rounded-xl p-4 mb-4 border border-line">
                    <TextInput
                        placeholder="Item name"
                        value={newItem.name}
                        onChangeText={text => {
                            setNewItem((prev) => ({ ...prev, name: text }));
                            setShowDropdown(true);
                        }}
                        className="border border-line rounded-lg p-2 mb-2 bg-linen text-ink"
                    />

                    {showDropdown && (
                        <View className="border border-line rounded-lg mb-2 bg-linen">
                            {searchLoading ? (
                                <Text className="p-3 text-center">Loading...</Text>
                            ) : (
                                filteredIngredients.map(i => (
                                    <TouchableOpacity
                                        key={i.id}
                                        onPress={() => {
                                            setNewItem({
                                                name: i.name,
                                                quantity: 1,
                                                unit: preferredUnitForIngredient(i, measurementSystem).unit,
                                            });
                                            setShowDropdown(false);
                                        }}
                                        className="p-3"
                                    >
                                        <Text>{i.name}</Text>
                                    </TouchableOpacity>
                                ))
                            )}
                        </View>
                    )}

                    <View className="mb-3">
                        <UnitSelect
                            kind={preferredUnitForIngredient(
                                ingredients.find(x => x.name.toLowerCase() === newItem.name.toLowerCase()) || {
                                    default_unit: newItem.unit,
                                },
                                measurementSystem,
                            ).kind}
                            value={newItem.unit}
                            onChange={unit => setNewItem((prev) => ({ ...prev, unit }))}
                            measurementSystem={measurementSystem}
                            preferSystemUnits
                        />
                    </View>
                    <View className="flex-row gap-2">
                        <TouchableOpacity
                            onPress={() => setIsAddingItem(false)}
                            className="flex-1 bg-linen border border-line p-3 rounded-lg"
                        >
                            <Text className="text-center">Cancel</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                            onPress={handleAddItem}
                            className="flex-1 bg-herb p-3 rounded-lg"
                        >
                            <Text className="text-white text-center">Add</Text>
                        </TouchableOpacity>
                    </View>
                </View>
            )}
        </View>
    ), [
        searchQuery,
        isAddingItem,
        newItem,
        showDropdown,
        searchLoading,
        filteredIngredients,
        ingredients,
        measurementSystem,
        handleAddItem,
        recognizing,
        handleScan,
        t,
    ]);

    const listEmpty = useMemo(() => (
        <View className="bg-surface rounded-xl p-6 items-center border border-line">
            <PackageIcon size={32} color={colors.line} />
            <Text className="text-muted mt-2">No items found</Text>
        </View>
    ), []);

    return (
        <View className="flex-1 bg-linen">
            <AppHeader title={t('pantry.title')} showMenuButton />

            <View className="flex-1 p-4">
                {showSkeleton ? (
                    <>
                        {listHeader}
                        <SkeletonList count={6} />
                    </>
                ) : (
                    <FlashList
                        data={filteredItems}
                        keyExtractor={item => String(item.id)}
                        renderItem={renderItem}
                        ListHeaderComponent={listHeader}
                        ListEmptyComponent={listEmpty}
                        keyboardShouldPersistTaps="handled"
                        drawDistance={DRAW_DISTANCE}
                    />
                )}
            </View>
        </View>
    );
}

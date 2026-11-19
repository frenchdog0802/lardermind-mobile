import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    ScrollView,
    Modal,
    TextInput,
    Alert,
    RefreshControl,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import { Calendar as RNCalendar } from 'react-native-calendars';
import {
    ChevronLeft,
    ChevronRight,
    Plus,
    Trash2,
    X,
    AlertCircle,
    Search,
    ChevronDown,
    ChevronUp,
    Calendar as CalendarIcon,
    Check,
} from 'lucide-react-native';

import { usePantry, normalizeRecipe } from '../contexts/pantryContext';
import type { MealPlan, Recipe } from '../types';
import { recipeApi } from '../api/recipe';
import AppHeader from '../components/AppHeader';
import { DRAW_DISTANCE } from '../constants/listPerf';
import { ErrorBanner } from '../components/ui/ErrorBanner';
import { useFocusRefresh } from '../hooks/useFocusRefresh';
import { colors } from '../theme/tokens';

export default function CalendarScreen() {
    const { t } = useTranslation();
    const {
        mealPlan,
        recipes,
        addMealPlan,
        deleteMealPlan,
        fetchAllMealPlans,
        fetchAllRecipes,
        confirmMealPlan,
        skipMealPlan,
        errorByResource,
    } = usePantry();

    const planList = Array.isArray(mealPlan) ? mealPlan : [];
    const recipeList = Array.isArray(recipes) ? recipes : [];

    const [currentDate, setCurrentDate] = useState(new Date());
    const [selectedDate, setSelectedDate] = useState<Date | null>(null);

    const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');

    // Add modal states
    const [showAddModal, setShowAddModal] = useState(false);
    const [selectedRecipeId, setSelectedRecipeId] = useState<string>('');
    const [selectedMealType, setSelectedMealType] = useState<'breakfast' | 'lunch' | 'dinner' | 'snack'>('dinner');
    const [searchQuery, setSearchQuery] = useState('');

    // Delete confirmation
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [recipeToDelete, setRecipeToDelete] = useState<MealPlan | null>(null);

    // Recipe detail modal
    const [showRecipeDetail, setShowRecipeDetail] = useState(false);
    const [selectedRecipeDetail, setSelectedRecipeDetail] = useState<Recipe | null>(null);

    // Week view
    const [currentWeekStart, setCurrentWeekStart] = useState(() => {
        const today = new Date();
        const day = today.getDay();
        const diff = today.getDate() - day;
        const start = new Date(today);
        start.setDate(diff);
        start.setHours(0, 0, 0, 0);
        return start;
    });

    const [expandedDates, setExpandedDates] = useState<string[]>([]);

    // Fetch into the pantry context (source of truth) on focus, at most every ~60 s;
    // pull-to-refresh always refetches.
    const fetchCalendarData = useCallback(
        () => Promise.all([fetchAllMealPlans(), fetchAllRecipes()]),
        [fetchAllMealPlans, fetchAllRecipes],
    );
    const { refresh, refreshing } = useFocusRefresh(fetchCalendarData);

    const formatDateString = (date: Date) =>
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

    const getHistoryForDate = (date: Date | null) => {
        if (!date) return [];
        const dateStr = formatDateString(date);
        return planList.filter((plan) => plan.serving_date === dateStr);
    };

    const getHistoryByType = () => {
        const items = getHistoryForDate(selectedDate);
        return {
            breakfast: items.filter((i) => i.meal_type === 'breakfast'),
            lunch: items.filter((i) => i.meal_type === 'lunch'),
            dinner: items.filter((i) => i.meal_type === 'dinner'),
            snack: items.filter((i) => i.meal_type === 'snack'),
        };
    };

    const monthNames = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
    ];

    const weekDates = useMemo(() => {
        const dates: Date[] = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(currentWeekStart);
            d.setDate(currentWeekStart.getDate() + i);
            dates.push(d);
        }
        return dates;
    }, [currentWeekStart]);

    const handleAddMeal = async () => {
        if (!selectedRecipeId) return;

        const recipe = recipeList.find((r) => r.id === selectedRecipeId);
        if (!recipe || !selectedDate) return;

        const dateStr = formatDateString(selectedDate);

        const newMeal: Partial<MealPlan> = {
            recipe_id: selectedRecipeId,
            meal_name: recipe.meal_name,
            meal_type: selectedMealType,
            serving_date: dateStr,
        };

        try {
            const response = await addMealPlan(newMeal);
            if (response?.success && response.data) {
                setShowAddModal(false);
                setSelectedRecipeId('');
                setSearchQuery('');
            }
        } catch (err) {
            console.error('Error adding meal plan:', err);
        }
    };

    const handleDelete = async () => {
        if (!recipeToDelete?.id) return;

        try {
            await deleteMealPlan(recipeToDelete.id);
            setShowDeleteConfirm(false);
            setRecipeToDelete(null);
        } catch (err) {
            console.error('Error deleting meal plan:', err);
        }
    };

    const canActOnMeal = (item: MealPlan) =>
        !item.status || item.status === 'PLANNED' || item.status === 'PENDING_CONFIRM';

    const pendingMeals = planList.filter((m) => m.status === 'PENDING_CONFIRM');

    const handleConfirmMeal = useCallback(async (item: MealPlan) => {
        const response = await confirmMealPlan(item.id);
        if (response.success && response.data) {
            const shortages = response.data.shortages || [];
            if (shortages.length > 0) {
                const summary = shortages
                    .slice(0, 3)
                    .map((s) => `${s.name} (had ${s.available}${s.unit}, needed ${s.needed}${s.unit})`)
                    .join('\n');
                Alert.alert(
                    'Marked cooked - pantry shortfall',
                    `Pantry was updated (clamped at 0).\n\n${summary}\n\nYou can adjust stock in Pantry.`
                );
            } else {
                Alert.alert('Marked cooked', `${item.meal_name} - pantry updated.`);
            }
        }
    }, [confirmMealPlan]);

    const handleSkipMeal = useCallback(async (item: MealPlan) => {
        const response = await skipMealPlan(item.id);
        if (response.success) {
            Alert.alert("Didn't cook", `${item.meal_name} - no pantry change.`);
        }
    }, [skipMealPlan]);

    const expandedKey = useMemo(
        () =>
            expandedDates.slice().sort().join('|') +
            ':' +
            planList.map((p) => `${p.id}:${p.status}`).join(','),
        [expandedDates, planList],
    );

    const openRecipeDetail = async (item: MealPlan) => {
        const recipeId = String(item.recipe_id ?? '').trim();
        let recipe = recipeList.find((r) => String(r.id) === recipeId) ?? null;

        if (!recipe && recipeId) {
            try {
                const response = await recipeApi.get(recipeId);
                if (response.success && response.data) {
                    const raw = response.data as unknown;
                    const payload = (raw && typeof raw === 'object' && 'recipe' in (raw as object)
                        ? (raw as { recipe: Record<string, unknown> }).recipe
                        : raw) as Record<string, unknown>;
                    recipe = normalizeRecipe(payload);
                }
            } catch (err) {
                console.error('Failed to load recipe for meal plan:', err);
            }
        }

        setSelectedRecipeDetail(
            recipe ?? {
                id: recipeId,
                meal_name: item.meal_name || 'Recipe',
                folder_id: '',
                instructions: [],
                ingredients: [],
                image: null,
            }
        );
        setShowRecipeDetail(true);
    };

    const formatDisplayDate = (d: Date) => {
        const today = new Date();
        if (d.toDateString() === today.toDateString()) return 'Today';
        const yesterday = new Date(today);
        yesterday.setDate(today.getDate() - 1);
        if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow';
        return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    };

    const emptyAndPendingBanner = (
        <>
            {planList.length === 0 && (
                <View className="mb-4 bg-surface rounded-xl p-6 items-center border border-line">
                    <Text className="text-muted">No meals planned</Text>
                </View>
            )}
            {pendingMeals.length > 0 && (
                <View className="mb-4 bg-sage border border-line rounded-2xl p-3">
                    <Text className="text-sm font-semibold text-ink mb-2">
                        {pendingMeals.length === 1
                            ? `Did you cook ${pendingMeals[0].meal_name}?`
                            : 'Did you cook these meals?'}
                    </Text>
                    {pendingMeals.map((item) => (
                        <View
                            key={item.id}
                            className="flex-row items-center justify-between bg-surface rounded-xl px-3 py-2 mb-2 border border-line"
                        >
                            <View className="flex-1 mr-2">
                                <Text className="font-medium text-ink" numberOfLines={1}>
                                    {item.meal_name}
                                </Text>
                                <Text className="text-xs text-muted">{item.serving_date}</Text>
                            </View>
                            <View className="flex-row gap-2">
                                <TouchableOpacity
                                    onPress={() => handleConfirmMeal(item)}
                                    className="bg-herb px-3 py-1.5 rounded-lg"
                                >
                                    <Text className="text-white text-xs font-medium">Mark cooked</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={() => handleSkipMeal(item)}
                                    className="border border-line px-3 py-1.5 rounded-lg"
                                >
                                    <Text className="text-muted text-xs font-medium">Didn't cook</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    ))}
                </View>
            )}
        </>
    );

    const weekNavHeader = (
        <View className="mb-4">
            {emptyAndPendingBanner}
            <View className="flex-row justify-between items-center mb-4">
                <TouchableOpacity
                    onPress={() => setCurrentWeekStart((d) => {
                        const newD = new Date(d);
                        newD.setDate(d.getDate() - 7);
                        return newD;
                    })}
                    className="flex-row items-center px-3 py-2 rounded-lg bg-surface border border-line"
                >
                    <ChevronLeft size={16} color={colors.muted} />
                    <Text className="text-muted font-medium">Prev</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    onPress={() => {
                        const today = new Date();
                        const day = today.getDay();
                        const diff = today.getDate() - day;
                        const start = new Date(today);
                        start.setDate(diff);
                        start.setHours(0, 0, 0, 0);
                        setCurrentWeekStart(start);
                    }}
                    className="px-3 py-1.5 bg-sage rounded-lg border border-line"
                >
                    <Text className="text-herb-deep font-medium text-sm">Today</Text>
                </TouchableOpacity>

                <TouchableOpacity
                    onPress={() => setCurrentWeekStart((d) => {
                        const newD = new Date(d);
                        newD.setDate(d.getDate() + 7);
                        return newD;
                    })}
                    className="flex-row items-center px-3 py-2 rounded-lg bg-surface border border-line"
                >
                    <Text className="text-muted font-medium">Next</Text>
                    <ChevronRight size={16} color={colors.muted} />
                </TouchableOpacity>
            </View>

            <Text className="text-center font-semibold text-ink mb-4">
                {currentWeekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {' to '}
                {(() => {
                    const end = new Date(currentWeekStart);
                    end.setDate(currentWeekStart.getDate() + 6);
                    return end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                })()}
            </Text>
        </View>
    );

    const renderWeekDay = useCallback(({ item: date }: { item: Date }) => {
        const dateStr = formatDateString(date);
        const dayMeals = planList.filter((p) => p.serving_date === dateStr);
        const isExpanded = expandedDates.includes(dateStr);
        const isToday = date.toDateString() === new Date().toDateString();

        return (
            <View
                className={`mb-2 rounded-xl overflow-hidden border ${isToday ? 'border-herb' : 'border-line'} bg-surface`}
            >
                <TouchableOpacity
                    onPress={() => {
                        setExpandedDates((prev) =>
                            prev.includes(dateStr)
                                ? prev.filter((d) => d !== dateStr)
                                : [...prev, dateStr],
                        );
                    }}
                    className={`px-4 py-3 flex-row justify-between items-center ${dayMeals.length > 0 ? 'bg-linen' : 'bg-surface'}`}
                >
                    <View className="flex-row items-center">
                        <CalendarIcon size={16} color={colors.muted} />
                        <Text className={`ml-2 font-medium ${isToday ? 'text-herb' : 'text-ink'}`}>
                            {formatDisplayDate(date)}
                        </Text>
                        {dayMeals.length > 0 && (
                            <View className="bg-sage rounded-full px-2 py-0.5 ml-2">
                                <Text className="text-herb-deep text-xs font-medium">{dayMeals.length}</Text>
                            </View>
                        )}
                    </View>
                    {dayMeals.length > 0 && (
                        isExpanded ? <ChevronUp size={18} color={colors.muted} /> : <ChevronDown size={18} color={colors.muted} />
                    )}
                </TouchableOpacity>

                {isExpanded && dayMeals.length > 0 && (
                    <View className="border-t border-line">
                        {dayMeals.map((meal) => (
                            <View
                                key={meal.id}
                                className="px-4 py-3 flex-row justify-between items-center border-b border-line"
                            >
                                <View className="flex-row items-center flex-1">
                                    <View className={`w-2 h-2 rounded-full mr-3 ${meal.meal_type === 'breakfast' ? 'bg-sage' :
                                        meal.meal_type === 'lunch' ? 'bg-herb' :
                                            meal.meal_type === 'dinner' ? 'bg-herb-deep' : 'bg-muted'
                                        }`} />
                                    <View className="flex-1">
                                        <Text className="font-medium text-ink">{meal.meal_name}</Text>
                                        <Text className="text-xs text-muted capitalize">{meal.meal_type}</Text>
                                    </View>
                                </View>
                                <View className="flex-row items-center">
                                    {canActOnMeal(meal) && (
                                        <>
                                            <TouchableOpacity onPress={() => handleConfirmMeal(meal)} className="p-2">
                                                <Check size={16} color={colors.herb} />
                                            </TouchableOpacity>
                                            <TouchableOpacity onPress={() => handleSkipMeal(meal)} className="p-2">
                                                <X size={16} color={colors.muted} />
                                            </TouchableOpacity>
                                        </>
                                    )}
                                    <TouchableOpacity
                                        onPress={() => {
                                            setRecipeToDelete(meal);
                                            setShowDeleteConfirm(true);
                                        }}
                                        className="p-2"
                                    >
                                        <Trash2 size={16} color={colors.danger} />
                                    </TouchableOpacity>
                                </View>
                            </View>
                        ))}
                    </View>
                )}

                <TouchableOpacity
                    onPress={() => {
                        setSelectedDate(date);
                        setShowAddModal(true);
                    }}
                    className="py-2 bg-linen border-t border-line"
                >
                    <View className="flex-row items-center justify-center">
                        <Plus size={14} color={colors.herb} />
                        <Text className="text-herb font-medium ml-1 text-sm">Add meal</Text>
                    </View>
                </TouchableOpacity>
            </View>
        );
    }, [planList, expandedDates, handleConfirmMeal, handleSkipMeal]);

    return (
        <View className="flex-1 bg-linen">
            <AppHeader
                title={t('calendar.title')}
                showMenuButton
                rightElement={<Plus size={24} color={colors.ink} />}
                onRightPress={() => {
                    setSelectedDate(new Date());
                    setShowAddModal(true);
                }}
            />

            {/* View Mode Toggle */}
            <View className="px-4 py-3 bg-linen border-b border-line">
                <View className="flex-row bg-surface rounded-xl p-1.5 border border-line">
                    <TouchableOpacity
                        onPress={() => setViewMode('calendar')}
                        className={`flex-1 py-2.5 rounded-lg ${viewMode === 'calendar' ? 'bg-herb' : ''}`}
                    >
                        <Text
                            className={`text-center font-medium ${viewMode === 'calendar' ? 'text-white' : 'text-muted'
                                }`}
                        >
                            Month
                        </Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                        onPress={() => setViewMode('list')}
                        className={`flex-1 py-2.5 rounded-lg ${viewMode === 'list' ? 'bg-herb' : ''}`}
                    >
                        <Text
                            className={`text-center font-medium ${viewMode === 'list' ? 'text-white' : 'text-muted'
                                }`}
                        >
                            Week
                        </Text>
                    </TouchableOpacity>
                </View>
            </View>

            {viewMode === 'calendar' ? (
                <ScrollView
                    className="flex-1 px-4 pt-3"
                    refreshControl={
                        <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
                    }
                >
                    {errorByResource?.mealPlan ? (
                        <ErrorBanner testID="calendar-load-error" onRetry={() => void refresh()} />
                    ) : null}
                    {emptyAndPendingBanner}

                    <>
                        {/* Month Navigation */}
                        <View className="flex-row justify-between items-center mb-4">
                            <TouchableOpacity onPress={() => setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>
                                <ChevronLeft size={28} color={colors.muted} />
                            </TouchableOpacity>

                            <Text className="text-xl font-bold text-ink">
                                {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
                            </Text>

                            <TouchableOpacity onPress={() => setCurrentDate((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>
                                <ChevronRight size={28} color={colors.muted} />
                            </TouchableOpacity>
                        </View>

                        <RNCalendar
                            key={currentDate.toISOString()}
                            current={currentDate.toISOString().split('T')[0]}
                            onDayPress={(day) => {
                                // Fix: Parse year, month, day separately to avoid UTC offset
                                const [year, month, dayNum] = day.dateString.split('-').map(Number);
                                setSelectedDate(new Date(year, month - 1, dayNum));
                            }}
                            markedDates={{
                                [selectedDate ? formatDateString(selectedDate) : '']: {
                                    selected: true,
                                    selectedColor: colors.herb,
                                },
                            }}
                            theme={{
                                backgroundColor: 'transparent',
                                calendarBackground: colors.linen,
                                textSectionTitleColor: colors.muted,
                                selectedDayBackgroundColor: colors.herb,
                                selectedDayTextColor: colors.onHerb,
                                todayTextColor: colors.herb,
                                dayTextColor: colors.ink,
                                textDisabledColor: colors.muted,
                                monthTextColor: colors.ink,
                                arrowColor: colors.herb,
                            }}
                            hideExtraDays={false}
                            hideArrows={true}
                            renderHeader={() => null}
                            onMonthChange={(month) => {
                                setCurrentDate(new Date(month.year, month.month - 1, 1));
                            }}
                        />
                    </>

                    {/* Selected Day Content - Calendar View */}
                    {selectedDate && (
                        <View className="mt-5 bg-surface rounded-2xl p-4 mb-8 border border-line shadow-sm">
                            <View className="flex-row justify-between items-center mb-4">
                                <Text className="text-lg font-bold text-ink">
                                    {selectedDate.toLocaleDateString('en-US', {
                                        weekday: 'long',
                                        month: 'long',
                                        day: 'numeric',
                                    })}
                                </Text>

                                <TouchableOpacity
                                    onPress={() => setShowAddModal(true)}
                                    className="bg-herb px-4 py-2 rounded-xl"
                                >
                                    <Text className="text-white font-medium">+ Add</Text>
                                </TouchableOpacity>
                            </View>

                            {(() => {
                                const byType = getHistoryByType();
                                const types = ['breakfast', 'lunch', 'dinner', 'snack'] as const;

                                return types.map((type) =>
                                    byType[type].length > 0 ? (
                                        <View key={type} className="mb-5">
                                            <Text className="text-base font-semibold mb-2 capitalize text-ink">
                                                {type}
                                            </Text>

                                            {byType[type].map((item) => (
                                                <TouchableOpacity
                                                    key={item.id}
                                                    onPress={() => openRecipeDetail(item)}
                                                    className="bg-linen p-4 rounded-xl mb-2.5 border border-line"
                                                >
                                                    <View className="flex-row justify-between items-center">
                                                        <View className="flex-1 mr-2">
                                                            <Text className="font-medium text-ink">{item.meal_name}</Text>
                                                            {item.status && item.status !== 'PLANNED' && (
                                                                <Text className="text-xs text-muted mt-0.5">
                                                                    {item.status === 'PENDING_CONFIRM' && 'Waiting: did you cook this?'}
                                                                    {item.status === 'CONFIRMED' && 'Cooked'}
                                                                    {item.status === 'SKIPPED' && "Didn't cook"}
                                                                </Text>
                                                            )}
                                                        </View>

                                                        <View className="flex-row items-center">
                                                            {canActOnMeal(item) && (
                                                                <>
                                                                    <TouchableOpacity
                                                                        onPress={() => handleConfirmMeal(item)}
                                                                        className="p-2 mr-1"
                                                                    >
                                                                        <Check size={20} color={colors.herb} />
                                                                    </TouchableOpacity>
                                                                    <TouchableOpacity
                                                                        onPress={() => handleSkipMeal(item)}
                                                                        className="p-2 mr-1"
                                                                    >
                                                                        <X size={20} color={colors.muted} />
                                                                    </TouchableOpacity>
                                                                </>
                                                            )}
                                                            <TouchableOpacity
                                                                onPress={() => {
                                                                    setRecipeToDelete(item);
                                                                    setShowDeleteConfirm(true);
                                                                }}
                                                            >
                                                                <Trash2 size={20} color={colors.danger} />
                                                            </TouchableOpacity>
                                                        </View>
                                                    </View>
                                                </TouchableOpacity>
                                            ))}
                                        </View>
                                    ) : null
                                );
                            })()}
                        </View>
                    )}
                </ScrollView>
            ) : (
                <View className="flex-1 px-4 pt-3">
                    <FlashList
                        data={weekDates}
                        keyExtractor={(date) => formatDateString(date)}
                        renderItem={renderWeekDay}
                        ListHeaderComponent={weekNavHeader}
                        extraData={expandedKey}
                        drawDistance={DRAW_DISTANCE}
                        contentContainerStyle={{ paddingBottom: 40 }}
                        refreshControl={
                            <RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} />
                        }
                    />
                </View>
            )}

            {/* ADD RECIPE BOTTOM MODAL */}
            <Modal
                visible={showAddModal}
                transparent
                animationType="slide"
                onRequestClose={() => setShowAddModal(false)}
            >
                <KeyboardAvoidingView
                    behavior={Platform.OS === 'ios' ? 'padding' : undefined}
                    className="flex-1 justify-end bg-black/50"
                >
                    <View className="bg-surface rounded-t-3xl p-6 max-h-[85%]">
                        <View className="flex-row justify-between items-center mb-5">
                            <Text className="text-xl font-bold text-ink">Add to Calendar</Text>
                            <TouchableOpacity onPress={() => setShowAddModal(false)}>
                                <X size={28} color={colors.muted} />
                            </TouchableOpacity>
                        </View>

                        {/* Meal Type */}
                        <Text className="text-ink font-medium mb-2">Meal Type</Text>
                        <View className="flex-row flex-wrap gap-2 mb-6">
                            {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map((type) => (
                                <TouchableOpacity
                                    key={type}
                                    onPress={() => setSelectedMealType(type)}
                                    className={`px-4 py-2.5 rounded-full border ${selectedMealType === type
                                        ? 'bg-herb border-herb'
                                        : 'border-line bg-surface'
                                        }`}
                                >
                                    <Text
                                        className={`capitalize ${selectedMealType === type ? 'text-white' : 'text-ink'
                                            }`}
                                    >
                                        {type}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>

                        {/* Recipe Search / Select */}
                        <Text className="text-ink font-medium mb-2">Recipe</Text>
                        <View className="relative mb-6">
                            <View
                                testID="calendar-recipe-search-icon-wrap"
                                className="absolute left-3 top-3 z-10"
                                pointerEvents="none"
                            >
                                <Search size={20} color={colors.muted} />
                            </View>
                            <TextInput
                                className="bg-linen border border-line rounded-xl pl-10 py-3 text-ink"
                                placeholder="Search recipe..."
                                placeholderTextColor={colors.muted}
                                value={searchQuery}
                                onChangeText={setSearchQuery}
                            />
                        </View>

                        <ScrollView
                            className="max-h-64 mb-6"
                            keyboardShouldPersistTaps="handled"
                            keyboardDismissMode="interactive"
                        >
                            {recipeList
                                .filter((r) => r.meal_name?.toLowerCase().includes(searchQuery.toLowerCase()))
                                .map((recipe) => (
                                    <TouchableOpacity
                                        key={recipe.id}
                                        onPress={() => setSelectedRecipeId(recipe.id)}
                                        className={`p-3 border-b border-line ${selectedRecipeId === recipe.id ? 'bg-sage' : ''
                                            }`}
                                    >
                                        <Text className="text-ink">{recipe.meal_name}</Text>
                                    </TouchableOpacity>
                                ))}
                        </ScrollView>

                        <View className="flex-row gap-3">
                            <TouchableOpacity
                                onPress={() => setShowAddModal(false)}
                                className="flex-1 py-4 bg-linen border border-line rounded-xl"
                            >
                                <Text className="text-center font-medium text-ink">Cancel</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                onPress={handleAddMeal}
                                disabled={!selectedRecipeId}
                                className={`flex-1 py-4 rounded-xl ${selectedRecipeId ? 'bg-herb' : 'bg-sage'
                                    }`}
                            >
                                <Text className="text-center font-medium text-white">Add</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </KeyboardAvoidingView>
            </Modal>

            {/* Delete Confirmation */}
            <Modal visible={showDeleteConfirm} transparent animationType="fade">
                <View className="flex-1 justify-center items-center bg-black/60 px-5">
                    <View className="bg-surface rounded-2xl p-6 w-full max-w-sm">
                        <View className="flex-row items-center mb-4">
                            <AlertCircle size={28} color={colors.danger} />
                            <Text className="ml-3 text-xl font-bold text-ink">Delete?</Text>
                        </View>

                        <Text className="text-muted mb-6">
                            Are you sure you want to remove this meal plan?
                        </Text>

                        <View className="flex-row gap-3">
                            <TouchableOpacity
                                onPress={() => setShowDeleteConfirm(false)}
                                className="flex-1 py-3.5 bg-linen border border-line rounded-xl"
                            >
                                <Text className="text-center font-medium text-ink">Cancel</Text>
                            </TouchableOpacity>

                            <TouchableOpacity
                                onPress={handleDelete}
                                className="flex-1 py-3.5 bg-herb-deep rounded-xl"
                            >
                                <Text className="text-center font-medium text-white">Delete</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Recipe Detail Modal */}
            <Modal
                visible={showRecipeDetail}
                transparent
                animationType="slide"
                onRequestClose={() => {
                    setShowRecipeDetail(false);
                    setSelectedRecipeDetail(null);
                }}
            >
                <View className="flex-1 bg-black/50 justify-end">
                    <View className="bg-surface rounded-t-3xl max-h-[85%]">
                        <View className="p-4 border-b border-line flex-row justify-between items-start">
                            <Text className="text-xl font-bold text-ink flex-1 mr-3">
                                {selectedRecipeDetail?.meal_name || 'Recipe'}
                            </Text>
                            <TouchableOpacity
                                onPress={() => {
                                    setShowRecipeDetail(false);
                                    setSelectedRecipeDetail(null);
                                }}
                                className="p-1"
                            >
                                <X size={24} color={colors.muted} />
                            </TouchableOpacity>
                        </View>

                        <ScrollView className="px-4 py-4">
                            {(selectedRecipeDetail?.ingredients?.length ?? 0) > 0 ? (
                                <View className="mb-6">
                                    <Text className="text-lg font-semibold text-ink mb-3">Ingredients</Text>
                                    {selectedRecipeDetail!.ingredients.map((ing, index) => (
                                        <View key={index} className="flex-row justify-between py-2 border-b border-line">
                                            <Text className="text-ink capitalize flex-1">{ing.name}</Text>
                                            <Text className="text-muted">
                                                {ing.quantity} {ing.unit}
                                            </Text>
                                        </View>
                                    ))}
                                </View>
                            ) : (
                                <Text className="text-muted mb-6">No ingredients listed for this recipe.</Text>
                            )}

                            <View className="mb-8">
                                <Text className="text-lg font-semibold text-ink mb-3">Instructions</Text>
                                {(selectedRecipeDetail?.instructions?.length ?? 0) > 0 ? (
                                    selectedRecipeDetail!.instructions.map((step, index) => (
                                        <View key={index} className="flex-row mb-3">
                                            <View className="w-6 h-6 rounded-full bg-sage items-center justify-center mr-3 mt-0.5">
                                                <Text className="text-xs font-medium text-herb-deep">{index + 1}</Text>
                                            </View>
                                            <Text className="flex-1 text-ink leading-5">{step}</Text>
                                        </View>
                                    ))
                                ) : (
                                    <Text className="text-muted">No instructions available for this recipe.</Text>
                                )}
                            </View>
                        </ScrollView>

                        <View className="p-4 border-t border-line">
                            <TouchableOpacity
                                onPress={() => {
                                    setShowRecipeDetail(false);
                                    setSelectedRecipeDetail(null);
                                }}
                                className="bg-linen border border-line py-3 rounded-xl"
                            >
                                <Text className="text-center text-ink font-medium">Close</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}

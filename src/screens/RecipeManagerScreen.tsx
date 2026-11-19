/**
 * RecipeManagerScreen - Connected to Real Backend API
 * 
 * This screen manages recipes and folders with full CRUD operations
 * connected to the backend API.
 */
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { FOCUS_STALE_MS } from '../hooks/useFocusRefresh';
import {
    View,
    Text,
    TouchableOpacity,
    TextInput,
    ScrollView,
    Modal,
    ActivityIndicator,
    Alert,
    RefreshControl,
} from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useTranslation } from 'react-i18next';
import {
    PlusIcon,
    TrashIcon,
    SearchIcon,
    EditIcon,
    XIcon,
    FolderIcon,
    ChevronRightIcon,
    HomeIcon,
    FolderPlusIcon,
    AlertCircleIcon,
    CameraIcon,
    ImageIcon,
} from 'lucide-react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { imageUploadApi } from '../api/imageUpload';
import AppHeader from '../components/AppHeader';
import { QuantityLabel } from '../components/UnitSelect';
import type { MeasurementSystem } from '../utils/units';
import { kindOf } from '../utils/units';

import { Recipe, Folder } from '../types';
import { normalizeRecipe, usePantry } from '../contexts/pantryContext';
import { CachedImage } from '../components/ui/CachedImage';
import { SkeletonList } from '../components/ui/Skeleton';
import { FolderRow, RecipeRow } from '../components/recipes/RecipeListRows';
import {
    RecipeIngredientRow,
    type RecipeIngredient,
} from '../components/recipes/RecipeIngredientRow';
import { DRAW_DISTANCE } from '../constants/listPerf';
import { colors } from '../theme/tokens';
import {
    applyCatalogIngredient,
    createEmptyRecipeForm,
    findCatalogIngredient,
} from '../utils/recipePayload';

// ============================================================================
// TYPES (Local interfaces for component state)
// ============================================================================

// Default folders that always exist (created on backend if not present)
const DEFAULT_FOLDER_NAMES = ['Uncategorized', 'Favorites', 'Breakfast', 'Lunch', 'Dinner'];

export default function RecipeManagerScreen() {
    const { t } = useTranslation();
    const navigation = useNavigation();
    const route = useRoute();
    const recipeIdParam = (route.params as { recipeId?: string } | undefined)?.recipeId;
    const {
        recipes,
        folders,
        ingredients,
        fetchAllRecipes,
        fetchAllFolders,
        fetchAllIngredients,
        addRecipe,
        updateRecipe,
        deleteRecipe,
        addFolder,
        updateFolder,
        deleteFolder,
        userSettings,
        loading,
        loadingByResource,
        errorByResource,
    } = usePantry();
    const measurementSystem = (userSettings.measurement_unit === 'imperial' ? 'imperial' : 'metric') as MeasurementSystem;

    // ========================================================================
    // STATE - Loading and Error (lists live in pantryContext)
    // ========================================================================
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [uploadingImage, setUploadingImage] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // ========================================================================
    // STATE - UI Navigation
    // ========================================================================
    const [currentFolder, setCurrentFolder] = useState<Folder | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedRecipe, setSelectedRecipe] = useState<Recipe | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [showAddRecipe, setShowAddRecipe] = useState(false);

    // ========================================================================
    // STATE - Folder Modals
    // ========================================================================
    const [showAddFolder, setShowAddFolder] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [editingFolder, setEditingFolder] = useState<Folder | null>(null);
    const [showFolderActions, setShowFolderActions] = useState<string | null>(null);
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null);

    // ========================================================================
    // STATE - New/Edit Recipe Form
    // ========================================================================
    const [newRecipe, setNewRecipe] = useState<Partial<Recipe>>(createEmptyRecipeForm());

    // Latest catalog for callbacks; refetch only when it is empty (it is loaded at login).
    const ingredientsRef = useRef(ingredients);
    ingredientsRef.current = ingredients;
    const ensureIngredients = useCallback(() => {
        if (ingredientsRef.current.length === 0) {
            void fetchAllIngredients();
        }
    }, [fetchAllIngredients]);

    const openAddRecipeForm = useCallback((folderId = '') => {
        setSelectedRecipe(null);
        setIsEditing(false);
        setNewRecipe(createEmptyRecipeForm(folderId));
        setShowAddRecipe(true);
        ensureIngredients();
        if (folderId) {
            setCurrentFolder((prev) => {
                if (prev?.id === folderId) return prev;
                return folders.find((f) => f.id === folderId) ?? prev;
            });
        }
    }, [folders, ensureIngredients]);

    // ========================================================================
    // DATA - Refetch via pantryContext
    // ========================================================================

    const lastLoadedAtRef = useRef(0);

    const loadData = useCallback(async (force = false) => {
        // Focus refetch only when stale (~60 s); pull-to-refresh / Try Again force it.
        if (!force && Date.now() - lastLoadedAtRef.current < FOCUS_STALE_MS) {
            setHasLoadedOnce(true);
            return;
        }
        lastLoadedAtRef.current = Date.now();
        setError(null);
        try {
            await Promise.all([
                fetchAllFolders(),
                fetchAllRecipes(),
                // The ingredient catalog is loaded at login; only refetch when empty or forced.
                force || ingredientsRef.current.length === 0 ? fetchAllIngredients() : Promise.resolve(),
            ]);
        } catch (err) {
            lastLoadedAtRef.current = 0;
            setError('Failed to load data. Please try again.');
            console.error('[RecipeManager] Load error:', err);
        } finally {
            setHasLoadedOnce(true);
        }
    }, [fetchAllFolders, fetchAllRecipes, fetchAllIngredients]);

    const handleRefresh = useCallback(async () => {
        setRefreshing(true);
        await loadData(true);
        setRefreshing(false);
    }, [loadData]);

    useFocusEffect(
        useCallback(() => {
            void loadData();
        }, [loadData]),
    );

    useEffect(() => {
        if (!recipeIdParam || recipes.length === 0) {
            return;
        }
        const match = recipes.find((recipe) => recipe.id === recipeIdParam);
        if (match) {
            setSelectedRecipe(match);
        }
    }, [recipeIdParam, recipes]);

    // ========================================================================
    // COMPUTED VALUES
    // ========================================================================

    /**
     * Filter recipes based on current folder and search query
     */
    const filteredRecipes = useMemo(() => {
        return (Array.isArray(recipes) ? recipes : []).filter((recipe) => {
            // Filter by folder
            if (currentFolder && recipe.folder_id !== currentFolder.id) return false;

            // Filter by search query
            if (!searchQuery.trim()) return true;
            const query = searchQuery.toLowerCase();
            const matchesName = recipe.meal_name.toLowerCase().includes(query);
            const matchesIngredient = recipe.ingredients?.some(
                (item) => item.name.toLowerCase().includes(query)
            );
            return matchesName || matchesIngredient;
        });
    }, [recipes, currentFolder, searchQuery]);

    const recipeCountByFolder = useMemo(() => {
        const map: Record<string, number> = {};
        for (const r of recipes) {
            const id = r.folder_id || '';
            map[id] = (map[id] ?? 0) + 1;
        }
        return map;
    }, [recipes]);

    const showSkeleton =
        !hasLoadedOnce &&
        (loadingByResource.recipes || loading) &&
        (Array.isArray(recipes) ? recipes : []).length === 0;

    // ========================================================================
    // FOLDER HANDLERS
    // ========================================================================

    /**
     * Create a new folder via pantryContext
     */
    const handleCreateFolder = async () => {
        if (!newFolderName.trim()) return;

        setSaving(true);
        try {
            const response = await addFolder({
                name: newFolderName.trim(),
                icon: 'FolderIcon',
            });

            if (response.success && response.data) {
                setNewFolderName('');
                setShowAddFolder(false);
            } else {
                Alert.alert('Error', response.message || 'Failed to create folder');
            }
        } catch (err) {
            console.error('[RecipeManager] Create folder error:', err);
            Alert.alert('Error', 'Failed to create folder. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    /**
     * Update folder name via pantryContext
     */
    const handleUpdateFolder = async () => {
        if (!editingFolder || !newFolderName.trim()) return;

        setSaving(true);
        try {
            await updateFolder({
                ...editingFolder,
                name: newFolderName.trim(),
            });
            setEditingFolder(null);
            setNewFolderName('');
        } catch (err) {
            console.error('[RecipeManager] Update folder error:', err);
            Alert.alert('Error', 'Failed to update folder. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    /**
     * Delete folder via pantryContext
     */
    const handleDeleteFolder = async () => {
        if (!folderToDelete) return;

        setSaving(true);
        try {
            await deleteFolder(folderToDelete.id);
            setFolderToDelete(null);
            setShowDeleteConfirm(false);
            if (currentFolder?.id === folderToDelete.id) setCurrentFolder(null);
        } catch (err) {
            console.error('[RecipeManager] Delete folder error:', err);
            Alert.alert('Error', 'Failed to delete folder. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    // ========================================================================
    // RECIPE HANDLERS
    // ========================================================================

    /**
     * Add new ingredient row to form
     */
    const handleAddIngredient = () => {
        if (isEditing && selectedRecipe) {
            setSelectedRecipe((prev) =>
                prev
                    ? {
                          ...prev,
                          ingredients: [
                              ...(prev.ingredients || []),
                              { name: '', quantity: 1, unit: 'pcs' },
                          ],
                      }
                    : prev,
            );
        } else {
            setNewRecipe((prev) => ({
                ...prev,
                ingredients: [...(prev.ingredients || []), { name: '', quantity: 1, unit: 'pcs' }],
            }));
        }
    };

    /**
     * Update ingredient field; sync unit from catalog when name matches.
     */
    const patchIngredient = useCallback((
        recipeIngredients: RecipeIngredient[],
        index: number,
        field: 'name' | 'quantity' | 'unit',
        value: string,
    ): RecipeIngredient[] => {
        const updated = [...recipeIngredients];
        const current = { ...updated[index] };

        if (field === 'quantity') {
            updated[index] = { ...current, quantity: parseFloat(value) || 0 };
            return updated;
        }

        if (field === 'unit') {
            updated[index] = {
                ...current,
                unit: value,
                // Free-typed rows stay unlocked; catalog-bound rows keep kind
                unit_kind: current.ingredient_id
                    ? current.unit_kind || kindOf(value) || undefined
                    : undefined,
            };
            return updated;
        }

        // name change — bind to catalog when exact match so unit kind stays compatible
        const catalog = findCatalogIngredient(value, ingredients);
        updated[index] = applyCatalogIngredient(
            { ...current, name: value },
            catalog,
            measurementSystem,
        );
        return updated;
    }, [ingredients, measurementSystem]);

    const resolveIngredientsForSave = useCallback(
        (rows: RecipeIngredient[]): RecipeIngredient[] =>
            rows
                .filter((ing) => ing.name?.trim())
                .map((ing) =>
                    applyCatalogIngredient(
                        ing,
                        findCatalogIngredient(ing.name, ingredients),
                        measurementSystem,
                    ),
                ),
        [ingredients, measurementSystem],
    );

    const handleUpdateNewIngredient = useCallback(
        (index: number, field: 'name' | 'quantity' | 'unit', value: string) => {
            setNewRecipe((prev) => ({
                ...prev,
                ingredients: patchIngredient(prev.ingredients || [], index, field, value),
            }));
        },
        [patchIngredient],
    );

    const handleUpdateSelectedIngredient = useCallback(
        (index: number, field: 'name' | 'quantity' | 'unit', value: string) => {
            setSelectedRecipe((prev) => {
                if (!prev) return prev;
                return {
                    ...prev,
                    ingredients: patchIngredient(prev.ingredients || [], index, field, value),
                };
            });
        },
        [patchIngredient],
    );

    const handleRemoveNewIngredient = useCallback((index: number) => {
        setNewRecipe((prev) => ({
            ...prev,
            ingredients: (prev.ingredients || []).filter((_, i) => i !== index),
        }));
    }, []);

    const handleRemoveSelectedIngredient = useCallback((index: number) => {
        setSelectedRecipe((prev) =>
            prev
                ? {
                      ...prev,
                      ingredients: (prev.ingredients || []).filter((_, i) => i !== index),
                  }
                : prev,
        );
    }, []);

    const focusFolder = useCallback((folderId: string) => {
        if (!folderId) return;
        const folder = folders.find((f) => f.id === folderId);
        if (folder) {
            setCurrentFolder(folder);
        }
    }, [folders]);

    /**
     * Save recipe (create or update) via pantryContext
     */
    const handleSaveRecipe = async () => {
        const recipeToSave = isEditing && selectedRecipe ? selectedRecipe : newRecipe;
        const validIngredients = resolveIngredientsForSave(recipeToSave.ingredients ?? []);

        if (!recipeToSave.meal_name?.trim()) {
            Alert.alert('Error', 'Meal name is required');
            return;
        }
        if (validIngredients.length === 0) {
            Alert.alert('Error', 'Add at least one ingredient with a name');
            return;
        }

        setSaving(true);
        try {
            if (isEditing && selectedRecipe) {
                const targetFolderId = selectedRecipe.folder_id || currentFolder?.id || '';
                const editedSnapshot = normalizeRecipe({
                    ...selectedRecipe,
                    ingredients: validIngredients,
                });

                setSelectedRecipe(null);
                setIsEditing(false);
                focusFolder(targetFolderId);

                await updateRecipe(editedSnapshot);
                focusFolder(editedSnapshot.folder_id || targetFolderId);
            } else {
                const targetFolderId = (newRecipe.folder_id || currentFolder?.id || '').trim();
                const response = await addRecipe({
                    meal_name: newRecipe.meal_name!.trim(),
                    folder_id: targetFolderId,
                    ingredients: validIngredients,
                    instructions: newRecipe.instructions || [],
                    image: newRecipe.image || null,
                });

                if (response.success && response.data) {
                    setNewRecipe(createEmptyRecipeForm(targetFolderId));
                    setShowAddRecipe(false);
                    focusFolder(response.data.folder_id || targetFolderId);
                } else {
                    Alert.alert('Error', response.message || 'Failed to create recipe');
                }
            }
        } catch (err) {
            console.error('[RecipeManager] Save recipe error:', err);
            Alert.alert('Error', 'Failed to save recipe. Please try again.');
        } finally {
            setSaving(false);
        }
    };

    /**
     * Delete recipe via pantryContext
     */
    const handleDeleteRecipe = useCallback((recipeId: string) => {
        Alert.alert('Delete Recipe', 'Are you sure you want to delete this recipe?', [
            { text: 'Cancel', style: 'cancel' },
            {
                text: 'Delete',
                style: 'destructive',
                onPress: async () => {
                    try {
                        await deleteRecipe(recipeId);
                    } catch (err) {
                        console.error('[RecipeManager] Delete recipe error:', err);
                        Alert.alert('Error', 'Failed to delete recipe. Please try again.');
                    }
                },
            },
        ]);
    }, [deleteRecipe]);

    // ========================================================================
    // IMAGE PICKER HANDLERS (upload to R2 — never persist file://)
    // ========================================================================

    const currentImagePublicId = (): string => {
        if (isEditing && selectedRecipe?.image?.public_id) {
            return selectedRecipe.image.public_id;
        }
        return newRecipe.image?.public_id ?? '';
    };

    const applyUploadedImage = (imageData: { url: string; public_id: string }) => {
        if (isEditing && selectedRecipe) {
            setSelectedRecipe((prev) => (prev ? { ...prev, image: imageData } : prev));
        } else {
            setNewRecipe((prev) => ({ ...prev, image: imageData }));
        }
    };

    const uploadPickedUri = async (uri: string) => {
        const previousPublicId = currentImagePublicId();
        setUploadingImage(true);
        try {
            const res = await imageUploadApi.upload(uri);
            if (!res.success || !res.data?.image_url) {
                Alert.alert(
                    'Upload failed',
                    res.message || 'Could not upload image. Please try again.',
                );
                return;
            }
            applyUploadedImage({
                url: res.data.image_url,
                public_id: res.data.public_id || '',
            });
            if (previousPublicId && previousPublicId !== res.data.public_id) {
                void imageUploadApi.delete(previousPublicId);
            }
        } catch {
            Alert.alert('Upload failed', 'Could not upload image. Please try again.');
        } finally {
            setUploadingImage(false);
        }
    };

    const pickImage = async () => {
        if (uploadingImage) return;
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!permission.granted) {
            Alert.alert('Permission Required', 'Please allow access to your photo library.');
            return;
        }

        const result = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.8,
        });

        if (!result.canceled && result.assets[0]?.uri) {
            await uploadPickedUri(result.assets[0].uri);
        }
    };

    const takePhoto = async () => {
        if (uploadingImage) return;
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
            Alert.alert('Permission Required', 'Please allow access to your camera.');
            return;
        }

        const result = await ImagePicker.launchCameraAsync({
            allowsEditing: true,
            aspect: [4, 3],
            quality: 0.8,
        });

        if (!result.canceled && result.assets[0]?.uri) {
            await uploadPickedUri(result.assets[0].uri);
        }
    };

    const removeImage = async () => {
        const publicId = currentImagePublicId();
        if (isEditing && selectedRecipe) {
            setSelectedRecipe((prev) => (prev ? { ...prev, image: null } : prev));
        } else {
            setNewRecipe((prev) => ({ ...prev, image: null }));
        }
        if (publicId) {
            try {
                await imageUploadApi.delete(publicId);
            } catch {
                // Best-effort delete; form already cleared
            }
        }
    };

    /**
     * Handle instructions text change
     */
    const handleInstructionsChange = (text: string) => {
        const instructionsArray = text.split('\n').filter(line => line.trim());
        if (isEditing && selectedRecipe) {
            setSelectedRecipe((prev) => (prev ? { ...prev, instructions: instructionsArray } : prev));
        } else {
            setNewRecipe((prev) => ({ ...prev, instructions: instructionsArray }));
        }
    };

    /**
     * Get instructions as text
     */
    const getInstructionsText = () => {
        if (isEditing && selectedRecipe) {
            return (selectedRecipe.instructions || []).join('\n');
        }
        return (newRecipe.instructions || []).join('\n');
    };

    // ========================================================================
    // RENDER HELPERS
    // ========================================================================

    const handleRenameFolder = useCallback((f: Folder) => {
        setEditingFolder(f);
        setNewFolderName(f.name);
        setShowFolderActions(null);
    }, []);

    const handleAddRecipeToFolder = useCallback((f: Folder) => {
        openAddRecipeForm(f.id);
        setShowFolderActions(null);
    }, [openAddRecipeForm]);

    const handleRequestDeleteFolder = useCallback((f: Folder) => {
        setFolderToDelete(f);
        setShowDeleteConfirm(true);
        setShowFolderActions(null);
    }, []);

    const handleOpenRecipe = useCallback((r: Recipe) => {
        setSelectedRecipe(r);
        setIsEditing(false);
    }, []);

    const handleEditRecipe = useCallback((r: Recipe) => {
        setSelectedRecipe(r);
        setIsEditing(true);
        ensureIngredients();
    }, [ensureIngredients]);

    /**
     * Render folder card
     */
    const renderFolderCard = useCallback(({ item: folder }: { item: Folder }) => (
        <FolderRow
            folder={folder}
            recipeCount={recipeCountByFolder[folder.id] ?? 0}
            showActions={showFolderActions === folder.id}
            onOpen={setCurrentFolder}
            onToggleActions={setShowFolderActions}
            onRename={handleRenameFolder}
            onAddRecipe={handleAddRecipeToFolder}
            onDelete={handleRequestDeleteFolder}
        />
    ), [
        recipeCountByFolder,
        showFolderActions,
        handleRenameFolder,
        handleAddRecipeToFolder,
        handleRequestDeleteFolder,
    ]);

    /**
     * Render recipe card
     */
    const renderRecipeCard = useCallback(({ item: recipe }: { item: Recipe }) => (
        <RecipeRow
            recipe={recipe}
            onOpen={handleOpenRecipe}
            onEdit={handleEditRecipe}
            onDelete={handleDeleteRecipe}
        />
    ), [handleOpenRecipe, handleEditRecipe, handleDeleteRecipe]);

    const handleNavigateBack = () => {
        if (showAddRecipe) {
            setShowAddRecipe(false);
            return;
        }
        if (selectedRecipe) {
            setSelectedRecipe(null);
            setIsEditing(false);
            return;
        }
        if (currentFolder) {
            setCurrentFolder(null);
        }
    };

    const isNestedRecipeView = Boolean(showAddRecipe || selectedRecipe || currentFolder);

    const recipeHeader = (
        <AppHeader
            title={t('recipes.title')}
            showMenuButton={!isNestedRecipeView}
            showBackButton={isNestedRecipeView}
            onBack={handleNavigateBack}
        />
    );

    const renderFolderPicker = (
        selectedFolderId: string | undefined,
        onSelect: (folderId: string) => void
    ) => (
        <View className="mb-4">
            <Text className="text-ink mb-2">Folder</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                {folders.map((folder) => {
                    const selected = (selectedFolderId || '') === folder.id;
                    return (
                        <TouchableOpacity
                            key={folder.id}
                            onPress={() => onSelect(folder.id)}
                            className={`mr-2 px-3 py-2 rounded-full border ${
                                selected ? 'bg-herb border-herb' : 'bg-surface border-line'
                            }`}
                        >
                            <Text className={selected ? 'text-white font-medium' : 'text-ink'}>
                                {folder.name}
                            </Text>
                        </TouchableOpacity>
                    );
                })}
            </ScrollView>
        </View>
    );

    // ========================================================================
    // LOADING STATE
    // ========================================================================
    if (showSkeleton) {
        return (
            <View className="flex-1 bg-linen">
                {recipeHeader}
                <View className="flex-1 p-4">
                    <SkeletonList count={6} />
                </View>
            </View>
        );
    }

    // ========================================================================
    // ERROR STATE
    // ========================================================================
    const loadFailed =
        Boolean(errorByResource?.recipes) &&
        (Array.isArray(recipes) ? recipes : []).length === 0 &&
        hasLoadedOnce;
    if (error || loadFailed) {
        return (
            <View className="flex-1 bg-linen">
                {recipeHeader}
                <View className="flex-1 items-center justify-center p-6">
                    <AlertCircleIcon size={48} color={colors.danger} />
                    <Text className="text-ink text-lg mt-4 text-center">{error ?? t('common.loadError')}</Text>
                    <TouchableOpacity
                        onPress={() => void loadData(true)}
                        className="mt-6 bg-herb px-6 py-3 rounded-xl"
                    >
                        <Text className="text-white font-medium">Try Again</Text>
                    </TouchableOpacity>
                </View>
            </View>
        );
    }

    // ========================================================================
    // MAIN RENDER
    // ========================================================================
    return (
        <View className="flex-1 bg-linen" testID="recipe-screen">
            {recipeHeader}

            {!showAddRecipe && !selectedRecipe ? (
                <View className="flex-1 p-4">
                    <View className="flex-row items-center mb-4">
                        {currentFolder && (
                            <TouchableOpacity hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                                onPress={() => setCurrentFolder(null)}
                                className="mr-2 p-1"
                                accessibilityLabel="Back to categories"
                            >
                                <ChevronRightIcon
                                    size={18}
                                    color={colors.muted}
                                    style={{ transform: [{ rotate: '180deg' }] }}
                                />
                            </TouchableOpacity>
                        )}
                        <TouchableOpacity onPress={() => setCurrentFolder(null)} className="flex-row items-center">
                            <HomeIcon size={16} color={colors.muted} />
                            <Text className="text-muted ml-1">Categories</Text>
                        </TouchableOpacity>
                        {currentFolder && (
                            <>
                                <ChevronRightIcon size={16} color={colors.muted} />
                                <Text className="text-ink font-medium ml-1">{currentFolder.name}</Text>
                            </>
                        )}
                    </View>

                    {!currentFolder ? (
                        <FlashList
                            data={folders}
                            renderItem={renderFolderCard}
                            keyExtractor={(item) => item.id}
                            drawDistance={DRAW_DISTANCE}
                            refreshing={refreshing}
                            onRefresh={handleRefresh}
                            ListHeaderComponent={
                                <View className="flex-row justify-between items-center mb-4">
                                    <Text className="text-xl font-bold text-ink">Recipe Categories</Text>
                                    <TouchableOpacity
                                        onPress={() => {
                                            setNewFolderName('');
                                            setShowAddFolder(true);
                                        }}
                                        className="flex-row items-center bg-sage px-3 py-2 rounded-lg border border-line"
                                    >
                                        <FolderPlusIcon size={16} color={colors.danger} />
                                        <Text className="text-herb-deep ml-1 font-medium">New</Text>
                                    </TouchableOpacity>
                                </View>
                            }
                            ListEmptyComponent={
                                <View className="bg-surface rounded-xl p-6 items-center border border-line">
                                    <FolderIcon size={48} color={colors.line} />
                                    <Text className="text-muted mt-4">No categories yet</Text>
                                    <Text className="text-muted text-sm mt-1">
                                        Create a category to organize your recipes
                                    </Text>
                                </View>
                            }
                        />
                    ) : (
                        <FlashList
                            data={filteredRecipes}
                            renderItem={renderRecipeCard}
                            keyExtractor={(item) => item.id}
                            extraData={filteredRecipes}
                            drawDistance={DRAW_DISTANCE}
                            refreshing={refreshing}
                            onRefresh={handleRefresh}
                            ListHeaderComponent={
                                <View>
                                    <View className="relative mb-4">
                                        <View className="absolute left-3 top-3 z-10">
                                            <SearchIcon size={18} color={colors.muted} />
                                        </View>
                                        <TextInput
                                            placeholder="Search recipes..."
                                            value={searchQuery}
                                            onChangeText={setSearchQuery}
                                            className="w-full pl-10 pr-4 py-3 bg-surface rounded-xl border border-line text-ink"
                                        />
                                    </View>
                                    <TouchableOpacity
                                        testID="recipe-add-button"
                                        onPress={() => openAddRecipeForm(currentFolder.id)}
                                        className="flex-row items-center justify-center bg-surface border border-line py-3 rounded-xl mb-4"
                                    >
                                        <PlusIcon size={18} color={colors.ink} />
                                        <Text className="text-ink font-medium ml-2">Add New Recipe</Text>
                                    </TouchableOpacity>
                                </View>
                            }
                            ListEmptyComponent={
                                <View className="bg-surface rounded-xl p-6 items-center border border-line">
                                    <Text className="text-muted">No recipes found</Text>
                                </View>
                            }
                        />
                    )}
                </View>
            ) : (
            <ScrollView
                className="flex-1 p-4"
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="interactive"
                automaticallyAdjustKeyboardInsets
                contentContainerStyle={{ paddingBottom: 24 }}
                refreshControl={
                    <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={colors.herb} colors={[colors.herb]} />
                }
            >
                {selectedRecipe ? (
                    <View className="bg-surface rounded-xl overflow-hidden border border-line">
                        <View className="p-4 border-b border-line bg-linen flex-row justify-between items-center">
                            <Text className="font-semibold text-ink">
                                {isEditing ? 'Edit Recipe' : 'Recipe Details'}
                            </Text>
                            <TouchableOpacity hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                                onPress={() => {
                                    setSelectedRecipe(null);
                                    setIsEditing(false);
                                }}
                            >
                                <XIcon size={20} color={colors.muted} />
                            </TouchableOpacity>
                        </View>

                        <View className="p-4">
                            {isEditing ? (
                                // Edit Form
                                <View>
                                    <Text className="text-ink mb-2">Meal Name</Text>
                                    <TextInput
                                        value={selectedRecipe.meal_name}
                                        onChangeText={(text) =>
                                            setSelectedRecipe((prev) =>
                                                prev ? { ...prev, meal_name: text } : prev,
                                            )
                                        }
                                        autoComplete="off"
                                        textContentType="none"
                                        className="w-full p-3 border border-line rounded-xl mb-4 bg-linen text-ink"
                                    />

                                    {renderFolderPicker(selectedRecipe.folder_id, (folderId) =>
                                        setSelectedRecipe((prev) =>
                                            prev ? { ...prev, folder_id: folderId } : prev,
                                        )
                                    )}

                                    <Text className="text-ink mb-2">Recipe Image</Text>
                                    {uploadingImage ? (
                                        <View className="mb-4 py-8 items-center bg-linen rounded-xl border border-line">
                                            <ActivityIndicator color={colors.herb} />
                                            <Text className="text-muted mt-2">Uploading…</Text>
                                        </View>
                                    ) : selectedRecipe.image?.url ? (
                                        <View className="relative mb-4">
                                            <CachedImage
                                                uri={selectedRecipe.image.url}
                                                className="w-full h-48 rounded-xl"
                                                style={{ width: '100%', height: 192, borderRadius: 12 }}
                                                contentFit="cover"
                                            />
                                            <TouchableOpacity hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                                                onPress={() => {
                                                    void removeImage();
                                                }}
                                                className="absolute top-2 right-2 bg-black/50 p-2 rounded-full"
                                            >
                                                <XIcon size={16} color={colors.onHerb} />
                                            </TouchableOpacity>
                                        </View>
                                    ) : (
                                        <View className="flex-row gap-3 mb-4">
                                            <TouchableOpacity
                                                onPress={() => {
                                                    void takePhoto();
                                                }}
                                                className="flex-1 flex-row items-center justify-center py-3 bg-linen rounded-xl border border-dashed border-line"
                                            >
                                                <CameraIcon size={20} color={colors.muted} />
                                                <Text className="text-muted ml-2">Camera</Text>
                                            </TouchableOpacity>
                                            <TouchableOpacity
                                                onPress={() => {
                                                    void pickImage();
                                                }}
                                                className="flex-1 flex-row items-center justify-center py-3 bg-linen rounded-xl border border-dashed border-line"
                                            >
                                                <ImageIcon size={20} color={colors.muted} />
                                                <Text className="text-muted ml-2">Gallery</Text>
                                            </TouchableOpacity>
                                        </View>
                                    )}

                                    <Text className="text-ink mb-2">Instructions / Steps</Text>
                                    <TextInput
                                        value={getInstructionsText()}
                                        onChangeText={handleInstructionsChange}
                                        placeholder="Enter cooking instructions (one step per line)"
                                        multiline
                                        numberOfLines={6}
                                        textAlignVertical="top"
                                        className="w-full p-3 border border-line rounded-xl mb-4 bg-linen text-ink min-h-[120px]"
                                    />

                                    <View className="flex-row justify-between items-center mb-2">
                                        <Text className="text-ink font-medium">Ingredients</Text>
                                        <TouchableOpacity
                                            onPress={handleAddIngredient}
                                            className="flex-row items-center"
                                        >
                                            <PlusIcon size={16} color={colors.danger} />
                                            <Text className="text-herb ml-1">Add</Text>
                                        </TouchableOpacity>
                                    </View>

                                    {(selectedRecipe.ingredients || []).map((item, index) => (
                                        <RecipeIngredientRow
                                            key={`edit-ingredient-${index}`}
                                            item={item}
                                            index={index}
                                            measurementSystem={measurementSystem}
                                            onUpdate={handleUpdateSelectedIngredient}
                                            onRemove={handleRemoveSelectedIngredient}
                                            namePlaceholder={t('recipes.searchIngredient')}
                                        />
                                    ))}

                                    <View className="flex-row gap-2 mt-4">
                                        <TouchableOpacity
                                            onPress={() => {
                                                setSelectedRecipe(null);
                                                setIsEditing(false);
                                            }}
                                            className="flex-1 bg-linen border border-line py-3 rounded-lg"
                                        >
                                            <Text className="text-ink text-center font-medium">Cancel</Text>
                                        </TouchableOpacity>
                                        <TouchableOpacity
                                            onPress={handleSaveRecipe}
                                            disabled={saving}
                                            className={`flex-1 py-3 rounded-lg ${saving ? 'bg-sage' : 'bg-herb'
                                                }`}
                                        >
                                            {saving ? (
                                                <ActivityIndicator color={colors.onHerb} />
                                            ) : (
                                                <Text className="text-white text-center font-medium">
                                                    Save Changes
                                                </Text>
                                            )}
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            ) : (
                                // View Details
                                <View>
                                    <Text className="font-bold text-xl text-ink mb-4">
                                        {selectedRecipe.meal_name}
                                    </Text>

                                    {selectedRecipe.image?.url ? (
                                        <CachedImage
                                            uri={selectedRecipe.image.url}
                                            className="w-full h-40 rounded-xl mb-4"
                                            style={{ width: '100%', height: 160, borderRadius: 12 }}
                                        />
                                    ) : null}

                                    <View className="border-t border-b border-line py-4">
                                        <Text className="font-medium text-ink mb-2">Ingredients</Text>
                                        {(selectedRecipe.ingredients || []).map((item, index) => (
                                            <View key={index} className="flex-row justify-between py-2">
                                                <Text className="text-ink capitalize">{item.name}</Text>
                                                {Number(item.quantity) > 0 ? (
                                                <QuantityLabel
                                                    quantity={Number(item.quantity)}
                                                    unit={item.unit}
                                                    unitKind={item.unit_kind}
                                                    baseUnit={item.base_unit}
                                                    defaultDisplayUnit={item.default_display_unit}
                                                    measurementSystem={measurementSystem}
                                                    style={{ color: colors.muted }}
                                                />
                                                ) : null}
                                            </View>
                                        ))}
                                    </View>

                                    {(selectedRecipe.instructions?.length ?? 0) > 0 && (
                                        <View className="border-b border-line py-4">
                                            <Text className="font-medium text-ink mb-2">Instructions</Text>
                                            {selectedRecipe.instructions.map((step, index) => (
                                                <View key={index} className="flex-row mb-3">
                                                    <View className="w-6 h-6 rounded-full bg-sage items-center justify-center mr-3 mt-0.5">
                                                        <Text className="text-xs font-medium text-herb-deep">{index + 1}</Text>
                                                    </View>
                                                    <Text className="flex-1 text-ink leading-5">{step}</Text>
                                                </View>
                                            ))}
                                        </View>
                                    )}

                                    <View className="flex-row gap-2 mt-4">
                                        <TouchableOpacity
                                            onPress={() => setIsEditing(true)}
                                            className="flex-1 bg-sage py-3 rounded-lg flex-row items-center justify-center border border-line"
                                        >
                                            <EditIcon size={16} color={colors.herb} />
                                            <Text className="text-herb-deep font-medium ml-1">Edit Recipe</Text>
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            )}
                        </View>
                    </View>
                ) : (
                    // Add New Recipe Form
                    <View className="bg-surface rounded-xl overflow-hidden border border-line">
                        <View className="p-4 border-b border-line bg-linen flex-row justify-between items-center">
                            <Text className="font-semibold text-ink">Add New Recipe</Text>
                            <TouchableOpacity hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} onPress={() => setShowAddRecipe(false)}>
                                <XIcon size={20} color={colors.muted} />
                            </TouchableOpacity>
                        </View>

                        <View className="p-4">
                            {/* Meal Name */}
                            <Text className="text-ink mb-2">Meal Name *</Text>
                            <TextInput
                                testID="recipe-meal-name"
                                value={newRecipe.meal_name}
                                onChangeText={(text) =>
                                    setNewRecipe((prev) => ({ ...prev, meal_name: text }))
                                }
                                placeholder={t('recipes.mealNamePlaceholder')}
                                autoComplete="off"
                                textContentType="none"
                                className="w-full p-3 border border-line rounded-xl mb-4 bg-linen text-ink"
                            />

                            {renderFolderPicker(newRecipe.folder_id, (folderId) =>
                                setNewRecipe((prev) => ({ ...prev, folder_id: folderId }))
                            )}

                            {/* Recipe Image */}
                            <Text className="text-ink mb-2">Recipe Image</Text>
                            {uploadingImage ? (
                                <View className="mb-4 py-8 items-center bg-linen rounded-xl border border-line">
                                    <ActivityIndicator color={colors.herb} />
                                    <Text className="text-muted mt-2">Uploading…</Text>
                                </View>
                            ) : newRecipe.image?.url ? (
                                <View className="relative mb-4">
                                    <CachedImage
                                        uri={newRecipe.image.url}
                                        className="w-full h-48 rounded-xl"
                                        style={{ width: '100%', height: 192, borderRadius: 12 }}
                                        contentFit="cover"
                                    />
                                    <TouchableOpacity hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                                        onPress={() => {
                                            void removeImage();
                                        }}
                                        className="absolute top-2 right-2 bg-black/50 p-2 rounded-full"
                                    >
                                        <XIcon size={16} color={colors.onHerb} />
                                    </TouchableOpacity>
                                </View>
                            ) : (
                                <View className="flex-row gap-3 mb-4">
                                    <TouchableOpacity
                                        onPress={() => {
                                            void takePhoto();
                                        }}
                                        className="flex-1 flex-row items-center justify-center py-3 bg-linen rounded-xl border border-dashed border-line"
                                    >
                                        <CameraIcon size={20} color={colors.muted} />
                                        <Text className="text-muted ml-2">Camera</Text>
                                    </TouchableOpacity>
                                    <TouchableOpacity
                                        onPress={() => {
                                            void pickImage();
                                        }}
                                        className="flex-1 flex-row items-center justify-center py-3 bg-linen rounded-xl border border-dashed border-line"
                                    >
                                        <ImageIcon size={20} color={colors.muted} />
                                        <Text className="text-muted ml-2">Gallery</Text>
                                    </TouchableOpacity>
                                </View>
                            )}

                            {/* Ingredients */}
                            <View className="flex-row justify-between items-center mb-2">
                                <Text className="text-ink font-medium">Ingredients *</Text>
                                <TouchableOpacity onPress={handleAddIngredient} className="flex-row items-center">
                                    <PlusIcon size={16} color={colors.danger} />
                                    <Text className="text-herb ml-1">Add</Text>
                                </TouchableOpacity>
                            </View>

                            {(newRecipe.ingredients || []).map((item, index) => (
                                <RecipeIngredientRow
                                    key={`new-ingredient-${index}`}
                                    item={item}
                                    index={index}
                                    measurementSystem={measurementSystem}
                                    onUpdate={handleUpdateNewIngredient}
                                    onRemove={handleRemoveNewIngredient}
                                    nameTestID={`recipe-ingredient-name-${index}`}
                                    namePlaceholder={t('recipes.searchIngredient')}
                                />
                            ))}

                            {/* Instructions */}
                            <Text className="text-ink mb-2 mt-4">Instructions / Steps</Text>
                            <TextInput
                                value={getInstructionsText()}
                                onChangeText={handleInstructionsChange}
                                placeholder="Enter cooking instructions (one step per line)"
                                multiline
                                numberOfLines={6}
                                textAlignVertical="top"
                                className="w-full p-3 border border-line rounded-xl mb-4 bg-linen text-ink min-h-[120px]"
                            />

                            {/* Save Button */}
                            <TouchableOpacity
                                testID="recipe-save-button"
                                onPress={handleSaveRecipe}
                                disabled={
                                    !newRecipe.meal_name?.trim() ||
                                    !(newRecipe.ingredients || []).some((ing) => ing.name?.trim()) ||
                                    saving
                                }
                                className={`w-full py-3 rounded-xl mt-2 ${newRecipe.meal_name?.trim() &&
                                    (newRecipe.ingredients || []).some((ing) => ing.name?.trim()) &&
                                    !saving
                                    ? 'bg-herb'
                                    : 'bg-sage'
                                    }`}
                            >
                                {saving ? (
                                    <ActivityIndicator color={colors.onHerb} />
                                ) : (
                                    <Text
                                        className={`text-center font-medium ${newRecipe.meal_name?.trim() &&
                                            (newRecipe.ingredients || []).some((ing) => ing.name?.trim())
                                            ? 'text-white'
                                            : 'text-muted'
                                            }`}
                                    >
                                        Save Recipe
                                    </Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </View>
                )}
            </ScrollView>
            )}

            {/* Add Folder Modal */}
            <Modal visible={showAddFolder} transparent animationType="fade">
                <View className="flex-1 bg-black/50 items-center justify-center p-4">
                    <View className="bg-surface rounded-xl w-full max-w-sm border border-line">
                        <View className="p-4 border-b border-line flex-row justify-between items-center">
                            <Text className="font-medium text-ink">Create New Category</Text>
                            <TouchableOpacity hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} onPress={() => setShowAddFolder(false)}>
                                <XIcon size={20} color={colors.muted} />
                            </TouchableOpacity>
                        </View>
                        <View className="p-6">
                            <Text className="text-ink mb-2">Category Name</Text>
                            <TextInput
                                value={newFolderName}
                                onChangeText={setNewFolderName}
                                placeholder="Enter category name"
                                className="w-full p-3 border border-line rounded-xl mb-4 bg-linen text-ink"
                            />
                            <View className="flex-row gap-2">
                                <TouchableOpacity
                                    onPress={() => setShowAddFolder(false)}
                                    className="flex-1 bg-linen border border-line py-3 rounded-lg"
                                >
                                    <Text className="text-ink text-center">Cancel</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={handleCreateFolder}
                                    disabled={!newFolderName.trim() || saving}
                                    className={`flex-1 py-3 rounded-lg ${newFolderName.trim() && !saving ? 'bg-herb' : 'bg-sage'
                                        }`}
                                >
                                    {saving ? (
                                        <ActivityIndicator color={colors.onHerb} />
                                    ) : (
                                        <Text
                                            className={`text-center ${newFolderName.trim() ? 'text-white' : 'text-muted'
                                                }`}
                                        >
                                            Create
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Edit Folder Modal */}
            <Modal visible={!!editingFolder} transparent animationType="fade">
                <View className="flex-1 bg-black/50 items-center justify-center p-4">
                    <View className="bg-surface rounded-xl w-full max-w-sm border border-line">
                        <View className="p-4 border-b border-line flex-row justify-between items-center">
                            <Text className="font-medium text-ink">Rename Category</Text>
                            <TouchableOpacity hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }} onPress={() => setEditingFolder(null)}>
                                <XIcon size={20} color={colors.muted} />
                            </TouchableOpacity>
                        </View>
                        <View className="p-6">
                            <Text className="text-ink mb-2">Category Name</Text>
                            <TextInput
                                value={newFolderName}
                                onChangeText={setNewFolderName}
                                placeholder="Enter category name"
                                className="w-full p-3 border border-line rounded-xl mb-4 bg-linen text-ink"
                            />
                            <View className="flex-row gap-2">
                                <TouchableOpacity
                                    onPress={() => setEditingFolder(null)}
                                    className="flex-1 bg-linen border border-line py-3 rounded-lg"
                                >
                                    <Text className="text-ink text-center">Cancel</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={handleUpdateFolder}
                                    disabled={!newFolderName.trim() || saving}
                                    className={`flex-1 py-3 rounded-lg ${newFolderName.trim() && !saving ? 'bg-herb' : 'bg-sage'
                                        }`}
                                >
                                    {saving ? (
                                        <ActivityIndicator color={colors.onHerb} />
                                    ) : (
                                        <Text
                                            className={`text-center ${newFolderName.trim() ? 'text-white' : 'text-muted'
                                                }`}
                                        >
                                            Update
                                        </Text>
                                    )}
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                </View>
            </Modal>

            {/* Delete Folder Confirmation Modal */}
            <Modal visible={showDeleteConfirm} transparent animationType="fade">
                <View className="flex-1 bg-black/50 items-center justify-center p-4">
                    <View className="bg-surface rounded-xl w-full max-w-sm border border-line">
                        <View className="p-6">
                            <View className="flex-row items-center mb-4">
                                <AlertCircleIcon size={24} color={colors.danger} />
                                <Text className="text-lg font-medium ml-2" style={{ color: colors.danger }}>Delete Category</Text>
                            </View>
                            <Text className="text-muted mb-2">
                                Are you sure you want to delete "{folderToDelete?.name}"?
                            </Text>
                            <Text className="text-muted text-sm mb-6">
                                All recipes in this category will be moved to "Uncategorized".
                            </Text>
                            <View className="flex-row justify-end gap-3">
                                <TouchableOpacity
                                    onPress={() => setShowDeleteConfirm(false)}
                                    className="px-4 py-2 bg-linen border border-line rounded-lg"
                                >
                                    <Text className="text-ink">Cancel</Text>
                                </TouchableOpacity>
                                <TouchableOpacity
                                    onPress={handleDeleteFolder}
                                    disabled={saving}
                                    className="px-4 py-2 bg-herb-deep rounded-lg"
                                >
                                    {saving ? (
                                        <ActivityIndicator color={colors.onHerb} size="small" />
                                    ) : (
                                        <Text className="text-white">Delete</Text>
                                    )}
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                </View>
            </Modal>
        </View>
    );
}
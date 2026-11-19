import React, { useState, createContext, useContext, useCallback, useEffect, useRef, useMemo } from 'react';
import {
    PantryItem,
    ShoppingListItem,
    ShoppingListSyncStatus,
    Recipe,
    Folder,
    UserSettings,
    IngredientEntry,
    MealPlan,
    ApiResponse,
    ConfirmMealPlanResult,
} from '../types';
import { folderApi } from '../api/folder';
import { ingredientApi } from '../api/ingredient';
import { recipeApi } from '../api/recipe';
import { pantryItemApi, parsePantryItem, parsePantryItems } from '../api/pantryItem';
import {
    shoppingListApi,
    parseShoppingListItems,
    parseSyncResult,
    parseUnsyncResult,
} from '../api/shoppingList';
import { mealPlanApi } from '../api/mealPlan';
import { userPreferencesApi } from '../api/userPreferences';
import { useAuth } from './authContext';
import { notifyUnauthorized } from '../api/client';
import {
    DEFAULT_SYNC_STATUS,
    applyPendingOps,
    clearBackoff,
    coalesce,
    createLocalItemId,
    enqueueCreate,
    enqueueDelete,
    enqueueUpdate,
    flushShoppingListQueue,
    getIsOnline,
    isEmptyPayload,
    loadFailed,
    loadQueue,
    loadSnapshot,
    payloadFromEdit,
    reconcileServerList,
    recoverShoppingListAuth,
    requeueFailedMutations,
    saveFailed,
    saveQueue,
    saveSnapshot,
    subscribeConnectivity,
    createSerialQueue,
    applyItemUpdate,
    applyItemRemove,
    applyMarkAllChecked,
    enqueueMarkAllUpdates,
    type ShoppingListMutationV1,
} from '../services/shoppingListOffline';
import {
    enrichPantryNames,
    enrichShoppingNames,
} from '../utils/fillMissingNames';
import { serializeRecipePayload } from '../utils/recipePayload';

type ResourceLoading = {
    recipes: boolean;
    pantry: boolean;
    shopping: boolean;
    mealPlan: boolean;
    ingredients: boolean;
};

const DEFAULT_RESOURCE_LOADING: ResourceLoading = {
    recipes: false,
    pantry: false,
    shopping: false,
    mealPlan: false,
    ingredients: false,
};

type ResourceError = Record<keyof ResourceLoading, boolean>;

const DEFAULT_RESOURCE_ERROR: ResourceError = {
    recipes: false,
    pantry: false,
    shopping: false,
    mealPlan: false,
    ingredients: false,
};

const DEFAULT_USER_SETTINGS: UserSettings = {
    name: '',
    language: 'english',
    measurement_unit: 'metric',
};

function asList<T>(value: unknown): T[] {
    return Array.isArray(value) ? value : [];
}

function unwrapListResponse<T>(data: T[] | Record<string, T[] | undefined>, key: string): T[] {
    if (Array.isArray(data)) return data;
    const list = data[key];
    return Array.isArray(list) ? list : [];
}

function unwrapEntityResponse<T>(
    data: T | Record<string, T | undefined> | undefined,
    key: string,
): T | null {
    if (!data || typeof data !== 'object') return null;
    if ('id' in data && (data as { id?: unknown }).id != null) {
        return data as T;
    }
    const nested = (data as Record<string, T | undefined>)[key];
    return nested ?? null;
}

function normalizeInstructions(raw: unknown, stepsFallback?: unknown): string[] {
    if (Array.isArray(raw)) {
        return raw.map(String).map((s) => s.trim()).filter(Boolean);
    }
    if (typeof raw === 'string' && raw.trim()) {
        return raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    }
    if (Array.isArray(stepsFallback)) {
        return stepsFallback.map(String).map((s) => s.trim()).filter(Boolean);
    }
    return [];
}

function normalizeRecipeImage(raw: unknown): Recipe['image'] {
    if (!raw || typeof raw !== 'object') return null;
    const image = raw as { url?: string; public_id?: string };
    const url = typeof image.url === 'string' ? image.url.trim() : '';
    if (!url) return null;
    return {
        url,
        public_id: typeof image.public_id === 'string' ? image.public_id : '',
    };
}

export function normalizeRecipe(raw: Record<string, unknown> | Recipe): Recipe {
    const r = raw as Record<string, unknown>;
    const imageUrl =
        typeof r.image_url === 'string'
            ? r.image_url
            : typeof r.imageUrl === 'string'
              ? r.imageUrl
              : '';
    return {
        id: String(r.id ?? ''),
        meal_name: String(r.meal_name ?? r.mealName ?? ''),
        folder_id: r.folder_id != null || r.folderId != null
            ? String(r.folder_id ?? r.folderId)
            : '',
        instructions: normalizeInstructions(r.instructions, r.steps),
        ingredients: Array.isArray(r.ingredients) ? (r.ingredients as Recipe['ingredients']) : [],
        image:
            normalizeRecipeImage(r.image) ??
            (imageUrl ? { url: imageUrl, public_id: String(r.image_public_id ?? r.imagePublicId ?? '') } : null),
    };
}

function normalizeMealPlan(raw: Record<string, unknown> | MealPlan): MealPlan {
    const record = raw as Record<string, unknown>;
    const statusRaw = String(record.status ?? 'PLANNED').toUpperCase();
    const status = (['PLANNED', 'PENDING_CONFIRM', 'CONFIRMED', 'SKIPPED'].includes(statusRaw)
        ? statusRaw
        : 'PLANNED') as MealPlan['status'];
    return {
        id: String(record.id ?? ''),
        recipe_id: String(record.recipe_id ?? record.recipeId ?? ''),
        meal_type: (record.meal_type ?? record.mealType ?? 'dinner') as MealPlan['meal_type'],
        serving_date: String(record.serving_date ?? record.servingDate ?? ''),
        meal_name: String(record.meal_name ?? record.mealName ?? ''),
        image: (record.image as string | null | undefined)
            ?? ((record.image_url as { url?: string } | undefined)?.url ?? null),
        status,
    };
}

interface PantryContextType {
    // Recipes
    recipes: Recipe[];
    fetchAllRecipes: () => Promise<Recipe[]>;
    addRecipe: (recipe: Partial<Recipe>) => Promise<ApiResponse<Recipe>>;
    updateRecipe: (recipe: Recipe) => Promise<void>;
    deleteRecipe: (id: string) => Promise<void>;

    // User settings
    userSettings: UserSettings;
    updateUserSettings: (settings: UserSettings) => void;

    // Folders
    folders: Folder[];
    fetchAllFolders: () => Promise<void>;
    addFolder: (folder: Partial<Folder>) => Promise<ApiResponse<Folder>>;
    deleteFolder: (id: string) => Promise<void>;
    updateFolder: (folder: Folder) => Promise<void>;

    // Pantry items
    pantryItems: PantryItem[];
    fetchAllPantryItems: () => Promise<void>;
    updatePantryItem: (item: PantryItem) => Promise<void>;
    updatePantryItems: (items: PantryItem[]) => Promise<void>;
    addPantryItem: (item: Partial<PantryItem>) => Promise<ApiResponse<PantryItem>>;
    removePantryItem: (id: string) => Promise<void>;

    // Ingredients
    fetchAllIngredients: (query?: string | null) => Promise<void>;
    ingredients: IngredientEntry[];

    // Shopping list
    shoppingList: ShoppingListItem[];
    shoppingListSyncStatus: ShoppingListSyncStatus;
    fetchAllShoppingListItems: () => Promise<ShoppingListItem[]>;
    updateShoppingListItem: (item: ShoppingListItem) => Promise<ApiResponse<ShoppingListItem>>;
    addShoppingListItem: (item: Partial<ShoppingListItem>) => Promise<ApiResponse<ShoppingListItem>>;
    removeShoppingListItem: (id: string) => Promise<void>;
    markAllShoppingListChecked: () => Promise<number>;
    retryShoppingListSync: () => Promise<void>;
    syncShoppingItemsToPantry: (
        items: Array<{ id: string; quantity?: number; unit?: string }>,
    ) => Promise<ApiResponse<{ synced: ShoppingListItem[]; skipped: Array<{ id: string; reason: string }> }>>;
    unsyncShoppingItemsFromPantry: (
        itemIds: string[],
    ) => Promise<ApiResponse<{ unsynced: ShoppingListItem[]; skipped: Array<{ id: string; reason: string }> }>>;

    // Meal plans
    mealPlan: MealPlan[];
    fetchAllMealPlans: () => Promise<MealPlan[]>;
    addMealPlan: (mealPlan: Partial<MealPlan>) => Promise<ApiResponse<MealPlan>>;
    updateMealPlan: (mealPlan: MealPlan) => Promise<void>;
    deleteMealPlan: (id: string) => Promise<void>;
    confirmMealPlan: (id: string) => Promise<ApiResponse<ConfirmMealPlanResult>>;
    skipMealPlan: (id: string) => Promise<ApiResponse<{ mealPlan: MealPlan; alreadySkipped: boolean }>>;

    /** True if any resource fetch is in flight */
    loading: boolean;
    loadingByResource: ResourceLoading;
    /** True for a resource whose last fetch failed (network/server). Cleared on next success. */
    errorByResource: ResourceError;
}

const PantryContext = createContext<PantryContextType | undefined>(undefined);

// Default folders for fallback
const DEFAULT_FOLDERS: Folder[] = [
    { id: 'uncategorized', name: 'Uncategorized', icon: 'FolderIcon' },
];

export function PantryProvider({ children }: { children: React.ReactNode }) {
    const { user } = useAuth();
    const userId = user?.id ?? '';
    const [loadingByResource, setLoadingByResource] = useState<ResourceLoading>(DEFAULT_RESOURCE_LOADING);
    const [errorByResource, setErrorByResource] = useState<ResourceError>(DEFAULT_RESOURCE_ERROR);
    const loading = Object.values(loadingByResource).some(Boolean);
    const userIdRef = useRef(userId);
    userIdRef.current = userId;
    const [mealPlan, setMealPlan] = useState<MealPlan[]>([]);
    const [ingredients, setIngredients] = useState<IngredientEntry[]>([]);
    const ingredientsRef = useRef(ingredients);
    ingredientsRef.current = ingredients;
    const [folders, setFolders] = useState<Folder[]>(DEFAULT_FOLDERS);
    const [pantryItems, setPantryItems] = useState<PantryItem[]>([]);
    const [shoppingList, setShoppingList] = useState<ShoppingListItem[]>([]);
    const [shoppingListSyncStatus, setShoppingListSyncStatus] =
        useState<ShoppingListSyncStatus>(DEFAULT_SYNC_STATUS);
    // Always-current copy of the shopping list. Updated synchronously by every writer so
    // optimistic updates can be computed without waiting for AsyncStorage round-trips.
    const shoppingListRef = useRef<ShoppingListItem[]>([]);
    const pendingShoppingWritesRef = useRef(0);
    const applyShoppingList = useCallback(
        (value: ShoppingListItem[] | ((prev: ShoppingListItem[]) => ShoppingListItem[])) => {
            const next = asList<ShoppingListItem>(
                typeof value === 'function' ? value(shoppingListRef.current) : value,
            );
            shoppingListRef.current = next;
            setShoppingList(next);
        },
        [],
    );
    const [recipes, setRecipes] = useState<Recipe[]>([]);
    const [userSettings, setUserSettings] = useState<UserSettings>(DEFAULT_USER_SETTINGS);

    const setResourceLoading = useCallback((key: keyof ResourceLoading, value: boolean) => {
        setLoadingByResource((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
    }, []);

    const setResourceError = useCallback((key: keyof ResourceLoading, value: boolean) => {
        setErrorByResource((prev) => (prev[key] === value ? prev : { ...prev, [key]: value }));
    }, []);

    // Reset ALL per-user state whenever the signed-in user changes (sign-out, account
    // switch, account deletion) so nothing from a previous account can leak into the next.
    useEffect(() => {
        setRecipes([]);
        setPantryItems([]);
        applyShoppingList([]);
        setIngredients([]);
        setMealPlan([]);
        setFolders(DEFAULT_FOLDERS);
        setUserSettings(DEFAULT_USER_SETTINGS);
        setLoadingByResource(DEFAULT_RESOURCE_LOADING);
        setErrorByResource(DEFAULT_RESOURCE_ERROR);
        setShoppingListSyncStatus((prev) => ({
            ...prev,
            pendingCount: 0,
            failedCount: 0,
            isSyncing: false,
            lastSyncError: null,
            lastSyncedAt: null,
        }));
    }, [userId]);

    const updateSyncStatus = useCallback((patch: Partial<ShoppingListSyncStatus>) => {
        setShoppingListSyncStatus((prev) => ({ ...prev, ...patch }));
    }, []);

    const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const shoppingWriteRef = useRef(createSerialQueue());
    const isOnlineRef = useRef(shoppingListSyncStatus.isOnline);
    isOnlineRef.current = shoppingListSyncStatus.isOnline;

    const runFlush = useCallback(async () => {
        if (!userId) return;
        updateSyncStatus({ isSyncing: true });
        const result = await flushShoppingListQueue(userId, {
            onItems: (items) => {
                if (userId !== userIdRef.current) return;
                applyShoppingList(Array.isArray(items) ? items : []);
            },
            recoverAuth: recoverShoppingListAuth,
            // Auth could not be recovered: expire the session the same way a
            // global 401 does (JWT + user only). Do NOT call logout() — that wipes
            // the offline queue. The queue flushes again after the same user
            // signs back in; stop the retry timer so we don't 401-loop meanwhile.
            onAuthFailure: async () => {
                clearBackoff(userId);
                await notifyUnauthorized();
            },
        });
        // Signed out / switched user while flushing: the reset effect owns state now.
        if (userId !== userIdRef.current) return;
        const failedCount = result.failedCount;
        updateSyncStatus({
            isSyncing: false,
            pendingCount: result.remaining,
            failedCount,
            lastSyncError:
                failedCount > 0
                    ? (result.error ?? 'Some changes could not sync')
                    : result.ok
                      ? null
                      : (result.error ?? 'Sync failed'),
            ...(result.remaining === 0 && failedCount === 0 ? { lastSyncedAt: Date.now() } : {}),
        });
        if (result.items) {
            applyShoppingList(Array.isArray(result.items) ? result.items : []);
        }
    }, [userId, updateSyncStatus, applyShoppingList]);

    const scheduleFlush = useCallback(() => {
        if (flushTimerRef.current) {
            clearTimeout(flushTimerRef.current);
        }
        flushTimerRef.current = setTimeout(() => {
            flushTimerRef.current = null;
            void runFlush();
        }, 400);
    }, [runFlush]);

    useEffect(() => {
        return () => {
            if (flushTimerRef.current) {
                clearTimeout(flushTimerRef.current);
            }
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            const online = await getIsOnline();
            if (!cancelled) updateSyncStatus({ isOnline: online });
        })();
        const unsubscribe = subscribeConnectivity((online) => {
            updateSyncStatus({ isOnline: online });
            if (online && userId) {
                void loadQueue(userId).then((queue) => {
                    if (queue.length > 0) {
                        void runFlush();
                    }
                });
            }
        });
        return () => {
            cancelled = true;
            unsubscribe();
        };
    }, [userId, updateSyncStatus, runFlush]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!userId) {
                applyShoppingList([]);
                setShoppingListSyncStatus(DEFAULT_SYNC_STATUS);
                return;
            }
            const cached = await loadSnapshot(userId);
            const queue = await loadQueue(userId);
            const failed = await loadFailed(userId);
            if (cancelled) return;
            applyShoppingList(asList(cached));
            updateSyncStatus({ pendingCount: queue.length, failedCount: failed.length });
        })();
        return () => {
            cancelled = true;
        };
    }, [userId, updateSyncStatus]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            if (!userId) return;
            try {
                const prefs = await userPreferencesApi.get();
                if (!cancelled && prefs?.measurementUnit) {
                    setUserSettings((prev) => ({
                        ...prev,
                        measurement_unit: prefs.measurementUnit,
                    }));
                }
            } catch (err) {
                console.error('Load measurement preference failed:', err);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [userId]);

    // === FOLDER FUNCTIONS ===
    const fetchAllFolders = useCallback(async () => {
        const uid = userIdRef.current;
        setResourceLoading('recipes', true);
        try {
            const response = await folderApi.list();
            if (uid !== userIdRef.current) return;
            if (response.success && response.data) {
                const fetchedFolders = unwrapListResponse(
                    response.data as Folder[] | { folders?: Folder[] },
                    'folders',
                );
                setFolders(fetchedFolders.length > 0 ? fetchedFolders : DEFAULT_FOLDERS);
            } else if (!response.success) {
                setResourceError('recipes', true);
            }
        } catch (error) {
            console.error('Failed to fetch folders:', error);
            setResourceError('recipes', true);
        } finally {
            setResourceLoading('recipes', false);
        }
    }, [setResourceLoading, setResourceError]);

    const addFolder = useCallback(async (folder: Partial<Folder>): Promise<ApiResponse<Folder>> => {
        const response = await folderApi.create(folder);
        const createdFolder = unwrapEntityResponse<Folder>(
            response.data as Folder | { folder?: Folder },
            'folder',
        );
        if (response.success && createdFolder) {
            setFolders((prev) => [...prev, createdFolder]);
        }
        return createdFolder ? { ...response, data: createdFolder } : response;
    }, []);

    const deleteFolder = useCallback(async (id: string) => {
        const response = await folderApi.delete(id);
        if (response.success) {
            setFolders((prev) => prev.filter((f) => f.id !== id));
            // Move recipes to uncategorized
            setRecipes((prev) =>
                prev.map((r) => (r.folder_id === id ? { ...r, folder_id: 'uncategorized' } : r))
            );
        }
    }, []);

    const updateFolder = useCallback(async (folder: Folder) => {
        const response = await folderApi.update(folder.id, folder);
        const updatedFolder = unwrapEntityResponse<Folder>(
            response.data as Folder | { folder?: Folder },
            'folder',
        );
        if (response.success && updatedFolder) {
            setFolders((prev) => prev.map((f) => (f.id === folder.id ? updatedFolder : f)));
        }
    }, []);

    // === RECIPE FUNCTIONS ===
    const fetchAllRecipes = useCallback(async (): Promise<Recipe[]> => {
        const uid = userIdRef.current;
        setResourceLoading('recipes', true);
        try {
            const response = await recipeApi.list();
            if (uid !== userIdRef.current) return [];
            if (response.success && response.data) {
                const data = response.data as Recipe[] | { recipes?: Recipe[] };
                const recipesList = unwrapListResponse(data, 'recipes').map((recipe) =>
                    normalizeRecipe(recipe as unknown as Record<string, unknown>)
                );
                setRecipes(asList(recipesList));
                setResourceError('recipes', false);
                return recipesList;
            }
            if (!response.success) setResourceError('recipes', true);
        } catch (error) {
            console.error('Failed to fetch recipes:', error);
            setResourceError('recipes', true);
        } finally {
            setResourceLoading('recipes', false);
        }
        return [];
    }, [setResourceLoading, setResourceError]);

    const addRecipe = useCallback(async (recipe: Partial<Recipe>): Promise<ApiResponse<Recipe>> => {
        const response = await recipeApi.create(serializeRecipePayload(recipe) as Partial<Recipe>);
        if (response.success && response.data) {
            const raw = response.data as unknown;
            const payload = (raw && typeof raw === 'object' && 'recipe' in (raw as object)
                ? (raw as { recipe: Record<string, unknown> }).recipe
                : raw) as Record<string, unknown>;
            const saved = normalizeRecipe(payload);
            setRecipes((prev) => [...prev, saved]);
            return { ...response, data: saved };
        }
        return response;
    }, []);

    const updateRecipe = useCallback(async (recipe: Recipe) => {
        const normalized = normalizeRecipe(recipe);
        setRecipes((prev) => prev.map((r) => (r.id === recipe.id ? normalized : r)));
        const response = await recipeApi.update(recipe.id, serializeRecipePayload(normalized) as Partial<Recipe>);
        if (response.success && response.data) {
            const raw = response.data as unknown;
            const payload = (raw && typeof raw === 'object' && 'recipe' in (raw as object)
                ? (raw as { recipe: Record<string, unknown> }).recipe
                : raw) as Record<string, unknown>;
            setRecipes((prev) => prev.map((r) => (r.id === recipe.id ? normalizeRecipe(payload) : r)));
        }
    }, []);

    const deleteRecipe = useCallback(async (id: string) => {
        const response = await recipeApi.delete(id);
        if (response.success) {
            setRecipes((prev) => prev.filter((r) => r.id !== id));
        }
    }, []);

    // === PANTRY ITEM FUNCTIONS ===
    const fetchAllPantryItems = useCallback(async () => {
        const uid = userIdRef.current;
        setResourceLoading('pantry', true);
        try {
            const response = await pantryItemApi.list();
            if (uid !== userIdRef.current) return;
            if (response.success && response.data) {
                const parsed = parsePantryItems(response.data);
                setPantryItems(
                    asList(enrichPantryNames(parsed, ingredientsRef.current)),
                );
                setResourceError('pantry', false);
            } else if (response.success) {
                setPantryItems([]);
                setResourceError('pantry', false);
            } else {
                setResourceError('pantry', true);
            }
        } catch (error) {
            console.error('Failed to fetch pantry items:', error);
            setResourceError('pantry', true);
        } finally {
            setResourceLoading('pantry', false);
        }
    }, [setResourceLoading, setResourceError]);

    const addPantryItem = useCallback(async (item: Partial<PantryItem>): Promise<ApiResponse<PantryItem>> => {
        const response = await pantryItemApi.create(item);
        const created = response.success ? parsePantryItem(response.data) : null;
        if (response.success && created) {
            setPantryItems((prev) => [...prev, created]);
        }
        return { ...response, data: created ?? undefined };
    }, []);

    const updatePantryItem = useCallback(async (item: PantryItem) => {
        let previous: PantryItem | undefined;
        setPantryItems((prev) => {
            previous = prev.find((i) => i.id === item.id);
            return prev.map((i) => (i.id === item.id ? item : i));
        });

        try {
            const response = await pantryItemApi.update(item.id, item);
            const updated = response.success ? parsePantryItem(response.data) : null;
            if (response.success && updated) {
                setPantryItems((prev) =>
                    prev.map((i) => {
                        if (i.id !== item.id) return i;
                        // Ignore stale server qty if user tapped again while request was in flight.
                        if (i.quantity !== item.quantity) return i;
                        return { ...i, ...updated };
                    }),
                );
                return;
            }
            if (previous) {
                setPantryItems((prev) =>
                    prev.map((i) => (i.id === item.id ? previous! : i)),
                );
            }
        } catch {
            if (previous) {
                setPantryItems((prev) =>
                    prev.map((i) => (i.id === item.id ? previous! : i)),
                );
            }
        }
    }, []);

    const updatePantryItems = useCallback(async (items: PantryItem[]) => {
        const response = await pantryItemApi.updateMany(items);
        if (response.success && response.data) {
            setPantryItems(parsePantryItems(response.data));
        }
    }, []);

    const removePantryItem = useCallback(async (id: string) => {
        let previous: PantryItem[] | undefined;
        setPantryItems((prev) => {
            previous = prev;
            return prev.filter((i) => i.id !== id);
        });

        try {
            const response = await pantryItemApi.delete(id);
            if (!response.success && previous) {
                setPantryItems(previous);
            }
        } catch {
            if (previous) {
                setPantryItems(previous);
            }
        }
    }, []);

    // === INGREDIENT FUNCTIONS ===
    const fetchAllIngredients = useCallback(async (query?: string | null) => {
        const uid = userIdRef.current;
        setResourceLoading('ingredients', true);
        try {
            const response = await ingredientApi.list(query || undefined);
            if (uid !== userIdRef.current) return;
            setResourceError('ingredients', !response.success);
            if (response.success && response.data) {
                const next = unwrapListResponse(
                    response.data as IngredientEntry[] | { ingredients?: IngredientEntry[] },
                    'ingredients',
                );
                setIngredients(next);
                // Backfill blank Nest list names once the catalog is available.
                setPantryItems((prev) => enrichPantryNames(asList(prev), next));
                applyShoppingList((prev) => enrichShoppingNames(asList(prev), next));
            } else if (response.success) {
                setIngredients([]);
            }
        } catch (error) {
            console.error('Failed to fetch ingredients:', error);
            setResourceError('ingredients', true);
        } finally {
            setResourceLoading('ingredients', false);
        }
    }, [setResourceLoading, setResourceError]);

    // Ensure ingredient catalog is available for name backfill on pantry/shopping.
    useEffect(() => {
        if (!userId) {
            setIngredients([]);
            return;
        }
        void fetchAllIngredients();
    }, [userId, fetchAllIngredients]);

    // === SHOPPING LIST FUNCTIONS ===
    const fetchAllShoppingListItems = useCallback(async (): Promise<ShoppingListItem[]> => {
        if (!userId) {
            return shoppingListRef.current;
        }

        // While local writes are still persisting, the in-memory list is newer than disk.
        const cached =
            pendingShoppingWritesRef.current > 0
                ? shoppingListRef.current
                : await loadSnapshot(userId);
        applyShoppingList(asList(cached));

        const online = await getIsOnline();
        updateSyncStatus({ isOnline: online });
        if (!online) {
            const queue = await loadQueue(userId);
            updateSyncStatus({ pendingCount: queue.length });
            return cached;
        }

        setResourceLoading('shopping', true);
        try {
            const response = await shoppingListApi.list();
            if (response.success && response.data !== undefined) {
                const serverItems = parseShoppingListItems(response.data);
                const queue = await loadQueue(userId);
                const failed = await loadFailed(userId);
                // Server list with still-queued ops projected on top. Use the
                // in-memory list as the base when local writes are mid-persist.
                const base =
                    pendingShoppingWritesRef.current > 0 ? shoppingListRef.current : cached;
                const projected = reconcileServerList(base, serverItems, queue);
                const enriched = enrichShoppingNames(projected, ingredientsRef.current);
                applyShoppingList(asList(enriched));
                await saveSnapshot(userId, enriched);
                setResourceError('shopping', false);
                updateSyncStatus({
                    pendingCount: queue.length,
                    failedCount: failed.length,
                    lastSyncError: failed.length > 0 ? 'Some changes could not sync' : null,
                    lastSyncedAt: Date.now(),
                });
                if (queue.length > 0) {
                    void runFlush();
                }
                return enriched;
            }
            if (response.success) {
                applyShoppingList([]);
                await saveSnapshot(userId, []);
                return [];
            }
            setResourceError('shopping', true);
            return cached;
        } catch (error) {
            console.error('Failed to fetch shopping list:', error);
            setResourceError('shopping', true);
            return cached;
        } finally {
            setResourceLoading('shopping', false);
        }
    }, [userId, updateSyncStatus, runFlush, setResourceLoading, setResourceError]);

    /**
     * Persist a local shopping-list write (snapshot + queue). State has ALREADY been updated
     * optimistically by the caller. Writes stay strictly serial so queue ordering is preserved;
     * the snapshot is only written by the last pending job (it always reflects the latest list).
     */
    const persistShoppingWrite = useCallback(
        (mutate: (queue: ShoppingListMutationV1[]) => ShoppingListMutationV1[]): Promise<void> => {
            const uid = userId;
            pendingShoppingWritesRef.current += 1;
            return shoppingWriteRef
                .current(async () => {
                    pendingShoppingWritesRef.current -= 1;
                    if (!uid) return;
                    if (pendingShoppingWritesRef.current === 0 && uid === userIdRef.current) {
                        await saveSnapshot(uid, shoppingListRef.current);
                    }
                    const queue = mutate(await loadQueue(uid));
                    await saveQueue(uid, queue);
                    updateSyncStatus({ pendingCount: queue.length, lastSyncError: null });
                    if (isOnlineRef.current) {
                        scheduleFlush();
                    }
                })
                .catch((error) => {
                    console.error('Failed to persist shopping list change:', error);
                });
        },
        [userId, updateSyncStatus, scheduleFlush],
    );

    const updateShoppingListItem = useCallback(async (item: ShoppingListItem): Promise<ApiResponse<ShoppingListItem>> => {
        const previous = shoppingListRef.current.find((entry) => entry.id === item.id);
        applyShoppingList(applyItemUpdate(shoppingListRef.current, item));
        // Only the fields the user actually changed are queued, with the server
        // version they were based on (409 version_conflict merge needs both).
        const payload = payloadFromEdit(previous, item);
        if (!isEmptyPayload(payload)) {
            await persistShoppingWrite((queue) =>
                enqueueUpdate(queue, item.id, payload, previous?.version),
            );
        }
        return { success: true, data: item };
    }, [applyShoppingList, persistShoppingWrite]);

    const addShoppingListItem = useCallback(async (item: Partial<ShoppingListItem>): Promise<ApiResponse<ShoppingListItem>> => {
            const localItem: ShoppingListItem = {
                id: createLocalItemId(),
                name: String(item.name ?? '').trim(),
                quantity: Number(item.quantity ?? 1),
                unit: String(item.unit ?? 'pcs'),
                checked: false,
                ingredient_id: item.ingredient_id,
                unit_kind: item.unit_kind,
                base_unit: item.base_unit,
                default_display_unit: item.default_display_unit,
            };
            if (!localItem.name) {
                return { success: false, message: 'Item name is required' };
            }

            applyShoppingList([localItem, ...shoppingListRef.current]);
            await persistShoppingWrite((queue) =>
                enqueueCreate(queue, localItem.id, {
                    name: localItem.name,
                    quantity: localItem.quantity,
                    unit: localItem.unit,
                    checked: false,
                }),
            );
            return { success: true, data: localItem };
    }, [applyShoppingList, persistShoppingWrite]);

    const removeShoppingListItem = useCallback(async (id: string) => {
        const previous = shoppingListRef.current.find((entry) => entry.id === id);
        applyShoppingList(applyItemRemove(shoppingListRef.current, id));
        await persistShoppingWrite((queue) => enqueueDelete(queue, id, previous?.version));
    }, [applyShoppingList, persistShoppingWrite]);

    const markAllShoppingListChecked = useCallback(async (): Promise<number> => {
        const { next, changed } = applyMarkAllChecked(shoppingListRef.current);
        if (changed.length === 0) return 0;
        applyShoppingList(next);
        await persistShoppingWrite((queue) => enqueueMarkAllUpdates(queue, changed));
        return changed.length;
    }, [applyShoppingList, persistShoppingWrite]);

    const retryShoppingListSync = useCallback(async () => {
        if (!userId) {
            await runFlush();
            return;
        }
        // Same serial queue as local writes so the queue read-modify-write
        // cannot interleave with an edit being persisted.
        await shoppingWriteRef.current(async () => {
            const failed = await loadFailed(userId);
            if (failed.length > 0) {
                const queue = coalesce([
                    ...(await loadQueue(userId)),
                    ...requeueFailedMutations(failed),
                ]);
                await saveFailed(userId, []);
                await saveQueue(userId, queue);
                const snapshot = await loadSnapshot(userId);
                const base =
                    pendingShoppingWritesRef.current > 0
                        ? shoppingListRef.current
                        : asList<ShoppingListItem>(snapshot);
                applyShoppingList(applyPendingOps(base, queue));
                updateSyncStatus({
                    pendingCount: queue.length,
                    failedCount: 0,
                    lastSyncError: null,
                });
            }
        });
        await runFlush();
    }, [userId, runFlush, updateSyncStatus, applyShoppingList]);

    const syncShoppingItemsToPantry = useCallback(
        async (items: Array<{ id: string; quantity?: number; unit?: string }>) => {
            const response = await shoppingListApi.syncToPantry(items);
            if (response.success && response.data) {
                const result = parseSyncResult(response.data);
                const byId = new Map(result.synced.map((i) => [i.id, i]));
                applyShoppingList((prev) => {
                    const next = asList<ShoppingListItem>(prev).map((item) => {
                        const synced = byId.get(item.id);
                        return synced
                            ? { ...item, ...synced, synced_to_pantry: true }
                            : item;
                    });
                    if (userId) {
                        void saveSnapshot(userId, next);
                    }
                    return next;
                });
                await fetchAllPantryItems();
                return { ...response, data: result };
            }
            return response as ApiResponse<{
                synced: ShoppingListItem[];
                skipped: Array<{ id: string; reason: string }>;
            }>;
        },
        [userId, fetchAllPantryItems],
    );

    const unsyncShoppingItemsFromPantry = useCallback(
        async (itemIds: string[]) => {
            const response = await shoppingListApi.unsyncFromPantry(itemIds);
            if (response.success && response.data) {
                const result = parseUnsyncResult(response.data);
                const byId = new Map(result.unsynced.map((i) => [i.id, i]));
                applyShoppingList((prev) => {
                    const next = asList<ShoppingListItem>(prev).map((item) => {
                        const unsynced = byId.get(item.id);
                        return unsynced
                            ? { ...item, ...unsynced, synced_to_pantry: false }
                            : item;
                    });
                    if (userId) {
                        void saveSnapshot(userId, next);
                    }
                    return next;
                });
                await fetchAllPantryItems();
                return { ...response, data: result };
            }
            return response as ApiResponse<{
                unsynced: ShoppingListItem[];
                skipped: Array<{ id: string; reason: string }>;
            }>;
        },
        [userId, fetchAllPantryItems],
    );

    // === MEAL PLAN FUNCTIONS ===
    const fetchAllMealPlans = useCallback(async (): Promise<MealPlan[]> => {
        const uid = userIdRef.current;
        setResourceLoading('mealPlan', true);
        try {
            const response = await mealPlanApi.list();
            if (uid !== userIdRef.current) return [];
            setResourceError('mealPlan', !response.success);
            if (response.success && response.data) {
                const list = unwrapListResponse(
                    response.data as MealPlan[] | { mealPlans?: MealPlan[] },
                    'mealPlans'
                ).map((plan) => normalizeMealPlan(plan as unknown as Record<string, unknown>));
                setMealPlan(asList(list));
                return list;
            }
        } catch (error) {
            console.error('Failed to fetch meal plans:', error);
            setResourceError('mealPlan', true);
        } finally {
            setResourceLoading('mealPlan', false);
        }
        return [];
    }, [setResourceLoading, setResourceError]);

    const addMealPlan = useCallback(async (newMealPlan: Partial<MealPlan>): Promise<ApiResponse<MealPlan>> => {
        const response = await mealPlanApi.create(newMealPlan);
        if (response.success && response.data) {
            const raw = response.data as MealPlan | { mealPlan?: MealPlan };
            const created = normalizeMealPlan(
                (('mealPlan' in raw && raw.mealPlan) ? raw.mealPlan : raw) as unknown as Record<string, unknown>
            );
            setMealPlan((prev) => [...prev, created]);
            return { ...response, data: created };
        }
        return response as ApiResponse<MealPlan>;
    }, []);

    const updateMealPlan = useCallback(async (mp: MealPlan) => {
        const response = await mealPlanApi.update(mp.id, mp);
        if (response.success && response.data) {
            setMealPlan((prev) => prev.map((m) => (m.id === mp.id ? normalizeMealPlan(response.data!) : m)));
        }
    }, []);

    const deleteMealPlan = useCallback(async (id: string) => {
        const response = await mealPlanApi.delete(id);
        if (response.success) {
            setMealPlan((prev) => prev.filter((m) => m.id !== id));
        }
    }, []);

    const confirmMealPlan = useCallback(async (id: string): Promise<ApiResponse<ConfirmMealPlanResult>> => {
        const response = await mealPlanApi.confirm(id);
        if (response.success && response.data) {
            const confirmed = normalizeMealPlan(
                (response.data.mealPlan ?? response.data) as unknown as Record<string, unknown>
            );
            setMealPlan((prev) => prev.map((m) => (m.id === id ? confirmed : m)));
            await fetchAllPantryItems();
        }
        return response;
    }, [fetchAllPantryItems]);

    const skipMealPlan = useCallback(async (id: string) => {
        const response = await mealPlanApi.skip(id);
        if (response.success && response.data) {
            const skipped = normalizeMealPlan(
                (response.data.mealPlan ?? response.data) as unknown as Record<string, unknown>
            );
            setMealPlan((prev) => prev.map((m) => (m.id === id ? skipped : m)));
        }
        return response;
    }, []);

    // === USER SETTINGS ===
    const updateUserSettings = useCallback((settings: UserSettings) => {
        setUserSettings(settings);
        // TODO: Add API call for user settings when available
    }, []);

    const value: PantryContextType = useMemo(
        () => ({
            loading,
            loadingByResource,
            errorByResource,
            recipes: asList(recipes),
            pantryItems: asList(pantryItems),
            shoppingList: asList(shoppingList),
            shoppingListSyncStatus,
            folders: asList(folders),
            ingredients: asList(ingredients),
            mealPlan: asList(mealPlan),
            userSettings,
            addRecipe,
            fetchAllRecipes,
            updateRecipe,
            deleteRecipe,
            updateUserSettings,
            fetchAllFolders,
            addFolder,
            deleteFolder,
            updateFolder,
            fetchAllPantryItems,
            updatePantryItem,
            updatePantryItems,
            addPantryItem,
            removePantryItem,
            fetchAllIngredients,
            fetchAllShoppingListItems,
            updateShoppingListItem,
            addShoppingListItem,
            removeShoppingListItem,
            markAllShoppingListChecked,
            retryShoppingListSync,
            syncShoppingItemsToPantry,
            unsyncShoppingItemsFromPantry,
            fetchAllMealPlans,
            addMealPlan,
            updateMealPlan,
            deleteMealPlan,
            confirmMealPlan,
            skipMealPlan,
        }),
        [
            loading,
            loadingByResource,
            errorByResource,
            recipes,
            pantryItems,
            shoppingList,
            shoppingListSyncStatus,
            folders,
            ingredients,
            mealPlan,
            userSettings,
            addRecipe,
            fetchAllRecipes,
            updateRecipe,
            deleteRecipe,
            updateUserSettings,
            fetchAllFolders,
            addFolder,
            deleteFolder,
            updateFolder,
            fetchAllPantryItems,
            updatePantryItem,
            updatePantryItems,
            addPantryItem,
            removePantryItem,
            fetchAllIngredients,
            fetchAllShoppingListItems,
            updateShoppingListItem,
            addShoppingListItem,
            removeShoppingListItem,
            markAllShoppingListChecked,
            retryShoppingListSync,
            syncShoppingItemsToPantry,
            unsyncShoppingItemsFromPantry,
            fetchAllMealPlans,
            addMealPlan,
            updateMealPlan,
            deleteMealPlan,
            confirmMealPlan,
            skipMealPlan,
        ],
    );

    return <PantryContext.Provider value={value}>{children}</PantryContext.Provider>;
}

export function usePantry() {
    const context = useContext(PantryContext);
    if (context === undefined) {
        throw new Error('usePantry must be used within a PantryProvider');
    }
    return context;
}
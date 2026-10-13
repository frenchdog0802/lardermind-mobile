/**
 * Shared types for the LarderMind mobile application
 * Migrated from Diet_APP web client
 */

export interface ApiResponse<T = unknown> {
    success: boolean;
    message?: string;
    data?: T;
    statusCode?: number;
}

export type User = {
    id?: string;
    first_name: string;
    last_name: string;
    name: string;
    email: string;
    token?: string;
};

export interface UserSettings {
    name: string;
    language: string;
    measurement_unit: string;
}

export interface UserPreferences {
    id?: string;
    allergies: string[];
    dislikes: string[];
    likes: string[];
    dietaryRestrictions: string[];
    householdNotes: string;
    measurementUnit: 'metric' | 'imperial';
    notes: string;
}

export interface IngredientEntry {
    id: string;
    name: string;
    default_unit: string;
    unit_kind?: 'weight' | 'volume' | 'count';
    base_unit?: string;
    default_display_unit?: string;
    kind_locked?: boolean;
    image_url?: number;
}

export interface Folder {
    id: string;
    name: string;
    icon: string;
}

export interface Recipe {
    id: string;
    folder_id: string;
    meal_name: string;
    instructions: string[];
    ingredients: {
        name: string;
        quantity: number;
        unit: string;
        ingredient_id?: string;
        unit_kind?: string;
        base_unit?: string;
        default_display_unit?: string;
    }[];
    image: {
        public_id: string;
        url: string;
    } | null;
}

export type ShoppingListItem = {
    id: string;
    name: string;
    quantity: number;
    unit: string;
    checked: boolean;
    /** True when quantity has been merged into pantry via batch sync. */
    synced_to_pantry?: boolean;
    ingredient_id?: string;
    unit_kind?: string;
    base_unit?: string;
    default_display_unit?: string;
};

export type SyncToPantryItemInput = {
    id: string;
    quantity?: number;
    unit?: string;
};

export type SyncToPantryResult = {
    synced: ShoppingListItem[];
    skipped: Array<{ id: string; reason: string }>;
};

export type UnsyncFromPantryResult = {
    unsynced: ShoppingListItem[];
    skipped: Array<{ id: string; reason: string }>;
};

export type ShoppingListSyncStatus = {
    isOnline: boolean;
    pendingCount: number;
    isSyncing: boolean;
    lastSyncError: string | null;
    lastSyncedAt: number | null;
};

export interface PantryItem {
    id: string;
    name: string;
    quantity: number;
    item_planned?: number;
    item_to_buy?: number;
    unit: string;
    ingredient_id?: string;
    unit_kind?: string;
    base_unit?: string;
    default_display_unit?: string;
}

export interface MealPlan {
    id: string;
    meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack';
    serving_date: string; // YYYY-MM-DD
    recipe_id: string;
    meal_name: string;
    image?: string | null;
    status?: 'PLANNED' | 'PENDING_CONFIRM' | 'CONFIRMED' | 'SKIPPED';
}

export interface MealConfirmShortage {
    ingredient_id?: string;
    name: string;
    needed: number;
    available: number;
    unit: string;
}

export interface ConfirmMealPlanResult {
    mealPlan: MealPlan;
    shortages: MealConfirmShortage[];
    deducted: Array<{
        ingredient_id?: string;
        name: string;
        deducted: number;
        previous_quantity: number;
        new_quantity: number;
        unit: string;
    }>;
    alreadyConfirmed: boolean;
}

export interface RecipeSuggestion {
    id: string;
    name: string;
    ingredients: {
        name: string;
        quantity: number;
        unit: string;
    }[];
    instructions: string[];
    cookTime?: number;
    difficulty?: string;
    image?: string;
    savedAt?: number;
}

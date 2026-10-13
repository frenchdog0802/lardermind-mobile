import { api } from './client';
import {
    ShoppingListItem,
    ApiResponse,
    SyncToPantryItemInput,
    SyncToPantryResult,
    UnsyncFromPantryResult,
} from '../types';

type ShoppingListItemDto = {
    id?: string;
    name?: string;
    details?: Partial<ShoppingListItem> & Record<string, unknown>;
};

function fromDto(dto: ShoppingListItemDto): ShoppingListItem {
    const details = dto.details ?? {};
    const flat = dto as ShoppingListItemDto & Partial<ShoppingListItem>;
    const synced =
        flat.synced_to_pantry ??
        (details.synced_to_pantry as boolean | undefined) ??
        false;
    return {
        id: String(flat.id ?? details.id ?? ''),
        name: String(flat.name ?? details.name ?? ''),
        quantity: Number(flat.quantity ?? details.quantity ?? 0),
        unit: String(flat.unit ?? details.unit ?? ''),
        checked: Boolean(flat.checked ?? details.checked ?? false),
        synced_to_pantry: Boolean(synced),
        ingredient_id:
            flat.ingredient_id != null
                ? String(flat.ingredient_id)
                : details.ingredient_id != null
                  ? String(details.ingredient_id)
                  : undefined,
        unit_kind:
            flat.unit_kind != null
                ? String(flat.unit_kind)
                : details.unit_kind != null
                  ? String(details.unit_kind)
                  : undefined,
        base_unit:
            flat.base_unit != null
                ? String(flat.base_unit)
                : details.base_unit != null
                  ? String(details.base_unit)
                  : undefined,
        default_display_unit:
            flat.default_display_unit != null
                ? String(flat.default_display_unit)
                : details.default_display_unit != null
                  ? String(details.default_display_unit)
                  : undefined,
    };
}

/**
 * Dual-backend payload:
 * - Spring expects { name, details: { quantity, unit, checked } }
 * - Nest expects flat { name, quantity, unit, checked }
 */
export function toRequestPayload(data: Partial<ShoppingListItem>) {
    const quantity = data.quantity;
    const unit = data.unit;
    const checked = data.checked ?? false;
    return {
        name: data.name,
        quantity,
        unit,
        checked,
        details: {
            quantity,
            unit,
            checked,
        },
    };
}

export function parseShoppingListItems(data: unknown): ShoppingListItem[] {
    if (Array.isArray(data)) {
        return data.map(fromDto);
    }
    if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) {
        return (data as { items: ShoppingListItemDto[] }).items.map(fromDto);
    }
    return [];
}

export function parseShoppingListItem(data: unknown): ShoppingListItem | null {
    if (!data || typeof data !== 'object') {
        return null;
    }
    const obj = data as Record<string, unknown>;
    if (obj.item && typeof obj.item === 'object') {
        return fromDto(obj.item as ShoppingListItemDto);
    }
    return fromDto(obj as ShoppingListItemDto);
}

export function parseSyncResult(data: unknown): SyncToPantryResult {
    const root = (data && typeof data === 'object' ? data : {}) as {
        synced?: unknown;
        skipped?: unknown;
    };
    return {
        synced: parseShoppingListItems(root.synced ?? []),
        skipped: Array.isArray(root.skipped)
            ? (root.skipped as Array<{ id: string; reason: string }>)
            : [],
    };
}

export function parseUnsyncResult(data: unknown): UnsyncFromPantryResult {
    const root = (data && typeof data === 'object' ? data : {}) as {
        unsynced?: unknown;
        skipped?: unknown;
    };
    return {
        unsynced: parseShoppingListItems(root.unsynced ?? []),
        skipped: Array.isArray(root.skipped)
            ? (root.skipped as Array<{ id: string; reason: string }>)
            : [],
    };
}

export const shoppingListApi = {
    list: (query?: string): Promise<ApiResponse<unknown>> =>
        api.get<unknown>(query ? `shopping-list?query=${encodeURIComponent(query)}` : 'shopping-list'),

    get: (id: string | number): Promise<ApiResponse<unknown>> =>
        api.get<unknown>(`shopping-list/${id}`),

    create: (data: Partial<ShoppingListItem>): Promise<ApiResponse<unknown>> =>
        api.post<unknown>('shopping-list', toRequestPayload(data)),

    update: (id: string | number, data: Partial<ShoppingListItem>): Promise<ApiResponse<unknown>> =>
        api.put<unknown>(`shopping-list/${id}`, toRequestPayload(data)),

    delete: (id: string | number): Promise<ApiResponse<void>> =>
        api.delete<void>(`shopping-list/${id}`),

    syncToPantry: (items: SyncToPantryItemInput[]): Promise<ApiResponse<unknown>> =>
        api.post<unknown>('shopping-list/sync-to-pantry', { items }),

    unsyncFromPantry: (itemIds: string[]): Promise<ApiResponse<unknown>> =>
        api.post<unknown>('shopping-list/unsync-from-pantry', { item_ids: itemIds }),
};

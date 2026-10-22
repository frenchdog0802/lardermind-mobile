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
    const version = readVersion(flat.version ?? details.version);
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
        ...(version !== undefined ? { version } : {}),
    };
}

function readVersion(raw: unknown): number | undefined {
    if (typeof raw === 'number' && Number.isInteger(raw) && raw >= 0) return raw;
    if (typeof raw === 'string' && /^\d+$/.test(raw)) return Number(raw);
    return undefined;
}

/**
 * Dual-backend payload:
 * - Spring expects { name, details: { quantity, unit, checked } }
 * - Nest / Workers expects flat { name, quantity, unit, checked }
 * Expected `version` is sent on both shapes so the two sources agree.
 */
export function toRequestPayload(data: Partial<ShoppingListItem>, expectedVersion?: number) {
    const details: {
        quantity?: number;
        unit?: string;
        checked?: boolean;
        version?: number;
    } = {};
    const body: {
        name?: string;
        quantity?: number;
        unit?: string;
        checked?: boolean;
        version?: number;
        details: typeof details;
    } = { details };

    if (data.name !== undefined) body.name = data.name;
    if (data.quantity !== undefined) {
        body.quantity = data.quantity;
        details.quantity = data.quantity;
    }
    if (data.unit !== undefined) {
        body.unit = data.unit;
        details.unit = data.unit;
    }
    if (data.checked !== undefined) {
        body.checked = data.checked;
        details.checked = data.checked;
    }
    if (expectedVersion !== undefined) {
        body.version = expectedVersion;
        details.version = expectedVersion;
    }
    return body;
}

export type ShoppingWriteOptions = {
    /** Stable per queued op. Replays the original response for 24 hours. */
    idempotencyKey?: string;
    /** When set, a mismatch returns 409 `version_conflict` instead of last-write-wins. */
    expectedVersion?: number;
    skipUnauthorizedHandler?: boolean;
};

function writeHeaders(options?: ShoppingWriteOptions): Record<string, string> | undefined {
    if (!options?.idempotencyKey) return undefined;
    return { 'Idempotency-Key': options.idempotencyKey };
}

function writeExtras(options?: ShoppingWriteOptions) {
    return {
        headers: writeHeaders(options),
        skipUnauthorizedHandler: options?.skipUnauthorizedHandler,
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
    list: (
        query?: string,
        options?: { skipUnauthorizedHandler?: boolean },
    ): Promise<ApiResponse<unknown>> =>
        api.get<unknown>(query ? `shopping-list?query=${encodeURIComponent(query)}` : 'shopping-list', {
            skipUnauthorizedHandler: options?.skipUnauthorizedHandler,
        }),

    get: (id: string | number): Promise<ApiResponse<unknown>> =>
        api.get<unknown>(`shopping-list/${id}`),

    create: (
        data: Partial<ShoppingListItem>,
        options?: ShoppingWriteOptions,
    ): Promise<ApiResponse<unknown>> =>
        api.post<unknown>('shopping-list', toRequestPayload(data), writeExtras(options)),

    update: (
        id: string | number,
        data: Partial<ShoppingListItem>,
        options?: ShoppingWriteOptions,
    ): Promise<ApiResponse<unknown>> =>
        api.put<unknown>(
            `shopping-list/${id}`,
            toRequestPayload(data, options?.expectedVersion),
            writeExtras(options),
        ),

    delete: (id: string | number, options?: ShoppingWriteOptions): Promise<ApiResponse<void>> => {
        const version = options?.expectedVersion;
        const path =
            version !== undefined
                ? `shopping-list/${id}?version=${encodeURIComponent(String(version))}`
                : `shopping-list/${id}`;
        return api.delete<void>(path, writeExtras(options));
    },

    syncToPantry: (items: SyncToPantryItemInput[]): Promise<ApiResponse<unknown>> =>
        api.post<unknown>('shopping-list/sync-to-pantry', { items }),

    unsyncFromPantry: (itemIds: string[]): Promise<ApiResponse<unknown>> =>
        api.post<unknown>('shopping-list/unsync-from-pantry', { item_ids: itemIds }),
};

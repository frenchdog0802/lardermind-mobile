import type { ShoppingListItem } from '../../types';

export const SHOPPING_LIST_OFFLINE_VERSION = 1 as const;

export type ShoppingListSnapshotV1 = {
  version: typeof SHOPPING_LIST_OFFLINE_VERSION;
  updatedAt: number;
  items: ShoppingListItem[];
};

export type MutationType = 'CREATE' | 'UPDATE' | 'DELETE';

export type ShoppingListMutationPayload = {
  name?: string;
  quantity?: number;
  unit?: string;
  checked?: boolean;
};

export type ShoppingListMutationV1 = {
  opId: string;
  type: MutationType;
  itemId: string;
  payload?: ShoppingListMutationPayload;
  createdAt: number;
  /**
   * Item version observed when this op was queued.
   * Sent as the expected version so a stale write returns 409 instead of
   * silently overwriting newer server fields.
   */
  baseVersion?: number;
  /** How many times this op was rewritten after `version_conflict`. */
  conflictRetries?: number;
  /** How many times the idempotency key was rotated after `idempotency_key_reused`. */
  keyRotations?: number;
};

export type FailedShoppingListMutationV1 = ShoppingListMutationV1 & {
  failedAt: number;
  statusCode?: number;
  code?: string;
  message: string;
};

export type ShoppingListQueueV1 = {
  version: typeof SHOPPING_LIST_OFFLINE_VERSION;
  mutations: ShoppingListMutationV1[];
};

export type ShoppingListSyncStatus = {
  isOnline: boolean;
  pendingCount: number;
  failedCount: number;
  isSyncing: boolean;
  lastSyncError: string | null;
  lastSyncedAt: number | null;
};

export const DEFAULT_SYNC_STATUS: ShoppingListSyncStatus = {
  isOnline: true,
  pendingCount: 0,
  failedCount: 0,
  isSyncing: false,
  lastSyncError: null,
  lastSyncedAt: null,
};

export function isLocalItemId(id: string): boolean {
  return id.startsWith('local_');
}

export function snapshotKey(userId: string): string {
  return `@lardermind/shopping-list/v1/${userId}/snapshot`;
}

export function queueKey(userId: string): string {
  return `@lardermind/shopping-list/v1/${userId}/queue`;
}

export function failedKey(userId: string): string {
  return `@lardermind/shopping-list/v1/${userId}/failed`;
}

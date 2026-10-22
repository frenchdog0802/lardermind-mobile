import type { ApiResponse, ShoppingListItem } from '../../types';
import {
  parseShoppingListItem,
  parseShoppingListItems,
  shoppingListApi,
  type ShoppingWriteOptions,
} from '../../api/shoppingList';
import { getIsOnline } from './connectivity';
import {
  isLocalItemId,
  type FailedShoppingListMutationV1,
  type ShoppingListMutationV1,
} from './types';
import { coalesce, createOpId, idempotencyKeyFor, remapItemId } from './queue';
import { applyPendingOps, isEmptyPayload, reconcileServerList } from './project';
import { loadFailed, loadQueue, loadSnapshot, saveFailed, saveQueue, saveSnapshot } from './store';

export type FlushResult = {
  ok: boolean;
  error?: string;
  remaining: number;
  failedCount: number;
  items?: ShoppingListItem[];
};

type FlushCallbacks = {
  onItems?: (items: ShoppingListItem[]) => void;
  onQueue?: (mutations: ShoppingListMutationV1[]) => void;
  onFailed?: (failed: FailedShoppingListMutationV1[]) => void;
  /**
   * Return true when the session can be retried (token still valid, or a
   * future refresh call succeeded). Return false when the user must sign in.
   */
  recoverAuth?: () => Promise<boolean>;
  /** Called once when auth cannot be recovered. Typically signs the user out. */
  onAuthFailure?: () => void | Promise<void>;
};

const flushLocks = new Set<string>();
const backoffTimers = new Map<string, ReturnType<typeof setTimeout>>();
const BACKOFF_MS = [2000, 5000, 15000];
const backoffAttempt = new Map<string, number>();
const MAX_CONFLICT_RETRIES = 2;

export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const index = Math.min(Math.max(attempt, 0), BACKOFF_MS.length - 1);
  const base = BACKOFF_MS[index];
  const jitter = Math.round(base * 0.2 * (random() * 2 - 1));
  return Math.max(0, base + jitter);
}

export function clearBackoff(userId: string): void {
  const timer = backoffTimers.get(userId);
  if (timer) {
    clearTimeout(timer);
    backoffTimers.delete(userId);
  }
  backoffAttempt.delete(userId);
}

function scheduleBackoff(userId: string, flush: () => void): void {
  clearBackoff(userId);
  const attempt = backoffAttempt.get(userId) ?? 0;
  const delay = backoffDelayMs(attempt);
  backoffAttempt.set(userId, attempt + 1);
  const timer = setTimeout(() => {
    backoffTimers.delete(userId);
    flush();
  }, delay);
  backoffTimers.set(userId, timer);
}

function isNetworkFailure(message?: string, statusCode?: number): boolean {
  if (statusCode != null && statusCode > 0) return false;
  const msg = (message ?? '').toLowerCase();
  return msg.includes('network') || msg.includes('failed to fetch') || msg === '';
}

function isRetryableStatus(statusCode?: number, code?: string): boolean {
  if (code === 'idempotency_in_progress') return true;
  if (statusCode == null || statusCode === 0) return true;
  if (statusCode === 408 || statusCode === 429) return true;
  return statusCode >= 500;
}

function writeOptions(op: ShoppingListMutationV1): ShoppingWriteOptions {
  return {
    idempotencyKey: idempotencyKeyFor(op.opId),
    ...(op.type !== 'CREATE' && op.baseVersion !== undefined
      ? { expectedVersion: op.baseVersion }
      : {}),
    skipUnauthorizedHandler: true,
  };
}

function readConflictItem(data: unknown): ShoppingListItem | null {
  if (!data || typeof data !== 'object') return null;
  const current = (data as { current?: unknown }).current;
  return parseShoppingListItem(current);
}

function upsertServerItem(items: ShoppingListItem[], next: ShoppingListItem): ShoppingListItem[] {
  const index = items.findIndex((item) => item.id === next.id);
  if (index < 0) return [next, ...items];
  return items.map((item) => (item.id === next.id ? { ...item, ...next, name: next.name || item.name } : item));
}

function failureRecord(
  op: ShoppingListMutationV1,
  response: ApiResponse<unknown>,
  message: string,
): FailedShoppingListMutationV1 {
  return {
    ...op,
    failedAt: Date.now(),
    statusCode: response.statusCode,
    code: response.code,
    message,
  };
}

export async function flushShoppingListQueue(
  userId: string,
  callbacks: FlushCallbacks = {},
): Promise<FlushResult> {
  if (!userId) {
    return { ok: false, error: 'Missing user', remaining: 0, failedCount: 0 };
  }
  if (flushLocks.has(userId)) {
    const mutations = await loadQueue(userId);
    return { ok: false, error: 'Sync in progress', remaining: mutations.length, failedCount: 0 };
  }

  flushLocks.add(userId);
  try {
    const online = await getIsOnline();
    if (!online) {
      const mutations = await loadQueue(userId);
      const failed = await loadFailed(userId);
      return { ok: false, error: 'Offline', remaining: mutations.length, failedCount: failed.length };
    }

    let mutations = coalesce(await loadQueue(userId));
    let failed = await loadFailed(userId);
    const cached = await loadSnapshot(userId);
    const cachedItems = Array.isArray(cached) ? cached : [];
    // Server rows only. Pending ops are re-applied for the snapshot so a
    // refresh does not freeze fields the server has newer values for.
    let serverItems: ShoppingListItem[] | null = null;
    let items = cachedItems;

    const opening = await shoppingListApi.list(undefined, { skipUnauthorizedHandler: true });
    if (opening.success && opening.data !== undefined) {
      serverItems = reconcileServerList(cachedItems, parseShoppingListItems(opening.data), []);
      items = applyPendingOps(serverItems, mutations);
    }

    callbacks.onQueue?.(mutations);
    callbacks.onItems?.(items);

    let authRetried = false;

    const view = (): ShoppingListItem[] =>
      serverItems ? applyPendingOps(serverItems, mutations) : items;

    const persist = async () => {
      items = view();
      await saveSnapshot(userId, items);
      await saveQueue(userId, mutations);
      await saveFailed(userId, failed);
      callbacks.onItems?.(items);
      callbacks.onQueue?.(mutations);
      callbacks.onFailed?.(failed);
    };

    const deadLetter = async (op: ShoppingListMutationV1, response: ApiResponse<unknown>, message: string) => {
      failed = [
        ...failed,
        failureRecord(op, response, message),
      ];
      mutations = mutations.slice(1);
      await persist();
    };

    const pause = async (message: string): Promise<FlushResult> => {
      items = view();
      await saveQueue(userId, mutations);
      await saveSnapshot(userId, items);
      scheduleBackoff(userId, () => {
        void flushShoppingListQueue(userId, callbacks);
      });
      return {
        ok: false,
        error: message,
        remaining: mutations.length,
        failedCount: failed.length,
        items,
      };
    };

    while (mutations.length > 0) {
      const op = mutations[0];

      if (op.type === 'UPDATE' && isEmptyPayload(op.payload)) {
        mutations = mutations.slice(1);
        await persist();
        continue;
      }

      if ((op.type === 'UPDATE' || op.type === 'DELETE') && isLocalItemId(op.itemId)) {
        mutations = mutations.slice(1);
        await persist();
        continue;
      }

      const response = await dispatchOp(op);

      if (response.success) {
        if (op.type === 'CREATE') {
          const created = parseShoppingListItem(response.data);
          const serverId = created?.id;
          if (!serverId) {
            await deadLetter(op, response, 'Create returned no id');
            continue;
          }
          const saved: ShoppingListItem = {
            ...created,
            id: serverId,
            name: created.name || op.payload?.name || '',
          };
          if (serverItems) {
            serverItems = [saved, ...serverItems.filter((item) => item.id !== op.itemId && item.id !== serverId)];
          } else {
            items = [saved, ...items.filter((item) => item.id !== op.itemId && item.id !== serverId)];
          }
          mutations = coalesce(remapItemId(mutations.slice(1), op.itemId, serverId, created.version));
          await persist();
          continue;
        }

        if (op.type === 'UPDATE') {
          const updated = parseShoppingListItem(response.data);
          if (updated) {
            const saved = { ...updated, name: updated.name || op.payload?.name || '' };
            if (serverItems) serverItems = upsertServerItem(serverItems, saved);
            else items = upsertServerItem(items, saved);
          }
          mutations = mutations.slice(1);
          await persist();
          continue;
        }

        if (serverItems) serverItems = serverItems.filter((item) => item.id !== op.itemId);
        else items = items.filter((item) => item.id !== op.itemId);
        mutations = mutations.slice(1);
        await persist();
        continue;
      }

      if (response.statusCode === 404 && op.type !== 'CREATE') {
        if (op.type === 'DELETE') {
          if (serverItems) serverItems = serverItems.filter((item) => item.id !== op.itemId);
          else items = items.filter((item) => item.id !== op.itemId);
        }
        mutations = mutations.slice(1);
        await persist();
        continue;
      }

      if (response.code === 'version_conflict' && op.type !== 'CREATE') {
        const current = readConflictItem(response.data);
        const retries = op.conflictRetries ?? 0;
        if (!current || retries >= MAX_CONFLICT_RETRIES) {
          if (current) {
            if (serverItems) serverItems = upsertServerItem(serverItems, current);
            else items = upsertServerItem(items, current);
          }
          const label = op.payload?.name || current?.name || 'An item';
          await deadLetter(
            { ...op, baseVersion: current?.version ?? op.baseVersion },
            response,
            `${label} changed on the server. Your edit was not applied.`,
          );
          continue;
        }
        if (current) {
          if (serverItems) serverItems = upsertServerItem(serverItems, current);
          else {
            serverItems = upsertServerItem(
              items.filter((item) => item.id !== op.itemId),
              current,
            );
          }
        }
        // The 409 body is stored under the old key for 24h, so the follow-up
        // write needs a new Idempotency-Key. baseVersion tracks the row we
        // just read; the payload stays limited to fields the user edited.
        mutations = [
          {
            ...op,
            opId: createOpId(),
            baseVersion: current?.version ?? op.baseVersion,
            conflictRetries: retries + 1,
          },
          ...mutations.slice(1),
        ];
        await persist();
        continue;
      }

      if (response.code === 'idempotency_key_reused') {
        const rotations = op.keyRotations ?? 0;
        if (rotations >= 1) {
          await deadLetter(op, response, response.message || 'Idempotency key was already used.');
          continue;
        }
        mutations = [
          { ...op, opId: createOpId(), keyRotations: rotations + 1 },
          ...mutations.slice(1),
        ];
        await persist();
        continue;
      }

      if (response.statusCode === 401 || response.code === 'unauthorized') {
        if (!authRetried) {
          authRetried = true;
          let recovered = false;
          try {
            recovered = callbacks.recoverAuth ? await callbacks.recoverAuth() : false;
          } catch {
            recovered = false;
          }
          if (recovered) continue;
        }
        items = view();
        await saveQueue(userId, mutations);
        await saveSnapshot(userId, items);
        scheduleBackoff(userId, () => {
          void flushShoppingListQueue(userId, callbacks);
        });
        await callbacks.onAuthFailure?.();
        return {
          ok: false,
          error: 'Session expired. Sign in to keep syncing.',
          remaining: mutations.length,
          failedCount: failed.length,
          items,
        };
      }

      if (isNetworkFailure(response.message, response.statusCode) || isRetryableStatus(response.statusCode, response.code)) {
        return pause(response.message || 'Network error');
      }

      if (response.statusCode != null && response.statusCode >= 400 && response.statusCode < 500) {
        const label = op.payload?.name || 'An item';
        await deadLetter(op, response, response.message || `Couldn't sync ${label}.`);
        continue;
      }

      return pause(response.message || 'Sync failed');
    }

    const listResponse = await shoppingListApi.list(undefined, { skipUnauthorizedHandler: true });
    if (listResponse.success && listResponse.data !== undefined) {
      serverItems = parseShoppingListItems(listResponse.data);
      items = reconcileServerList(items, serverItems, mutations);
      await saveSnapshot(userId, items);
      callbacks.onItems?.(items);
    }

    clearBackoff(userId);
    const error =
      failed.length > 0
        ? failed.length === 1
          ? failed[0].message
          : `Couldn't sync ${failed.length} changes. Later changes were still sent.`
        : undefined;
    return {
      ok: true,
      error,
      remaining: 0,
      failedCount: failed.length,
      items,
    };
  } finally {
    flushLocks.delete(userId);
  }
}

async function dispatchOp(op: ShoppingListMutationV1): Promise<ApiResponse<unknown>> {
  const options = writeOptions(op);
  if (op.type === 'CREATE') {
    return shoppingListApi.create(
      {
        name: op.payload?.name,
        quantity: op.payload?.quantity,
        unit: op.payload?.unit,
        checked: op.payload?.checked ?? false,
      },
      options,
    );
  }
  if (op.type === 'UPDATE') {
    return shoppingListApi.update(op.itemId, op.payload ?? {}, options);
  }
  return shoppingListApi.delete(op.itemId, options);
}

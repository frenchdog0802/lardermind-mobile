import type { ShoppingListItem } from '../../types';
import type { ShoppingListMutationPayload, ShoppingListMutationV1 } from './types';

const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{1,128}$/;

export function createOpId(): string {
  return `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Header value for `Idempotency-Key`. Falls back when a stored id is unsafe. */
export function idempotencyKeyFor(opId: string): string {
  if (IDEMPOTENCY_KEY.test(opId)) return opId;
  const cleaned = opId.replace(/[^A-Za-z0-9._:-]/g, '').slice(0, 128);
  return cleaned.length > 0 ? cleaned : createOpId();
}

export function createLocalItemId(): string {
  return `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function coalesce(mutations: ShoppingListMutationV1[]): ShoppingListMutationV1[] {
  const result: ShoppingListMutationV1[] = [];

  for (const op of mutations) {
    if (op.type === 'CREATE') {
      result.push({ ...op, payload: op.payload ? { ...op.payload } : undefined });
      continue;
    }

    if (op.type === 'DELETE') {
      const createIdx = result.findIndex((m) => m.type === 'CREATE' && m.itemId === op.itemId);
      if (createIdx >= 0) {
        result.splice(createIdx, 1);
        continue;
      }
      // Drop any pending UPDATEs for this id; keep a single DELETE
      for (let i = result.length - 1; i >= 0; i -= 1) {
        if (result[i].itemId === op.itemId) {
          result.splice(i, 1);
        }
      }
      result.push({ ...op });
      continue;
    }

    // UPDATE
    const createIdx = result.findIndex((m) => m.type === 'CREATE' && m.itemId === op.itemId);
    if (createIdx >= 0) {
      const create = result[createIdx];
      result[createIdx] = {
        ...create,
        payload: { ...create.payload, ...op.payload },
      };
      continue;
    }

    const updateIdx = result.findIndex((m) => m.type === 'UPDATE' && m.itemId === op.itemId);
    if (updateIdx >= 0) {
      const prev = result[updateIdx];
      result[updateIdx] = {
        ...prev,
        payload: { ...prev.payload, ...op.payload },
        createdAt: op.createdAt,
        baseVersion: prev.baseVersion ?? op.baseVersion,
      };
      continue;
    }

    // If already deleted in queue, ignore further updates
    if (result.some((m) => m.type === 'DELETE' && m.itemId === op.itemId)) {
      continue;
    }

    result.push({ ...op, payload: op.payload ? { ...op.payload } : undefined });
  }

  return result;
}

export function enqueueCreate(
  mutations: ShoppingListMutationV1[],
  itemId: string,
  payload: ShoppingListMutationPayload,
): ShoppingListMutationV1[] {
  return coalesce([
    ...mutations,
    {
      opId: createOpId(),
      type: 'CREATE',
      itemId,
      payload,
      createdAt: Date.now(),
    },
  ]);
}

export function enqueueUpdate(
  mutations: ShoppingListMutationV1[],
  itemId: string,
  payload: ShoppingListMutationPayload,
  baseVersion?: number,
): ShoppingListMutationV1[] {
  return coalesce([
    ...mutations,
    {
      opId: createOpId(),
      type: 'UPDATE',
      itemId,
      payload,
      createdAt: Date.now(),
      ...(baseVersion !== undefined ? { baseVersion } : {}),
    },
  ]);
}

export function enqueueDelete(
  mutations: ShoppingListMutationV1[],
  itemId: string,
  baseVersion?: number,
): ShoppingListMutationV1[] {
  return coalesce([
    ...mutations,
    {
      opId: createOpId(),
      type: 'DELETE',
      itemId,
      createdAt: Date.now(),
      ...(baseVersion !== undefined ? { baseVersion } : {}),
    },
  ]);
}

export function remapItemId(
  mutations: ShoppingListMutationV1[],
  fromId: string,
  toId: string,
  serverVersion?: number,
): ShoppingListMutationV1[] {
  return mutations.map((m) => {
    if (m.itemId !== fromId) return m;
    return {
      ...m,
      itemId: toId,
      baseVersion: m.baseVersion ?? serverVersion,
    };
  });
}

/** Fresh idempotency keys so a replayed 4xx is not returned for 24 hours. */
export function requeueFailedMutations(
  failed: ShoppingListMutationV1[],
): ShoppingListMutationV1[] {
  return failed.map((op) => ({
    opId: createOpId(),
    type: op.type,
    itemId: op.itemId,
    payload: op.payload ? { ...op.payload } : undefined,
    createdAt: Date.now(),
    ...(op.baseVersion !== undefined ? { baseVersion: op.baseVersion } : {}),
  }));
}

export function remapItemsInList(
  items: ShoppingListItem[],
  fromId: string,
  toId: string,
): ShoppingListItem[] {
  return items.map((item) => (item.id === fromId ? { ...item, id: toId } : item));
}

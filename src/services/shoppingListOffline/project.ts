import type { ShoppingListItem } from '../../types';
import { mergeNames } from './mergeNames';
import type { ShoppingListMutationPayload, ShoppingListMutationV1 } from './types';

const TRACKED_FIELDS = ['name', 'quantity', 'unit', 'checked'] as const;

export function isEmptyPayload(payload: ShoppingListMutationPayload | undefined): boolean {
  if (!payload) return true;
  return TRACKED_FIELDS.every((field) => payload[field] === undefined);
}

/**
 * Fields the user actually changed. Unchanged fields stay off the payload so a
 * later version conflict can keep the server value for anything the user did
 * not edit.
 */
export function payloadFromEdit(
  before: ShoppingListItem | undefined,
  after: Pick<ShoppingListItem, 'name' | 'quantity' | 'unit' | 'checked'>,
): ShoppingListMutationPayload {
  if (!before) {
    return {
      name: after.name,
      quantity: after.quantity,
      unit: after.unit,
      checked: after.checked,
    };
  }
  const payload: ShoppingListMutationPayload = {};
  if (before.name !== after.name) payload.name = after.name;
  if (Number(before.quantity) !== Number(after.quantity)) payload.quantity = after.quantity;
  if ((before.unit ?? '') !== (after.unit ?? '')) payload.unit = after.unit;
  if (Boolean(before.checked) !== Boolean(after.checked)) payload.checked = after.checked;
  return payload;
}

export function applyPayload(
  item: ShoppingListItem,
  payload: ShoppingListMutationPayload | undefined,
): ShoppingListItem {
  if (!payload) return item;
  return {
    ...item,
    ...(payload.name !== undefined ? { name: payload.name } : {}),
    ...(payload.quantity !== undefined ? { quantity: payload.quantity } : {}),
    ...(payload.unit !== undefined ? { unit: payload.unit } : {}),
    ...(payload.checked !== undefined ? { checked: payload.checked } : {}),
  };
}

/**
 * Field-level merge after `version_conflict`: keep the fields this device
 * edited, and take the server row for everything else (including version).
 */
export function mergeConflictItem(
  server: ShoppingListItem,
  edited: ShoppingListMutationPayload | undefined,
): ShoppingListItem {
  return applyPayload(server, edited);
}

function syntheticItem(op: ShoppingListMutationV1): ShoppingListItem {
  return {
    id: op.itemId,
    name: op.payload?.name ?? '',
    quantity: op.payload?.quantity ?? 1,
    unit: op.payload?.unit ?? 'pcs',
    checked: op.payload?.checked ?? false,
    ...(op.baseVersion !== undefined ? { version: op.baseVersion } : {}),
  };
}

/**
 * Server list, then replay queued ops so optimistic edits stay visible
 * without freezing stale field values the server has already replaced.
 */
export function applyPendingOps(
  serverItems: ShoppingListItem[],
  mutations: ShoppingListMutationV1[],
): ShoppingListItem[] {
  let items = serverItems.map((item) => ({ ...item }));

  for (const op of mutations) {
    if (op.type === 'DELETE') {
      items = items.filter((item) => item.id !== op.itemId);
      continue;
    }

    if (op.type === 'CREATE') {
      const index = items.findIndex((item) => item.id === op.itemId);
      if (index >= 0) {
        items[index] = applyPayload(items[index], op.payload);
      } else {
        items = [applyPayload(syntheticItem(op), op.payload), ...items];
      }
      continue;
    }

    const index = items.findIndex((item) => item.id === op.itemId);
    if (index >= 0) {
      items[index] = applyPayload(items[index], op.payload);
    } else {
      items = [applyPayload(syntheticItem(op), op.payload), ...items];
    }
  }

  return items;
}

/**
 * Drop cached rows the server no longer has, fill missing names, then
 * re-apply anything still queued.
 */
export function reconcileServerList(
  previous: ShoppingListItem[],
  server: ShoppingListItem[],
  pending: ShoppingListMutationV1[],
): ShoppingListItem[] {
  const named = mergeNames(previous, server);
  const serverIds = new Set(server.map((item) => item.id));
  const base = named.filter((item) => serverIds.has(item.id));
  return applyPendingOps(base, pending);
}

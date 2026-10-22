import type { ShoppingListItem } from '../../types';
import type { ShoppingListMutationV1 } from './types';
import { enqueueUpdate } from './queue';

/**
 * Serializes shopping-list local writes so concurrent callers cannot
 * clobber each other's snapshot/queue (e.g. Complete All via Promise.all).
 */
export function createSerialQueue() {
  let chain: Promise<unknown> = Promise.resolve();

  return function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}

export function applyItemUpdate(
  list: ShoppingListItem[],
  item: ShoppingListItem,
): ShoppingListItem[] {
  return list.map((i) => (i.id === item.id ? item : i));
}

export function applyItemRemove(list: ShoppingListItem[], id: string): ShoppingListItem[] {
  return list.filter((i) => i.id !== id);
}

export function applyMarkAllChecked(list: ShoppingListItem[]): {
  next: ShoppingListItem[];
  changed: ShoppingListItem[];
} {
  const changed: ShoppingListItem[] = [];
  const next = list.map((item) => {
    if (item.checked) return item;
    const updated = { ...item, checked: true };
    changed.push(updated);
    return updated;
  });
  return { next, changed };
}

export function enqueueMarkAllUpdates(
  queue: ShoppingListMutationV1[],
  changed: ShoppingListItem[],
): ShoppingListMutationV1[] {
  let nextQueue = queue;
  for (const item of changed) {
    nextQueue = enqueueUpdate(nextQueue, item.id, { checked: true }, item.version);
  }
  return nextQueue;
}

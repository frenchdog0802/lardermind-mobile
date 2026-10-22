import {
  coalesce,
  createLocalItemId,
  createOpId,
  enqueueCreate,
  enqueueDelete,
  enqueueUpdate,
  idempotencyKeyFor,
  remapItemId,
  requeueFailedMutations,
} from '../../services/shoppingListOffline/queue';
import type { ShoppingListMutationV1 } from '../../services/shoppingListOffline/types';

describe('shoppingListOffline queue', () => {
  it('creates local ids with local_ prefix', () => {
    expect(createLocalItemId().startsWith('local_')).toBe(true);
  });

  it('collapses CREATE then DELETE for same id', () => {
    let queue: ShoppingListMutationV1[] = [];
    queue = enqueueCreate(queue, 'local_1', { name: 'Milk', quantity: 1, unit: 'L' });
    queue = enqueueDelete(queue, 'local_1');
    expect(queue).toHaveLength(0);
  });

  it('folds UPDATE into pending CREATE', () => {
    let queue: ShoppingListMutationV1[] = [];
    queue = enqueueCreate(queue, 'local_1', { name: 'Milk', quantity: 1, unit: 'L', checked: false });
    queue = enqueueUpdate(queue, 'local_1', { quantity: 2, checked: true });
    expect(queue).toHaveLength(1);
    expect(queue[0].type).toBe('CREATE');
    expect(queue[0].payload).toMatchObject({
      name: 'Milk',
      quantity: 2,
      unit: 'L',
      checked: true,
    });
  });

  it('keeps last UPDATE for same server id', () => {
    let queue: ShoppingListMutationV1[] = [];
    queue = enqueueUpdate(queue, 'srv-1', { quantity: 1 });
    queue = enqueueUpdate(queue, 'srv-1', { quantity: 3, checked: true });
    expect(queue).toHaveLength(1);
    expect(queue[0].payload).toMatchObject({ quantity: 3, checked: true });
  });

  it('DELETE drops prior UPDATEs for same id', () => {
    let queue: ShoppingListMutationV1[] = [];
    queue = enqueueUpdate(queue, 'srv-1', { checked: true });
    queue = enqueueDelete(queue, 'srv-1');
    expect(queue).toEqual([
      expect.objectContaining({ type: 'DELETE', itemId: 'srv-1' }),
    ]);
  });

  it('keeps the first opId and base version when updates coalesce', () => {
    let queue: ShoppingListMutationV1[] = [];
    queue = enqueueUpdate(queue, 'srv-1', { quantity: 1 }, 3);
    const opId = queue[0].opId;
    queue = enqueueUpdate(queue, 'srv-1', { checked: true }, 9);
    expect(queue).toHaveLength(1);
    expect(queue[0].opId).toBe(opId);
    expect(queue[0].baseVersion).toBe(3);
    expect(queue[0].payload).toMatchObject({ quantity: 1, checked: true });
  });

  it('sends a safe idempotency key and mints a new one when requeueing failures', () => {
    expect(idempotencyKeyFor('op_abc-1')).toBe('op_abc-1');
    expect(idempotencyKeyFor('bad key')).toBe('badkey');
    expect(idempotencyKeyFor('***')).toMatch(/^op_/);

    const failed = [
      {
        opId: 'op_old',
        type: 'CREATE' as const,
        itemId: 'local_1',
        payload: { name: 'Milk' },
        createdAt: 1,
      },
    ];
    const next = requeueFailedMutations(failed);
    expect(next[0].opId).not.toBe('op_old');
    expect(next[0].opId).toBe(idempotencyKeyFor(next[0].opId));
    expect(next[0].payload).toEqual({ name: 'Milk' });
    expect(createOpId()).toMatch(/^op_/);
  });

  it('remapItemId copies the server version onto later ops', () => {
    const queue = remapItemId(
      [
        {
          opId: 'a',
          type: 'UPDATE',
          itemId: 'local_1',
          payload: { checked: true },
          createdAt: 1,
        },
      ],
      'local_1',
      'uuid-9',
      4,
    );
    expect(queue[0]).toMatchObject({ itemId: 'uuid-9', baseVersion: 4 });
  });

  it('remapItemId rewrites queued ids', () => {
    const queue = coalesce([
      {
        opId: 'a',
        type: 'UPDATE',
        itemId: 'local_1',
        payload: { checked: true },
        createdAt: 1,
      },
    ]);
    expect(remapItemId(queue, 'local_1', 'uuid-9')[0].itemId).toBe('uuid-9');
  });
});

import { flushShoppingListQueue, clearBackoff, backoffDelayMs } from '../../services/shoppingListOffline/sync';
import { loadFailed, loadQueue, loadSnapshot, saveFailed, saveQueue, saveSnapshot } from '../../services/shoppingListOffline/store';
import type { ShoppingListItem } from '../../types';
import type { FailedShoppingListMutationV1, ShoppingListMutationV1 } from '../../services/shoppingListOffline/types';

jest.mock('../../services/shoppingListOffline/store', () => ({
  loadQueue: jest.fn(),
  saveQueue: jest.fn(),
  loadSnapshot: jest.fn(),
  saveSnapshot: jest.fn(),
  loadFailed: jest.fn(),
  saveFailed: jest.fn(),
}));

jest.mock('../../services/shoppingListOffline/connectivity', () => ({
  getIsOnline: jest.fn(async () => true),
}));

jest.mock('../../api/shoppingList', () => ({
  shoppingListApi: {
    list: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  parseShoppingListItem: (value: unknown) => {
    if (!value || typeof value !== 'object') return null;
    const record = value as { item?: unknown };
    return (record.item ?? value) as ShoppingListItem;
  },
  parseShoppingListItems: (value: unknown) => (Array.isArray(value) ? value : []),
}));

const USER = 'flush-user';

function milk(overrides: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id: 'milk',
    name: 'Milk',
    quantity: 1,
    unit: 'L',
    checked: false,
    version: 2,
    ...overrides,
  };
}

describe('shopping list flush contract', () => {
  let queue: ShoppingListMutationV1[];
  let failed: FailedShoppingListMutationV1[];
  let snapshot: ShoppingListItem[];

  beforeEach(() => {
    jest.clearAllMocks();
    clearBackoff(USER);
    queue = [];
    failed = [];
    snapshot = [];
    (loadQueue as jest.Mock).mockImplementation(async () => queue.map((op) => ({ ...op })));
    (saveQueue as jest.Mock).mockImplementation(async (_userId: string, next: ShoppingListMutationV1[]) => {
      queue = next;
    });
    (loadFailed as jest.Mock).mockImplementation(async () => failed.map((op) => ({ ...op })));
    (saveFailed as jest.Mock).mockImplementation(async (_userId: string, next: FailedShoppingListMutationV1[]) => {
      failed = next;
    });
    (loadSnapshot as jest.Mock).mockImplementation(async () => snapshot.map((item) => ({ ...item })));
    (saveSnapshot as jest.Mock).mockImplementation(async (_userId: string, next: ShoppingListItem[]) => {
      snapshot = next;
    });
    const { shoppingListApi } = require('../../api/shoppingList');
    shoppingListApi.list.mockResolvedValue({ success: true, data: [] });
    shoppingListApi.create.mockResolvedValue({ success: true, data: { id: 'srv', version: 1 } });
    shoppingListApi.update.mockResolvedValue({ success: true, data: { id: 'milk', version: 2 } });
    shoppingListApi.delete.mockResolvedValue({ success: true, data: null });
  });

  afterEach(() => {
    clearBackoff(USER);
  });

  function api() {
    return require('../../api/shoppingList').shoppingListApi;
  }

  it('adds jitter around the backoff steps', () => {
    expect(backoffDelayMs(0, () => 0)).toBe(1600);
    expect(backoffDelayMs(0, () => 1)).toBe(2400);
    expect(backoffDelayMs(0, () => 0.5)).toBe(2000);
    expect(backoffDelayMs(1, () => 0.5)).toBe(5000);
    expect(backoffDelayMs(8, () => 0.5)).toBe(15000);
  });

  it('retries a create with the same Idempotency-Key after a lost response', async () => {
    queue = [
      {
        opId: 'op_create_1',
        type: 'CREATE',
        itemId: 'local_1',
        payload: { name: 'Milk', quantity: 1, unit: 'L', checked: false },
        createdAt: 1,
      },
    ];
    snapshot = [{ id: 'local_1', name: 'Milk', quantity: 1, unit: 'L', checked: false }];
    const created = {
      id: 'srv-1',
      name: 'Milk',
      quantity: 1,
      unit: 'L',
      checked: false,
      version: 1,
    };
    api().list.mockResolvedValue({ success: true, data: [created] });
    api().create
      .mockResolvedValueOnce({ success: false, message: 'Network error occurred' })
      .mockResolvedValueOnce({
        success: true,
        statusCode: 201,
        data: created,
      });

    const first = await flushShoppingListQueue(USER);
    expect(first.ok).toBe(false);
    expect(queue).toHaveLength(1);
    expect(queue[0].opId).toBe('op_create_1');
    clearBackoff(USER);

    const second = await flushShoppingListQueue(USER);
    expect(second.ok).toBe(true);
    expect(api().create).toHaveBeenCalledTimes(2);
    for (const call of api().create.mock.calls) {
      expect(call[1]).toEqual(
        expect.objectContaining({
          idempotencyKey: 'op_create_1',
          skipUnauthorizedHandler: true,
        }),
      );
      expect(call[1].expectedVersion).toBeUndefined();
    }
    expect(queue).toHaveLength(0);
    expect(snapshot.some((item) => item.id === 'srv-1')).toBe(true);
    expect(snapshot.some((item) => item.id === 'local_1')).toBe(false);
  });

  it('merges a version conflict field-by-field and retries with the server version', async () => {
    queue = [
      {
        opId: 'op_upd',
        type: 'UPDATE',
        itemId: 'milk',
        payload: { checked: true },
        baseVersion: 2,
        createdAt: 1,
      },
    ];
    snapshot = [milk({ checked: true })];
    api().list
      .mockResolvedValueOnce({
        success: true,
        data: [milk({ name: 'Milk', quantity: 1, checked: false, version: 2 })],
      })
      .mockResolvedValue({
        success: true,
        data: [milk({ name: 'Oat milk', quantity: 2, checked: true, version: 6 })],
      });
    api().update
      .mockResolvedValueOnce({
        success: false,
        statusCode: 409,
        code: 'version_conflict',
        message: 'Version conflict',
        data: {
          current: milk({ name: 'Oat milk', quantity: 2, checked: false, version: 5 }),
        },
      })
      .mockResolvedValueOnce({
        success: true,
        statusCode: 200,
        data: milk({ name: 'Oat milk', quantity: 2, checked: true, version: 6 }),
      });

    const result = await flushShoppingListQueue(USER);

    expect(result.ok).toBe(true);
    expect(api().update).toHaveBeenNthCalledWith(
      1,
      'milk',
      { checked: true },
      expect.objectContaining({
        idempotencyKey: 'op_upd',
        expectedVersion: 2,
        skipUnauthorizedHandler: true,
      }),
    );
    const retry = api().update.mock.calls[1];
    expect(retry[1]).toEqual({ checked: true });
    expect(retry[2].expectedVersion).toBe(5);
    expect(retry[2].idempotencyKey).not.toBe('op_upd');
    expect(snapshot[0]).toMatchObject({
      name: 'Oat milk',
      quantity: 2,
      checked: true,
      version: 6,
    });
    expect(failed).toHaveLength(0);
  });

  it('dead-letters a permanent 4xx and still syncs later ops', async () => {
    queue = [
      {
        opId: 'op_bad',
        type: 'UPDATE',
        itemId: 'bad',
        payload: { name: 'Nope' },
        baseVersion: 1,
        createdAt: 1,
      },
      {
        opId: 'op_good',
        type: 'UPDATE',
        itemId: 'good',
        payload: { checked: true },
        baseVersion: 1,
        createdAt: 2,
      },
    ];
    api().list.mockResolvedValue({
      success: true,
      data: [
        { id: 'bad', name: 'Nope', quantity: 1, unit: 'pcs', checked: false, version: 1 },
        { id: 'good', name: 'Bread', quantity: 1, unit: 'pcs', checked: false, version: 1 },
      ],
    });
    api().update.mockImplementation(async (id: string) => {
      if (id === 'bad') {
        return {
          success: false,
          statusCode: 400,
          code: 'validation_error',
          message: 'Invalid name',
        };
      }
      return {
        success: true,
        statusCode: 200,
        data: { id: 'good', name: 'Bread', quantity: 1, unit: 'pcs', checked: true, version: 2 },
      };
    });

    const result = await flushShoppingListQueue(USER);

    expect(result.ok).toBe(true);
    expect(result.failedCount).toBe(1);
    expect(result.remaining).toBe(0);
    expect(queue).toHaveLength(0);
    expect(failed.map((op) => op.opId)).toEqual(['op_bad']);
    expect(failed[0].code).toBe('validation_error');
    expect(api().update.mock.calls.map((call: unknown[]) => call[0])).toEqual(['bad', 'good']);
  });

  it('retries the same op after 401 once auth recovers', async () => {
    queue = [
      {
        opId: 'op_auth',
        type: 'UPDATE',
        itemId: 'milk',
        payload: { checked: true },
        baseVersion: 2,
        createdAt: 1,
      },
    ];
    api().update
      .mockResolvedValueOnce({
        success: false,
        statusCode: 401,
        code: 'unauthorized',
        message: 'Unauthorized',
      })
      .mockResolvedValueOnce({
        success: true,
        data: milk({ checked: true, version: 3 }),
      });
    const recoverAuth = jest.fn(async () => true);
    const onAuthFailure = jest.fn();

    const result = await flushShoppingListQueue(USER, { recoverAuth, onAuthFailure });

    expect(result.ok).toBe(true);
    expect(recoverAuth).toHaveBeenCalledTimes(1);
    expect(onAuthFailure).not.toHaveBeenCalled();
    expect(api().update).toHaveBeenCalledTimes(2);
    expect(api().update.mock.calls[0][2].idempotencyKey).toBe('op_auth');
    expect(api().update.mock.calls[1][2].idempotencyKey).toBe('op_auth');
    expect(failed).toHaveLength(0);
    expect(queue).toHaveLength(0);
  });

  it('keeps the op queued when 401 cannot be recovered', async () => {
    queue = [
      {
        opId: 'op_auth',
        type: 'DELETE',
        itemId: 'milk',
        baseVersion: 2,
        createdAt: 1,
      },
      {
        opId: 'op_next',
        type: 'UPDATE',
        itemId: 'bread',
        payload: { checked: true },
        baseVersion: 1,
        createdAt: 2,
      },
    ];
    api().delete.mockResolvedValue({
      success: false,
      statusCode: 401,
      code: 'unauthorized',
      message: 'Unauthorized',
    });
    const onAuthFailure = jest.fn();

    const result = await flushShoppingListQueue(USER, {
      recoverAuth: async () => false,
      onAuthFailure,
    });

    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/sign in/i);
    expect(onAuthFailure).toHaveBeenCalledTimes(1);
    expect(queue.map((op) => op.opId)).toEqual(['op_auth', 'op_next']);
    expect(api().update).not.toHaveBeenCalled();
    expect(failed).toHaveLength(0);
    expect(api().delete.mock.calls[0][1]).toEqual(
      expect.objectContaining({ idempotencyKey: 'op_auth', expectedVersion: 2 }),
    );
  });
});

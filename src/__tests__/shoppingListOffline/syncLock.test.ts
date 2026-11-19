import { flushShoppingListQueue, clearBackoff } from '../../services/shoppingListOffline/sync';
import { loadQueue, saveQueue } from '../../services/shoppingListOffline/store';

jest.mock('../../services/shoppingListOffline/store', () => ({
  loadQueue: jest.fn(),
  saveQueue: jest.fn(),
  loadSnapshot: jest.fn(async () => []),
  saveSnapshot: jest.fn(),
  loadFailed: jest.fn(async () => []),
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
  parseShoppingListItem: (x: unknown) => x,
  parseShoppingListItems: (x: unknown) => (Array.isArray(x) ? x : []),
}));

describe('flushShoppingListQueue lock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    clearBackoff('u1');
  });

  it('returns ok:false when a flush is already in progress', async () => {
    (loadQueue as jest.Mock).mockResolvedValue([
      {
        opId: 'op1',
        type: 'UPDATE',
        itemId: '1',
        payload: { checked: true },
        createdAt: 1,
      },
    ]);

    // Hold the first flush open by making create hang until we release.
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const { shoppingListApi } = require('../../api/shoppingList');
    shoppingListApi.update.mockImplementation(async () => {
      await gate;
      return { success: true, data: { id: '1' } };
    });
    shoppingListApi.list.mockResolvedValue({ success: true, data: [] });

    const first = flushShoppingListQueue('u1');
    // Give the first call time to acquire the lock
    await Promise.resolve();
    await Promise.resolve();

    const second = await flushShoppingListQueue('u1');
    expect(second.ok).toBe(false);
    expect(second.error).toBe('Sync in progress');

    release();
    await first;
  });
});

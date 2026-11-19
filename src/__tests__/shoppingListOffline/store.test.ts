import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  clearUserOfflineData,
  loadFailed,
  loadQueue,
  loadSnapshot,
  saveFailed,
  saveQueue,
  saveSnapshot,
} from '../../services/shoppingListOffline/store';
import type { ShoppingListItem } from '../../types';

describe('shoppingListOffline store', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  it('round-trips snapshot and queue', async () => {
    const items: ShoppingListItem[] = [
      { id: '1', name: 'Milk', quantity: 1, unit: 'L', checked: false },
    ];
    await saveSnapshot('user-a', items);
    await saveQueue('user-a', [
      {
        opId: 'op1',
        type: 'UPDATE',
        itemId: '1',
        payload: { checked: true },
        createdAt: 1,
      },
    ]);

    expect(await loadSnapshot('user-a')).toEqual(items);
    expect(await loadQueue('user-a')).toHaveLength(1);
  });

  it('round-trips failed ops and clears them with the user', async () => {
    await saveFailed('user-a', [
      {
        opId: 'op1',
        type: 'UPDATE',
        itemId: '1',
        payload: { checked: true },
        baseVersion: 2,
        createdAt: 1,
        failedAt: 2,
        statusCode: 400,
        code: 'validation_error',
        message: 'Invalid',
      },
    ]);
    expect(await loadFailed('user-a')).toHaveLength(1);
    await clearUserOfflineData('user-a');
    expect(await loadFailed('user-a')).toEqual([]);
  });

  it('clearUserOfflineData removes keys', async () => {
    await saveSnapshot('user-a', [
      { id: '1', name: 'Milk', quantity: 1, unit: 'L', checked: false },
    ]);
    await saveQueue('user-a', []);
    await clearUserOfflineData('user-a');
    expect(await loadSnapshot('user-a')).toEqual([]);
    expect(await loadQueue('user-a')).toEqual([]);
  });

  it('isolates users', async () => {
    await saveSnapshot('user-a', [
      { id: '1', name: 'A', quantity: 1, unit: '', checked: false },
    ]);
    await saveSnapshot('user-b', [
      { id: '2', name: 'B', quantity: 1, unit: '', checked: false },
    ]);
    expect((await loadSnapshot('user-a'))[0].name).toBe('A');
    expect((await loadSnapshot('user-b'))[0].name).toBe('B');
  });
});

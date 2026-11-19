import React from 'react';
import { renderHook, act, waitFor } from '@testing-library/react-native';
import { PantryProvider, usePantry } from '../../contexts/pantryContext';
import { loadSnapshot, saveSnapshot, loadQueue, saveQueue } from '../../services/shoppingListOffline/store';

jest.mock('../../contexts/authContext', () => ({
  useAuth: () => ({ user: { id: 'u1' } }),
}));

jest.mock('../../services/shoppingListOffline/store', () => ({
  loadSnapshot: jest.fn(),
  saveSnapshot: jest.fn(),
  loadQueue: jest.fn(),
  saveQueue: jest.fn(),
  // Dead-letter list added by the hardened sync contract (PR #1).
  loadFailed: jest.fn(async () => []),
  saveFailed: jest.fn(async () => undefined),
  clearUserOfflineData: jest.fn(),
}));

jest.mock('../../services/shoppingListOffline/connectivity', () => ({
  getIsOnline: jest.fn(async () => false),
  subscribeConnectivity: jest.fn(() => () => undefined),
  isStateOnline: jest.fn(() => false),
}));

jest.mock('../../api/ingredient', () => ({
  ingredientApi: { list: jest.fn(async () => ({ success: true, data: [] })) },
}));
jest.mock('../../api/userPreferences', () => ({
  userPreferencesApi: { get: jest.fn(async () => null) },
}));

const item = (id: string, checked = false) => ({ id, name: id, quantity: 1, unit: 'pcs', checked });

describe('PantryProvider optimistic shopping writes', () => {
  it('updates state before AsyncStorage persistence completes, and keeps queue ordering', async () => {
    let snapshot = [item('a'), item('b')];
    let queue: unknown[] = [];
    let releaseQueueLoad!: () => void;
    const gate = new Promise<void>((r) => {
      releaseQueueLoad = r;
    });
    let firstQueueLoad = true;
    (loadSnapshot as jest.Mock).mockImplementation(async () => [...snapshot]);
    (saveSnapshot as jest.Mock).mockImplementation(async (_u: string, next: typeof snapshot) => {
      snapshot = next;
    });
    (loadQueue as jest.Mock).mockImplementation(async () => {
      // The initial mount load resolves immediately; write-path loads wait on the gate.
      if (firstQueueLoad) {
        firstQueueLoad = false;
        return [];
      }
      await gate;
      return [...queue];
    });
    (saveQueue as jest.Mock).mockImplementation(async (_u: string, q: unknown[]) => {
      queue = q;
    });

    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <PantryProvider>{children}</PantryProvider>
    );
    const { result } = renderHook(() => usePantry(), { wrapper });
    await waitFor(() => expect(result.current.shoppingList).toHaveLength(2));

    let p1!: Promise<unknown>;
    let p2!: Promise<unknown>;
    act(() => {
      p1 = result.current.updateShoppingListItem({ ...item('a'), checked: true });
      p2 = result.current.updateShoppingListItem({ ...item('b'), checked: true });
    });

    // Storage is still blocked, but the UI already reflects both toggles.
    expect(result.current.shoppingList.map((i) => i.checked)).toEqual([true, true]);
    expect(saveQueue).not.toHaveBeenCalled();

    await act(async () => {
      releaseQueueLoad();
      await Promise.all([p1, p2]);
    });

    expect((queue as Array<{ itemId: string }>).map((m) => m.itemId)).toEqual(['a', 'b']);
    // Snapshot is written once, by the last pending job, with the latest list.
    expect(saveSnapshot).toHaveBeenCalledTimes(1);
    expect(snapshot.map((i) => i.checked)).toEqual([true, true]);
  });
});

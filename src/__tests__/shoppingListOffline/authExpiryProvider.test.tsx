/**
 * Integration of PR #1's shopping-sync 401 recovery with our session-expiry rule:
 * 1. a 401 during flush first re-reads the stored JWT and retries once (recoverAuth);
 * 2. if that cannot recover, the session is expired through the global unauthorized
 *    handler (JWT + user only) — NOT logout() — and the offline queue is kept.
 */
import React from 'react';
import { renderHook, waitFor } from '@testing-library/react-native';
import { PantryProvider, usePantry } from '../../contexts/pantryContext';
import { setUnauthorizedHandler } from '../../api/client';
import { authHelper } from '../../api/auth-helper';
import { shoppingListApi } from '../../api/shoppingList';
import {
  clearUserOfflineData,
  loadQueue,
  loadSnapshot,
  saveQueue,
} from '../../services/shoppingListOffline/store';
import { clearBackoff } from '../../services/shoppingListOffline/sync';
import type { ShoppingListMutationV1 } from '../../services/shoppingListOffline/types';

const mockLogout = jest.fn();
jest.mock('../../contexts/authContext', () => ({
  useAuth: () => ({ user: { id: 'u1' }, logout: mockLogout }),
}));

jest.mock('../../api/auth-helper', () => ({
  authHelper: { getJWT: jest.fn(), clearJWT: jest.fn() },
  isJwtExpired: jest.fn(() => false),
}));

jest.mock('../../services/shoppingListOffline/store', () => ({
  loadSnapshot: jest.fn(),
  saveSnapshot: jest.fn(async () => undefined),
  loadQueue: jest.fn(),
  saveQueue: jest.fn(),
  loadFailed: jest.fn(async () => []),
  saveFailed: jest.fn(async () => undefined),
  clearUserOfflineData: jest.fn(),
}));

jest.mock('../../services/shoppingListOffline/connectivity', () => ({
  getIsOnline: jest.fn(async () => true),
  // Report "online" right away so the provider flushes the stored queue.
  subscribeConnectivity: jest.fn((cb: (online: boolean) => void) => {
    setTimeout(() => cb(true), 0);
    return () => undefined;
  }),
  isStateOnline: jest.fn(() => true),
}));

jest.mock('../../api/shoppingList', () => {
  const actual = jest.requireActual('../../api/shoppingList');
  return {
    ...actual,
    shoppingListApi: {
      ...actual.shoppingListApi,
      list: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };
});
jest.mock('../../api/ingredient', () => ({
  ingredientApi: { list: jest.fn(async () => ({ success: true, data: [] })) },
}));
jest.mock('../../api/userPreferences', () => ({
  userPreferencesApi: { get: jest.fn(async () => null) },
}));

const op: ShoppingListMutationV1 = {
  opId: 'op_keep_me',
  type: 'UPDATE',
  itemId: 'milk',
  payload: { checked: true },
  createdAt: 1,
  baseVersion: 3,
};

describe('PantryProvider shopping sync on 401', () => {
  let queue: ShoppingListMutationV1[];
  const onUnauthorized = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    clearBackoff('u1');
    queue = [op];
    setUnauthorizedHandler(onUnauthorized);
    (loadSnapshot as jest.Mock).mockResolvedValue([
      { id: 'milk', name: 'Milk', quantity: 1, unit: 'L', checked: true, version: 3 },
    ]);
    (loadQueue as jest.Mock).mockImplementation(async () => queue.map((m) => ({ ...m })));
    (saveQueue as jest.Mock).mockImplementation(async (_u: string, next: ShoppingListMutationV1[]) => {
      queue = next;
    });
    (shoppingListApi.list as jest.Mock).mockResolvedValue({ success: true, data: [] });
  });

  afterEach(() => {
    setUnauthorizedHandler(null);
    clearBackoff('u1');
  });

  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <PantryProvider>{children}</PantryProvider>
  );

  it('expires the session (not logout) and keeps the queue when the token is gone', async () => {
    (authHelper.getJWT as jest.Mock).mockResolvedValue(null);
    (shoppingListApi.update as jest.Mock).mockResolvedValue({
      success: false,
      statusCode: 401,
      code: 'unauthorized',
    });

    renderHook(() => usePantry(), { wrapper });

    await waitFor(() => expect(onUnauthorized).toHaveBeenCalledTimes(1));
    expect(shoppingListApi.update).toHaveBeenCalledTimes(1);
    // Sync requests skip the global handler; only the explicit onAuthFailure fires it.
    expect((shoppingListApi.update as jest.Mock).mock.calls[0][2]).toEqual(
      expect.objectContaining({ skipUnauthorizedHandler: true, idempotencyKey: 'op_keep_me' }),
    );
    expect(mockLogout).not.toHaveBeenCalled();
    expect(clearUserOfflineData).not.toHaveBeenCalled();
    expect(queue.map((m) => m.opId)).toEqual(['op_keep_me']);
  });

  it('retries the same op once when the stored token is still valid', async () => {
    (authHelper.getJWT as jest.Mock).mockResolvedValue('still-valid');
    (shoppingListApi.update as jest.Mock)
      .mockResolvedValueOnce({ success: false, statusCode: 401, code: 'unauthorized' })
      .mockResolvedValueOnce({
        success: true,
        data: { id: 'milk', name: 'Milk', quantity: 1, unit: 'L', checked: true, version: 4 },
      });

    renderHook(() => usePantry(), { wrapper });

    await waitFor(() => expect(queue).toEqual([]));
    expect(shoppingListApi.update).toHaveBeenCalledTimes(2);
    const keys = (shoppingListApi.update as jest.Mock).mock.calls.map((c) => c[2]?.idempotencyKey);
    expect(keys).toEqual(['op_keep_me', 'op_keep_me']);
    expect(onUnauthorized).not.toHaveBeenCalled();
    expect(mockLogout).not.toHaveBeenCalled();
  });
});

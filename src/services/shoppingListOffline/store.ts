import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ShoppingListItem } from '../../types';
import {
  SHOPPING_LIST_OFFLINE_VERSION,
  failedKey,
  queueKey,
  snapshotKey,
  type FailedShoppingListMutationV1,
  type ShoppingListMutationV1,
  type ShoppingListQueueV1,
  type ShoppingListSnapshotV1,
} from './types';

export async function loadSnapshot(userId: string): Promise<ShoppingListItem[]> {
  if (!userId) return [];
  try {
    const raw = await AsyncStorage.getItem(snapshotKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ShoppingListSnapshotV1;
    if (!parsed || parsed.version !== SHOPPING_LIST_OFFLINE_VERSION || !Array.isArray(parsed.items)) {
      return [];
    }
    return parsed.items;
  } catch {
    return [];
  }
}

export async function saveSnapshot(userId: string, items: ShoppingListItem[]): Promise<void> {
  if (!userId) return;
  const snapshot: ShoppingListSnapshotV1 = {
    version: SHOPPING_LIST_OFFLINE_VERSION,
    updatedAt: Date.now(),
    items,
  };
  await AsyncStorage.setItem(snapshotKey(userId), JSON.stringify(snapshot));
}

export async function loadQueue(userId: string): Promise<ShoppingListMutationV1[]> {
  if (!userId) return [];
  try {
    const raw = await AsyncStorage.getItem(queueKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as ShoppingListQueueV1;
    if (!parsed || parsed.version !== SHOPPING_LIST_OFFLINE_VERSION || !Array.isArray(parsed.mutations)) {
      return [];
    }
    return parsed.mutations;
  } catch {
    return [];
  }
}

export async function saveQueue(userId: string, mutations: ShoppingListMutationV1[]): Promise<void> {
  if (!userId) return;
  const queue: ShoppingListQueueV1 = {
    version: SHOPPING_LIST_OFFLINE_VERSION,
    mutations,
  };
  await AsyncStorage.setItem(queueKey(userId), JSON.stringify(queue));
}

export async function loadFailed(userId: string): Promise<FailedShoppingListMutationV1[]> {
  if (!userId) return [];
  try {
    const raw = await AsyncStorage.getItem(failedKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { version?: number; mutations?: FailedShoppingListMutationV1[] };
    if (!parsed || parsed.version !== SHOPPING_LIST_OFFLINE_VERSION || !Array.isArray(parsed.mutations)) {
      return [];
    }
    return parsed.mutations;
  } catch {
    return [];
  }
}

export async function saveFailed(
  userId: string,
  mutations: FailedShoppingListMutationV1[],
): Promise<void> {
  if (!userId) return;
  await AsyncStorage.setItem(
    failedKey(userId),
    JSON.stringify({
      version: SHOPPING_LIST_OFFLINE_VERSION,
      mutations,
    }),
  );
}

export async function clearUserOfflineData(userId: string): Promise<void> {
  if (!userId) return;
  await AsyncStorage.multiRemove([snapshotKey(userId), queueKey(userId), failedKey(userId)]);
}

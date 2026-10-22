import { mergeConflictItem, payloadFromEdit } from '../../services/shoppingListOffline/project';
import type { ShoppingListItem } from '../../types';

const server: ShoppingListItem = {
  id: 'milk',
  name: 'Oat milk',
  quantity: 2,
  unit: 'L',
  checked: false,
  version: 5,
};

describe('shopping list version merge', () => {
  it('records only the fields the user changed', () => {
    const before: ShoppingListItem = {
      id: 'milk',
      name: 'Milk',
      quantity: 1,
      unit: 'L',
      checked: false,
      version: 2,
    };
    expect(payloadFromEdit(before, { ...before, checked: true })).toEqual({ checked: true });
    expect(payloadFromEdit(undefined, before)).toMatchObject({
      name: 'Milk',
      quantity: 1,
      unit: 'L',
      checked: false,
    });
  });

  it('keeps local edits and takes the server value for other fields', () => {
    expect(mergeConflictItem(server, { checked: true })).toEqual({
      ...server,
      checked: true,
      version: 5,
    });
  });
});

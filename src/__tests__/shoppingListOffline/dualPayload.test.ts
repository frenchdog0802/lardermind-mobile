import { toRequestPayload } from '../../api/shoppingList';

describe('toRequestPayload dual backend shape', () => {
  it('includes flat fields and nested details', () => {
    expect(
      toRequestPayload({
        name: 'Milk',
        quantity: 2,
        unit: 'L',
        checked: true,
      }),
    ).toEqual({
      name: 'Milk',
      quantity: 2,
      unit: 'L',
      checked: true,
      details: {
        quantity: 2,
        unit: 'L',
        checked: true,
      },
    });
  });

  it('adds the expected version to both shapes and omits untouched fields', () => {
    expect(toRequestPayload({ checked: true }, 4)).toEqual({
      checked: true,
      version: 4,
      details: {
        checked: true,
        version: 4,
      },
    });
  });
});

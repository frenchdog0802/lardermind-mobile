import { shoppingListApi } from '../../api/shoppingList';

describe('shopping list idempotency headers', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function mockFetch() {
    const calls: { url: string; init?: RequestInit }[] = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return {
        status: 200,
        text: async () => JSON.stringify({ success: true, data: { id: '1', version: 2 } }),
      } as Response;
    });
    return calls;
  }

  it('sends Idempotency-Key on create', async () => {
    const calls = mockFetch();
    await shoppingListApi.create(
      { name: 'Milk', quantity: 1, unit: 'L', checked: false },
      { idempotencyKey: 'op_create_1', skipUnauthorizedHandler: true },
    );
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get('Idempotency-Key')).toBe('op_create_1');
    expect(String(calls[0].init?.body)).not.toContain('"version"');
  });

  it('sends Idempotency-Key and expected version on update', async () => {
    const calls = mockFetch();
    await shoppingListApi.update(
      'abc',
      { checked: true },
      { idempotencyKey: 'op_abc', expectedVersion: 3, skipUnauthorizedHandler: true },
    );
    expect(calls[0].url).toContain('shopping-list/abc');
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get('Idempotency-Key')).toBe('op_abc');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      checked: true,
      version: 3,
      details: { checked: true, version: 3 },
    });
  });

  it('sends Idempotency-Key and version query on delete', async () => {
    const calls = mockFetch();
    await shoppingListApi.delete('abc', {
      idempotencyKey: 'op_del',
      expectedVersion: 4,
      skipUnauthorizedHandler: true,
    });
    expect(calls[0].url).toContain('shopping-list/abc?version=4');
    expect(calls[0].init?.method).toBe('DELETE');
    const headers = new Headers(calls[0].init?.headers);
    expect(headers.get('Idempotency-Key')).toBe('op_del');
  });
});

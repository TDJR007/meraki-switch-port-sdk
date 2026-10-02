import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MerakiApiError,
  MerakiClient,
  MerakiNetworkError,
  MerakiPaginationError,
} from '../src/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function clientWithFetch(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>, options: { maxRetries?: number } = {}) {
  return new MerakiClient({
    apiKey: 'test-api-key',
    baseUrl: 'https://meraki.test/api/v1',
    fetch: fetchMock,
    retryDelayMs: 0,
    maxRetryDelayMs: 0,
    ...options,
  });
}

describe('MerakiClient', () => {
  it('sends the API key and serializes array query values with Meraki bracket notation', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify([{ id: 'N_1', name: 'Office' }]), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = clientWithFetch(fetchMock);

    const networks = await client.getOrganizationNetworks('org/1', {
      productTypes: ['switch', 'wireless'],
    });

    expect(networks).toEqual([{ id: 'N_1', name: 'Office' }]);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0]!;
    const url = new URL(String(requestUrl));
    expect(url.pathname).toBe('/api/v1/organizations/org%2F1/networks');
    expect(url.searchParams.getAll('productTypes[]')).toEqual(['switch', 'wireless']);
    expect(url.searchParams.get('perPage')).toBe('1000');
    expect(new Headers(requestInit?.headers).get('X-Cisco-Meraki-API-Key')).toBe('test-api-key');
  });

  it('follows same-origin Link pagination and combines collection results', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'N_1', name: 'A' }]), {
        headers: {
          'Content-Type': 'application/json',
          Link: '<https://meraki.test/api/v1/organizations/org/networks?perPage=1000&startingAfter=next>; rel="next"',
        },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'N_2', name: 'B' }]), {
        headers: { 'Content-Type': 'application/json' },
      }));
    const client = clientWithFetch(fetchMock);

    await expect(client.getOrganizationNetworks('org')).resolves.toEqual([
      { id: 'N_1', name: 'A' },
      { id: 'N_2', name: 'B' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('rejects pagination links that leave the configured API origin', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('[]', {
        headers: { Link: '<https://attacker.test/steal>; rel="next"' },
      }),
    );
    const client = clientWithFetch(fetchMock);

    await expect(client.getOrganizationNetworks('org')).rejects.toBeInstanceOf(MerakiPaginationError);
  });

  it('sends switch-port updates as JSON using the documented PUT endpoint', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ portId: '7', enabled: true, vlan: 120 }), {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const client = clientWithFetch(fetchMock);

    await expect(client.updateSwitchPort('Q2XX-ABCD-1234', '7', {
      enabled: true,
      type: 'access',
      vlan: 120,
    })).resolves.toMatchObject({ portId: '7', vlan: 120 });

    const [requestUrl, requestInit] = fetchMock.mock.calls[0]!;
    expect(String(requestUrl)).toBe('https://meraki.test/api/v1/devices/Q2XX-ABCD-1234/switch/ports/7');
    expect(requestInit?.method).toBe('PUT');
    expect(new Headers(requestInit?.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(requestInit?.body))).toEqual({ enabled: true, type: 'access', vlan: 120 });
  });

  it('retries rate-limited requests and honors Retry-After', async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, {
        status: 429,
        headers: { 'Retry-After': '0' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ id: 'N_1', name: 'Office' }])));
    const client = clientWithFetch(fetchMock, { maxRetries: 1 });

    await expect(client.getOrganizationNetworks('org')).resolves.toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a typed error with the Meraki status and request ID', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ errors: ['Insufficient privileges'] }), {
        status: 403,
        statusText: 'Forbidden',
        headers: { 'X-Cisco-Meraki-API-Request-ID': 'request-123' },
      }),
    );
    const client = clientWithFetch(fetchMock);

    await expect(client.getOrganizationNetworks('org')).rejects.toMatchObject<Partial<MerakiApiError>>({
      name: 'MerakiApiError',
      status: 403,
      message: 'Insufficient privileges',
      requestId: 'request-123',
    });
  });

  it('does not retry non-idempotent requests', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ errors: ['Temporary failure'] }), { status: 503 }),
    );
    const client = clientWithFetch(fetchMock, { maxRetries: 3 });

    await expect(client.request('/some/action', {
      method: 'POST',
      body: { action: 'run' },
    })).rejects.toBeInstanceOf(MerakiApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

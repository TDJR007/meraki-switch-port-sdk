import { MerakiApiError, MerakiNetworkError, MerakiPaginationError } from './errors.js';
import type {
  DeviceAvailabilitiesQuery,
  MerakiDevice,
  MerakiDeviceAvailability,
  MerakiNetwork,
  OrganizationDevicesQuery,
  OrganizationNetworksQuery,
  Query,
  SwitchPort,
  SwitchPortProfile,
  SwitchPortProfilesQuery,
  SwitchPortStatus,
  SwitchPortStatusesQuery,
  UpdateSwitchPortRequest,
} from './types.js';

const DEFAULT_BASE_URL = 'https://api.meraki.com/api/v1';
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 500;
const DEFAULT_MAX_RETRY_DELAY_MS = 10_000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

export interface MerakiClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  maxRetries?: number;
  retryDelayMs?: number;
  maxRetryDelayMs?: number;
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  query?: Query;
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

interface RequestResult<T> {
  data: T;
  linkHeader: string | null;
}

export class MerakiClient {
  private readonly apiKey: string;
  private readonly baseUrl: URL;
  private readonly fetchImpl: typeof fetch;
  private readonly maxRetries: number;
  private readonly retryDelayMs: number;
  private readonly maxRetryDelayMs: number;

  constructor(options: MerakiClientOptions) {
    if (!options.apiKey.trim()) {
      throw new TypeError('Meraki API key must not be empty');
    }

    this.apiKey = options.apiKey;
    this.baseUrl = new URL(options.baseUrl ?? DEFAULT_BASE_URL);
    this.baseUrl.pathname = this.baseUrl.pathname.replace(/\/+$/, '');
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;

    if (!this.fetchImpl) {
      throw new TypeError('A fetch implementation is required');
    }
    if (!Number.isInteger(this.maxRetries) || this.maxRetries < 0) {
      throw new RangeError('maxRetries must be a non-negative integer');
    }
    if (this.retryDelayMs < 0 || this.maxRetryDelayMs < 0) {
      throw new RangeError('Retry delays must be non-negative');
    }
  }

  getOrganizationNetworks(
    organizationId: string,
    query: OrganizationNetworksQuery = {},
  ): Promise<MerakiNetwork[]> {
    return this.getAllPages(`/organizations/${segment(organizationId)}/networks`, query);
  }

  getOrganizationDevices(
    organizationId: string,
    query: OrganizationDevicesQuery = {},
  ): Promise<MerakiDevice[]> {
    return this.getAllPages(`/organizations/${segment(organizationId)}/devices`, query);
  }

  getOrganizationDeviceAvailabilities(
    organizationId: string,
    query: DeviceAvailabilitiesQuery = {},
  ): Promise<MerakiDeviceAvailability[]> {
    return this.getAllPages(
      `/organizations/${segment(organizationId)}/devices/availabilities`,
      query,
    );
  }

  getSwitchPorts(serial: string): Promise<SwitchPort[]> {
    return this.request(`/devices/${segment(serial)}/switch/ports`);
  }

  getSwitchPort(serial: string, portId: string): Promise<SwitchPort> {
    return this.request(`/devices/${segment(serial)}/switch/ports/${segment(portId)}`);
  }

  getSwitchPortStatuses(
    serial: string,
    query: SwitchPortStatusesQuery = {},
  ): Promise<SwitchPortStatus[]> {
    return this.request(`/devices/${segment(serial)}/switch/ports/statuses`, { query });
  }

  updateSwitchPort(
    serial: string,
    portId: string,
    update: UpdateSwitchPortRequest,
  ): Promise<SwitchPort> {
    return this.request(`/devices/${segment(serial)}/switch/ports/${segment(portId)}`, {
      method: 'PUT',
      body: update,
    });
  }

  getOrganizationSwitchPortProfiles(
    organizationId: string,
    query: SwitchPortProfilesQuery = {},
  ): Promise<SwitchPortProfile[]> {
    return this.getAllPages(
      `/organizations/${segment(organizationId)}/switch/ports/profiles`,
      query,
    );
  }

  async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    if (/^[a-z][a-z\d+.-]*:/i.test(path)) {
      throw new TypeError('request path must be relative to the configured Meraki API base URL');
    }

    const url = new URL(path.replace(/^\/+/, ''), ensureDirectoryUrl(this.baseUrl));
    appendQuery(url, options.query);
    const result = await this.performRequest<T>(url, options);
    return result.data;
  }

  private async getAllPages<T>(path: string, query: Query = {}): Promise<T[]> {
    const url = new URL(path.replace(/^\/+/, ''), ensureDirectoryUrl(this.baseUrl));
    appendQuery(url, query);
    if (!url.searchParams.has('perPage')) {
      url.searchParams.set('perPage', '1000');
    }

    const results: T[] = [];
    const visited = new Set<string>();
    let currentUrl: URL | null = url;

    while (currentUrl) {
      if (currentUrl.origin !== this.baseUrl.origin) {
        throw new MerakiPaginationError('Meraki pagination link changed API origin');
      }
      if (visited.has(currentUrl.href)) {
        throw new MerakiPaginationError('Meraki pagination returned a repeated page link');
      }
      visited.add(currentUrl.href);

      const { data: page, linkHeader } = await this.performRequest<T[]>(currentUrl);
      if (!Array.isArray(page)) {
        throw new MerakiPaginationError('Expected Meraki collection endpoint to return an array');
      }
      results.push(...page);
      currentUrl = nextPageUrl(currentUrl, linkHeader);
    }

    return results;
  }

  private async performRequest<T>(url: URL, options: RequestOptions = {}): Promise<RequestResult<T>> {
    return this.performRequestWithRetries<T>(url, options);
  }

  private async performRequestWithRetries<T>(
    url: URL,
    options: RequestOptions,
  ): Promise<RequestResult<T>> {
    let lastError: unknown;
    const method = options.method ?? 'GET';

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let response: Response;
      try {
        const headers = new Headers(options.headers);
        headers.set('Accept', headers.get('Accept') ?? 'application/json');
        headers.set('X-Cisco-Meraki-API-Key', this.apiKey);
        if (options.body !== undefined && !headers.has('Content-Type')) {
          headers.set('Content-Type', 'application/json');
        }
        response = await this.fetchImpl(url, {
          method,
          headers,
          ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
          ...(options.signal === undefined ? {} : { signal: options.signal }),
        });
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }
        lastError = error;
        if (!isRetryableMethod(method) || attempt >= this.maxRetries) {
          throw new MerakiNetworkError('Request to the Meraki Dashboard API failed', { cause: error });
        }
        await delay(this.backoffDelay(attempt), options.signal);
        continue;
      }

      if (
        RETRYABLE_STATUSES.has(response.status) &&
        isRetryableMethod(method) &&
        attempt < this.maxRetries
      ) {
        const retryAfter = retryAfterMs(response.headers.get('Retry-After'));
        await response.body?.cancel();
        await delay(this.backoffDelay(attempt, retryAfter), options.signal);
        continue;
      }

      if (!response.ok) {
        const text = await response.text();
        const body = parseBody(text);
        throw new MerakiApiError(
          response.status,
          apiErrorMessage(response.status, response.statusText, body),
          body,
          response.headers.get('X-Cisco-Meraki-API-Request-ID'),
        );
      }

      const text = await response.text();
      if (!text) {
        return { data: undefined as T, linkHeader: response.headers.get('Link') };
      }

      try {
        return {
          data: JSON.parse(text) as T,
          linkHeader: response.headers.get('Link'),
        };
      } catch (error) {
        if (error instanceof SyntaxError) {
          throw new MerakiNetworkError('Meraki Dashboard API returned invalid JSON', { cause: error });
        }
        throw error;
      }
    }

    throw new MerakiNetworkError('Request to the Meraki Dashboard API failed', { cause: lastError });
  }

  private backoffDelay(attempt: number, serverDelay?: number): number {
    const delayMs = serverDelay ?? this.retryDelayMs * 2 ** attempt;
    return Math.min(delayMs, this.maxRetryDelayMs);
  }
}

function segment(value: string): string {
  return encodeURIComponent(value);
}

function ensureDirectoryUrl(url: URL): URL {
  const directoryUrl = new URL(url.href);
  if (!directoryUrl.pathname.endsWith('/')) {
    directoryUrl.pathname += '/';
  }
  return directoryUrl;
}

function appendQuery(url: URL, query?: Query): void {
  if (!query) return;
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    const isArray = Array.isArray(value);
    const parameterName = isArray && !key.endsWith('[]') ? `${key}[]` : key;
    url.searchParams.delete(key);
    url.searchParams.delete(parameterName);
    for (const item of isArray ? value : [value]) {
      url.searchParams.append(parameterName, String(item));
    }
  }
}

function nextPageUrl(currentUrl: URL, linkHeader: string | null): URL | null {
  if (!linkHeader) return null;
  for (const link of linkHeader.split(',')) {
    const match = link.match(/<([^>]+)>\s*;\s*rel\s*=\s*"?([^";\s]+)"?/i);
    if (match?.[2] === 'next' && match[1]) {
      return new URL(match[1], currentUrl);
    }
  }
  return null;
}

function retryAfterMs(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1000;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : Math.max(0, timestamp - Date.now());
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? new DOMException('The operation was aborted', 'AbortError'));
  }
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', abort);
      resolve();
    }, milliseconds);
    const abort = () => {
      clearTimeout(timeout);
      reject(signal?.reason ?? new DOMException('The operation was aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function isRetryableMethod(method: NonNullable<RequestOptions['method']>): boolean {
  return method === 'GET' || method === 'PUT' || method === 'DELETE';
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function apiErrorMessage(status: number, statusText: string, body: unknown): string {
  if (typeof body === 'object' && body !== null && 'errors' in body) {
    const errors = body.errors;
    if (Array.isArray(errors) && errors.every(error => typeof error === 'string')) {
      return errors.join('; ');
    }
  }
  return `Meraki Dashboard API request failed (${status}${statusText ? ` ${statusText}` : ''})`;
}

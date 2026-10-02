# meraki-switch-ports-sdk

A typed TypeScript client for Cisco Meraki Dashboard switch and switch-port operations. It uses Node's built-in `fetch` and has no runtime dependencies.

## Why This SDK Exists

This SDK grew out of a switch-port management portal use case: let operational teams request configuration changes for one or many Meraki switch ports through a graphical queue. The portal needed to inspect networks, switches, port status, and available port profiles through the Meraki Dashboard API, then hand approved work to Ansible playbooks running in AWX.

At the time, a suitable Node.js SDK was not available, so the Meraki API integration had to be built by hand in the portal. This package extracts that reusable Meraki-facing work into a typed TypeScript client, so other teams can build similar tools without reimplementing authentication headers, pagination, rate-limit handling, and switch-port requests.

The SDK intentionally stops at the Meraki API boundary. It does not run Ansible playbooks or integrate with AWX, SAML/identity providers, approval flows, or a particular UI. A consuming application can connect the SDK to AWX or its own job runner and apply its own access and approval rules.

## Requirements

- Node.js 20 or newer
- A Meraki Dashboard API key with the permissions required by the operations you call

## Install

```sh
npm install meraki-switch-ports-sdk
```

## Quick Start

```ts
import { MerakiClient } from 'meraki-switch-ports-sdk';

const client = new MerakiClient({
  apiKey: process.env.MERAKI_API_KEY!,
});

const networks = await client.getOrganizationNetworks('YOUR_ORGANIZATION_ID');
const switches = await client.getOrganizationDevices('YOUR_ORGANIZATION_ID', {
  productTypes: ['switch'],
});
const availability = await client.getOrganizationDeviceAvailabilities('YOUR_ORGANIZATION_ID', {
  productTypes: ['switch'],
});
const ports = await client.getSwitchPorts(switches[0]!.serial);
const liveStatuses = await client.getSwitchPortStatuses(switches[0]!.serial);
const profiles = await client.getOrganizationSwitchPortProfiles('YOUR_ORGANIZATION_ID');

await client.updateSwitchPort(switches[0]!.serial, '1', {
  enabled: true,
  type: 'access',
  vlan: 120,
  profile: { enabled: true, id: profiles[0]!.profileId },
});
```

API keys should be stored on a trusted server and never bundled into browser code. Use a key with only the Dashboard API permissions your application needs.

## Client Options

```ts
const client = new MerakiClient({
  apiKey: process.env.MERAKI_API_KEY!,
  maxRetries: 3,
  retryDelayMs: 500,
  maxRetryDelayMs: 10_000,
  // baseUrl and fetch can be overridden for compatible gateways and tests.
});
```

Collection methods follow Meraki `Link` pagination automatically. They request up to 1,000 entries per page by default and encode array query parameters using Meraki's bracket notation (for example, `productTypes[]=switch`). HTTP 429, transient 5xx responses, and network failures are retried with bounded delays for idempotent `GET`, `PUT`, and `DELETE` requests; `Retry-After` is honored. Non-idempotent `POST` and `PATCH` requests are never retried automatically. Pagination links must remain on the configured API origin.

## Switch Operations

- List organization networks, devices, device availabilities, and port profiles.
- Get a switch's configured ports and live port statuses.
- Read one port or update a port's configuration.
- Use `client.request<T>()` for Meraki endpoints not yet wrapped by a convenience method.

Meraki reports device availability through its organization availability endpoint, and that data may be up to five minutes old. Port status is returned by the switch port statuses endpoint.

## Live API Smoke Test

The Vitest suite mocks `fetch`; it verifies request behavior without contacting Meraki. To check real credentials, endpoint access, pagination, and response compatibility, run the read-only live smoke test against an organization you control:

```bash
export MERAKI_API_KEY='your-dashboard-api-key'
export MERAKI_ORG_ID='your-organization-id'
export MERAKI_SWITCH_SERIAL='your-switch-serial'
npm run smoke:live
```

`MERAKI_SWITCH_SERIAL` is optional. When set, the smoke test also reads that switch's configured ports and live port statuses. The script never updates configuration. Do not commit API keys or place them in frontend code.

The API key needs read access for the operations being tested: organization network/device configuration, device availability telemetry, switch port configuration/profile reads, and switch port telemetry. Meraki may report missing scopes as HTTP 403; the error output includes the HTTP status to help distinguish permission issues from connectivity or API errors.

## Errors

- `MerakiApiError` represents an HTTP error and exposes `status`, parsed `body`, and the Meraki request ID when present.
- `MerakiNetworkError` represents a fetch/network failure after retries are exhausted.
- `MerakiPaginationError` is thrown if a pagination link attempts to leave the configured API origin.

## Development

```sh
npm install
npm test
npm run typecheck
npm run build
```

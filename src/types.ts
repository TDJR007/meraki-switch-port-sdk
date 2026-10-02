export type MerakiDeviceStatus =
  | 'online'
  | 'alerting'
  | 'offline'
  | 'dormant'
  | (string & {});

export interface MerakiNetwork {
  id: string;
  organizationId?: string;
  name: string;
  productTypes?: string[];
  timeZone?: string;
  tags?: string[];
  url?: string;
  notes?: string;
  isBoundToConfigTemplate?: boolean;
}

export interface MerakiDevice {
  serial: string;
  name?: string;
  model?: string;
  networkId?: string;
  mac?: string;
  lanIp?: string;
  productType?: string;
  firmware?: string;
  tags?: string[];
  address?: string;
  lat?: number;
  lng?: number;
}

export interface MerakiDeviceAvailability {
  serial: string;
  status: MerakiDeviceStatus;
  name?: string;
  mac?: string;
  network?: { id: string };
  productType?: string;
  tags?: string[];
}

export interface SwitchPort {
  portId: string;
  name?: string;
  tags?: string[];
  enabled?: boolean;
  poeEnabled?: boolean;
  type?: string;
  vlan?: number | null;
  voiceVlan?: number | null;
  allowedVlans?: string;
  stpGuard?: string;
  linkNegotiation?: string;
  accessPolicyType?: string;
  accessPolicyNumber?: number;
  macAllowList?: string[];
  profile?: { enabled?: boolean; id?: string; iname?: string };
  [key: string]: unknown;
}

export interface SwitchPortStatus {
  portId: string;
  status: string;
  enabled?: boolean;
  isUplink?: boolean;
  errors?: string[];
  warnings?: string[];
  speed?: string;
  duplex?: string;
  clientCount?: number;
  [key: string]: unknown;
}

export interface SwitchPortProfile {
  profileId: string;
  name: string;
  description?: string;
  network?: { id: string };
  isOrganizationWide?: boolean;
  access?: string;
}

export interface UpdateSwitchPortRequest {
  name?: string;
  tags?: string[];
  enabled?: boolean;
  poeEnabled?: boolean;
  type?: string;
  vlan?: number | null;
  voiceVlan?: number | null;
  allowedVlans?: string;
  stpGuard?: string;
  linkNegotiation?: string;
  accessPolicyType?: string;
  accessPolicyNumber?: number;
  macAllowList?: string[];
  profile?: { enabled: boolean; id?: string };
}

export interface PaginationQuery extends Query {
  perPage?: number;
  startingAfter?: string;
  endingBefore?: string;
}

export type QueryValue = string | number | boolean | readonly (string | number | boolean)[] | null | undefined;
export type Query = Readonly<Record<string, QueryValue>>;

export interface OrganizationDevicesQuery extends PaginationQuery {
  networkIds?: readonly string[];
  productTypes?: readonly string[];
  serial?: string;
  serials?: readonly string[];
  models?: readonly string[];
  tags?: readonly string[];
}

export interface OrganizationNetworksQuery extends PaginationQuery {
  configTemplateId?: string;
  isBoundToConfigTemplate?: boolean;
  productTypes?: readonly string[];
  tags?: readonly string[];
}

export interface DeviceAvailabilitiesQuery extends PaginationQuery {
  networkIds?: readonly string[];
  productTypes?: readonly string[];
  serials?: readonly string[];
  statuses?: readonly MerakiDeviceStatus[];
  tags?: readonly string[];
}

export interface SwitchPortProfilesQuery extends PaginationQuery {
  networkIds?: readonly string[];
  formattedStaticAssignments?: boolean;
  searchQuery?: string;
}

export interface SwitchPortStatusesQuery extends Query {
  timespan?: number;
  t0?: string;
}

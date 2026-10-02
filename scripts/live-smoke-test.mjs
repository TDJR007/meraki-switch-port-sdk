import { MerakiClient } from '../dist/index.js';

const apiKey = process.env.MERAKI_API_KEY;
const organizationId = process.env.MERAKI_ORG_ID;
const switchSerial = process.env.MERAKI_SWITCH_SERIAL;

if (!apiKey || !organizationId) {
  console.error('Set MERAKI_API_KEY and MERAKI_ORG_ID before running the live smoke test.');
  process.exitCode = 1;
} else {
  const client = new MerakiClient({
    apiKey,
    ...(process.env.MERAKI_BASE_URL ? { baseUrl: process.env.MERAKI_BASE_URL } : {}),
  });

  try {
    const [networks, switches, availabilities, profiles] = await Promise.all([
      client.getOrganizationNetworks(organizationId),
      client.getOrganizationDevices(organizationId, { productTypes: ['switch'] }),
      client.getOrganizationDeviceAvailabilities(organizationId, { productTypes: ['switch'] }),
      client.getOrganizationSwitchPortProfiles(organizationId),
    ]);

    const statusCounts = availabilities.reduce((counts, device) => {
      counts.set(device.status, (counts.get(device.status) ?? 0) + 1);
      return counts;
    }, new Map());

    console.log(`Networks: ${networks.length}`);
    console.log(`Switches: ${switches.length}`);
    console.log(`Switch availability records: ${availabilities.length}`);
    console.log(`Switch statuses: ${[...statusCounts].map(([status, count]) => `${status}=${count}`).join(', ') || 'none'}`);
    console.log(`Port profiles: ${profiles.length}`);

    if (switchSerial) {
      const target = switches.find(device => device.serial === switchSerial);
      if (!target) {
        throw new Error('MERAKI_SWITCH_SERIAL was not found among the organization switches returned by the API.');
      }

      const [ports, portStatuses] = await Promise.all([
        client.getSwitchPorts(switchSerial),
        client.getSwitchPortStatuses(switchSerial),
      ]);
      console.log(`Selected switch ports: ${ports.length}`);
      console.log(`Selected switch live port statuses: ${portStatuses.length}`);
    }

    console.log('Live Meraki read-only smoke test passed. No configuration was changed.');
  } catch (error) {
    if (error instanceof Error) {
      const status = 'status' in error && typeof error.status === 'number' ? ` (HTTP ${error.status})` : '';
      console.error(`Live Meraki smoke test failed${status}: ${error.message}`);
    } else {
      console.error('Live Meraki smoke test failed with an unknown error.');
    }
    process.exitCode = 1;
  }
}

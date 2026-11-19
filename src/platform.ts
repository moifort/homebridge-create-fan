import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import { FanAccessory } from './accessory.js';
import { DEFAULT_PROTOCOL_VERSION, findDuplicateIds, normalizeProtocolVersion, type TuyaProtocolVersion } from './config.js';

export type { TuyaProtocolVersion } from './config.js';

export interface FanConfiguration {
  id: string;
  key: string;
  name: string;
  ip: string;
  light?: boolean;
  toggles?: boolean;
  speedButtons?: boolean;
  // A number is accepted for hand-written config.json files (`"version": 3.4`);
  // it is normalised to a string before reaching the accessory.
  version?: TuyaProtocolVersion | number;
}

export interface PersistedFanState {
  Active: 0 | 1;
  RotationSpeed?: number;
  RotationDirection?: 0 | 1;
}

export interface PersistedLightState {
  On: boolean;
}

export type PlatformAccessoryContext = {
  device: FanConfiguration;
  fanState?: PersistedFanState;
  lightState?: PersistedLightState;
};


export class HomebridgeCreateCeilingFan implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: Map<string, PlatformAccessory<PlatformAccessoryContext>> = new Map();
  private readonly discoveredCacheUUIDs = new Set<string>();
  private readonly fanAccessories: FanAccessory[] = [];

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.log.debug('Platform:',`Finished initializing platform ${this.config.name}`);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Platform:','Executed didFinishLaunching callback');
      if (!config.devices || !Array.isArray(config.devices) || config.devices.length === 0) {
        this.log.warn('No fans specified in the configuration.');
        return;
      }
      this.discoverDevices(config.devices);
    });

    // Close the Tuya sockets and stop every reconnect/write timer so
    // Homebridge can exit (or restart a child bridge) cleanly.
    this.api.on('shutdown', () => {
      for (const fan of this.fanAccessories) {
        fan.dispose();
      }
    });
  }

  discoverDevices(fans: FanConfiguration[]) {
    const duplicateIds = new Set(findDuplicateIds(fans.map(fan => fan.id)));
    for (const id of duplicateIds) {
      this.log.error(
        'Platform:',
        `Skipping every fan with id "${id}" — this id appears more than once in the config. ` +
        'Each fan needs its own Tuya device ID: fix the duplicate entry and restart Homebridge.',
      );
    }
    for (const configuredFan of fans) {
      if (duplicateIds.has(configuredFan.id)) {
        continue;
      }
      const version = normalizeProtocolVersion(configuredFan.version);
      if (configuredFan.version !== undefined && version === undefined) {
        this.log.warn(
          'Platform:',
          `Fan "${configuredFan.name ?? configuredFan.id}": unknown protocol version "${configuredFan.version}", ` +
          `using ${DEFAULT_PROTOCOL_VERSION}.`,
        );
      }
      const fan: FanConfiguration = { ...configuredFan, version: version ?? DEFAULT_PROTOCOL_VERSION };
      const missing = (['id', 'key', 'ip'] as const).filter(field => !fan[field]);
      if (missing.length > 0) {
        this.log.error(
          'Platform:',
          `Skipping fan "${fan.name ?? fan.id ?? 'unknown'}" — missing required config field(s): ` +
          `${missing.join(', ')}. Since v2.1.0 a static "ip" is required (UDP discovery was removed). ` +
          'Add the missing field(s) in the plugin config and restart Homebridge.',
        );
        continue;
      }
      const uuid = this.api.hap.uuid.generate(fan.id);
      const existingFan = this.accessories.get(uuid);
      if (existingFan) {
        this.log.info('Platform:',`Restoring existing accessory from cache -> ${existingFan.displayName}`);
        existingFan.context.device = fan;
        this.fanAccessories.push(new FanAccessory(this, existingFan));
      } else {
        this.log.info('Platform:',`Adding new accessory -> ${fan.name}`);
        const accessory = new this.api.platformAccessory<PlatformAccessoryContext>(fan.name, uuid);
        accessory.context.device = fan;
        this.fanAccessories.push(new FanAccessory(this, accessory));
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
      this.discoveredCacheUUIDs.add(uuid);
    }

    // Clean
    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.has(uuid)) {
        this.log.info('Platform:','Removing existing accessory from cache ->', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Platform:','Loading accessory from cache ->', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory as PlatformAccessory<PlatformAccessoryContext>);
  }
}

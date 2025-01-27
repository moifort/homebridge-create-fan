import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { FanAccessory } from './accessory';

interface FanConfiguration {
  id: string;
  key: string;
  ip: string;
  version: string;
  name: string;
  hasLight: boolean;
  withToggle: boolean;
}

export class HomebridgeCreateCeilingFan implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      if (!config.devices || !Array.isArray(config.devices) || config.devices.length === 0) {
        this.log.warn('No fans specified in the configuration.');
        return;
      }
      this.discoverDevices(config.devices);
    });
  }

  discoverDevices(fans: FanConfiguration[]) {
    for (const fan of fans) {
      const uuid = this.api.hap.uuid.generate(fan.id);
      const existingFan = this.accessories.get(uuid);
      if (existingFan) {
        this.log.info('Restoring existing accessory from cache:', existingFan.displayName);
        new FanAccessory(this, existingFan);
      } else {
        this.log.info('Adding new accessory:', fan.name);
        const accessory = new this.api.platformAccessory(fan.name, uuid);
        accessory.context.device = fan;
        new FanAccessory(this, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
      this.discoveredCacheUUIDs.push(uuid);
    }

    // Clean
    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to set up event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }
}

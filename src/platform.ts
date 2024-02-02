import {API, Categories, Characteristic, DynamicPlatformPlugin, Logger, PlatformAccessory, PlatformConfig, Service} from 'homebridge';

import {PLATFORM_NAME, PLUGIN_NAME} from './settings';
import {CeilingFanAccessory} from './platformAccessory';
import {ToggleCeilingFanAccessory} from './platformOptionalAccessory';

interface DeviceConfig {
  id: string;
  key: string;
  ip: string;
  version: string;
  name: string;
  hasLight: boolean;
  withToggle: boolean;
}

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class HomebridgeCreateCeilingFan implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;
  public readonly accessories: PlatformAccessory[] = [];
  private devices: DeviceConfig[] = [];

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    // Check if the configuration contains devices
    if (config.devices && Array.isArray(config.devices)) {
      this.devices = config.devices;
    } else {
      this.log.warn('No devices specified in the configuration.');
    }

    this.log.debug('Finished initializing platform:', this.config.name);
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  discoverDevices() {
    for (const device of this.devices) {
      const uuid = this.api.hap.uuid.generate(device.id);
      const existingAccessory = this.accessories
        .find(accessory => accessory.UUID === uuid);
      if (existingAccessory) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
        new CeilingFanAccessory(this, existingAccessory);
      } else if(!existingAccessory) {
        this.log.info('Adding new ceiling fan:', device.id, device.name, device.hasLight);
        const accessory = new this.api.platformAccessory(device.name, uuid, Categories.FAN);
        accessory.context.device = device;
        new CeilingFanAccessory(this, accessory);
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }

      if (device.withToggle) {
        const toggleUuid = this.api.hap.uuid.generate(`toggle-${device.id}`);
        const existingToggleAccessory = this.accessories
          .find(accessory => accessory.UUID === toggleUuid);
        if(existingToggleAccessory) {
          this.log.info('Restoring existing toggle accessory from cache:', existingToggleAccessory.displayName);
          new ToggleCeilingFanAccessory(this, existingToggleAccessory);
        } else {
          this.log.info('Adding new toggle ceiling fan:', device.id, device.name, device.hasLight);
          const toggleAccessoryId = this.api.hap.uuid.generate(`toggle-${device.id}`);
          const toggleAccessory = new this.api.platformAccessory(`Toggle ${device.name}`, toggleAccessoryId, Categories.FAN);
          toggleAccessory.context.device = device;
          new ToggleCeilingFanAccessory(this, toggleAccessory);
          this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [toggleAccessory]);
        }
      }
    }
  }
}

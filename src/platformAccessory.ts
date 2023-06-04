import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';

import {HomebridgeCreateCeilingFan} from './platform';
import TuyAPI, {DPSObject} from 'tuyapi';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different fanService types.
 */
export class CeilingFanAccessory {
  private fanService!: Service;
  private lightService!: Service;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private state = {
    fanOn: false,
    fanSpeed: 20,
    lightOn: false,
  };

  constructor(
    private readonly platform: HomebridgeCreateCeilingFan,
    private readonly accessory: PlatformAccessory,
  ) {
    try {
      const device = new TuyAPI({
        id: accessory.context.device.id,
        key: accessory.context.device.key,
      });

      device.on('disconnected', () => {
        device.connect();
      });

      // Information
      this.accessory.getService(this.platform.Service.AccessoryInformation)!
        .setCharacteristic(this.platform.Characteristic.Manufacturer, 'CREATE')
        .setCharacteristic(this.platform.Characteristic.Model, 'Ceiling Fan')
        .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.id);

      // Fan
      this.fanService = this.accessory.getService(this.platform.Service.Fan) || this.accessory.addService(this.platform.Service.Fan);
      this.fanService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

      // Fan state
      this.fanService.getCharacteristic(this.platform.Characteristic.On)
        .onSet(async (value: CharacteristicValue) => {
          this.state.fanOn = value.valueOf() as boolean;
          await device.set({dps: 60, set: value.valueOf() as boolean, shouldWaitForResponse: false});
        })
        .onGet(() => this.state.fanOn);
      const stateHook = (data: DPSObject) => {
        const isOn = data.dps['60'] as boolean | undefined;
        if (isOn !== undefined) {
          this.state.fanOn = isOn;
          this.platform.log.info('Update fan on', this.state.fanOn);
          this.fanService.updateCharacteristic(this.platform.Characteristic.On, this.state.fanOn);
        }
      };
      device.on('dp-refresh', stateHook);
      device.on('data', stateHook);

      // Fan Light
      this.lightService = this.accessory.getService(this.platform.Service.Lightbulb)
        || this.accessory.addService(this.platform.Service.Lightbulb);
      this.lightService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);
      this.lightService.getCharacteristic(this.platform.Characteristic.On)
        .onSet(async (value: CharacteristicValue) => {
          this.state.lightOn = value.valueOf() as boolean;
          await device.set({dps: 20, set: value.valueOf() as boolean, shouldWaitForResponse: false});
        })
        .onGet(() => this.state.lightOn);

      const lightStateHook = (data: DPSObject) => {
        const isOn = data.dps['20'] as boolean | undefined;
        if (isOn !== undefined) {
          this.state.lightOn = isOn;
          this.platform.log.info('Update light on', this.state.lightOn);
          this.lightService.updateCharacteristic(this.platform.Characteristic.On, this.state.lightOn);
        }
      };
      device.on('dp-refresh', lightStateHook);
      device.on('data', lightStateHook);

      device.find().then(() => device.connect()).catch((e) => {
        this.platform.log.warn('Error occurred while initializing device', e);
        setTimeout(() => device.find().then(() => device.connect()), 1000 * 60 * 10);
      });
    } catch (e) {
      this.platform.log.warn('Error occurred while initializing device', e);
    }
  }
}

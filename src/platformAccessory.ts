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
    fanRotation: this.platform.Characteristic.RotationDirection.CLOCKWISE,
    fanSpeed: 20,
    lightOn: false,
    lightBrightness: 60,
  };

  constructor(
    private readonly platform: HomebridgeCreateCeilingFan,
    private readonly accessory: PlatformAccessory,
  ) {
    const device = new TuyAPI({
      id: accessory.context.device.id,
      key: accessory.context.device.key,
    });

    device.on('disconnected', () => device.connect());

    // Information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'CREATE')
      .setCharacteristic(this.platform.Characteristic.Model, 'Ceiling Fan')
      .setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.id);

    // Fan
    this.fanService = this.accessory.getService(this.platform.Service.Fan) || this.accessory.addService(this.platform.Service.Fan);
    this.fanService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    // Fan state
    this.fanService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value: CharacteristicValue) => {
        this.state.fanOn = value.valueOf() as boolean;
        await device.set({dps: 60, set: value.valueOf() as boolean, shouldWaitForResponse: false});
        if (this.state.fanOn) {
          device.refresh({});
        }
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

    // Fan rotation
    this.fanService.getCharacteristic(this.platform.Characteristic.RotationDirection)
      .onSet(async (value: CharacteristicValue) => {
        this.state.fanRotation = value.valueOf() as number;
        await device.set({dps: 63, set:  this.state.fanRotation === 0 ? 'forward' : 'reverse', shouldWaitForResponse: false});
      })
      .onGet(() => this.state.fanRotation);
    const rotationHook = (data: DPSObject) => {
      const rotation = data.dps['63'] as string | undefined;
      if (rotation !== undefined) {
        this.state.fanRotation = rotation === 'forward'
          ? this.platform.Characteristic.RotationDirection.CLOCKWISE
          : this.platform.Characteristic.RotationDirection.COUNTER_CLOCKWISE;
        this.platform.log.info('Update fan rotation', this.state.fanRotation);
        this.fanService.updateCharacteristic(this.platform.Characteristic.RotationDirection, this.state.fanRotation);
      }
    };
    device.on('dp-refresh', rotationHook);
    device.on('data', rotationHook);

    // Fan speed
    this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onSet(async (value: CharacteristicValue) => {
        this.state.fanSpeed = value.valueOf() as number;
        if (this.state.fanSpeed === 0) {
          await device.set({dps: 60, set: false, shouldWaitForResponse: false});
        } else {
          await device.set({dps: 62, set:  this.toStep(this.state.fanSpeed), shouldWaitForResponse: false});
        }
      })
      .onGet(() => this.state.fanSpeed);
    const speedHook = (data: DPSObject) => {
      const speed = data.dps['62'] as number | undefined;
      if (speed !== undefined) {
        this.state.fanSpeed = this.toPercent(this.state.fanSpeed, speed);
        this.platform.log.info('Update fan speed', this.state.fanSpeed);
        this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.state.fanSpeed);
      }
    };
    device.on('dp-refresh', speedHook);
    device.on('data', speedHook);

    // Fan Light
    this.lightService = this.accessory.getService(this.platform.Service.Lightbulb)
      || this.accessory.addService(this.platform.Service.Lightbulb);
    this.lightService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);
    this.lightService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value: CharacteristicValue) => {
        this.state.lightOn = value.valueOf() as boolean;
        await device.set({dps: 20, set: value.valueOf() as boolean, shouldWaitForResponse: false});
        if (this.state.lightOn) {
          device.refresh({});
        }
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

    // Fan Light Brightness
    this.lightService.getCharacteristic(this.platform.Characteristic.Brightness)
      .onSet(async (value: CharacteristicValue) => {
        this.state.lightBrightness = value.valueOf() as number;
        if (this.state.lightBrightness === 0) {
          await device.set({dps: 20, set: false, shouldWaitForResponse: false});
        } else {
          await device.set({dps: 22, set: this.state.lightBrightness * 10, shouldWaitForResponse: false});
        }
      })
      .onGet(() => this.state.lightBrightness);

    const lightBrightnessHook = (data: DPSObject) => {
      const brightness = data.dps['22'] as number | undefined;
      if (brightness !== undefined) {
        this.state.lightBrightness = brightness / 10;
        this.platform.log.info('Update brightness', this.state.lightBrightness);
        this.lightService.updateCharacteristic(this.platform.Characteristic.Brightness, this.state.lightBrightness);
      }
    };
    device.on('dp-refresh', lightBrightnessHook);
    device.on('data', lightBrightnessHook);

    device.find().then(() => device.connect());
  }

  toStep(percent: number) {
    const etapes = [1, 2, 3, 4, 5, 6];
    const etapeIndex = Math.floor(percent / 16.67); // 100 / 6 = 16.67
    return etapes[etapeIndex];
  }

  toPercent(initialPercentage: number, step: number) {
    const plagesPourcentage = [0, 15, 30, 50, 65, 80, 100];
    const plageMin = plagesPourcentage[step - 1];
    const plageMax = plagesPourcentage[step];
    if (initialPercentage >= plageMin && initialPercentage <= plageMax) {
      return initialPercentage;
    }
    if (step === 1) {
      return 10;
    }
    if (step === 6) {
      return 100;
    }
    return plageMin;
  }
}

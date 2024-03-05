import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';

import {HomebridgeCreateCeilingFan} from './platform';
import TuyAPI from 'tuyapi';
import TuyaDevice, {DPSObject} from 'tuyapi';

export class ToggleCeilingFanAccessory {
  private fanService!: Service;
  private lightService!: Service;

  private state = {
    fanOn: false,
    fanRotation: this.platform.Characteristic.RotationDirection.CLOCKWISE,
    fanSpeed: 20,
    lightOn: false,
    lightBrightness: 60,
    lightColorTemperature: 140,
  };

  constructor(
    private readonly platform: HomebridgeCreateCeilingFan,
    private readonly accessory: PlatformAccessory,
  ) {
    const device = new TuyAPI({
      id: accessory.context.device.id,
      key: accessory.context.device.key,
      ip: accessory.context.device.ip,
      version: accessory.context.device.version,
      issueRefreshOnConnect: true,
    });

    device.on('disconnected', () => {
      this.platform.log.info('Disconnected... Try to connect');
      this.connect(device);
    });
    device.on('error', error => {
      this.platform.log.info('Error :', error);
      this.platform.log.info('Try to connect');
      this.connect(device);
    });


    // Fan
    this.fanService = this.accessory.getService(this.platform.Service.Fan) || this.accessory.addService(this.platform.Service.Fan);
    this.fanService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    // Fan state
    this.fanService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value: CharacteristicValue) => {
        const receivedValue = value.valueOf() as boolean;
        this.state.fanOn = this.state.fanOn && receivedValue ? false : receivedValue;
        await device.set({dps: 60, set: this.state.fanOn, shouldWaitForResponse: false});
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

    if (accessory.context.device.hasLight) {
      // Fan Light
      this.lightService = this.accessory.getService(this.platform.Service.Lightbulb)
        || this.accessory.addService(this.platform.Service.Lightbulb);
      this.lightService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);
      this.lightService.getCharacteristic(this.platform.Characteristic.On)
        .onSet(async (value: CharacteristicValue) => {
          const receivedValue = value.valueOf() as boolean;
          this.state.lightOn = this.state.lightOn && receivedValue ? false : receivedValue;
          await device.set({dps: 20, set: this.state.lightOn, shouldWaitForResponse: false});
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
    }

    this.connect(device);
  }

  async connect(device: TuyaDevice) {
    try {
      this.platform.log.info('Connecting...');
      await device.find();
      await device.connect();
      this.platform.log.info('Connected');
    } catch (e) {
      this.platform.log.info('Connection failed', e);
      this.platform.log.info('Retry in 1 minute');
      setTimeout(() => this.connect(device), 60000);
    }
  }
}

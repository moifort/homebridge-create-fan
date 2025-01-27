import { Characteristic, CharacteristicValue, type Logging, PlatformAccessory, Service } from 'homebridge';
import { HomebridgeCreateCeilingFan, PlatformAccessoryContext } from './platform.js';
import type TuyaDevice from 'tuyapi';
import TuyAPI from 'tuyapi';

export class FanAccessory {
  private readonly fanService: Service;
  private readonly lightService: Service;
  private readonly Characteristic: typeof Characteristic;
  private readonly log: Logging;
  private readonly tuyaDevice: TuyaDevice;
  private isConnecting = false;
  private fanState = {
    Active: 0 as CharacteristicValue, // 0 = Inactive, 1 = Active
    Rotation: 0 as CharacteristicValue, // 0 = Clockwise, 1 = Counter-Clockwise
    Speed: 20,
  };
  private lightState = {
    On: false,
    Brightness: 60,
  };

  constructor(
    private readonly platform: HomebridgeCreateCeilingFan,
    private readonly accessory: PlatformAccessory<PlatformAccessoryContext>,
  ) {
    this.Characteristic = this.platform.Characteristic;
    this.log = this.platform.log;

    this.log.info(`${accessory.displayName}:`, 'Init...');

    // Information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, 'CREATE')
      .setCharacteristic(this.Characteristic.Model, 'Ceiling Fan')
      .setCharacteristic(this.Characteristic.Name, accessory.context.device.name)
      .setCharacteristic(this.Characteristic.SerialNumber, accessory.context.device.id);

    // Fan
    this.fanService = this.accessory.getService(this.platform.Service.Fanv2) || this.accessory.addService(this.platform.Service.Fanv2);
    this.fanService.setCharacteristic(this.Characteristic.Name, accessory.context.device.name);
    this.fanService.getCharacteristic(this.Characteristic.Active)
      .onGet(this.getFanActivity.bind(this))
      .onSet(this.setFanActivity.bind(this));

    // Light
    this.lightService = this.accessory.getService(this.platform.Service.Lightbulb) || this.accessory.addService(this.platform.Service.Lightbulb);
    this.lightService.getCharacteristic(this.Characteristic.On)
      .onGet(this.getLightOn.bind(this))
      .onSet(this.setLightOn.bind(this));

    this.tuyaDevice = new TuyAPI({ id: accessory.context.device.id, key: accessory.context.device.key });
    this.tuyaDevice.on('disconnected', () => this.log.warn('Disconnected'));
    this.tuyaDevice.on('error', error => this.log.error(error.message));
    this.connect(this.tuyaDevice);
  }

  async connect(device: TuyaDevice) {
    if (this.isConnecting) {
      return;
    }
    this.isConnecting = true;
    this.log.info(`${this.accessory.displayName}:`, 'Connecting...');
    await device.find();
    await device.connect();
    this.log.info(`${this.accessory.displayName}:`, 'Connected!');
    this.isConnecting = false;
  }

  async sendCommand(dps: number, value: string | number | boolean) {
    this.log.debug(`${this.accessory.displayName}:`, `sendCommand(${dps}, ${value})`);
    await this.tuyaDevice.set({ dps, set: value });
  }

  getFanActivity() {
    this.log.debug(`${this.accessory.displayName}:`, `getFanActivity() => ${this.fanState.Active === 0 ? 'INACTIVE' : 'ACTIVE'}`);
    return this.fanState.Active;
  }

  async setFanActivity(value: CharacteristicValue) {
    this.fanState.Active = this.fanState.Active === this.Characteristic.Active.INACTIVE
      ? this.Characteristic.Active.ACTIVE
      : this.Characteristic.Active.INACTIVE;
    if (value !== this.fanState.Active) {
      this.fanService.updateCharacteristic(this.Characteristic.Active, this.fanState.Active);
    }
    await this.sendCommand(60, this.fanState.Active === 1);
    this.log.debug(`${this.accessory.displayName}:`, `setFanActivity() => ${value === 0 ? 'INACTIVE' : 'ACTIVE'}`);
  }

  getLightOn() {
    this.log.debug(`${this.accessory.displayName}:`, `getLightOn() => ${this.lightState.On ? 'ON' : 'OFF'}`);
    return this.lightState.On;
  }

  async setLightOn(value: CharacteristicValue) {
    this.lightState.On = !this.lightState.On;
    if (value !== this.lightState.On) {
      this.lightService.updateCharacteristic(this.Characteristic.On, this.lightState.On);
    }
    await this.sendCommand(20, this.lightState.On);
    this.log.debug(`${this.accessory.displayName}:`, `setLightOn() => ${this.lightState.On ? 'ON' : 'OFF'}`);
  }
}

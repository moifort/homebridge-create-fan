import { Characteristic, CharacteristicValue, type Logging, PlatformAccessory, Service } from 'homebridge';
import { HomebridgeCreateCeilingFan, PlatformAccessoryContext } from './platform.js';
import type TuyaDevice from 'tuyapi';
import TuyAPI from 'tuyapi';

export class FanAccessory {
  private readonly fanService: Service;
  private readonly lightService: Service;
  private readonly toggleLightService: Service;
  private readonly Characteristic: typeof Characteristic;
  private readonly log: Logging;
  private readonly tuyaDevice: TuyaDevice;
  private isConnecting = false;
  private isConnected = false;
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
    this.toggleLightService = this.accessory.getService(this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch);
    this.toggleLightService.setCharacteristic(this.Characteristic.Name, `${accessory.context.device.name} Toggle Light`);
    this.toggleLightService.getCharacteristic(this.Characteristic.On)
      .onGet(this.getLightOn.bind(this))
      .onSet(this.toggleLightOn.bind(this));

    this.tuyaDevice = new TuyAPI({ id: accessory.context.device.id, key: accessory.context.device.key });
    this.tuyaDevice.on('disconnected', () => {
      this.log.info(`${this.accessory.displayName}:`,'Disconnected');
      this.isConnected = false;
      this.connect();
    });
    this.tuyaDevice.on('connected', () => {
      this.log.info(`${this.accessory.displayName}:`,'Connected!');
      this.isConnected = true;
    });
    this.tuyaDevice.on('error', error => this.log.warn(`${this.accessory.displayName}:`,`Error -> ${error.toString()}`));
    this.connect();
  }

  async connect() {
    if (this.isConnecting || this.isConnected) {
      return;
    }
    this.isConnecting = true;
    this.log.info(`${this.accessory.displayName}:`, 'Connecting...');
    await this.tuyaDevice.find();
    await this.tuyaDevice.connect();
    this.isConnecting = false;
  }

  sendCommand(dps: number, value: string | number | boolean) {
    this.log.debug(`${this.accessory.displayName}:`, `sendCommand(${dps}, ${value})`);
    this.tuyaDevice.set({ dps, set: value });
  }

  getFanActivity() {
    this.log.debug(`${this.accessory.displayName}:`, `getFanActivity() => ${this.fanState.Active === 0 ? 'INACTIVE' : 'ACTIVE'}`);
    return this.fanState.Active;
  }

  setFanActivity(value: CharacteristicValue) {
    this.fanState.Active = this.fanState.Active === this.Characteristic.Active.INACTIVE
      ? this.Characteristic.Active.ACTIVE
      : this.Characteristic.Active.INACTIVE;
    if (value !== this.fanState.Active) {
      this.fanService.updateCharacteristic(this.Characteristic.Active, this.fanState.Active);
    }
    this.sendCommand(60, this.fanState.Active === 1);
    this.log.debug(`${this.accessory.displayName}:`, `setFanActivity() => ${value === 0 ? 'INACTIVE' : 'ACTIVE'}`);
  }

  getLightOn() {
    this.log.debug(`${this.accessory.displayName}:`, `getLightOn() => ${this.lightState.On ? 'ON' : 'OFF'}`);
    return this.lightState.On;
  }

  setLightOn(value: CharacteristicValue) {
    if (value !== this.lightState.On) {
      this.lightState.On = value as boolean;
      this.sendCommand(20, this.lightState.On);
    }
    this.log.debug(`${this.accessory.displayName}:`, `setLightOn() => ${this.lightState.On ? 'ON' : 'OFF'}`);
  }

  toggleLightOn(value: CharacteristicValue) {
    this.lightState.On = !this.lightState.On;
    if (value !== this.lightState.On) {
      this.lightService.updateCharacteristic(this.Characteristic.On, this.lightState.On);
      this.toggleLightService.updateCharacteristic(this.Characteristic.On, this.lightState.On);
    }
    this.sendCommand(20, this.lightState.On);
    this.log.debug(`${this.accessory.displayName}:`, `toggleLightOn() => ${this.lightState.On ? 'ON' : 'OFF'}`);
  }
}

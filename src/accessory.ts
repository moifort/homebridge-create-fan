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
  private isConnected = false;
  private fanState: { Active: 0 | 1; Rotation: CharacteristicValue; Speed: number };
  private lightState: { On: boolean; Brightness: number };

  constructor(
    private readonly platform: HomebridgeCreateCeilingFan,
    private readonly accessory: PlatformAccessory<PlatformAccessoryContext>,
  ) {
    this.Characteristic = this.platform.Characteristic;
    this.log = this.platform.log;

    // Restore last known state from Homebridge persistent context (survives restarts)
    this.fanState = {
      Active: accessory.context.fanState?.Active ?? 0,
      Rotation: 0 as CharacteristicValue, // 0 = Clockwise, 1 = Counter-Clockwise
      Speed: 20,
    };
    this.lightState = {
      On: accessory.context.lightState?.On ?? false,
      Brightness: 60,
    };

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

    // Remove legacy Toggle Light switch service from cached accessories
    const legacyToggleSwitch = this.accessory.getService(this.platform.Service.Switch);
    if (legacyToggleSwitch) {
      this.accessory.removeService(legacyToggleSwitch);
    }

    this.tuyaDevice = new TuyAPI({
      id: accessory.context.device.id,
      key: accessory.context.device.key,
      issueRefreshOnConnect: true,
    });
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
    this.tuyaDevice.on('data', data => this.applyDps(data?.dps));
    this.tuyaDevice.on('dp-refresh', data => this.applyDps(data?.dps));
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

  private persistState() {
    this.accessory.context.fanState = { Active: this.fanState.Active };
    this.accessory.context.lightState = { On: this.lightState.On };
    this.platform.api.updatePlatformAccessories([this.accessory]);
  }

  private applyDps(dps: Record<string, unknown> | undefined) {
    if (!dps) {
      return;
    }
    let changed = false;

    const lightDps = dps['20'];
    if (typeof lightDps === 'boolean' && lightDps !== this.lightState.On) {
      this.lightState.On = lightDps;
      this.lightService.updateCharacteristic(this.Characteristic.On, lightDps);
      changed = true;
      this.log.debug(`${this.accessory.displayName}:`, `Tuya -> light ${lightDps ? 'ON' : 'OFF'}`);
    }

    const fanDps = dps['60'];
    if (typeof fanDps === 'boolean') {
      const nextActive: 0 | 1 = fanDps ? 1 : 0;
      if (nextActive !== this.fanState.Active) {
        this.fanState.Active = nextActive;
        this.fanService.updateCharacteristic(this.Characteristic.Active, nextActive);
        changed = true;
        this.log.debug(`${this.accessory.displayName}:`, `Tuya -> fan ${nextActive === 1 ? 'ACTIVE' : 'INACTIVE'}`);
      }
    }

    if (changed) {
      this.persistState();
    }
  }

  getFanActivity() {
    this.log.debug(`${this.accessory.displayName}:`, `getFanActivity() => ${this.fanState.Active === 0 ? 'INACTIVE' : 'ACTIVE'}`);
    return this.fanState.Active;
  }

  setFanActivity(value: CharacteristicValue) {
    const next: 0 | 1 = value === this.Characteristic.Active.ACTIVE ? 1 : 0;
    this.fanState.Active = next;
    this.persistState();
    this.sendCommand(60, next === 1);
    this.log.debug(`${this.accessory.displayName}:`, `setFanActivity() => ${next === 0 ? 'INACTIVE' : 'ACTIVE'}`);
  }

  getLightOn() {
    this.log.debug(`${this.accessory.displayName}:`, `getLightOn() => ${this.lightState.On ? 'ON' : 'OFF'}`);
    return this.lightState.On;
  }

  setLightOn(value: CharacteristicValue) {
    const next = value as boolean;
    this.lightState.On = next;
    this.persistState();
    this.sendCommand(20, next);
    this.log.debug(`${this.accessory.displayName}:`, `setLightOn() => ${next ? 'ON' : 'OFF'}`);
  }

}

import { Characteristic, CharacteristicValue, type Logging, PlatformAccessory, Service } from 'homebridge';
import { HomebridgeCreateCeilingFan, PlatformAccessoryContext } from './platform.js';
import type TuyaDevice from 'tuyapi';
import TuyAPI from 'tuyapi';

type DpsPrimitive = string | number | boolean;

const WRITE_DEBOUNCE_MS = 250;
const ECHO_SUPPRESS_MS = 1500;

const DPS_LIGHT = 20;
const DPS_FAN = 60;
const DPS_FAN_SPEED = 62;
const DPS_FAN_DIRECTION = 63;
const DPS_BEEP = 66;
const BEEP_SUBTYPE = 'beep';
const FAN_TOGGLE_SUBTYPE = 'fan-toggle';
const LIGHT_TOGGLE_SUBTYPE = 'light-toggle';
const TOGGLE_RESET_MS = 300;

const FAN_SPEED_MIN = 1;
const FAN_SPEED_MAX = 6;

const FAN_DIRECTION_FORWARD = 'forward';
const FAN_DIRECTION_REVERSE = 'reverse';
type FanDirectionDps = typeof FAN_DIRECTION_FORWARD | typeof FAN_DIRECTION_REVERSE;

const isFanDirectionDps = (value: unknown): value is FanDirectionDps =>
  value === FAN_DIRECTION_FORWARD || value === FAN_DIRECTION_REVERSE;

const percentToStep = (percent: number): number =>
  Math.min(FAN_SPEED_MAX, Math.max(FAN_SPEED_MIN, Math.ceil(percent / (100 / FAN_SPEED_MAX))));

const stepToPercent = (step: number): number =>
  Math.round((Math.min(FAN_SPEED_MAX, Math.max(FAN_SPEED_MIN, step)) / FAN_SPEED_MAX) * 100);

export class FanAccessory {
  private readonly fanService: Service;
  private readonly lightService: Service;
  private readonly fanToggleService?: Service;
  private readonly lightToggleService?: Service;
  private readonly Characteristic: typeof Characteristic;
  private readonly log: Logging;
  private readonly tuyaDevice: TuyaDevice;
  private isConnecting = false;
  private isConnected = false;
  private fanState: { Active: 0 | 1; RotationSpeed: number; RotationDirection: 0 | 1 };
  private lightState: { On: boolean; Brightness: number };
  private readonly pendingWrites = new Map<number, { value: DpsPrimitive; timer: NodeJS.Timeout }>();
  private readonly recentWrites = new Map<number, { value: DpsPrimitive; at: number }>();

  constructor(
    private readonly platform: HomebridgeCreateCeilingFan,
    private readonly accessory: PlatformAccessory<PlatformAccessoryContext>,
  ) {
    this.Characteristic = this.platform.Characteristic;
    this.log = this.platform.log;

    // Restore last known state from Homebridge persistent context (survives restarts)
    this.fanState = {
      Active: accessory.context.fanState?.Active ?? 0,
      RotationSpeed: accessory.context.fanState?.RotationSpeed ?? 3,
      RotationDirection: accessory.context.fanState?.RotationDirection ?? 0,
    };
    this.lightState = {
      On: accessory.context.lightState?.On ?? false,
      Brightness: 60,
    };
    delete (accessory.context as { beepState?: unknown }).beepState;

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
    this.fanService.getCharacteristic(this.Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 100 / FAN_SPEED_MAX })
      .onGet(this.getRotationSpeed.bind(this))
      .onSet(this.setRotationSpeed.bind(this));
    this.fanService.getCharacteristic(this.Characteristic.RotationDirection)
      .onGet(this.getRotationDirection.bind(this))
      .onSet(this.setRotationDirection.bind(this));

    // Light
    this.lightService = this.accessory.getService(this.platform.Service.Lightbulb) || this.accessory.addService(this.platform.Service.Lightbulb);
    this.lightService.getCharacteristic(this.Characteristic.On)
      .onGet(this.getLightOn.bind(this))
      .onSet(this.setLightOn.bind(this));

    // Remove legacy Beep switch service from cached accessories — beep is now driven by config
    const legacyBeepSwitch = this.accessory.getServiceById(this.platform.Service.Switch, BEEP_SUBTYPE);
    if (legacyBeepSwitch) {
      this.accessory.removeService(legacyBeepSwitch);
    }

    // Remove legacy Toggle Light switch service (no subtype) from cached accessories
    const legacyToggleSwitches = this.accessory.services.filter(
      service => service.UUID === this.platform.Service.Switch.UUID && !service.subtype,
    );
    for (const legacy of legacyToggleSwitches) {
      this.accessory.removeService(legacy);
    }

    // Momentary toggle switches (default on). Each press inverts the current state then auto-resets to OFF.
    const togglesEnabled = accessory.context.device.toggles !== false;
    if (togglesEnabled) {
      const fanToggleName = `${accessory.context.device.name} Fan Toggle`;
      this.fanToggleService =
        this.accessory.getServiceById(this.platform.Service.Switch, FAN_TOGGLE_SUBTYPE)
        || this.accessory.addService(this.platform.Service.Switch, fanToggleName, FAN_TOGGLE_SUBTYPE);
      this.fanToggleService.setCharacteristic(this.Characteristic.Name, fanToggleName);
      this.fanToggleService.setCharacteristic(this.Characteristic.ConfiguredName, fanToggleName);
      this.fanToggleService.getCharacteristic(this.Characteristic.On)
        .onGet(() => false)
        .onSet(this.handleFanToggle.bind(this));

      const lightToggleName = `${accessory.context.device.name} Light Toggle`;
      this.lightToggleService =
        this.accessory.getServiceById(this.platform.Service.Switch, LIGHT_TOGGLE_SUBTYPE)
        || this.accessory.addService(this.platform.Service.Switch, lightToggleName, LIGHT_TOGGLE_SUBTYPE);
      this.lightToggleService.setCharacteristic(this.Characteristic.Name, lightToggleName);
      this.lightToggleService.setCharacteristic(this.Characteristic.ConfiguredName, lightToggleName);
      this.lightToggleService.getCharacteristic(this.Characteristic.On)
        .onGet(() => false)
        .onSet(this.handleLightToggle.bind(this));
    } else {
      for (const subtype of [FAN_TOGGLE_SUBTYPE, LIGHT_TOGGLE_SUBTYPE]) {
        const stale = this.accessory.getServiceById(this.platform.Service.Switch, subtype);
        if (stale) {
          this.accessory.removeService(stale);
        }
      }
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
      this.applyBeepConfig();
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

  private scheduleCommand(dps: number, value: DpsPrimitive) {
    const existing = this.pendingWrites.get(dps);
    if (existing) {
      clearTimeout(existing.timer);
    }
    const timer = setTimeout(() => {
      this.pendingWrites.delete(dps);
      this.recentWrites.set(dps, { value, at: Date.now() });
      this.log.debug(`${this.accessory.displayName}:`, `sendCommand(${dps}, ${value})`);
      this.tuyaDevice.set({ dps, set: value }).catch(err =>
        this.log.warn(`${this.accessory.displayName}:`, `set dps ${dps} failed -> ${err}`),
      );
    }, WRITE_DEBOUNCE_MS);
    this.pendingWrites.set(dps, { value, timer });
  }

  private shouldIgnoreEcho(dps: number, incoming: DpsPrimitive): boolean {
    const recent = this.recentWrites.get(dps);
    if (!recent) {
      return false;
    }
    if (Date.now() - recent.at > ECHO_SUPPRESS_MS) {
      this.recentWrites.delete(dps);
      return false;
    }
    return recent.value !== incoming;
  }

  private persistState() {
    this.accessory.context.fanState = {
      Active: this.fanState.Active,
      RotationSpeed: this.fanState.RotationSpeed,
      RotationDirection: this.fanState.RotationDirection,
    };
    this.accessory.context.lightState = { On: this.lightState.On };
    this.platform.api.updatePlatformAccessories([this.accessory]);
  }

  private applyBeepConfig() {
    const configured = this.accessory.context.device.beep;
    if (configured === undefined) {
      return;
    }
    this.log.debug(`${this.accessory.displayName}:`, `applying config beep -> ${configured ? 'ON' : 'OFF'}`);
    this.scheduleCommand(DPS_BEEP, configured);
  }

  private applyDps(dps: Record<string, unknown> | undefined) {
    if (!dps) {
      return;
    }
    let changed = false;

    const lightDps = dps[String(DPS_LIGHT)];
    if (typeof lightDps === 'boolean' && !this.shouldIgnoreEcho(DPS_LIGHT, lightDps) && lightDps !== this.lightState.On) {
      this.lightState.On = lightDps;
      this.lightService.updateCharacteristic(this.Characteristic.On, lightDps);
      changed = true;
      this.log.debug(`${this.accessory.displayName}:`, `Tuya -> light ${lightDps ? 'ON' : 'OFF'}`);
    }

    const fanDps = dps[String(DPS_FAN)];
    if (typeof fanDps === 'boolean' && !this.shouldIgnoreEcho(DPS_FAN, fanDps)) {
      const nextActive: 0 | 1 = fanDps ? 1 : 0;
      if (nextActive !== this.fanState.Active) {
        this.fanState.Active = nextActive;
        this.fanService.updateCharacteristic(this.Characteristic.Active, nextActive);
        changed = true;
        this.log.debug(`${this.accessory.displayName}:`, `Tuya -> fan ${nextActive === 1 ? 'ACTIVE' : 'INACTIVE'}`);
      }
    }

    const speedDps = dps[String(DPS_FAN_SPEED)];
    if (typeof speedDps === 'number' && speedDps >= FAN_SPEED_MIN && speedDps <= FAN_SPEED_MAX
        && !this.shouldIgnoreEcho(DPS_FAN_SPEED, speedDps) && speedDps !== this.fanState.RotationSpeed) {
      this.fanState.RotationSpeed = speedDps;
      this.fanService.updateCharacteristic(this.Characteristic.RotationSpeed, stepToPercent(speedDps));
      changed = true;
      this.log.debug(`${this.accessory.displayName}:`, `Tuya -> fan speed ${speedDps}/${FAN_SPEED_MAX}`);
    }

    const directionDps = dps[String(DPS_FAN_DIRECTION)];
    if (isFanDirectionDps(directionDps) && !this.shouldIgnoreEcho(DPS_FAN_DIRECTION, directionDps)) {
      const nextDirection: 0 | 1 = directionDps === FAN_DIRECTION_FORWARD ? 0 : 1;
      if (nextDirection !== this.fanState.RotationDirection) {
        this.fanState.RotationDirection = nextDirection;
        this.fanService.updateCharacteristic(this.Characteristic.RotationDirection, nextDirection);
        changed = true;
        this.log.debug(`${this.accessory.displayName}:`, `Tuya -> fan direction ${directionDps}`);
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
    this.scheduleCommand(DPS_FAN, next === 1);
    this.log.debug(`${this.accessory.displayName}:`, `setFanActivity() => ${next === 0 ? 'INACTIVE' : 'ACTIVE'}`);
  }

  getRotationSpeed() {
    const percent = stepToPercent(this.fanState.RotationSpeed);
    this.log.debug(`${this.accessory.displayName}:`, `getRotationSpeed() => ${percent}% (step ${this.fanState.RotationSpeed}/${FAN_SPEED_MAX})`);
    return percent;
  }

  setRotationSpeed(value: CharacteristicValue) {
    const percent = value as number;
    // iOS Home drives on/off through the Active characteristic — ignore 0 to preserve the last step.
    if (percent <= 0) {
      this.log.debug(`${this.accessory.displayName}:`, 'setRotationSpeed(0%) ignored — Active handles on/off');
      return;
    }
    const step = percentToStep(percent);
    if (step === this.fanState.RotationSpeed) {
      return;
    }
    this.fanState.RotationSpeed = step;
    this.persistState();
    this.scheduleCommand(DPS_FAN_SPEED, step);
    this.log.debug(`${this.accessory.displayName}:`, `setRotationSpeed() => ${percent}% (step ${step}/${FAN_SPEED_MAX})`);
  }

  getRotationDirection() {
    this.log.debug(`${this.accessory.displayName}:`, `getRotationDirection() => ${this.fanState.RotationDirection === 0 ? 'CLOCKWISE' : 'COUNTER_CLOCKWISE'}`);
    return this.fanState.RotationDirection;
  }

  setRotationDirection(value: CharacteristicValue) {
    const next: 0 | 1 = value === this.Characteristic.RotationDirection.COUNTER_CLOCKWISE ? 1 : 0;
    if (next === this.fanState.RotationDirection) {
      return;
    }
    this.fanState.RotationDirection = next;
    this.persistState();
    const dpsValue: FanDirectionDps = next === 0 ? FAN_DIRECTION_FORWARD : FAN_DIRECTION_REVERSE;
    this.scheduleCommand(DPS_FAN_DIRECTION, dpsValue);
    this.log.debug(`${this.accessory.displayName}:`, `setRotationDirection() => ${dpsValue}`);
  }

  getLightOn() {
    this.log.debug(`${this.accessory.displayName}:`, `getLightOn() => ${this.lightState.On ? 'ON' : 'OFF'}`);
    return this.lightState.On;
  }

  setLightOn(value: CharacteristicValue) {
    const next = value as boolean;
    this.lightState.On = next;
    this.persistState();
    this.scheduleCommand(DPS_LIGHT, next);
    this.log.debug(`${this.accessory.displayName}:`, `setLightOn() => ${next ? 'ON' : 'OFF'}`);
  }

  private handleFanToggle(value: CharacteristicValue) {
    if (value !== true) {
      return;
    }
    const next: 0 | 1 = this.fanState.Active === 1 ? 0 : 1;
    this.log.debug(`${this.accessory.displayName}:`, `handleFanToggle() => ${this.fanState.Active} -> ${next}`);
    this.setFanActivity(next === 1 ? this.Characteristic.Active.ACTIVE : this.Characteristic.Active.INACTIVE);
    this.fanService.updateCharacteristic(this.Characteristic.Active, next);
    setTimeout(() => {
      this.fanToggleService?.updateCharacteristic(this.Characteristic.On, false);
    }, TOGGLE_RESET_MS);
  }

  private handleLightToggle(value: CharacteristicValue) {
    if (value !== true) {
      return;
    }
    const next = !this.lightState.On;
    this.log.debug(`${this.accessory.displayName}:`, `handleLightToggle() => ${this.lightState.On} -> ${next}`);
    this.setLightOn(next);
    this.lightService.updateCharacteristic(this.Characteristic.On, next);
    setTimeout(() => {
      this.lightToggleService?.updateCharacteristic(this.Characteristic.On, false);
    }, TOGGLE_RESET_MS);
  }

}

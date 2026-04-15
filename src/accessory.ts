import { Characteristic, CharacteristicValue, type Logging, PlatformAccessory, Service } from 'homebridge';
import { HomebridgeCreateCeilingFan, PlatformAccessoryContext } from './platform.js';
import type TuyaDevice from 'tuyapi';
import TuyAPI from 'tuyapi';

type DpsPrimitive = string | number | boolean;

const WRITE_DEBOUNCE_MS = 250;
const ECHO_SUPPRESS_MS = 1500;
const TOGGLE_RESET_MS = 500;
const RECONNECT_BACKOFF_MS = [5_000, 10_000, 30_000, 60_000] as const;

const DPS_LIGHT = 20;
const DPS_FAN = 60;
const DPS_FAN_SPEED = 62;
const DPS_FAN_DIRECTION = 63;
const FAN_TOGGLE_SUBTYPE = 'fan-toggle';
const LIGHT_TOGGLE_SUBTYPE = 'light-toggle';

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
  private reconnectTimer?: NodeJS.Timeout;
  private reconnectAttempts = 0;
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

    this.log.info(`${accessory.displayName}:`, 'Init...');

    // Information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, 'CREATE')
      .setCharacteristic(this.Characteristic.Model, 'Ceiling Fan')
      .setCharacteristic(this.Characteristic.Name, accessory.context.device.name)
      .setCharacteristic(this.Characteristic.SerialNumber, accessory.context.device.id);

    // Fan (main service: explicit no-subtype filter to avoid collision with the Fanv2 toggle)
    this.fanService = this.accessory.services.find(
      service => service.UUID === this.platform.Service.Fanv2.UUID && !service.subtype,
    ) ?? this.accessory.addService(this.platform.Service.Fanv2);
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

    // Light (main service: explicit no-subtype filter to avoid collision with the Lightbulb toggle)
    this.lightService = this.accessory.services.find(
      service => service.UUID === this.platform.Service.Lightbulb.UUID && !service.subtype,
    ) ?? this.accessory.addService(this.platform.Service.Lightbulb);
    this.lightService.getCharacteristic(this.Characteristic.On)
      .onGet(this.getLightOn.bind(this))
      .onSet(this.setLightOn.bind(this));

    // Remove legacy Toggle Light switch service (no subtype) from cached accessories
    const legacyToggleSwitches = this.accessory.services.filter(
      service => service.UUID === this.platform.Service.Switch.UUID && !service.subtype,
    );
    for (const legacy of legacyToggleSwitches) {
      this.accessory.removeService(legacy);
    }

    // Legacy cleanup: drop previous toggle services (v2.0.16/v2.0.20 Switch, v2.0.19 StatelessProgrammableSwitch)
    const legacyToggleTypes = [
      this.platform.Service.Switch.UUID,
      this.platform.Service.StatelessProgrammableSwitch.UUID,
    ];
    for (const legacy of this.accessory.services.filter(
      service => legacyToggleTypes.includes(service.UUID)
        && (service.subtype === FAN_TOGGLE_SUBTYPE || service.subtype === LIGHT_TOGGLE_SUBTYPE),
    )) {
      this.accessory.removeService(legacy);
    }

    // Momentary toggle tiles: a secondary Fanv2 (fan icon) and Lightbulb (bulb icon).
    // Tap in Home (or trigger from an automation) -> flips the underlying fan/light state,
    // then auto-resets the tile after a short delay.
    const togglesEnabled = accessory.context.device.toggles !== false;
    if (togglesEnabled) {
      this.fanToggleService =
        this.accessory.getServiceById(this.platform.Service.Fanv2, FAN_TOGGLE_SUBTYPE)
        || this.accessory.addService(this.platform.Service.Fanv2, 'Toggle', FAN_TOGGLE_SUBTYPE);
      this.fanToggleService.setCharacteristic(this.Characteristic.Name, 'Toggle');
      this.fanToggleService.getCharacteristic(this.Characteristic.Active)
        .onGet(() => 0 as 0 | 1)
        .onSet(this.onFanToggle.bind(this));

      this.lightToggleService =
        this.accessory.getServiceById(this.platform.Service.Lightbulb, LIGHT_TOGGLE_SUBTYPE)
        || this.accessory.addService(this.platform.Service.Lightbulb, 'Toggle', LIGHT_TOGGLE_SUBTYPE);
      this.lightToggleService.setCharacteristic(this.Characteristic.Name, 'Toggle');
      this.lightToggleService.getCharacteristic(this.Characteristic.On)
        .onGet(() => false)
        .onSet(this.onLightToggle.bind(this));
    } else {
      const fanStale = this.accessory.getServiceById(this.platform.Service.Fanv2, FAN_TOGGLE_SUBTYPE);
      if (fanStale) {
        this.accessory.removeService(fanStale);
      }
      const lightStale = this.accessory.getServiceById(this.platform.Service.Lightbulb, LIGHT_TOGGLE_SUBTYPE);
      if (lightStale) {
        this.accessory.removeService(lightStale);
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
      this.scheduleReconnect();
    });
    this.tuyaDevice.on('connected', () => {
      this.log.info(`${this.accessory.displayName}:`,'Connected!');
      this.isConnected = true;
      this.reconnectAttempts = 0;
      if (this.reconnectTimer) {
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
      }
    });
    this.tuyaDevice.on('error', error => {
      this.log.warn(`${this.accessory.displayName}:`, `Error -> ${error.toString()}`);
      this.isConnected = false;
      this.scheduleReconnect();
    });
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
    try {
      await this.tuyaDevice.find();
      await this.tuyaDevice.connect();
    } catch (err) {
      this.log.warn(`${this.accessory.displayName}:`, `connect failed -> ${err}`);
      this.scheduleReconnect();
    } finally {
      this.isConnecting = false;
    }
  }

  private scheduleReconnect() {
    if (this.isConnected || this.isConnecting || this.reconnectTimer) {
      return;
    }
    const delay = RECONNECT_BACKOFF_MS[Math.min(this.reconnectAttempts, RECONNECT_BACKOFF_MS.length - 1)];
    this.reconnectAttempts += 1;
    this.log.info(
      `${this.accessory.displayName}:`,
      `Reconnect scheduled in ${delay / 1000}s (attempt ${this.reconnectAttempts})`,
    );
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.connect();
    }, delay);
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

  private onFanToggle(value: CharacteristicValue) {
    if (!value) {
      return;
    }
    const next: 0 | 1 = this.fanState.Active === 1 ? 0 : 1;
    this.fanState.Active = next;
    this.persistState();
    this.scheduleCommand(DPS_FAN, next === 1);
    this.fanService.updateCharacteristic(this.Characteristic.Active, next);
    this.log.debug(`${this.accessory.displayName}:`, `onFanToggle() => ${next === 1 ? 'ACTIVE' : 'INACTIVE'}`);
    setTimeout(() => {
      this.fanToggleService?.updateCharacteristic(this.Characteristic.Active, 0);
    }, TOGGLE_RESET_MS);
  }

  private onLightToggle(value: CharacteristicValue) {
    if (!value) {
      return;
    }
    const next = !this.lightState.On;
    this.lightState.On = next;
    this.persistState();
    this.scheduleCommand(DPS_LIGHT, next);
    this.lightService.updateCharacteristic(this.Characteristic.On, next);
    this.log.debug(`${this.accessory.displayName}:`, `onLightToggle() => ${next ? 'ON' : 'OFF'}`);
    setTimeout(() => {
      this.lightToggleService?.updateCharacteristic(this.Characteristic.On, false);
    }, TOGGLE_RESET_MS);
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

}

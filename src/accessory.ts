import { Characteristic, CharacteristicValue, type Logging, PlatformAccessory, Service, type WithUUID } from 'homebridge';
import { HomebridgeCreateCeilingFan, PlatformAccessoryContext } from './platform.js';
import type TuyaDevice from 'tuyapi';
import TuyAPI from 'tuyapi';
import { TuyaConnection } from './connection.js';
import { DEFAULT_PROTOCOL_VERSION } from './config.js';
import { type DpsPrimitive, isEchoExpired, type RecentWrite, shouldIgnoreEcho } from './echo.js';
import { FAN_SPEED_MAX, FAN_SPEED_MIN, percentToStep, SPEED_STEP_PERCENT, stepToPercent } from './speed.js';

const WRITE_DEBOUNCE_MS = 250;
const TOGGLE_RESET_MS = 500;
// Persisting the accessory cache rewrites the whole cachedAccessories file:
// batch the bursts of state changes (slider drags, toggles…).
const PERSIST_DEBOUNCE_MS = 1000;

const DPS_LIGHT = 20;
const DPS_FAN = 60;
const DPS_FAN_SPEED = 62;
const DPS_FAN_DIRECTION = 63;
const FAN_TOGGLE_SUBTYPE = 'fan-toggle';
const LIGHT_TOGGLE_SUBTYPE = 'light-toggle';
const FAN_SPEED_UP_SUBTYPE = 'fan-speed-up';
const FAN_SPEED_DOWN_SUBTYPE = 'fan-speed-down';

const FAN_DIRECTION_FORWARD = 'forward';
const FAN_DIRECTION_REVERSE = 'reverse';
type FanDirectionDps = typeof FAN_DIRECTION_FORWARD | typeof FAN_DIRECTION_REVERSE;

const isFanDirectionDps = (value: unknown): value is FanDirectionDps =>
  value === FAN_DIRECTION_FORWARD || value === FAN_DIRECTION_REVERSE;

export class FanAccessory {
  private readonly fanService: Service;
  private readonly lightService?: Service;
  private readonly fanToggleService?: Service;
  private readonly lightToggleService?: Service;
  private readonly fanSpeedUpService?: Service;
  private readonly fanSpeedDownService?: Service;
  private readonly Characteristic: typeof Characteristic;
  private readonly log: Logging;
  private readonly tuyaDevice: TuyaDevice;
  private readonly connection: TuyaConnection;
  private fanState: { Active: 0 | 1; RotationSpeed: number; RotationDirection: 0 | 1 };
  private lightState: { On: boolean };
  private readonly pendingWrites = new Map<number, { value: DpsPrimitive; timer: NodeJS.Timeout }>();
  private readonly recentWrites = new Map<number, RecentWrite>();
  private readonly tileResetTimers = new Set<NodeJS.Timeout>();
  private persistTimer?: NodeJS.Timeout;
  // Latest desired value per dps that could not be sent because the socket was
  // down. Flushed once the device reconnects. Calling tuyaDevice.set() while
  // disconnected makes tuyapi auto-connect *outside* our backoff, which feeds
  // the reconnect war and produces 'Timeout waiting for status response'.
  private readonly queuedWrites = new Map<number, DpsPrimitive>();

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
      .setProps({ minValue: 0, maxValue: 100, minStep: SPEED_STEP_PERCENT })
      .onGet(this.getRotationSpeed.bind(this))
      .onSet(this.setRotationSpeed.bind(this));
    this.fanService.getCharacteristic(this.Characteristic.RotationDirection)
      .onGet(this.getRotationDirection.bind(this))
      .onSet(this.setRotationDirection.bind(this));

    // Light (main service: explicit no-subtype filter to avoid collision with the Lightbulb toggle)
    // Fans without a light can hide the tile with `light: false`.
    const lightEnabled = accessory.context.device.light !== false;
    const existingLight = this.accessory.services.find(
      service => service.UUID === this.platform.Service.Lightbulb.UUID && !service.subtype,
    );
    if (lightEnabled) {
      this.lightService = existingLight ?? this.accessory.addService(this.platform.Service.Lightbulb);
      this.lightService.getCharacteristic(this.Characteristic.On)
        .onGet(this.getLightOn.bind(this))
        .onSet(this.setLightOn.bind(this));
    } else if (existingLight) {
      // Remove a previously exposed light from cached accessories.
      this.accessory.removeService(existingLight);
    }

    this.removeLegacyServices();

    // Momentary toggle tiles: a secondary Fanv2 (fan icon) and Lightbulb (bulb icon).
    // Tap in Home (or trigger from an automation) -> flips the underlying fan/light state,
    // then auto-resets the tile after a short delay.
    const togglesEnabled = accessory.context.device.toggles !== false;
    this.fanToggleService = this.ensureService(this.platform.Service.Fanv2, FAN_TOGGLE_SUBTYPE, 'Toggle', togglesEnabled);
    this.fanToggleService?.getCharacteristic(this.Characteristic.Active)
      .onGet(() => 0 as 0 | 1)
      .onSet(this.onFanToggle.bind(this));
    this.lightToggleService = this.ensureService(
      this.platform.Service.Lightbulb, LIGHT_TOGGLE_SUBTYPE, 'Toggle', togglesEnabled && lightEnabled,
    );
    this.lightToggleService?.getCharacteristic(this.Characteristic.On)
      .onGet(() => false)
      .onSet(this.onLightToggle.bind(this));

    // Speed step tiles: two secondary Fanv2 services (fan-speed-up, fan-speed-down).
    // Tap in Home (or trigger from an automation) -> bumps the fan speed by one step.
    // Speed Up powers the fan on from OFF; Speed Down powers it off when already at step 1.
    const speedButtonsEnabled = accessory.context.device.speedButtons !== false;
    this.fanSpeedUpService = this.ensureService(this.platform.Service.Fanv2, FAN_SPEED_UP_SUBTYPE, 'Speed Up', speedButtonsEnabled);
    this.fanSpeedUpService?.getCharacteristic(this.Characteristic.Active)
      .onGet(() => 0 as 0 | 1)
      .onSet(this.onSpeedUp.bind(this));
    this.fanSpeedDownService = this.ensureService(
      this.platform.Service.Fanv2, FAN_SPEED_DOWN_SUBTYPE, 'Speed Down', speedButtonsEnabled,
    );
    this.fanSpeedDownService?.getCharacteristic(this.Characteristic.Active)
      .onGet(() => 0 as 0 | 1)
      .onSet(this.onSpeedDown.bind(this));

    this.tuyaDevice = new TuyAPI({
      id: accessory.context.device.id,
      key: accessory.context.device.key,
      ip: accessory.context.device.ip,
      version: String(accessory.context.device.version ?? DEFAULT_PROTOCOL_VERSION),
      issueRefreshOnConnect: true,
    });
    this.connection = new TuyaConnection(this.tuyaDevice, this.log, {
      name: accessory.displayName,
      onConnected: () => this.flushQueuedWrites(),
    });
    this.tuyaDevice.on('connected', () => this.connection.handleConnected());
    this.tuyaDevice.on('disconnected', () => this.connection.handleDisconnected());
    this.tuyaDevice.on('error', (error: unknown) => this.connection.handleError(error));
    this.tuyaDevice.on('data', data => this.applyDps(data?.dps));
    this.tuyaDevice.on('dp-refresh', data => this.applyDps(data?.dps));
    void this.connection.connect();
  }

  /** Stops every timer and closes the Tuya socket. Called on Homebridge shutdown. */
  dispose() {
    this.connection.dispose();
    for (const { timer } of this.pendingWrites.values()) {
      clearTimeout(timer);
    }
    this.pendingWrites.clear();
    for (const timer of this.tileResetTimers) {
      clearTimeout(timer);
    }
    this.tileResetTimers.clear();
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = undefined;
      this.platform.api.updatePlatformAccessories([this.accessory]);
    }
  }

  /**
   * Returns the secondary service `subtype`, creating it when `enabled`, or
   * removes it from the (cached) accessory when disabled.
   */
  private ensureService(type: WithUUID<typeof Service>, subtype: string, name: string, enabled: boolean): Service | undefined {
    const existing = this.accessory.getServiceById(type, subtype);
    if (!enabled) {
      if (existing) {
        this.accessory.removeService(existing);
      }
      return undefined;
    }
    const service = existing ?? this.accessory.addService(type, name, subtype);
    service.setCharacteristic(this.Characteristic.Name, name);
    return service;
  }

  private removeLegacyServices() {
    // Legacy Toggle Light switch service (no subtype),
    // toggles from v2.0.16/v2.0.20 (Switch) and v2.0.19 (StatelessProgrammableSwitch).
    const legacyToggleTypes = [
      this.platform.Service.Switch.UUID,
      this.platform.Service.StatelessProgrammableSwitch.UUID,
    ];
    for (const legacy of this.accessory.services.filter(
      service => (service.UUID === this.platform.Service.Switch.UUID && !service.subtype)
        || (legacyToggleTypes.includes(service.UUID)
          && (service.subtype === FAN_TOGGLE_SUBTYPE || service.subtype === LIGHT_TOGGLE_SUBTYPE)),
    )) {
      this.accessory.removeService(legacy);
    }
  }

  private resetTileLater(reset: () => void) {
    const timer = setTimeout(() => {
      this.tileResetTimers.delete(timer);
      reset();
    }, TOGGLE_RESET_MS);
    this.tileResetTimers.add(timer);
  }

  private scheduleCommand(dps: number, value: DpsPrimitive) {
    const existing = this.pendingWrites.get(dps);
    if (existing) {
      clearTimeout(existing.timer);
    }
    const timer = setTimeout(() => {
      this.pendingWrites.delete(dps);
      if (!this.connection.isConnected) {
        // Don't let tuyapi auto-connect outside our backoff. Keep the latest
        // desired value and flush it once 'connected' fires. HomeKit already
        // shows the optimistic state from the onSet handler.
        this.queuedWrites.set(dps, value);
        this.log.debug(`${this.accessory.displayName}:`, `queued dps ${dps}=${value} until reconnect`);
        return;
      }
      this.sendCommand(dps, value);
    }, WRITE_DEBOUNCE_MS);
    this.pendingWrites.set(dps, { value, timer });
  }

  private sendCommand(dps: number, value: DpsPrimitive) {
    this.recentWrites.set(dps, { value, at: Date.now() });
    this.log.debug(`${this.accessory.displayName}:`, `sendCommand(${dps}, ${value})`);
    this.tuyaDevice.set({ dps, set: value }).catch(err => {
      // The socket dropped between the connection check and the write. Re-queue
      // so the value is flushed on the next reconnect instead of being lost.
      if (!this.connection.isConnected) {
        this.queuedWrites.set(dps, value);
      }
      this.log.warn(`${this.accessory.displayName}:`, `set dps ${dps} failed -> ${err}`);
    });
  }

  private flushQueuedWrites() {
    if (this.queuedWrites.size === 0) {
      return;
    }
    const queued = [...this.queuedWrites];
    this.queuedWrites.clear();
    this.log.debug(`${this.accessory.displayName}:`, `flushing ${queued.length} queued write(s)`);
    for (const [dps, value] of queued) {
      this.sendCommand(dps, value);
    }
  }

  private shouldIgnoreEcho(dps: number, incoming: DpsPrimitive): boolean {
    const now = Date.now();
    const recent = this.recentWrites.get(dps);
    if (recent && isEchoExpired(recent, now)) {
      this.recentWrites.delete(dps);
    }
    return shouldIgnoreEcho(this.recentWrites.get(dps), incoming, now);
  }

  private persistState() {
    // The context is updated right away (Homebridge also saves it on
    // shutdown); only the disk write is batched.
    this.accessory.context.fanState = {
      Active: this.fanState.Active,
      RotationSpeed: this.fanState.RotationSpeed,
      RotationDirection: this.fanState.RotationDirection,
    };
    this.accessory.context.lightState = { On: this.lightState.On };
    if (this.persistTimer) {
      return;
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = undefined;
      this.platform.api.updatePlatformAccessories([this.accessory]);
    }, PERSIST_DEBOUNCE_MS);
  }

  private applyDps(dps: Record<string, unknown> | undefined) {
    if (!dps) {
      return;
    }
    let changed = false;

    const lightDps = dps[String(DPS_LIGHT)];
    if (typeof lightDps === 'boolean' && !this.shouldIgnoreEcho(DPS_LIGHT, lightDps) && lightDps !== this.lightState.On) {
      this.lightState.On = lightDps;
      this.lightService?.updateCharacteristic(this.Characteristic.On, lightDps);
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

  // Momentary tile handlers: accept BOTH Active=1 (tap when tile OFF) AND Active=0 (tap when tile
  // ON before the auto-reset has propagated). Filtering out value=0 caused rapid taps to appear as
  // "first tap turns on, second tap turns off" with no underlying action. updateCharacteristic()
  // does not invoke onSet, so the scheduled reset cannot re-enter these handlers.

  private onFanToggle() {
    const next: 0 | 1 = this.fanState.Active === 1 ? 0 : 1;
    this.fanState.Active = next;
    this.persistState();
    this.scheduleCommand(DPS_FAN, next === 1);
    this.fanService.updateCharacteristic(this.Characteristic.Active, next);
    this.log.debug(`${this.accessory.displayName}:`, `onFanToggle() => ${next === 1 ? 'ACTIVE' : 'INACTIVE'}`);
    this.resetTileLater(() => this.fanToggleService?.updateCharacteristic(this.Characteristic.Active, 0));
  }

  private onLightToggle() {
    const next = !this.lightState.On;
    this.lightState.On = next;
    this.persistState();
    this.scheduleCommand(DPS_LIGHT, next);
    this.lightService?.updateCharacteristic(this.Characteristic.On, next);
    this.log.debug(`${this.accessory.displayName}:`, `onLightToggle() => ${next ? 'ON' : 'OFF'}`);
    this.resetTileLater(() => this.lightToggleService?.updateCharacteristic(this.Characteristic.On, false));
  }

  private onSpeedUp() {
    try {
      if (this.fanState.Active === 0) {
        // Fan OFF -> turn it ON at step 1
        this.fanState.Active = 1;
        this.fanState.RotationSpeed = FAN_SPEED_MIN;
        this.persistState();
        this.scheduleCommand(DPS_FAN, true);
        this.scheduleCommand(DPS_FAN_SPEED, FAN_SPEED_MIN);
        this.fanService.updateCharacteristic(this.Characteristic.Active, 1);
        this.fanService.updateCharacteristic(this.Characteristic.RotationSpeed, stepToPercent(FAN_SPEED_MIN));
        this.log.debug(`${this.accessory.displayName}:`, `onSpeedUp() => fan ON at step ${FAN_SPEED_MIN}/${FAN_SPEED_MAX}`);
        return;
      }
      if (this.fanState.RotationSpeed >= FAN_SPEED_MAX) {
        this.log.debug(`${this.accessory.displayName}:`, 'onSpeedUp() already at max');
        return;
      }
      const step = this.fanState.RotationSpeed + 1;
      this.fanState.RotationSpeed = step;
      this.persistState();
      this.scheduleCommand(DPS_FAN_SPEED, step);
      this.fanService.updateCharacteristic(this.Characteristic.RotationSpeed, stepToPercent(step));
      this.log.debug(`${this.accessory.displayName}:`, `onSpeedUp() => step ${step}/${FAN_SPEED_MAX}`);
    } finally {
      this.resetTileLater(() => this.fanSpeedUpService?.updateCharacteristic(this.Characteristic.Active, 0));
    }
  }

  private onSpeedDown() {
    try {
      if (this.fanState.Active === 0) {
        this.log.debug(`${this.accessory.displayName}:`, 'onSpeedDown() fan off, no-op');
        return;
      }
      if (this.fanState.RotationSpeed <= FAN_SPEED_MIN) {
        // Already at min step -> turn the fan OFF (symmetric with Speed Up turning it ON from OFF).
        // Keep RotationSpeed at FAN_SPEED_MIN so the next Speed Up resumes at step 1.
        this.fanState.Active = 0;
        this.persistState();
        this.scheduleCommand(DPS_FAN, false);
        this.fanService.updateCharacteristic(this.Characteristic.Active, 0);
        this.log.debug(`${this.accessory.displayName}:`, 'onSpeedDown() at min => fan OFF');
        return;
      }
      const step = this.fanState.RotationSpeed - 1;
      this.fanState.RotationSpeed = step;
      this.persistState();
      this.scheduleCommand(DPS_FAN_SPEED, step);
      this.fanService.updateCharacteristic(this.Characteristic.RotationSpeed, stepToPercent(step));
      this.log.debug(`${this.accessory.displayName}:`, `onSpeedDown() => step ${step}/${FAN_SPEED_MAX}`);
    } finally {
      this.resetTileLater(() => this.fanSpeedDownService?.updateCharacteristic(this.Characteristic.Active, 0));
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

}

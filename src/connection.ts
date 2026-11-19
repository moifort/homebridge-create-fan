import { errorMessage, isPacketDecodeError, isWrongKeyError } from './tuya-errors.js';

export const RECONNECT_BACKOFF_MS = [5_000, 10_000, 30_000, 60_000, 120_000] as const;
// Randomised +/- fraction added to each backoff delay. Tuya devices accept a
// single local TCP connection: when a second client (a stray Homebridge
// instance, Home Assistant, the Tuya cloud keep-alive...) reconnects, the fan
// RSTs ours, we reconnect and RST theirs, and so on. Without jitter both
// clients retry in lockstep and the war never ends. Jitter desynchronises the
// two so one side wins the connection and holds it.
export const RECONNECT_JITTER = 0.3;
// A connection must stay up this long before we consider it stable and reset
// the backoff. Tuya devices that flap (handshake OK -> immediate RST) would
// otherwise reset the counter on every brief 'connected' event, turning the
// exponential backoff into a tight 5s loop.
export const STABLE_CONNECTION_MS = 30_000;
// Reconnect attempts after the first one are logged at debug level; a single
// warning is emitted once the fan has been unreachable for this long.
export const OFFLINE_WARNING_MS = 5 * 60_000;

/** Delay before reconnect attempt `attempt` (0-based), with jitter. `random` returns [0, 1). */
export const reconnectDelay = (attempt: number, random: () => number = Math.random): number => {
  const base = RECONNECT_BACKOFF_MS[Math.min(Math.max(0, attempt), RECONNECT_BACKOFF_MS.length - 1)];
  return Math.round(base * (1 + RECONNECT_JITTER * (random() * 2 - 1)));
};

/** The subset of tuyapi's TuyaDevice used to manage the connection. */
export interface ConnectableDevice {
  connect(): Promise<unknown>;
  disconnect(): void;
  isConnected(): boolean;
}

export interface ConnectionLogger {
  debug(message: string, ...parameters: unknown[]): void;
  info(message: string, ...parameters: unknown[]): void;
  warn(message: string, ...parameters: unknown[]): void;
  error(message: string, ...parameters: unknown[]): void;
}

export interface ConnectionOptions {
  /** Prefix for every log line (the accessory name). */
  name: string;
  /** Called each time the connection comes up, e.g. to flush queued writes. */
  onConnected?: () => void;
  random?: () => number;
  now?: () => number;
}

/**
 * Keeps one tuyapi device connected: reconnects with jittered exponential
 * backoff and tracks the connection state.
 *
 * tuyapi emits 'error' for many non-fatal conditions (a malformed packet,
 * 'Timeout waiting for status response' as a plain string…) without closing
 * the socket, while real socket failures are always followed by
 * 'disconnected'. The state is therefore never flipped by an error: it is
 * only resynced with tuyapi's own view (device.isConnected()). Flipping it
 * while the socket was still open used to leave the accessory offline for
 * good, because device.connect() then resolves immediately without emitting
 * 'connected'.
 */
export class TuyaConnection {
  private connected = false;
  private connecting = false;
  private disposed = false;
  private attempts = 0;
  private reconnectTimer?: NodeJS.Timeout;
  private stabilityTimer?: NodeJS.Timeout;
  private offlineSince?: number;
  private offlineWarned = false;
  // A visible "Disconnected" / "connect failed" line was logged: the next
  // "Connected!" is logged visibly too, so the recovery is never hidden.
  private offlineAnnounced = false;
  private readonly random: () => number;
  private readonly now: () => number;

  constructor(
    private readonly device: ConnectableDevice,
    private readonly log: ConnectionLogger,
    private readonly options: ConnectionOptions,
  ) {
    this.random = options.random ?? Math.random;
    this.now = options.now ?? Date.now;
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get reconnectAttempts(): number {
    return this.attempts;
  }

  get isReconnectScheduled(): boolean {
    return this.reconnectTimer !== undefined;
  }

  async connect(): Promise<void> {
    if (this.disposed || this.connecting || this.connected) {
      return;
    }
    this.connecting = true;
    this.logNoisy('Connecting...');
    try {
      await this.device.connect();
    } catch (err) {
      // A wrong key is already reported by handleError().
      if (!isWrongKeyError(err)) {
        this.offlineAnnounced ||= this.logNoisy(`connect failed -> ${errorMessage(err)}`, 'warn');
      }
    } finally {
      this.connecting = false;
    }
    if (this.disposed) {
      return;
    }
    this.syncState();
    if (!this.connected) {
      this.scheduleReconnect();
    }
  }

  /** Wire to tuyapi's 'connected' event. */
  handleConnected() {
    if (!this.disposed) {
      this.markConnected();
    }
  }

  /** Wire to tuyapi's 'disconnected' event. */
  handleDisconnected() {
    if (!this.disposed) {
      this.markDisconnected();
    }
  }

  /** Wire to tuyapi's 'error' event. Never changes the state by itself. */
  handleError(error: unknown) {
    if (isWrongKeyError(error)) {
      this.log.error(
        this.prefix,
        'Wrong local key: the fan rejected the session handshake (HMAC mismatch). '
        + 'Check the "key" field in the plugin config (it changes every time the fan is re-paired in the app).',
      );
    } else if (isPacketDecodeError(error)) {
      this.log.debug(this.prefix, `Ignored malformed packet -> ${errorMessage(error)}`);
    } else if (this.connected) {
      this.log.warn(this.prefix, `Error -> ${errorMessage(error)}`);
    } else {
      // Socket errors while (re)connecting repeat on every attempt.
      this.logNoisy(`Error -> ${errorMessage(error)}`, 'warn');
    }
    if (!this.disposed) {
      this.syncState();
    }
  }

  /** Stops reconnecting and closes the socket. Call on Homebridge shutdown. */
  dispose() {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    this.cancelStabilityTimer();
    this.connected = false;
    if (this.device.isConnected()) {
      this.device.disconnect();
    }
  }

  private get prefix() {
    return `${this.options.name}:`;
  }

  /**
   * Logs at `level` until `visibleAttempts` reconnect attempts have been made
   * since the last stable connection, then at debug level, so a reconnect war
   * does not flood the logs.
   */
  private logNoisy(message: string, level: 'info' | 'warn' = 'info', visibleAttempts = 0): boolean {
    const visible = this.attempts <= visibleAttempts;
    if (visible) {
      this.log[level](this.prefix, message);
    } else {
      this.log.debug(this.prefix, message);
    }
    return visible;
  }

  private syncState() {
    const actual = this.device.isConnected();
    if (actual === this.connected) {
      return;
    }
    if (actual) {
      this.markConnected();
    } else {
      this.markDisconnected();
    }
  }

  private markConnected() {
    if (this.connected) {
      return;
    }
    this.connected = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
    if (this.offlineWarned && this.offlineSince !== undefined) {
      this.log.info(this.prefix, `Back online after ${this.formatDuration(this.now() - this.offlineSince)}`);
    } else if (this.offlineAnnounced) {
      this.log.info(this.prefix, 'Connected!');
    } else {
      this.logNoisy('Connected!');
    }
    this.offlineSince = undefined;
    this.offlineWarned = false;
    this.offlineAnnounced = false;
    this.options.onConnected?.();
    // Don't reset the backoff yet — the device may RST in the next few ms.
    this.cancelStabilityTimer();
    this.stabilityTimer = setTimeout(() => {
      this.stabilityTimer = undefined;
      if (this.attempts > 0) {
        this.log.debug(this.prefix, `Connection stable for ${STABLE_CONNECTION_MS / 1000}s — backoff reset`);
      }
      this.attempts = 0;
    }, STABLE_CONNECTION_MS);
  }

  private markDisconnected() {
    const wasConnected = this.connected;
    this.connected = false;
    this.cancelStabilityTimer();
    if (wasConnected) {
      this.offlineAnnounced ||= this.logNoisy('Disconnected');
    }
    this.scheduleReconnect();
  }

  private scheduleReconnect() {
    if (this.disposed || this.connected || this.connecting || this.reconnectTimer) {
      return;
    }
    this.offlineSince ??= this.now();
    const delay = reconnectDelay(this.attempts, this.random);
    this.logNoisy(`Reconnect scheduled in ${(delay / 1000).toFixed(1)}s (attempt ${this.attempts + 1})`);
    this.attempts += 1;
    const offlineFor = this.now() - this.offlineSince;
    if (!this.offlineWarned && offlineFor >= OFFLINE_WARNING_MS) {
      this.offlineWarned = true;
      this.log.warn(
        this.prefix,
        `Unreachable for ${this.formatDuration(offlineFor)}, still retrying in the background (attempt ${this.attempts}). `
        + 'Enable debug logs to see every attempt.',
      );
    }
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connect();
    }, delay);
  }

  private cancelStabilityTimer() {
    if (this.stabilityTimer) {
      clearTimeout(this.stabilityTimer);
      this.stabilityTimer = undefined;
    }
  }

  private formatDuration(ms: number): string {
    const minutes = Math.round(ms / 60_000);
    return minutes >= 1 ? `${minutes} min` : `${Math.round(ms / 1000)} s`;
  }
}

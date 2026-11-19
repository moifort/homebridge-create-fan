import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it, mock } from 'node:test';
import {
  type ConnectableDevice,
  OFFLINE_WARNING_MS,
  RECONNECT_BACKOFF_MS,
  reconnectDelay,
  STABLE_CONNECTION_MS,
  TuyaConnection,
} from '../dist/connection.js';

/** Mimics tuyapi: connect() resolves without emitting anything when the socket is already open. */
class FakeDevice implements ConnectableDevice {
  open = false;
  connectCalls = 0;
  failNextConnects = 0;
  connection?: TuyaConnection;

  async connect() {
    this.connectCalls += 1;
    if (this.open) {
      return true;
    }
    if (this.failNextConnects > 0) {
      this.failNextConnects -= 1;
      throw new Error('connection timed out');
    }
    this.open = true;
    this.connection?.handleConnected();
    return true;
  }

  disconnect() {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.connection?.handleDisconnected();
  }

  isConnected() {
    return this.open;
  }
}

const createLogger = () => {
  const lines: { level: string; message: string }[] = [];
  const record = (level: string) => (...args: unknown[]) => {
    lines.push({ level, message: args.map(String).join(' ') });
  };
  return { lines, logger: { debug: record('debug'), info: record('info'), warn: record('warn'), error: record('error') } };
};

const setup = (options: { now?: () => number } = {}) => {
  const device = new FakeDevice();
  const { lines, logger } = createLogger();
  let flushes = 0;
  const connection = new TuyaConnection(device, logger, {
    name: 'Fan',
    onConnected: () => {
      flushes += 1;
    },
    random: () => 0.5,
    ...options,
  });
  device.connection = connection;
  return { device, connection, lines, flushes: () => flushes };
};

describe('reconnectDelay', () => {
  it('follows the backoff table and caps at the last value', () => {
    assert.equal(reconnectDelay(0, () => 0.5), RECONNECT_BACKOFF_MS[0]);
    assert.equal(reconnectDelay(2, () => 0.5), RECONNECT_BACKOFF_MS[2]);
    assert.equal(reconnectDelay(99, () => 0.5), RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1]);
  });

  it('applies at most ±30 % jitter', () => {
    assert.equal(reconnectDelay(0, () => 0), 3_500);
    assert.equal(reconnectDelay(0, () => 1), 6_500);
  });
});

describe('TuyaConnection', () => {
  beforeEach(() => {
    mock.timers.enable({ apis: ['setTimeout'] });
  });

  afterEach(() => {
    mock.timers.reset();
  });

  it('connects and flushes queued writes', async () => {
    const { connection, flushes } = setup();
    await connection.connect();
    assert.equal(connection.isConnected, true);
    assert.equal(flushes(), 1);
    connection.dispose();
  });

  it('a string error from tuyapi does not mark the connection down (B2)', async () => {
    const { device, connection } = setup();
    await connection.connect();

    connection.handleError('Timeout waiting for status response from device id: abc');
    connection.handleError('json obj data unvalid');

    assert.equal(connection.isConnected, true);
    assert.equal(connection.isReconnectScheduled, false);
    assert.equal(device.open, true);
    connection.dispose();
  });

  it('resyncs with tuyapi when connect() resolves without emitting "connected" (B2)', async () => {
    const { device, connection, flushes } = setup();
    // Socket already open on tuyapi's side, but we never saw 'connected'.
    device.open = true;
    await connection.connect();

    assert.equal(connection.isConnected, true);
    assert.equal(flushes(), 1);
    connection.dispose();
  });

  it('reconnects with backoff after a real disconnect', async () => {
    const { device, connection, lines } = setup();
    await connection.connect();

    device.failNextConnects = 1;
    device.disconnect();
    assert.equal(connection.isConnected, false);
    assert.equal(connection.isReconnectScheduled, true);

    mock.timers.tick(RECONNECT_BACKOFF_MS[0]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(connection.isConnected, false);
    assert.equal(connection.reconnectAttempts, 2);

    mock.timers.tick(RECONNECT_BACKOFF_MS[1]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(connection.isConnected, true);
    assert.ok(lines.filter(line => line.level === 'info' && line.message.includes('Connected!')).length === 2);

    mock.timers.tick(STABLE_CONNECTION_MS);
    assert.equal(connection.reconnectAttempts, 0);
    connection.dispose();
  });

  it('logs following attempts at debug level and warns once when offline for long', async () => {
    let now = 0;
    const { device, connection, lines } = setup({ now: () => now });
    device.failNextConnects = 100;
    await connection.connect();

    for (let i = 0; i < 8; i += 1) {
      now += RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1];
      mock.timers.tick(RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1]);
      await new Promise(resolve => setImmediate(resolve));
    }

    const visible = lines.filter(line => line.level !== 'debug');
    const offlineWarnings = visible.filter(line => line.message.includes('Unreachable for'));
    assert.equal(offlineWarnings.length, 1);
    assert.ok(now >= OFFLINE_WARNING_MS);
    assert.ok(visible.length <= 4, `too many visible log lines: ${visible.length}`);

    device.failNextConnects = 0;
    now += RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1];
    mock.timers.tick(RECONNECT_BACKOFF_MS[RECONNECT_BACKOFF_MS.length - 1]);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(connection.isConnected, true);
    assert.ok(lines.some(line => line.level === 'info' && line.message.includes('Back online after')));
    connection.dispose();
  });

  it('reports a wrong key as an error', () => {
    const { connection, lines } = setup();
    connection.handleError(new Error('HMAC mismatch(keys): expected aa, was bb.'));
    assert.ok(lines.some(line => line.level === 'error' && line.message.includes('Wrong local key')));
    connection.dispose();
  });

  it('dispose() closes the socket and stops reconnecting', async () => {
    const { device, connection } = setup();
    await connection.connect();
    connection.dispose();
    assert.equal(device.open, false);
    assert.equal(connection.isReconnectScheduled, false);
    await connection.connect();
    assert.equal(device.connectCalls, 1);
  });
});

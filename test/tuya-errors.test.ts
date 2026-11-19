import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { errorMessage, isPacketDecodeError, isWrongKeyError } from '../dist/tuya-errors.js';

describe('tuya errors', () => {
  it('treats parser failures as malformed packets', () => {
    assert.ok(isPacketDecodeError(new RangeError('offset out of range')));
    assert.ok(isPacketDecodeError(new TypeError('Prefix does not match')));
    assert.ok(isPacketDecodeError(new Error('HMAC mismatch: expected aa, was bb.')));
    assert.ok(isPacketDecodeError(new Error('crc mismatch')));
  });

  it('reports a wrong local key instead of hiding it as a malformed packet (B3)', () => {
    const error = new Error('HMAC mismatch(keys): expected aa, was bb. cafe');
    assert.ok(isWrongKeyError(error));
    assert.equal(isPacketDecodeError(error), false);
  });

  it('handles the plain strings tuyapi emits', () => {
    const timeout = 'Timeout waiting for status response from device id: abc';
    assert.equal(errorMessage(timeout), timeout);
    assert.equal(isPacketDecodeError(timeout), false);
    assert.equal(isWrongKeyError(timeout), false);
    assert.equal(errorMessage(new Error('boom')), 'boom');
  });
});

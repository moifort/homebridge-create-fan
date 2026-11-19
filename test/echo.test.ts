import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ECHO_SUPPRESS_MS, isEchoExpired, shouldIgnoreEcho } from '../dist/echo.js';

describe('echo suppression', () => {
  const recent = { value: true, at: 1_000 };

  it('ignores a contradicting report right after a write', () => {
    assert.equal(shouldIgnoreEcho(recent, false, 1_500), true);
  });

  it('accepts a report that matches the write', () => {
    assert.equal(shouldIgnoreEcho(recent, true, 1_500), false);
  });

  it('accepts anything once the window has passed', () => {
    const later = 1_000 + ECHO_SUPPRESS_MS + 1;
    assert.equal(isEchoExpired(recent, later), true);
    assert.equal(shouldIgnoreEcho(recent, false, later), false);
  });

  it('accepts anything when nothing was written', () => {
    assert.equal(shouldIgnoreEcho(undefined, false, 1_500), false);
  });
});

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { FAN_SPEED_MAX, FAN_SPEED_MIN, percentToStep, SPEED_STEP_PERCENT, stepToPercent } from '../dist/speed.js';

const STEPS = [1, 2, 3, 4, 5, 6];

describe('speed conversion', () => {
  it('step -> percent -> step is the identity for the 6 steps (B1)', () => {
    for (const step of STEPS) {
      assert.equal(percentToStep(stepToPercent(step)), step, `step ${step}`);
    }
  });

  it('maps the rounded integers HomeKit may store back to the same step (B1)', () => {
    const rounded = [17, 33, 50, 67, 83, 100];
    rounded.forEach((percent, index) => assert.equal(percentToStep(percent), STEPS[index], `${percent} %`));
  });

  it('returns exact multiples of minStep', () => {
    for (const step of STEPS) {
      assert.equal(stepToPercent(step), step * SPEED_STEP_PERCENT);
    }
    assert.equal(stepToPercent(FAN_SPEED_MAX), 100);
  });

  it('clamps out-of-range values', () => {
    assert.equal(percentToStep(1), FAN_SPEED_MIN);
    assert.equal(percentToStep(150), FAN_SPEED_MAX);
    assert.equal(stepToPercent(0), stepToPercent(FAN_SPEED_MIN));
    assert.equal(stepToPercent(9), 100);
  });
});

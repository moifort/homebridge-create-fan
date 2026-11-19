export const FAN_SPEED_MIN = 1;
export const FAN_SPEED_MAX = 6;

/** HomeKit RotationSpeed minStep: one fan step expressed in percent (16.666…). */
export const SPEED_STEP_PERCENT = 100 / FAN_SPEED_MAX;

export const clampStep = (step: number): number => Math.min(FAN_SPEED_MAX, Math.max(FAN_SPEED_MIN, step));

/**
 * HomeKit percentage -> fan step (1-6).
 *
 * Math.round (not ceil): HomeKit may hand back either the exact multiple of
 * minStep (16.666…) or a rounded integer (17, 67…). Both must map back to the
 * same step, otherwise re-applying a value read from the accessory bumps the
 * fan up one step.
 */
export const percentToStep = (percent: number): number => clampStep(Math.round(percent / SPEED_STEP_PERCENT));

/** Fan step (1-6) -> HomeKit percentage, an exact multiple of minStep so HAP does not snap it. */
export const stepToPercent = (step: number): number => clampStep(step) * SPEED_STEP_PERCENT;

export type DpsPrimitive = string | number | boolean;

export interface RecentWrite {
  value: DpsPrimitive;
  at: number;
}

/** How long after a write a conflicting report from the fan is treated as a stale echo. */
export const ECHO_SUPPRESS_MS = 1500;

export const isEchoExpired = (recent: RecentWrite, now: number): boolean => now - recent.at > ECHO_SUPPRESS_MS;

/**
 * Right after a write, the fan may still report the previous value. Ignore a
 * report that contradicts a write sent less than ECHO_SUPPRESS_MS ago so the
 * HomeKit tile does not flicker back.
 */
export const shouldIgnoreEcho = (recent: RecentWrite | undefined, incoming: DpsPrimitive, now: number): boolean =>
  recent !== undefined && !isEchoExpired(recent, now) && recent.value !== incoming;

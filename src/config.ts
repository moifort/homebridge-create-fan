export type TuyaProtocolVersion = '3.1' | '3.2' | '3.3' | '3.4' | '3.5';

export const DEFAULT_PROTOCOL_VERSION: TuyaProtocolVersion = '3.4';

const PROTOCOL_VERSIONS: readonly string[] = ['3.1', '3.2', '3.3', '3.4', '3.5'];

/**
 * Users editing config.json by hand often write `"version": 3.4` (a number).
 * tuyapi compares the version as a string, so normalise it here.
 * Returns undefined for anything that is not a known protocol version.
 */
export const normalizeProtocolVersion = (version: unknown): TuyaProtocolVersion | undefined => {
  if (version === undefined || version === null || version === '') {
    return undefined;
  }
  const text = typeof version === 'number' ? version.toFixed(1) : String(version).trim();
  return PROTOCOL_VERSIONS.includes(text) ? text as TuyaProtocolVersion : undefined;
};

/** Device ids that appear more than once in the config. */
export const findDuplicateIds = (ids: readonly unknown[]): string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (typeof id !== 'string' || id === '') {
      continue;
    }
    if (seen.has(id)) {
      duplicates.add(id);
    }
    seen.add(id);
  }
  return [...duplicates];
};

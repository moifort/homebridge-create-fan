// tuyapi surfaces malformed/partial packets as 'error' events: its parser
// throws while decoding bytes off an otherwise healthy socket (the socket is
// NOT torn down in that path). Examples: a RangeError from reading past a short
// buffer ("offset out of range"), or TypeErrors for prefix/suffix/length
// mismatches, or HMAC/CRC failures. None of these mean the connection is dead,
// so we must not reconnect on them — doing so drops a working link and kicks
// off the backoff/reconnect cycle the user sees as the plugin "restarting".
const PACKET_DECODE_ERROR_RE =
  /prefix does not match|suffix does not match|packet too short|packet missing payload|hmac mismatch|crc mismatch|out of range/i;

// tuyapi rejects the session key negotiation with "HMAC mismatch(keys)" when
// the configured local key is wrong. It must be surfaced to the user, not
// swallowed as a malformed packet.
const WRONG_KEY_ERROR_RE = /hmac mismatch\(keys\)/i;

/** tuyapi emits both Error objects and plain strings ('Timeout waiting for status response…'). */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const isWrongKeyError = (error: unknown): boolean => WRONG_KEY_ERROR_RE.test(errorMessage(error));

export const isPacketDecodeError = (error: unknown): boolean =>
  !isWrongKeyError(error) && (
    error instanceof RangeError
    || error instanceof TypeError
    || (error instanceof Error && PACKET_DECODE_ERROR_RE.test(error.message))
  );

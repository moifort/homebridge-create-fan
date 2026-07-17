# Changelog

## 2.2.2

- Fix: a fan whose config is missing a required field (`ip`, `id`, or `key`) is now skipped at startup with a clear error message naming the field, instead of failing with obscure connection timeouts. This helps users who upgraded from 2.0.x without adding the static `ip` that became mandatory in 2.1.0
- Fix: a single malformed/partial Tuya packet on a healthy socket is now ignored (logged at debug) instead of triggering a full reconnect, so one bad packet no longer looks like the plugin "restarting"

## 2.2.1

- Fix: a failed connect attempt (connect timeout or socket error) no longer leaves the accessory wedged offline permanently — the reconnect backoff is now always re-armed, so queued writes get flushed once the fan comes back

## 2.2.0

- Add `light` config (default: on) to hide the Lightbulb tile and its toggle for fan models without a light

## 2.1.1

- Fewer `ECONNRESET` reconnect storms when another local client (a second Homebridge instance, Home Assistant, the Tuya cloud) competes for the fan's single TCP connection
- Writes issued while the fan is offline are now queued and flushed on reconnect, instead of forcing an out-of-backoff reconnect that caused `Timeout waiting for status response`
- Reconnect backoff now has jitter and a longer ceiling so competing clients desynchronise

## 2.1.0

- **Breaking:** each device now requires a static `ip` field in the config
- Removed UDP broadcast discovery (`find()`) — the plugin connects directly to the fan's IP, fixing frequent connection timeouts on stable networks
- Fixed config changes (`version`, `toggles`, `speedButtons`) not taking effect on cached accessories without clearing the Homebridge cache

## 2.0.25

- Fix: momentary toggle tiles now trigger on every tap

## 2.0.24

- Add speed up/down button tiles (gated by `speedButtons` config, default: on)

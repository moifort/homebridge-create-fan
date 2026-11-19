# Changelog

## Unreleased

- README: screenshots now load on npmjs.com (absolute URLs, the images are no longer shipped in the package), and a Development section explains how to run a local Homebridge
- Dev: dependencies refreshed (Homebridge 2.5.0, TypeScript 6, ESLint 10), unused `ts-node` removed, `npm audit` clean

## 2.3.0

- Fix: the fan speed no longer jumps up one step when HomeKit re-applies a value it read back (e.g. a scene saved at 17 % set step 2 instead of 1, 67 % set step 5 instead of 4)
- Fix: the accessory no longer stays offline forever after a non-fatal Tuya error such as `Timeout waiting for status response` (only a restart used to bring it back)
- Fix: a wrong local `key` is now reported as a clear `Wrong local key` error instead of being hidden in debug logs behind an endless `connect failed` loop
- Fix: a numeric `version` in `config.json` (`3.4` instead of `"3.4"`) is now accepted
- Fix: two fans configured with the same `id` are now skipped with an explicit error instead of crashing Homebridge
- Fewer log lines while the fan is unreachable: only the first reconnect attempt is logged at info level, the following ones at debug level, plus a single warning after 5 minutes offline and a `Back online` line when it recovers
- Clean shutdown: Tuya sockets and timers are closed when Homebridge stops or restarts the bridge
- Accessory cache writes are batched instead of rewriting the cache file on every state change
- Config UI: rewritten form with placeholders, IP validation, a masked local key, accurate help texts and advanced options folded away
- README: document `speedButtons` and `version`, add a troubleshooting section
- The npm package no longer ships screenshots and editor files (5.5 MB → 29 kB)

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

## Earlier versions

See the [GitHub releases](https://github.com/moifort/homebridge-create-fan/releases).

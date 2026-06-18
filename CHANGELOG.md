# Changelog

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

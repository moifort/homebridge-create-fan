# Changelog

## 2.1.0

- **Breaking:** each device now requires a static `ip` field in the config
- Removed UDP broadcast discovery (`find()`) — the plugin connects directly to the fan's IP, fixing frequent connection timeouts on stable networks
- Fixed config changes (`version`, `toggles`, `speedButtons`) not taking effect on cached accessories without clearing the Homebridge cache

## 2.0.25

- Fix: momentary toggle tiles now trigger on every tap

## 2.0.24

- Add speed up/down button tiles (gated by `speedButtons` config, default: on)

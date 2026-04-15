
![ceiling-fan.jpg](readme/ceiling-fan.jpg)

# CREATE Ceiling Fan

Control your CREATE Ceiling Fan from HomeKit.
- Turn fan on/off
- Adjust fan speed (6 steps, shown as a slider in the Home app)
- Reverse rotation direction (summer/winter mode)
- Turn light on/off
- Silence the beep via config (v2 only)
- Stateless Programmable Switch tiles (rendered as "Button" category in Apple Home)

![homekit-1.png](readme/homekit-1.png)
![homekit-2.png](readme/homekit-2.png)

## Installation

Go to the Homebridge UI, Plugins screen and search for `homebridge-create-ceiling-fan`. Install the plugin and use the form to configure it.


### Optional

#### Silence the beep (v2 only)

Ceiling Fan **v2** (`Ceiling Fan/Light`) emits an audible beep on every command. Set `beep: false`
on the device in your Homebridge config to silence it; set `beep: true` to re-enable it. The value
is pushed to the fan on every Tuya reconnect.

Leave the key unset to let the plugin leave the beep untouched — recommended for the original
Ceiling Fan (v1), which does not expose this Tuya DP.

```json
{
  "platform": "HomebridgeCreateCeilingFan",
  "devices": [
    { "id": "…", "key": "…", "name": "Ceiling Fan", "beep": false }
  ]
}
```

#### Stateless button tiles

The plugin exposes two extra Stateless Programmable Switch services that Apple Home renders as
"Button" category tiles. Note: these tiles cannot be tapped from the Home app nor targeted as
automation actions — they are placeholders. To actually toggle the fan or the light from a physical
HomeKit button, point the automation at `Ceiling Fan (Active)` or `Ceiling Light (On)` directly,
using a Shortcut with `If` logic if you need a single-press toggle.

Set `toggles: false` on the device to hide them. Default is `true`.

```json
{
  "platform": "HomebridgeCreateCeilingFan",
  "devices": [
    { "id": "…", "key": "…", "name": "Ceiling Fan", "toggles": false }
  ]
}
```


## Configuration

To get your `Id` and `Key` ceiling fan, follow the instructions [Getting your keys](https://github.com/jasonacox/tinytuya/tree/master#setup-wizard---getting-local-keys)

## Thanks

- [tuyapi](https://github.com/codetheweb/tuyapi)
- @marsuboss

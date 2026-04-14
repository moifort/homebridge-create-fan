
![ceiling-fan.jpg](readme/ceiling-fan.jpg)

# CREATE Ceiling Fan

Control your CREATE Ceiling Fan from HomeKit.
- Turn fan on/off
- Adjust fan speed (6 steps, shown as a slider in the Home app)
- Reverse rotation direction (summer/winter mode)
- Turn light on/off
- Mute/unmute the beep (v2 only, optional)

![homekit-1.png](readme/homekit-1.png)
![homekit-2.png](readme/homekit-2.png)

## Installation

Go to the Homebridge UI, Plugins screen and search for `homebridge-create-ceiling-fan`. Install the plugin and use the form to configure it.


### Optional

#### Beep switch (v2 only)

Ceiling Fan **v2** (`Ceiling Fan/Light`) exposes a `fan_beep` Tuya DP that makes the unit emit an
audible beep on every command. A **Beep** switch is added in HomeKit by default so you can mute or
re-enable it from the Home app. Toggle it OFF to silence the beep.

If you own the original Ceiling Fan (v1) which does not expose this DP, set `hasBeep: false` on
the device in your config to hide the switch.


## Configuration

To get your `Id` and `Key` ceiling fan, follow the instructions [Getting your keys](https://github.com/jasonacox/tinytuya/tree/master#setup-wizard---getting-local-keys)

## Thanks

- [tuyapi](https://github.com/codetheweb/tuyapi)
- @marsuboss

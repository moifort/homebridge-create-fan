import { PlatformAccessory } from 'homebridge';

import type { HomebridgeCreateCeilingFan } from './platform.js';

export class FanAccessory {
  // private service: Service;

  private fanState = {
    On: false,
    Rotation: 0, // 0 = Clockwise, 1 = Counter-Clockwise
    Speed: 20,
  };

  private lightState = {
    On: false,
    Brightness: 60,
  };

  constructor(
    private readonly platform: HomebridgeCreateCeilingFan,
    private readonly accessory: PlatformAccessory,
  ) {
    platform.log.prefix = accessory.displayName;
    this.platform.log.info('Creating Fan Accessory');
  }

}

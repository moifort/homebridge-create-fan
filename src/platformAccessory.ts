import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';

import {HomebridgeCreateCeilingFan} from './platform';
import TuyAPI from 'tuyapi';
import TuyaDevice, {DPSObject} from 'tuyapi';
import {withPrefix} from 'homebridge/lib/logger';

export class CeilingFanAccessory {
  private fanService!: Service;
  private lightService!: Service;
  private isConnecting = false;
  private isConnectingLater = false;

  private state = {
    fanOn: false,
    fanRotation: this.platform.Characteristic.RotationDirection.CLOCKWISE,
    fanSpeed: 20,
    lightOn: false,
    lightBrightness: 60,
    lightColorTemperature: 140,
  };

  constructor(
    private readonly platform: HomebridgeCreateCeilingFan,
    private readonly accessory: PlatformAccessory,
  ) {
    const device = new TuyAPI({
      id: accessory.context.device.id,
      key: accessory.context.device.key,
      // ip: accessory.context.device.ip,
      // version: accessory.context.device.version,
    });

    withPrefix(accessory.context.device.name ?? '');


    device.on('disconnected', () => {
      this.platform.log.info('Disconnected... Try to connect');
      this.connect(device);
    });

    device.on('error', error => {
      this.platform.log.info('Error :', error);
      this.platform.log.info('Disconnect...');
      device.disconnect();
    });


    // Information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'CREATE')
      .setCharacteristic(this.platform.Characteristic.Model, 'Ceiling Fan')
      .setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.id);

    // Fan
    this.fanService = this.accessory.getService(this.platform.Service.Fan) || this.accessory.addService(this.platform.Service.Fan);
    this.fanService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);


    // Fan state
    this.fanService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value: CharacteristicValue) => {
        this.state.fanOn = value.valueOf() as boolean;
        await device.set({dps: 60, set: this.state.fanOn, shouldWaitForResponse: false});
      })
      .onGet(() => this.state.fanOn);
    const stateHook = (data: DPSObject) => {
      const isOn = data.dps['60'] as boolean | undefined;
      if (isOn !== undefined) {
        this.state.fanOn = isOn;
        this.platform.log.info('Update fan on', this.state.fanOn);
        this.fanService.updateCharacteristic(this.platform.Characteristic.On, this.state.fanOn);
      }
    };
    // device.on('dp-refresh', stateHook);
    device.on('data', stateHook);

    // Fan rotation
    this.fanService.getCharacteristic(this.platform.Characteristic.RotationDirection)
      .onSet(async (value: CharacteristicValue) => {
        this.state.fanRotation = value.valueOf() as number;
        await device.set({dps: 63, set:  this.state.fanRotation === 0 ? 'forward' : 'reverse', shouldWaitForResponse: false});
      })
      .onGet(() => this.state.fanRotation);
    const rotationHook = (data: DPSObject) => {
      const rotation = data.dps['63'] as string | undefined;
      if (rotation !== undefined) {
        this.state.fanRotation = rotation === 'forward'
          ? this.platform.Characteristic.RotationDirection.CLOCKWISE
          : this.platform.Characteristic.RotationDirection.COUNTER_CLOCKWISE;
        this.platform.log.info('Update fan rotation', this.state.fanRotation);
        this.fanService.updateCharacteristic(this.platform.Characteristic.RotationDirection, this.state.fanRotation);
      }
    };
    // device.on('dp-refresh', rotationHook);
    device.on('data', rotationHook);

    // Fan speed
    this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onSet(async (value: CharacteristicValue) => {
        if (value.valueOf() === 0) {
          await device.set({dps: 60, set: false, shouldWaitForResponse: false});
        } else {
          this.state.fanSpeed = value.valueOf() as number;
          await device.set({dps: 62, set:  this.toStep(this.state.fanSpeed), shouldWaitForResponse: false});
        }
      })
      .onGet(() => this.state.fanSpeed)
      .setProps({});
    const speedHook = (data: DPSObject) => {
      const speed = data.dps['62'] as number | undefined;
      if (speed !== undefined) {
        this.state.fanSpeed = this.toPercent(this.state.fanSpeed, speed);
        this.platform.log.info('Update fan speed', this.state.fanSpeed);
        this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.state.fanSpeed);
      }
    };
    // device.on('dp-refresh', speedHook);
    device.on('data', speedHook);

    if (accessory.context.device.hasLight) {
      // Fan Light
      this.lightService = this.accessory.getService(this.platform.Service.Lightbulb)
        || this.accessory.addService(this.platform.Service.Lightbulb);
      this.lightService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);
      this.lightService.getCharacteristic(this.platform.Characteristic.On)
        .onSet(async (value: CharacteristicValue) => {
          this.state.lightOn = value.valueOf() as boolean;
          await device.set({dps: 20, set: this.state.lightOn, shouldWaitForResponse: false});
          await device.refresh({});
        })
        .onGet(() => this.state.lightOn);

      const lightStateHook = (data: DPSObject) => {
        const isOn = data.dps['20'] as boolean | undefined;
        if (isOn !== undefined) {
          this.state.lightOn = isOn;
          this.platform.log.info('Update light on', this.state.lightOn);
          this.lightService.updateCharacteristic(this.platform.Characteristic.On, this.state.lightOn);
        }
      };
      // device.on('dp-refresh', lightStateHook);
      device.on('data', lightStateHook);

      // Fan Light Brightness
      this.lightService.getCharacteristic(this.platform.Characteristic.Brightness)
        .onSet(async (value: CharacteristicValue) => {
          if (value.valueOf() === 0) {
            await device.set({dps: 20, set: false, shouldWaitForResponse: false});
          } else {
            this.state.lightBrightness = value.valueOf() as number;
            await device.set({dps: 22, set: this.state.lightBrightness * 10, shouldWaitForResponse: false});
          }
        })
        .onGet(() => this.state.lightBrightness);

      const lightBrightnessHook = (data: DPSObject) => {
        const brightness = data.dps['22'] as number | undefined;
        if (brightness !== undefined) {
          this.state.lightBrightness = brightness / 10;
          this.platform.log.info('Update brightness', this.state.lightBrightness);
          this.lightService.updateCharacteristic(this.platform.Characteristic.Brightness, this.state.lightBrightness);
        }
      };
      // device.on('dp-refresh', lightBrightnessHook);
      device.on('data', lightBrightnessHook);


      // Fan Light ColorTemperature
      // this.lightService.getCharacteristic(this.platform.Characteristic.ColorTemperature)
      //   .onSet(async (value: CharacteristicValue) => {
      //     this.state.lightColorTemperature = value.valueOf() as number;
      //     await device.set({dps: 23, set: this.convertTemperatureTuya(this.state.lightColorTemperature), shouldWaitForResponse: false});
      //   })
      //   .onGet(() => this.state.lightColorTemperature);
      //
      // const lightColorTemperatureHook = (data: DPSObject) => {
      //   const colorTemperature = data.dps['23'] as number | undefined;
      //   if (colorTemperature !== undefined) {
      //     this.state.lightColorTemperature = this.convertTemperatureHomeKit(colorTemperature);
      //     this.platform.log.info('Update colorTemperature', this.state.lightColorTemperature);
      //     this.lightService.updateCharacteristic(this.platform.Characteristic.ColorTemperature, this.state.lightColorTemperature);
      //   }
      // };
      // device.on('dp-refresh', lightColorTemperatureHook);
      // device.on('data', lightColorTemperatureHook);
    }

    this.connect(device);
  }

  async connect(device: TuyaDevice) {
    if (this.isConnecting || this.isConnectingLater) {
      return;
    }
    try {
      this.isConnecting = true;
      this.platform.log.info('Connecting...');
      await device.find();
      await device.connect();
      this.platform.log.info('Connected');
      this.isConnecting = false;
    } catch (e) {
      this.isConnectingLater = true;
      this.platform.log.info('Connection failed', e);
      this.platform.log.info('Retry in 1 minute');
      setTimeout(() => {
        this.platform.log.info('Re-connecting...');
        this.isConnectingLater = false;
        this.connect(device);
      }, 60000);
    }
  }


  toStep(percent: number) {
    const etapes = [1, 2, 3, 4, 5, 6];
    const etapeIndex = Math.floor(percent / 16.67); // 100 / 6 = 16.67
    return etapes[etapeIndex];
  }

  toPercent(initialPercentage: number, step: number) {
    const plagesPourcentage = [0, 15, 30, 50, 65, 80, 100];
    const plageMin = plagesPourcentage[step - 1];
    const plageMax = plagesPourcentage[step];
    if (initialPercentage >= plageMin && initialPercentage <= plageMax) {
      return initialPercentage;
    }
    if (step === 1) {
      return 10;
    }
    if (step === 6) {
      return 100;
    }
    return plageMin;
  }

  convertTemperatureHomeKit(tuyaValue: number) {
    switch (tuyaValue) {
      case 0:
        return 140;
      case 500:
        return 320;
      case 1000:
        return 500;
      default:
        return 140;
    }
  }

  convertTemperatureTuya(homekitValue: number) {
    if (homekitValue >= 140 && homekitValue < 230) {
      return 0;
    } else if (homekitValue >= 230 && homekitValue < 430) {
      return 500;
    } else if (homekitValue >= 430 && homekitValue <= 500) {
      return 1000;
    } else {
      return 0;
    }
  }
}

import {CharacteristicValue, PlatformAccessory, Service} from 'homebridge';

import {HomebridgeCreateCeilingFan} from './platform';
import TuyAPI, {DPSObject} from 'tuyapi';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different fanService types.
 */
export class CeilingFanAccessory {
  private fanService: Service;
  private lightService: Service;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private state = {
    fanOn: false,
    fanSpeed: 100 / 6 * 2,
    lightOn: false,
  };

  constructor(
    private readonly platform: HomebridgeCreateCeilingFan,
    private readonly accessory: PlatformAccessory,
  ) {
    const device = new TuyAPI({
      id: accessory.context.device.id,
      key: accessory.context.device.key,
    });



    // Connect to the device

    // Information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'CREATE')
      .setCharacteristic(this.platform.Characteristic.Model, 'Ceiling Fan')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.id);

    // Fan
    this.fanService = this.accessory.getService(this.platform.Service.Fan) || this.accessory.addService(this.platform.Service.Fan);
    this.fanService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    // Fan state
    this.fanService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value: CharacteristicValue) => {
        await device.set({dps: 60, set: value.valueOf() as boolean});
      })
      .onGet(() => this.state.fanOn);
    const stateHook = (data: DPSObject) => {
      if (data.dps['60']) {
        this.state.fanOn = data.dps['60'] as boolean;
        this.fanService.updateCharacteristic(this.platform.Characteristic.On, this.state.fanOn);
      }
    };
    device.on('data', stateHook);
    device.on('dp-refresh', stateHook);

    // Fan speed
    this.fanService.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .onSet(async (value: CharacteristicValue) => {
        const speed = Math.floor(6 / 100 * (value.valueOf() as number));
        await device.set({dps: 62, set: speed === 0 ? 1 : speed});
      })
      .onGet(() => this.state.fanSpeed);
    const speedHook = (data: DPSObject) => {
      if (data.dps['62']) {
        this.state.fanSpeed = 100 / 6 * (data.dps['62'] as number);
        this.fanService.updateCharacteristic(this.platform.Characteristic.RotationSpeed, this.state.fanSpeed);
      }
    };
    device.on('data', speedHook);
    device.on('dp-refresh', speedHook);

    // // Fan direction
    // this.fanService.getCharacteristic(this.api.hap.Characteristic.RotationDirection)
    //   .onGet(this.fetchFanDirection.bind(this))
    //   .onSet(this.handleFanDirection.bind(this));
    //
    // device.on('dp-refresh', (data) => {
    //   if (data.dps['60']) {
    //     this.state.fanOn = data.dps['60'] as boolean;
    //     this.fanService.updateCharacteristic(this.platform.Characteristic.On, this.state.fanOn);
    //   }
    // });

    // Fan Light
    this.lightService = this.accessory.getService(this.platform.Service.Lightbulb)
      || this.accessory.addService(this.platform.Service.Lightbulb);
    this.lightService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);
    this.lightService.getCharacteristic(this.platform.Characteristic.On)
      .onSet(async (value: CharacteristicValue) => {
        await device.set({dps: 20, set: value.valueOf() as boolean});
      })
      .onGet(() => this.state.lightOn);

    const lightStateHook = (data: DPSObject) => {
      if (data.dps['20']) {
        this.state.lightOn = data.dps['20'] as boolean;
        this.lightService.updateCharacteristic(this.platform.Characteristic.On, this.state.lightOn);
      }
    };
    device.on('data', lightStateHook);
    device.on('dp-refresh', lightStateHook);

    device.find().then(() => device.connect());

    // this.fanService.getCharacteristic(this.api.hap.Characteristic.On)
    //   .onGet(this.fetchFanOn.bind(this))
    //   .onSet(this.handleFanOn.bind(this));

    // // get the LightBulb fanService if it exists, otherwise create a new LightBulb fanService
    // // you can create multiple services for each accessory
    // this.fanService = this.accessory.getService(this.platform.Service.Lightbulb)
    // || this.accessory.addService(this.platform.Service.Lightbulb);
    //
    // // set the fanService name, this is what is displayed as the default name on the Home app
    // // in this example we are using the name we stored in the `accessory.context` in the `discoverDevices` method.
    // this.fanService.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.exampleDisplayName);
    //
    // // each fanService must implement at-minimum the "required characteristics" for the given fanService type
    // // see https://developers.homebridge.io/#/service/Lightbulb
    //
    // // register handlers for the On/Off Characteristic
    // this.fanService.getCharacteristic(this.platform.Characteristic.On)
    //   .onSet(this.setOn.bind(this))                // SET - bind to the `setOn` method below
    //   .onGet(this.getOn.bind(this));               // GET - bind to the `getOn` method below
    //
    // // register handlers for the Brightness Characteristic
    // this.fanService.getCharacteristic(this.platform.Characteristic.Brightness)
    //   .onSet(this.setBrightness.bind(this));       // SET - bind to the 'setBrightness` method below
    //
    // /**
    //  * Creating multiple services of the same type.
    //  *
    //  * To avoid "Cannot add a Service with the same UUID another Service without also defining a unique 'subtype' property." error,
    //  * when creating multiple services of the same type, you need to use the following syntax to specify a name and subtype id:
    //  * this.accessory.getService('NAME') ||
    //  this.accessory.addService(this.platform.Service.Lightbulb, 'NAME', 'USER_DEFINED_SUBTYPE_ID');
    //  *
    //  * The USER_DEFINED_SUBTYPE must be unique to the platform accessory (if you platform exposes multiple accessories, each accessory
    //  * can use the same sub type id.)
    //  */
    //
    // // Example: add two "motion sensor" services to the accessory
    // const motionSensorOneService = this.accessory.getService('Motion Sensor One Name') ||
    //     this.accessory.addService(this.platform.Service.MotionSensor, 'Motion Sensor One Name', 'YourUniqueIdentifier-1');
    //
    // const motionSensorTwoService = this.accessory.getService('Motion Sensor Two Name') ||
    //   this.accessory.addService(this.platform.Service.MotionSensor, 'Motion Sensor Two Name', 'YourUniqueIdentifier-2');
    //
    // /**
    //  * Updating characteristics values asynchronously.
    //  *
    //  * Example showing how to update the state of a Characteristic asynchronously instead
    //  * of using the `on('get')` handlers.
    //  * Here we change update the motion sensor trigger states on and off every 10 seconds
    //  * the `updateCharacteristic` method.
    //  *
    //  */
    // let motionDetected = false;
    // setInterval(() => {
    //   // EXAMPLE - inverse the trigger
    //   motionDetected = !motionDetected;
    //
    //   // push the new value to HomeKit
    //   motionSensorOneService.updateCharacteristic(this.platform.Characteristic.MotionDetected, motionDetected);
    //   motionSensorTwoService.updateCharacteristic(this.platform.Characteristic.MotionDetected, !motionDetected);
    //
    //   this.platform.log.debug('Triggering motionSensorOneService:', motionDetected);
    //   this.platform.log.debug('Triggering motionSensorTwoService:', !motionDetected);
    // }, 10000);
  }

  // /**
  //  * Handle "SET" requests from HomeKit
  //  * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
  //  */
  // async setOn(value: CharacteristicValue) {
  //   // implement your own code to turn your device on/off
  //   this.state.On = value as boolean;
  //
  //   this.platform.log.debug('Set Characteristic On ->', value);
  // }
  //
  // /**
  //  * Handle the "GET" requests from HomeKit
  //  * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
  //  *
  //  * GET requests should return as fast as possbile. A long delay here will result in
  //  * HomeKit being unresponsive and a bad user experience in general.
  //  *
  //  * If your device takes time to respond you should update the status of your device
  //  * asynchronously instead using the `updateCharacteristic` method instead.
  //
  //  * @example
  //  * this.fanService.updateCharacteristic(this.platform.Characteristic.On, true)
  //  */
  // async getOn(): Promise<CharacteristicValue> {
  //   // implement your own code to check if the device is on
  //   const isOn = this.state.On;
  //
  //   this.platform.log.debug('Get Characteristic On ->', isOn);
  //
  //   // if you need to return an error to show the device as "Not Responding" in the Home app:
  //   // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
  //
  //   return isOn;
  // }
  //
  // /**
  //  * Handle "SET" requests from HomeKit
  //  * These are sent when the user changes the state of an accessory, for example, changing the Brightness
  //  */
  // async setBrightness(value: CharacteristicValue) {
  //   // implement your own code to set the brightness
  //   this.state.Brightness = value as number;
  //
  //   this.platform.log.debug('Set Characteristic Brightness -> ', value);
  // }

}

import {Service, PlatformAccessory, CharacteristicValue, CharacteristicChange} from 'homebridge';
import { IntellifirePlatform } from './platform.js';
import {Session} from './session.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class Fireplace {
  private service: Service;
  private sensor: Service;

  /**
   * These are just used to create a working example
   * You should implement your own code to track the state of your accessory
   */
  private states = {
    on: false,
  };

  constructor(
    private readonly platform: IntellifirePlatform,
    private readonly accessory: PlatformAccessory,
    private readonly session: Session,
  ) {

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Hearth and Home')
      .setCharacteristic(this.platform.Characteristic.Model, this.accessory.context.device.brand)
      .setCharacteristic(this.platform.Characteristic.FirmwareRevision, this.accessory.context.device.firmware_version_string)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.accessory.context.device.serial);

    this.service = this.accessory.getService(this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch);
    this.service.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))                // SET - bind to the `setOn` method below
      .onGet(this.getOn.bind(this))                // GET - bind to the `getOn` method below
      .on('change', this.setSensor.bind(this));

    this.sensor = this.accessory.getService(this.platform.Service.ContactSensor) ||
      this.accessory.addService(this.platform.Service.ContactSensor);
    this.sensor.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    this.queryStatus();
    setInterval(this.queryStatus.bind(this), 60000);
  }

  queryStatus() {
    this.platform.log.info(`Querying for status on ${this.accessory.displayName}.`);
    this.session.fetch(`https://iftapi.net/a/${this.accessory.context.device.serial}//apppoll`)
      .then((response) => {
        this.platform.log.info(`Response from Intellifire: ${response.statusText}`);
        response.json().then((data) => {
          this.platform.log.info(`Status response: ${JSON.stringify(data)}`);
          this.updateStatus(data);
        });
      });
  }

  updateStatus(data) {
    this.states.on = (data.power === '1');
    this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(this.states.on);
  }

  async setSensor(change : CharacteristicChange) {
    if (change.newValue !== change.oldValue) {
      this.sensor.getCharacteristic(this.platform.Characteristic.ContactSensorState).updateValue(change.newValue ? 1 : 0);
    }
  }

  sendFireplaceCommand(command : string, value : string) {
    this.platform.log.info(`Setting ${command} on fireplace ${this.accessory.displayName} status to ${value}`);
    const params = new URLSearchParams();
    params.append(command, value);

    this.session.fetch(`https://iftapi.net/a/${this.accessory.context.device.serial}//apppost`, {
      method: 'POST',
      body: params,
    }).then((response: Response) => {
      if (response.ok) {
        this.platform.log.info(`Fireplace update response: ${response.status}`);
      } else {
        this.platform.log.info(`Fireplace ${this.accessory.displayName} power failed to update: ${response.statusText}`);
      }
    });
  }

  /**
   * Handle "SET" requests from HomeKit
   * These are sent when the user changes the state of an accessory, for example, turning on a Light bulb.
   */
  async setOn(value : CharacteristicValue) {
    if (value as boolean !== this.states.on) {
      this.states.on = value as boolean;
      this.sendFireplaceCommand('power', (this.states.on ? '1' : '0'));
    }
  }

  /**
   * Handle the "GET" requests from HomeKit
   * These are sent when HomeKit wants to know the current state of the accessory, for example, checking if a Light bulb is on.
   *
   * GET requests should return as fast as possbile. A long delay here will result in
   * HomeKit being unresponsive and a bad user experience in general.
   *
   * If your device takes time to respond you should update the status of your device
   * asynchronously instead using the `updateCharacteristic` method instead.

   * @example
   * this.service.updateCharacteristic(this.platform.Characteristic.On, true)
   */
  async getOn(): Promise<CharacteristicValue> {
    return this.states.on;
  }

}

import {Service, PlatformAccessory, CharacteristicValue, CharacteristicChange} from 'homebridge';
import { IntellifirePlatform } from './platform.js';
import {Session} from './session.js';

export class Fireplace {
  private readonly service: Service;
  private readonly sensor: Service;
  private readonly fan: Service;
  private refreshTimer!: NodeJS.Timeout;
  private heightTimer!: NodeJS.Timeout;

  private states = {
    on: false,
    height: 2,
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
    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Power');
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this))
      .on('change', this.setSensor.bind(this));

    this.sensor = this.accessory.getService(this.platform.Service.ContactSensor) ||
      this.accessory.addService(this.platform.Service.ContactSensor);
    this.sensor.setCharacteristic(this.platform.Characteristic.Name, accessory.context.device.name);

    this.fan = this.accessory.getService(this.platform.Service.Fan) || this.accessory.addService(this.platform.Service.Fan);
    this.fan.setCharacteristic(this.platform.Characteristic.Name, 'Flame Height');
    this.fan.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: 4,
        minStep: 1,
      })
      .onSet(this.setHeight.bind(this))
      .onGet(this.getHeight.bind(this));

    this.queryStatus();
    this.setRefreshInterval();
  }

  setRefreshInterval() {
    if (this.refreshTimer) {
      clearInterval(this.refreshTimer);
    }

    this.refreshTimer = setInterval(this.queryStatus.bind(this), 30000);
  }

  queryStatus() {
    this.platform.log.debug(`Querying for status on ${this.accessory.displayName}.`);
    this.session.fetch(`https://iftapi.net/a/${this.accessory.context.device.serial}//apppoll`)
      .then((response) => {
        this.platform.log.debug(`Response from Intellifire: ${response.statusText}`);
        response.json().then((data) => {
          this.platform.log.debug(`Status response: ${JSON.stringify(data)}`);
          this.updateStatus(data);
        });
      });
  }

  updateStatus(data) {
    this.states.on = (data.power === '1');
    this.states.height = this.states.on ? data.height : 2;
    this.platform.log.info(`Fireplace ${this.accessory.displayName} states set to ${JSON.stringify(this.states)}`);

    this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(this.states.on);
    this.fan.getCharacteristic(this.platform.Characteristic.On).updateValue(this.states.on);
    this.fan.getCharacteristic(this.platform.Characteristic.RotationSpeed).updateValue(this.getHeight());
  }

  async setSensor(change : CharacteristicChange) {
    if (change.newValue !== change.oldValue) {
      this.sensor.getCharacteristic(this.platform.Characteristic.ContactSensorState).updateValue(change.newValue ? 1 : 0);
    }
  }

  sendFireplaceCommand(params : URLSearchParams) {
    this.setRefreshInterval();
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

  sendFireplaceUpdate() {
    const params = new URLSearchParams();
    params.append('power', (this.states.on ? '1' : '0'));
    params.append('height', this.states.height.toString());
    this.platform.log.info(`Setting update to fireplace ${this.accessory.displayName} status to ${JSON.stringify(this.states)}: `,
      params.toString());
    this.sendFireplaceCommand(params);
  }

  sendPowerCommand() {
    const params = new URLSearchParams();
    params.append('power', (this.states.on ? '1' : '0'));
    this.sendFireplaceCommand(params);
  }

  setOn(value : CharacteristicValue) {
    if (value as boolean !== this.states.on) {
      this.states.on = value as boolean;
      setImmediate(this.sendPowerCommand.bind(this));
    }

    this.fan.getCharacteristic(this.platform.Characteristic.On).updateValue(this.states.on);
    this.fan.getCharacteristic(this.platform.Characteristic.RotationSpeed).updateValue(this.getHeight());
  }

  getOn():CharacteristicValue {
    return this.states.on;
  }

  sendHeightCommand() {
    const params = new URLSearchParams();
    params.append('height', this.states.height.toString());
    this.sendFireplaceCommand(params);
  }

  setHeight(value : CharacteristicValue) {
    if (value as number !== this.states.height) {
      this.states.height = value as number;
      if (this.heightTimer) {
        clearTimeout(this.heightTimer);
      }
      this.heightTimer = setTimeout(this.sendHeightCommand.bind(this), 2000);
    }
  }

  getHeight(): CharacteristicValue {
    return this.states.on ? this.states.height : 0;
  }

}

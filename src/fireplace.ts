import {Service, PlatformAccessory, CharacteristicValue, CharacteristicChange} from 'homebridge';
import { IntellifirePlatform } from './platform.js';
import {Session} from './session.js';
import {Device} from './types.js';

export class Fireplace {
  private readonly service: Service;
  private readonly sensor: Service;
  private readonly fan: Service;
  private heightTimer!: NodeJS.Timeout;

  private states = {
    on: false,
    height: 2,
  };

  constructor(
    private readonly platform: IntellifirePlatform,
    private readonly device: Device,
    private readonly accessory: PlatformAccessory,
    private readonly session: Session,
  ) {

    this.platform.log.info(`Creating fireplace for device: ${JSON.stringify(device)}`);

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Hearth and Home')
      .setCharacteristic(this.platform.Characteristic.Model, this.device.brand)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device.serial);

    this.service = this.accessory.getService(this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch);
    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Power');
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this))
      .on('change', this.setSensor.bind(this));

    this.sensor = this.accessory.getService(this.platform.Service.ContactSensor) ||
      this.accessory.addService(this.platform.Service.ContactSensor);
    this.sensor.setCharacteristic(this.platform.Characteristic.Name, this.accessory.displayName);

    this.fan = this.accessory.getService(this.platform.Service.Fan) || this.accessory.addService(this.platform.Service.Fan);
    this.fan.setCharacteristic(this.platform.Characteristic.Name, 'Flame Height');
    this.fan.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: 4,
        minStep: 1,
      })
      .onSet(this.setHeight.bind(this));

    // get initial status
    this.getInitialStatus();
    this.poll();
  }

  handleCloudResponse(response) {
    this.platform.log.debug(`Response from Intellifire: ${response.statusText}`);
    if (response.ok) {
      response.json().then((data) => {
        this.platform.log.debug(`Status response: ${JSON.stringify(data)}`);
        this.updateStatus(data.power === '1', Number(data.height));
      });
    } else {
      this.platform.log.debug('No updates from the server.');
    }
  }

  getInitialStatus() {
    if (this.session.connected) {
      this.platform.log.debug(`Poll for status on ${this.accessory.displayName}.`);
      this.session.fetch(`https://iftapi.net/a/${this.device.serial}//apppoll`)
        .then(this.handleCloudResponse.bind(this));
    } else {
      // do local status check
    }
  }

  poll(options = {}) {
    if (this.session.connected) {
      this.platform.log.debug(`Long poll for status on ${this.accessory.displayName}.`);
      this.session.fetch(`https://iftapi.net/a/${this.device.serial}//applongpoll`, options)
        .then((response) => {
          this.handleCloudResponse(response);
          setImmediate(() => {
            this.poll({
              method: 'GET',
              headers: {
                'If-None-Match': response.headers.get('etag'),
              },
            });
          });
        })
        .catch((err) => {
          this.platform.log.info('Failed to successfully get update from server: ', err.message);
          setImmediate(this.poll.bind(this));
        });
    } else {
      // do local poll
    }
  }

  updateStatus(power: boolean, height: number) {
    this.states.on = power;
    this.states.height = this.states.on ? height : 0;
    this.platform.log.info(`Fireplace ${this.accessory.displayName} states set to ${JSON.stringify(this.states)}`);

    this.service.getCharacteristic(this.platform.Characteristic.On).updateValue(this.states.on);
    this.fan.getCharacteristic(this.platform.Characteristic.On).updateValue(this.states.on);
    this.fan.getCharacteristic(this.platform.Characteristic.RotationSpeed).updateValue(this.states.height);
  }

  async setSensor(change : CharacteristicChange) {
    if (change.newValue !== change.oldValue) {
      this.sensor.getCharacteristic(this.platform.Characteristic.ContactSensorState).updateValue(change.newValue ? 1 : 0);
    }
  }

  post(params : URLSearchParams) {
    this.platform.log.info(`Sending update to fireplace ${this.accessory.displayName}: ${JSON.stringify(this.states)}=>`,
      params.toString());
    this.session.fetch(`https://iftapi.net/a/${this.device.serial}//apppost`, {
      method: 'POST',
      body: params,
    })
      .then((response: Response) => {
        if (response.ok) {
          this.platform.log.info(`Fireplace update response: ${response.status}`);
        } else {
          this.platform.log.info(`Fireplace ${this.accessory.displayName} failed to update: ${response.statusText}`);
        }
      });
  }

  sendPowerCommand() {
    const params = new URLSearchParams();
    params.append('power', (this.states.on ? '1' : '0'));
    this.post(params);
  }

  setOn(value : CharacteristicValue) {
    if (value as boolean !== this.states.on) {
      this.states.on = value as boolean;
      setImmediate(this.sendPowerCommand.bind(this));
    }

    this.fan.getCharacteristic(this.platform.Characteristic.On).updateValue(this.states.on);
  }

  getOn():CharacteristicValue {
    return this.states.on;
  }

  sendHeightCommand() {
    const params = new URLSearchParams();
    params.append('height', this.states.height.toString());
    this.post(params);
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

}

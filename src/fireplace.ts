import {Service, PlatformAccessory, CharacteristicValue, CharacteristicChange} from 'homebridge';
import {IntellifirePlatform} from './platform.js';
import {clearTimeout} from 'timers';

export class Fireplace {
  private readonly service: Service;
  private readonly sensor: Service;
  private readonly fan: Service;
  private heightTimer!: NodeJS.Timeout;
  private pollTimer!: NodeJS.Timeout;

  private states = {
    on: false,
    height: 2,
  };

  constructor(
    private readonly platform: IntellifirePlatform,
    private readonly accessory: PlatformAccessory,
  ) {

    this.platform.log.info(`Creating fireplace for device: ${JSON.stringify(this.device())}`);

    this.platform.api.on('shutdown', () => {
      if (this.pollTimer) {
        clearTimeout(this.pollTimer);
      }
      if (this.heightTimer) {
        clearTimeout(this.heightTimer);
      }
    });

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Hearth and Home')
      .setCharacteristic(this.platform.Characteristic.Model, this.device().brand)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device().serial);

    this.service = this.accessory.getService(this.platform.Service.Switch) || this.accessory.addService(this.platform.Service.Switch);
    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Power');
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this))
      .on('change', this.setSensor.bind(this));

    this.sensor = this.accessory.getService(this.platform.Service.ContactSensor) ||
      this.accessory.addService(this.platform.Service.ContactSensor);
    this.sensor.setCharacteristic(this.platform.Characteristic.Name, 'Fireplace Valve');

    this.fan = this.accessory.getService(this.platform.Service.Fan) || this.accessory.addService(this.platform.Service.Fan);
    this.fan.setCharacteristic(this.platform.Characteristic.Name, 'Flame Height');
    this.fan.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: 4,
        minStep: 1,
      })
      .onSet(this.setHeight.bind(this));

    this.platform.cloud.on('connected', () => {
      this.platform.cloud.status(this.device()).then(this.handleResponse.bind(this));
    });

    this.poll();
  }

  device() {
    return this.accessory.context.device;
  }

  handleResponse(response) {
    if (response.ok) {
      response.json().then(data => {
        this.platform.log.debug(`Status response: ${JSON.stringify(data)}`);
        this.updateStatus(data.power === '1', Number(data.height));
      });
    } else {
      this.platform.log.debug('No updates from the server.');
    }
  }

  poll() {
    if (this.platform.cloud.connected) {
      this.platform.cloud.poll(this.device())
        .then(this.handleResponse.bind(this))
        .catch(err => {
          this.platform.log.info(err.message);
        })
        .finally(() => {
          this.pollTimer = setTimeout(this.poll.bind(this));
        });
    } else {
      this.platform.local.poll(this.device())
        .then(this.handleResponse.bind(this))
        .catch(error => {
          this.platform.log.info(error.message);
        })
        .finally(() => {
          this.pollTimer = setTimeout(this.poll.bind(this), 5000);
        });
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

  post(command: string, value: string) {
    if (this.platform.cloud.connected) {
      this.platform.cloud.post(this.device(), command, value);
    } else {
      this.platform.local.post(this.device(), command, value);
    }
  }

  sendPowerCommand() {
    this.post('power', (this.states.on ? '1' : '0'));
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
    this.post('height', this.states.height.toString());
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

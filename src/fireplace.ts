import {Service, PlatformAccessory, CharacteristicValue, CharacteristicChange} from 'homebridge';
import {IntellifirePlatform} from './platform.js';
import {clearTimeout} from 'timers';

export class Fireplace {
  // private readonly power: Service;
  private readonly sensor: Service;
  private readonly flame: Service;
  private readonly fan: Service;
  private readonly lights: Service;
  private adjustTimer!: NodeJS.Timeout;
  private pollTimer!: NodeJS.Timeout;

  private states = {
    on: false,
    ackOn: false,
    height: 2,
    fan: 0,
    lights: false,
    updated: 0,
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
      if (this.adjustTimer) {
        clearTimeout(this.adjustTimer);
      }
    });

    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Hearth and Home')
      .setCharacteristic(this.platform.Characteristic.Model, this.device().brand)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.device().serial);

    this.flame = this.accessory.getService('Flame') ||
      this.accessory.addService(this.platform.Service.Lightbulb, 'Flame', 'flame');
    this.flame.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setOn.bind(this))
      .onGet(this.getOn.bind(this));
    this.flame.getCharacteristic(this.platform.Characteristic.Brightness)
      .setProps({
        minStep: 25,
      })
      .onSet(this.setHeight.bind(this));
    this.flame.setPrimaryService(true);

    this.sensor = this.accessory.getService('Fireplace Valve') ||
      this.accessory.addService(this.platform.Service.ContactSensor, 'Fireplace Valve');

    this.fan = this.accessory.getService('Fan Speed') ||
      this.accessory.addService(this.platform.Service.Fan, 'Fan Speed', 'fan');
    this.fan.getCharacteristic(this.platform.Characteristic.RotationSpeed)
      .setProps({
        minValue: 0,
        maxValue: 4,
        minStep: 1,
      })
      .onSet(this.setFan.bind(this));

    this.lights = this.accessory.getService('Lights') ||
      this.accessory.addService(this.platform.Service.Lightbulb, 'Lights', 'lights');
    this.lights.getCharacteristic(this.platform.Characteristic.On).onSet(this.setLights.bind(this));

    this.platform.cloud.onConnected(this.status.bind(this));
    this.poll();
  }

  device() {
    return this.accessory.context.device;
  }

  handleResponse(response) {
    if (response.ok) {
      response.json().then(data => {
        this.platform.log.debug(`Status response: ${JSON.stringify(data)}`);
        this.updateStatus(data.power === '1',
          Number(data.height) * 25,
          Number(data.fanspeed),
          data.light === '1',
          Number(data.timestamp));
      });
    } else {
      this.platform.log.debug('No updates from the server.');
    }
  }

  api() {
    return this.platform.cloud.connected ? this.platform.cloud : this.platform.local;
  }

  connected() {
    return this.platform.cloud.connected;
  }

  status() {
    this.api().status(this.device())
      .then(this.handleResponse.bind(this))
      .catch(err => {
        this.platform.log.info(err.message);
      });
  }

  poll() {
    this.api().poll(this.device(), this.states.updated)
      .then(this.handleResponse.bind(this))
      .catch(err => {
        this.platform.log.info(err.message);
      })
      .finally(() => {
        this.pollTimer = setTimeout(this.poll.bind(this), this.connected() ? 0 : 5000);
      });
  }

  updateStatus(power: boolean, height: number, fan: number, lights: boolean, updated: number) {
    if (power !== this.states.ackOn) {
      this.sensor.getCharacteristic(this.platform.Characteristic.ContactSensorState).updateValue(power);
    }

    this.states.on = power;
    this.states.ackOn = power;
    this.states.height = power ? height : 0;
    this.states.fan = power ? fan : 0;
    this.states.lights = power && lights;
    this.states.updated = updated;
    this.platform.log.info(`Fireplace ${this.accessory.displayName} states set to ${JSON.stringify(this.states)}`);

    this.flame.getCharacteristic(this.platform.Characteristic.On).updateValue(this.states.on);
    this.flame.getCharacteristic(this.platform.Characteristic.Brightness).updateValue(this.states.height);
    this.fan.getCharacteristic(this.platform.Characteristic.RotationSpeed).updateValue(this.states.fan);
    this.lights.getCharacteristic(this.platform.Characteristic.On).updateValue(this.states.lights);
  }

  post(command: string, value: string) {
    this.api().post(this.device(), command, value);
  }

  sendPowerCommand(power) {
    this.post('power', (power ? '1' : '0'));
  }

  setOn(value : CharacteristicValue) {
    this.platform.log.debug(`Setting fireplace ${this.device().name} on: ${value}`);
    if (value as boolean !== this.states.on) {
      this.states.on = value as boolean;
      setImmediate(() => {
        this.sendPowerCommand(value as boolean);
      });
    }
  }

  getOn():CharacteristicValue {
    return this.states.on;
  }

  sendHeightCommand(height) {
    this.post('height', height.toString());
  }

  setHeight(value : CharacteristicValue) {
    this.platform.log.debug(`Setting fireplace ${this.device().name} height: ${value}`);
    if (!this.states.ackOn) {
      this.platform.log.debug('Limiting flame height to 50% until fireplace acknowledges it\'s on.');
      // we cap the height at 2 until we are acknowledged to be on
      value = Math.min(value as number, 50);
    }

    if (value as number !== this.states.height) {
      this.states.height = value as number;
      if (this.adjustTimer) {
        clearTimeout(this.adjustTimer);
      }
      this.adjustTimer = setTimeout(() => {
        this.sendHeightCommand(value as number / 25);
      }, 2000);
    }
  }

  sendFanCommand(fanSpeed) {
    this.post('fanspeed', fanSpeed.toString());
  }

  setFan(value : CharacteristicValue) {
    if (value as number !== this.states.height) {
      this.states.height = value as number;
      if (this.adjustTimer) {
        clearTimeout(this.adjustTimer);
      }
      this.adjustTimer = setTimeout(() => {
        this.sendFanCommand(value as number);
      }, 2000);
    }
  }

  sendLightCommand(light) {
    this.post('light', (light ? '1' : '0'));
  }

  setLights(value : CharacteristicValue) {
    if (value as boolean !== this.states.lights) {
      this.states.lights = value as boolean;
      setImmediate(() => {
        this.sendLightCommand(value as boolean);
      });
    }
  }

}

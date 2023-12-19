import {Service, PlatformAccessory, CharacteristicValue, CharacteristicChange} from 'homebridge';
import {IntellifirePlatform} from './platform.js';
import {Session} from './session.js';
import {Device} from './types.js';
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';

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
    public readonly device: Device,
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

  handleResponse(response) {
    this.platform.log.debug(`Response from Intellifire: ${response.statusText}`);
    if (response.ok) {
      response.json().then(data => {
        this.platform.log.debug(`Status response: ${JSON.stringify(data)} with headers ${JSON.stringify(response.headers)}`);
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
        .then(this.handleResponse.bind(this));
    } else {
      // do local status check
    }
  }

  poll(etag: string | null = null) {
    if (this.session.connected) {
      this.platform.log.debug(`Long poll for status on ${this.accessory.displayName}.`);
      const options = {
        method: 'GET',
      };

      if (etag) {
        options['If-None-Match'] = etag;
      }

      this.session.fetch(`https://iftapi.net/a/${this.device.serial}//applongpoll`, options)
        .then(response => {
          this.handleResponse(response);
          etag = response.headers.get('Etag');
          this.platform.log.debug(`Etag set to ${etag}`);
        })
        .catch(err => {
          this.platform.log.info('Failed to poll cloud servers: ', err.message);
        })
        .finally(() => {
          setTimeout(() => {
            this.poll(etag);
          });
        });
    } else {
      this.platform.log.debug(`Local poll for status on ${this.accessory.displayName}.`);
      this.getIpAddress()
        .then(ip => {
          fetch(`http://${ip}/poll`).then(this.handleResponse.bind(this));
        })
        .catch(err => {
          this.platform.log.info('Failed to poll local fireplace: ', err.message);
        })
        .finally(() => {
          setTimeout(this.poll.bind(this), 5000);
        });
    }
  }

  getIpAddress() {
    return new Promise(() => {
      const ip = this.platform.discovery.ip(this.device.serial);

      if (!ip) {
        throw new Error(`Fireplace ${this.accessory.displayName} is not connected locally.`);
      }

      return ip;
    });
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
    if (this.session.connected) {
      const params = new URLSearchParams();
      params.append(command, value);
      this.platform.log.info(`Sending update to fireplace ${this.accessory.displayName}: ${JSON.stringify(this.states)}=>`,
        params.toString());
      this.session.fetch(`https://iftapi.net/a/${this.device.serial}//apppost`, {
        method: 'POST',
        body: params,
      })
        .then(response => {
          if (response.ok) {
            this.platform.log.info(`Fireplace ${this.accessory.displayName} update response: ${response.status}`);
          } else {
            this.platform.log.info(`Fireplace ${this.accessory.displayName} failed to update: ${response.statusText}`);
          }
        });
    } else {
      this.getIpAddress()
        .then((ip) => {
          fetch(`http://${ip}/get_challenge`)
            .then(response => {
              if (response.ok) {
                response.text().then(challenge => {
                  const apiKeyBuffer = Buffer.from(this.device.apikey);
                  const challengeBuffer = Buffer.from(challenge, 'hex');
                  const payloadBuffer = Buffer.from(`${command}=${value})`);
                  const sig = createHash('sha256').update(Buffer.concat([apiKeyBuffer, challengeBuffer, payloadBuffer])).digest();
                  const resp = createHash('sha256').update(Buffer.concat([apiKeyBuffer, sig])).digest('hex');

                  const params = new URLSearchParams();
                  params.append("command", command);
                  params.append("value", value);
                  params.append("user", this.platform.config.userID);
                  params.append("response", resp);

                  this.session.fetch(`http://${ip}/post`, {
                    method: 'POST',
                    body: params
                  }).then(response => {
                    if (response.ok) {
                      this.platform.log.info(`Fireplace ${this.accessory.displayName} update response: ${response.status}`);
                    } else {
                      this.platform.log.info(`Fireplace ${this.accessory.displayName} failed to update: ${response.statusText}`);
                    }
                  })
                });
              } else {
                this.platform.log.info(`Fireplace ${this.accessory.displayName} update failed: ${response.statusText}`);
              }
            });
        });
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

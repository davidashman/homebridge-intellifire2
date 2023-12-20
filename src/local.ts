import {IntellifirePlatform} from './platform.js';
import * as dgram from 'dgram';
import {Device, DiscoveryInfo} from './types.js';
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';

export class Local {

  private enabled = false;
  private readonly socket;
  private ipList = new Map<string, string>();

  constructor(
    private readonly platform : IntellifirePlatform,
  ) {

    if (this.enabled) {
      this.socket = dgram.createSocket('udp4');
      this.socket.on('error', (err) => {
        this.platform.log.error(`Receiver error:\n${err.stack}`);
        this.socket.close();
      });
      this.socket.on('message', this.handleDiscoveryPacket.bind(this));

      this.platform.api.on('shutdown', () => {
        this.platform.log.info('Shutting down discovery.');
        this.socket.close();
      });

      this.socket.bind(55555, () => {
        this.socket.setBroadcast(true);
        this.platform.log.debug('Sending UDP discovery packet');
        this.socket.send('IFT-search', 3785, '255.255.255.255');
      });
    }
  }

  async handleDiscoveryPacket(msg, rinfo) {
    this.platform.log.debug(`Received UDP packet for fireplace: ${msg} (${rinfo})`);
    const data = JSON.parse(msg) as DiscoveryInfo;
    fetch(`http://${data.ip}/poll`)
      .then((response) => {
        if (response.ok) {
          response.json().then((json) => {
            this.platform.log.debug(`Fireplace ${json.serial} is at ip ${data.ip}`);
            this.ipList.set(json.serial, data.ip);
          });
        }
      })
      .catch((err) => {
        this.platform.log.info(`Failed to verify fireplace ip ${data.ip}: `, err.message);
      });
  }

  ip(serial: string) {
    return this.ipList.get(serial);
  }

  fetch(device: Device, action: string, options = {}) {
    const ip = this.platform.local.ip(device.serial);
    if (ip) {
      this.platform.log.debug(`Local poll for status on ${device.name} at ip ${ip}.`);
      return fetch(`http://${ip}/${action}`, options);
    } else {
      return new Promise((_resolve: (response: Response) => void, reject: (error: Error) => void) => {
        reject(new Error('No local IP'));
      });
    }
  }

  poll(device: Device) {
    return this.fetch(device, 'poll');
  }

  post(device: Device, command: string, value: string) {
    this.fetch(device, 'get_challenge')
      .then(response => {
        if (response.ok) {
          response.text().then(challenge => {
            const apiKeyBuffer = Buffer.from(device.apikey, 'hex');
            const challengeBuffer = Buffer.from(challenge, 'hex');
            const payloadBuffer = Buffer.from(`post:command=${command}&value=${value}`);
            const sig = createHash('sha256').update(Buffer.concat([apiKeyBuffer, challengeBuffer, payloadBuffer])).digest();
            const resp = createHash('sha256').update(Buffer.concat([apiKeyBuffer, sig])).digest('hex');

            const params = new URLSearchParams();
            params.append('command', command);
            params.append('value', value);
            params.append('user', this.platform.config.user);
            params.append('response', resp);

            this.fetch(device, 'post', {
              method: 'POST',
              body: params,
            }).then(response => {
              this.platform.log.info(`Fireplace ${device.name} update response: ${response.statusText}`);
            });
          });
        } else {
          this.platform.log.info(`Fireplace ${device.name} challenge response: ${response.statusText}`);
        }
      });
  }
}
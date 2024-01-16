import {IntellifirePlatform} from './platform.js';
import {fetch, CookieJar, Cookie} from 'node-fetch-cookies';
import EventEmitter from 'node:events';
import {clearTimeout} from 'node:timers';
import * as dgram from 'dgram';
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';

export interface Locations {

  readonly locations: Location[];

}

export interface Location {

  readonly location_id: string;
  readonly fireplaces: Device[];

}

export interface Device {

  readonly name: string;
  readonly serial: string;
  readonly brand: string;
  readonly apikey: string;

}

export interface DiscoveryInfo {

  readonly ip: string;
  readonly uuid: string;

}

export class Cloud extends EventEmitter {

  private readonly cookies = new CookieJar();
  public connected = false;
  private timer!: NodeJS.Timeout;

  constructor(
    private readonly platform : IntellifirePlatform,
  ) {
    super();
    this.platform.api.on('shutdown', () => {
      if (this.timer) {
        clearTimeout(this.timer);
      }
    });
  }

  cookieFor(name: string) {
    return Cookie.fromObject({
      name: name,
      value: this.platform.config[name],
      path: '/',
      domain: 'iftapi.net',
      subdomains: false,
      secure: false,
      expiry: null,
    });
  }

  async connect() {
    if (!this.platform.config.user) {
      throw new Error('Please configure this plugin before using.');
    }

    this.platform.log.info('Logging into Intellifire...');
    this.cookies.addCookie(this.cookieFor('user'));
    this.cookies.addCookie(this.cookieFor('auth_cookie'));
    this.cookies.addCookie(this.cookieFor('web_client_id'));
    this.ping();
  }

  onConnected(listener: () => void) {
    this.on('connected', listener);

    if (this.connected) {
      listener();
    }
  }

  ping() {
    this.fetch(null, 'enumlocations')
      .then(response => {
        this.connected = response.ok;
        this.platform.log.info(`Connection status: ${this.connected}`);
        this.platform.log.debug(response.statusText);
        this.emit(this.connected ? 'connected' : 'disconnected');
        this.timer = setTimeout(this.ping.bind(this), 300000);
      });
  }

  async fetch(device: Device | null, action : string, options = {}) {
    const serial = device ? device.serial : '';
    const url = `https://iftapi.net/a/${serial}/${action}`;
    this.platform.log.debug(`Fetching from ${url}.`);
    return fetch(this.cookies, url, options);
  }

  status(device: Device) {
    return this.fetch(device, 'apppoll');
  }

  poll(device: Device, lastUpdated: number) {
    this.platform.log.debug(`Long poll for status on ${device.name} since ${lastUpdated}.`);
    const options = {
      method: 'GET',
      headers: {'If-None-Match': `${lastUpdated}:0`},
    };

    return new Promise((resolve, reject) => {
      this.fetch(device, 'applongpoll', options)
        .then(response => {
          resolve(response);
        })
        .catch(error => {
          reject(error);
        });
    });
  }

  post(device: Device, command: string, value: string) {
    const params = new URLSearchParams();
    params.append(command, value);
    this.platform.log.info(`Sending update to fireplace ${device.name}:`, params.toString());
    this.fetch(device, 'apppost', {
      method: 'POST',
      body: params,
    }).then(response => {
      this.platform.log.info(`Fireplace ${device.name} update response: ${response.status} ${response.statusText}`);
    });
  }

  async forEachDevice(handler: (device: Device) => void) {
    this.platform.log.info('Discovering locations...');
    const locationResponse = await this.fetch(null, 'enumlocations');
    if (locationResponse.ok) {
      const locations: Locations = await locationResponse.json();
      const location_id = locations.locations[0].location_id;

      this.platform.log.info('Discovering fireplaces...');
      const fireplaceResponse = await this.fetch(null, `enumfireplaces?location_id=${location_id}`);
      if (fireplaceResponse.ok) {
        const location: Location = await fireplaceResponse.json();
        this.platform.log.info(`Found ${location.fireplaces.length} fireplaces.`);

        location.fireplaces.forEach(handler);
      }
    }
  }

}

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

  poll(device: Device, lastUpdated: number) {
    return this.fetch(device, 'poll');
  }

  status(device: Device) {
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
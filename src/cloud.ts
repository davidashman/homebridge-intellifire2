import {IntellifirePlatform} from './platform.js';
import {fetch, CookieJar, Cookie} from 'node-fetch-cookies';
import EventEmitter from 'events';
import {clearTimeout} from 'timers';
import {Device} from './types.js';

export class Cloud extends EventEmitter {

  private readonly cookies = new CookieJar();
  public connected = false;
  private timer!: NodeJS.Timeout;
  private etags = new Map<string, string>();

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

  async login() {
    if (!this.platform.config.user) {
      throw new Error('Please configure this plugin before using.');
    }

    this.platform.log.info('Logging into Intellifire...');
    this.cookies.addCookie(this.cookieFor('user'));
    this.cookies.addCookie(this.cookieFor('auth_cookie'));
    this.cookies.addCookie(this.cookieFor('web_client_id'));
    this.ping();
  }

  ping() {
    this.fetch(null, 'enumlocations').then(this.setConnected.bind(this));
  }

  setConnected(response) {
    this.connected = response.ok;
    this.platform.log.info(`Setting connected status to ${this.connected}: ${response.status}`);
    if (response.ok) {
      this.emit('connected');
      this.timer = setTimeout(this.ping.bind(this), 300000);
    } else {
      this.emit('disconnected');
      this.timer = setTimeout(this.login.bind(this), 300000);
    }
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

  poll(device: Device) {
    this.platform.log.debug(`Long poll for status on ${device.name}.`);
    const options = {
      method: 'GET',
    };

    if (this.etags.has(device.serial)) {
      options['headers'] = {'If-None-Match': this.etags.get(device.serial)};
      this.platform.log.debug(`Etag set to ${this.etags.get(device.serial)}`);
    }

    return new Promise((resolve, reject) => {
      this.fetch(device, 'applongpoll', options)
        .then(response => {
          this.etags.set(device.serial, response.headers.get('etag'));
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

}
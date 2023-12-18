import {IntellifirePlatform} from './platform.js';
import {fetch, CookieJar} from 'node-fetch-cookies';
import EventEmitter from 'events';

export class Session extends EventEmitter {

  private readonly cookies = new CookieJar();
  public connected = false;

  constructor(
    private readonly platform : IntellifirePlatform,
  ) {
    super();
  }

  async login() {
    if (!this.platform.config.password) {
      throw new Error('Please configure this plugin before using.');
    }

    this.platform.log.info('Logging into Intellifire...');

    const loginParams = new URLSearchParams();
    loginParams.append('username', this.platform.config.username);
    loginParams.append('password', this.platform.config.password);

    this.fetch('https://iftapi.net/a//login', {
      method: 'POST',
      body: loginParams,
    }).then(this.setConnected.bind(this));
  }

  ping() {
    this.fetch('https://iftapi.net/a//enumlocations').then(this.setConnected.bind(this));
  }

  setConnected(response) {
    this.connected = response.ok;
    this.platform.log.info(`Setting connected status to ${this.connected}: ${response.status}`);
    if (response.ok) {
      this.emit('connected');
      setTimeout(this.ping.bind(this), 300000);
    } else {
      this.emit('disconnected');
      setTimeout(this.login.bind(this), 300000);
    }
  }

  async fetch(url : string, options = {}) {
    this.platform.log.debug(`Fetching from ${url}.`);
    return fetch(this.cookies, url, options);
  }

}
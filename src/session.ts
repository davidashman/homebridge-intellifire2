import {IntellifirePlatform} from './platform.js';
import {fetch, CookieJar, Cookie} from 'node-fetch-cookies';
import EventEmitter from 'events';

export class Session extends EventEmitter {

  private readonly cookies = new CookieJar();
  public connected = false;

  constructor(
    private readonly platform : IntellifirePlatform,
  ) {
    super();
  }

  cookieFor(name: string) {
    return Cookie.fromObject({
      name: name,
      value: this.platform.config[name],
      path: "/",
      domain: "iftapi.net",
      subdomains: false,
      secure: false,
      expiry: null
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
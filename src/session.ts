import {IntellifirePlatform} from './platform.js';
import {fetch, CookieJar} from 'node-fetch-cookies';

export class Session {

  private readonly cookies = new CookieJar();
  private valid = false;

  constructor(
    private readonly platform : IntellifirePlatform,
  ) {
  }

  async login() {
    if (!this.platform.config.password) {
      throw new Error('Please configure this plugin before using.');
    }

    this.platform.log.info('Logging into Intellifire...');

    const loginParams = new URLSearchParams();
    loginParams.append('username', this.platform.config.username);
    loginParams.append('password', this.platform.config.password);

    const r = await fetch(this.cookies, 'https://iftapi.net/a//login', {
      method: 'POST',
      body: loginParams,
    });

    this.valid = r.ok;
    this.platform.log.info(`Logged in with response ${r.status}.`);
  }

  isValid() {
    return this.valid;
  }

  async fetch(url : string, options = {}) {
    if (!this.valid) {
      throw new Error('Please login before making API calls.');
    }

    this.platform.log.debug(`Fetching from ${url}.`);
    return fetch(this.cookies, url, options);
  }

}
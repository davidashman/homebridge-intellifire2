import {IntellifirePlatform} from './platform.js';
import {fetch, CookieJar} from 'node-fetch-cookies';

export class Session {

  constructor(
    private readonly platform : IntellifirePlatform,
    private readonly cookies : CookieJar,
  ) {
  }

  static async login(platform : IntellifirePlatform) {
    if (!platform.config.password) {
      throw new Error('Please configure this plugin before using.');
    }

    platform.log.info('Logging into Intellifire...');

    const loginParams = new URLSearchParams();
    loginParams.append('username', platform.config.username);
    loginParams.append('password', platform.config.password);

    const cookies = new CookieJar();
    const r = await fetch(cookies, 'https://iftapi.net/a//login', {
      method: 'POST',
      body: loginParams,
    });
    platform.log.info(`Logged in with response ${r.status}.`);

    return new Session(platform, cookies);
  }

  async fetch(url : string, options = {}) {
    this.platform.log.debug(`Fetching from ${url}.`);
    return fetch(this.cookies, url, options);
  }

}
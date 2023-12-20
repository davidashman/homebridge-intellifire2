import { HomebridgePluginUiServer } from '@homebridge/plugin-ui-utils';
import {CookieJar, fetch} from "node-fetch-cookies";

class PluginUiServer extends HomebridgePluginUiServer {

    constructor () {
        // super must be called first
        super();
        this.onRequest('/login', this.handleLogin.bind(this));
        this.ready();
    }

    async handleLogin(payload) {
        const loginParams = new URLSearchParams();
        loginParams.append('username', payload.username);
        loginParams.append('password', payload.password);

        const jar = new CookieJar();
        const response = await fetch(jar, 'https://iftapi.net/a//login', {
            method: 'POST',
            body: loginParams,
        });

        if (response.ok) {
            for (const cookie of jar.cookiesAll()) {
                console.log(cookie.serialize());
            }

            const cookies = jar.cookies.get('iftapi.net');
            return {
                platform: 'Intellifire',
                name: 'Intellifire',
                username: payload.username,
                user: cookies.get('user').value,
                auth_cookie: cookies.get('auth_cookie').value,
                web_client_id: cookies.get('web_client_id').value,
            };
        } else {
            return {
                error: "Login failed.  Please check your username and password."
            };
        }
    }

}

// start the instance of the class
(() => {
    return new PluginUiServer;
})();
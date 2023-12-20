import {IntellifirePlatform} from './platform.js';
import * as dgram from 'dgram';
import {DiscoveryInfo} from './types.js';

export class Discovery {

  private readonly socket;
  private ipList = new Map<string, string>();

  constructor(
    private readonly platform : IntellifirePlatform,
  ) {

    this.socket = dgram.createSocket('udp4');
    this.socket.on('error', (err) => {
      this.platform.log.error(`Receiver error:\n${err.stack}`);
      this.socket.close();
    });
    this.socket.on('message', this.handleDiscoveryPacket.bind(this));

    this.platform.api.on('shutdown', () => {
      this.platform.log.info("Shutting down discovery.");
      this.socket.close();
    });

    this.socket.bind(55555, () => {
      this.socket.setBroadcast(true);
      this.platform.log.debug(`Sending UDP discovery packet`);
      this.socket.send('IFT-search', 3785, '255.255.255.255');
    });
  }

  async handleDiscoveryPacket(msg, _) {
    this.platform.log.debug(`Received UDP packet for fireplace: ${msg}`);
    const data = JSON.parse(msg) as DiscoveryInfo;
    fetch(`http://${data.ip}/poll`)
      .then((response) => {
        if (response.ok) {
          response.json().then((json) => {
            this.platform.log.debug(`Fireplace ${json.serial} is at ip ${data.ip}`);
            this.ipList.set(json.serial, data.ip);
          })
        }
      })
      .catch((err) => {
        this.platform.log.info(`Failed to verify fireplace ip ${data.ip}: `, err.message);
      });
  }

  ip(serial: string) {
    return this.ipList.get(serial);
  }

}
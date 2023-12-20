import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import {PLATFORM_NAME, PLUGIN_NAME} from './settings.js';
import {Fireplace} from './fireplace.js';
import {Session} from './session.js';
import {Locations, Location, Device} from './types.js';
import {Discovery} from './discovery.js';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class IntellifirePlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service = this.api.hap.Service;
  public readonly Characteristic: typeof Characteristic = this.api.hap.Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  public readonly session = new Session(this);
  public readonly discovery = new Discovery(this);

  constructor(
    public readonly log: Logger,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.log.debug('Finished initializing platform:', this.config.name);
    this.session.on('connected', this.discoverDevices.bind(this));

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    // Dynamic Platform plugins should only register new accessories after this event was fired,
    // in order to ensure they weren't added to homebridge already. This event can also be used
    // to start discovery of new accessories.
    this.api.on('didFinishLaunching', () => {
      this.session.login().catch(error => this.log.error(error.message));
    });
  }

  /**
   * This function is invoked when homebridge restores cached accessories from disk at startup.
   * It should be used to setup event handlers for characteristics and update respective values.
   */
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache so we can track if it has already been registered
    this.accessories.push(accessory);
    new Fireplace(this, accessory);
  }

  /**
   * This is an example method showing how to register discovered accessories.
   * Accessories must only be registered once, previously created accessories
   * must not be registered again to prevent 'duplicate UUID' errors.
   */
  async discoverDevices() {
    this.log.info('Discovering locations...');
    const locationResponse = await this.session.fetch('https://iftapi.net/a//enumlocations');
    if (locationResponse.ok) {
      const locations: Locations = await locationResponse.json();
      const location_id = locations.locations[0].location_id;

      this.log.info('Discovering fireplaces...');
      const fireplaceResponse = await this.session.fetch(`https://iftapi.net/a//enumfireplaces?location_id=${location_id}`);
      if (fireplaceResponse.ok) {
        const location : Location = await fireplaceResponse.json();
        this.log.info(`Found ${location.fireplaces.length} fireplaces.`);

        location.fireplaces.forEach((device : Device) => {
          const uuid = this.api.hap.uuid.generate(device.serial);
          const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);
          if (existingAccessory) {
            // Update the context information for the accessory
            existingAccessory.context.device = device;
          } else {
            this.log.info('Adding new accessory:', device.name);
            const accessory = new this.api.platformAccessory(device.name, uuid);
            accessory.context.device = device;
            this.accessories.push(accessory);
            new Fireplace(this, accessory);
            this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          }
        });
      }
    }
  }

}

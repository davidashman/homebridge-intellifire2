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
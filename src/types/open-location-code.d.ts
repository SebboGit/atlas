// `open-location-code` ships ES5 with no types. The package exports a single
// `OpenLocationCode` constructor with prototype methods we use a narrow slice
// of — declaring the surface inline keeps `@/lib/geocoding/plus-code` strictly
// typed without an `@ts-expect-error` at the import.
declare module 'open-location-code' {
  /** Decoded code area; we only ever read the center fields. */
  export interface CodeArea {
    latitudeLo: number;
    longitudeLo: number;
    latitudeHi: number;
    longitudeHi: number;
    latitudeCenter: number;
    longitudeCenter: number;
    codeLength: number;
  }

  export class OpenLocationCode {
    isValid(code: string): boolean;
    isShort(code: string): boolean;
    isFull(code: string): boolean;
    encode(latitude: number, longitude: number, codeLength?: number): string;
    decode(code: string): CodeArea;
    recoverNearest(
      shortCode: string,
      referenceLatitude: number,
      referenceLongitude: number,
    ): string;
    shorten(code: string, latitude: number, longitude: number): string;
  }
}

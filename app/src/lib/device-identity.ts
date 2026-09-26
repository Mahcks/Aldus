import { deviceName } from './consumption/handoff-copy';
import { randomID } from './random-id';

export type DeviceIdentity = {
  deviceID: string;
  /** Shown to the account's other devices, e.g. "Aldus on the web". */
  label: string;
  platform: 'web' | 'ios' | 'android' | 'other';
};

const storageKey = 'aldus:device-id';
let cached: DeviceIdentity | undefined;

/** Separate live browser surfaces must not share a writer credential. */
export async function getDeviceIdentity(): Promise<DeviceIdentity> {
  if (cached) return cached;

  let deviceID = '';
  try {
    deviceID = globalThis.localStorage?.getItem(storageKey) ?? '';
    if (!deviceID) {
      deviceID = randomID();
      globalThis.localStorage?.setItem(storageKey, deviceID);
    }
  } catch {
    deviceID = randomID();
  }

  // Normal tabs have separate session storage and reloads retain their identity.
  // Duplicated tabs may inherit it, so opening always claims a fresh epoch too.
  let tabID = randomID();
  try {
    tabID = globalThis.sessionStorage?.getItem(storageKey) || tabID;
    globalThis.sessionStorage?.setItem(storageKey, tabID);
  } catch {
    // Storage-disabled browsers retain identity for this document only.
  }
  cached = {
    deviceID: deviceID + ':' + tabID,
    label: deviceName({ platform: 'web' }),
    platform: 'web',
  };
  return cached;
}

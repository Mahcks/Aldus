import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { deviceName } from './consumption/handoff-copy';
import type { DeviceIdentity } from './device-identity';
import { randomID } from './random-id';

const storageKey = 'aldus:device-id';
let pending: Promise<DeviceIdentity> | undefined;

export type { DeviceIdentity } from './device-identity';

/** One stable id per install. */
export function getDeviceIdentity(): Promise<DeviceIdentity> {
  if (!pending) {
    pending = loadDeviceIdentity().catch((error) => {
      pending = undefined;
      throw error;
    });
  }
  return pending;
}

async function loadDeviceIdentity(): Promise<DeviceIdentity> {
  let deviceID = (await AsyncStorage.getItem(storageKey)) ?? '';
  if (!deviceID) {
    deviceID = randomID();
    await AsyncStorage.setItem(storageKey, deviceID);
  }

  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : 'other';
  return { deviceID, label: deviceName({ platform }), platform };
}

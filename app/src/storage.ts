import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

// SecureStore (Keychain/Keystore) di native; localStorage di web.
export const storage = {
  get: async (key: string) =>
    Platform.OS === 'web' ? globalThis.localStorage?.getItem(key) ?? null : SecureStore.getItemAsync(key),
  set: async (key: string, value: string) =>
    Platform.OS === 'web' ? globalThis.localStorage?.setItem(key, value) : SecureStore.setItemAsync(key, value),
  remove: async (key: string) =>
    Platform.OS === 'web' ? globalThis.localStorage?.removeItem(key) : SecureStore.deleteItemAsync(key),
};

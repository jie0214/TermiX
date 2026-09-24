import * as SecureStore from 'expo-secure-store';
import type { CredentialStore } from '../features/hosts/credentials';

const options: SecureStore.SecureStoreOptions = {
  keychainService: 'termix.mobile.ssh',
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const credentialStore: CredentialStore = {
  get: key => SecureStore.getItemAsync(key, options),
  set: (key, value) => SecureStore.setItemAsync(key, value, options),
  remove: key => SecureStore.deleteItemAsync(key, options),
};

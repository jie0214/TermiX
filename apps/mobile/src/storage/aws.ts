import { requireNativeModule } from 'expo';
import * as SecureStore from 'expo-secure-store';
import { AwsRepository, type AwsNative } from '../features/aws/repository';
const options: SecureStore.SecureStoreOptions = {
  keychainService: 'termix.mobile.aws', keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
export const awsRepository = new AwsRepository({
  get: key => SecureStore.getItemAsync(key, options),
  set: (key, value) => SecureStore.setItemAsync(key, value, options),
  remove: key => SecureStore.deleteItemAsync(key, options),
}, requireNativeModule<AwsNative>('TermixSSH'));

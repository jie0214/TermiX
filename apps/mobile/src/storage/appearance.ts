import Storage from 'expo-sqlite/kv-store';
import { AppearanceStore } from '../features/appearance/store';
export const appearanceStore = new AppearanceStore(Storage);

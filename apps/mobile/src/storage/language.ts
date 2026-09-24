import Storage from 'expo-sqlite/kv-store';
import { LanguageStore } from '../features/language/store';
export const languageStore = new LanguageStore(Storage);

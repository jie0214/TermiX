import { router } from 'expo-router';
import { LanguageSettings } from '../../features/language/LanguageSettings';
export default function LanguageRoute() { return <LanguageSettings onBack={() => router.back()} />; }

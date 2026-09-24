import { router } from 'expo-router';
import { AppearanceSettings } from '../../features/appearance/AppearanceSettings';
export default function AppearanceRoute() { return <AppearanceSettings onBack={() => router.back()} />; }

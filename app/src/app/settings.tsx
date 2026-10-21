import { useRouter } from 'expo-router';
import SettingsScreen from '../screens/SettingsScreen';

export default function SettingsRoute() {
  const router = useRouter();
  return (
    <SettingsScreen
      onOpenAnalytics={(id) => router.push({ pathname: '/analytics/[id]', params: { id } })}
      onClose={() => (router.canGoBack() ? router.back() : router.replace('/'))}
    />
  );
}

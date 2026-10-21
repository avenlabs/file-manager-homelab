import { useRouter } from 'expo-router';
import HomeScreen from '../screens/HomeScreen';

export default function HomeRoute() {
  const router = useRouter();
  return (
    <HomeScreen
      onOpenSource={(id) => router.push({ pathname: '/source/[id]', params: { id } })}
      onOpenMenu={() => router.push('/settings')}
      onConnectCasaOS={() => router.push('/connect/casaos')}
    />
  );
}

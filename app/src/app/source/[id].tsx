import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import BrowserScreen from '../../screens/BrowserScreen';
import { useSources } from '../../sources';

export default function SourceRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const provider = useSources().provider(id);
  if (!provider) return <Redirect href="/" />;
  return (
    <BrowserScreen
      key={provider.id}
      provider={provider}
      onExit={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      onOpenMenu={() => router.push('/settings')}
      onOpenAnalytics={() => router.push({ pathname: '/analytics/[id]', params: { id } })}
    />
  );
}

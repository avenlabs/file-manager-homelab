import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import AnalyticsScreen from '../../screens/AnalyticsScreen';
import { CasaOSProvider } from '../../providers/casaos';
import { useSources } from '../../sources';

export default function AnalyticsRoute() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const provider = useSources().provider(id);
  if (!(provider instanceof CasaOSProvider)) return <Redirect href="/" />;
  return (
    <AnalyticsScreen provider={provider} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
  );
}

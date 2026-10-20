import { useRouter } from 'expo-router';
import AnalyticsScreen from '../screens/AnalyticsScreen';
import { useAuthedSession } from '../session';

export default function AnalyticsRoute() {
  const router = useRouter();
  return <AnalyticsScreen session={useAuthedSession()} onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))} />;
}

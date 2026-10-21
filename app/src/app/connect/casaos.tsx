import { useRouter } from 'expo-router';
import LoginScreen from '../../screens/LoginScreen';
import { useSources } from '../../sources';

export default function ConnectCasaOSRoute() {
  const router = useRouter();
  const { addCasaOS } = useSources();
  return (
    <LoginScreen
      onBack={() => (router.canGoBack() ? router.back() : router.replace('/'))}
      onLogin={async (session) => {
        const id = await addCasaOS(session);
        router.replace({ pathname: '/source/[id]', params: { id } });
      }}
    />
  );
}

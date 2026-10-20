import { useRouter } from 'expo-router';
import SettingsScreen from '../screens/SettingsScreen';
import { useAuthedSession, useSession } from '../session';

export default function SettingsRoute() {
  const router = useRouter();
  const session = useAuthedSession();
  const { prefs, setPrefs, signOut } = useSession();
  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));
  return (
    <SettingsScreen
      session={session}
      view={prefs.view}
      showHidden={prefs.showHidden}
      onChangeView={(view) => setPrefs({ view })}
      onChangeHidden={(showHidden) => setPrefs({ showHidden })}
      onOpenAnalytics={() => router.push('/analytics')}
      onClose={close}
      onLogout={signOut}
    />
  );
}

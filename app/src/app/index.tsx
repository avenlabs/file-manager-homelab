import { useRouter } from 'expo-router';
import BrowserScreen from '../screens/BrowserScreen';
import { useAuthedSession, useSession } from '../session';

export default function FilesRoute() {
  const router = useRouter();
  const session = useAuthedSession();
  const { prefs, setPrefs, signOut } = useSession();
  return (
    <BrowserScreen
      session={session}
      view={prefs.view}
      showHidden={prefs.showHidden}
      onChangeView={(view) => setPrefs({ view })}
      onLogout={signOut}
      onOpenMenu={() => router.push('/settings')}
    />
  );
}

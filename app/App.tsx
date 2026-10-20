import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { Geist_400Regular, Geist_500Medium, Geist_600SemiBold, Geist_700Bold } from '@expo-google-fonts/geist';
import { GeistMono_400Regular, GeistMono_500Medium } from '@expo-google-fonts/geist-mono';
import { storage } from './src/storage';
import type { Session } from './src/api';
import { useTheme } from './src/theme';
import LoginScreen from './src/screens/LoginScreen';
import BrowserScreen from './src/screens/BrowserScreen';

const SESSION_KEY = 'casa-files-session';

export default function App() {
  const t = useTheme();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [fontsLoaded] = useFonts({
    Geist_400Regular,
    Geist_500Medium,
    Geist_600SemiBold,
    Geist_700Bold,
    GeistMono_400Regular,
    GeistMono_500Medium,
  });

  useEffect(() => {
    storage.get(SESSION_KEY)
      .then((raw) => raw && setSession(JSON.parse(raw)))
      .finally(() => setLoading(false));
  }, []);

  const onLogin = async (s: Session) => {
    await storage.set(SESSION_KEY, JSON.stringify(s));
    setSession(s);
  };

  const onLogout = async () => {
    await storage.remove(SESSION_KEY);
    setSession(null);
  };

  return (
    <SafeAreaProvider>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <View style={{ flex: 1, backgroundColor: t.bg }}>
        {loading || !fontsLoaded ? (
          <View style={{ flex: 1, justifyContent: 'center' }}>
            <ActivityIndicator color={t.mutedText} />
          </View>
        ) : session ? (
          <BrowserScreen session={session} onLogout={onLogout} />
        ) : (
          <LoginScreen onLogin={onLogin} />
        )}
      </View>
    </SafeAreaProvider>
  );
}

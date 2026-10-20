import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import * as SecureStore from 'expo-secure-store';
import type { Session } from './src/api';
import LoginScreen from './src/screens/LoginScreen';
import BrowserScreen from './src/screens/BrowserScreen';

const SESSION_KEY = 'casa-files-session';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    SecureStore.getItemAsync(SESSION_KEY)
      .then((raw) => raw && setSession(JSON.parse(raw)))
      .finally(() => setLoading(false));
  }, []);

  const onLogin = async (s: Session) => {
    await SecureStore.setItemAsync(SESSION_KEY, JSON.stringify(s));
    setSession(s);
  };

  const onLogout = async () => {
    await SecureStore.deleteItemAsync(SESSION_KEY);
    setSession(null);
  };

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : session ? (
        <BrowserScreen session={session} onLogout={onLogout} />
      ) : (
        <LoginScreen onLogin={onLogin} />
      )}
    </SafeAreaProvider>
  );
}

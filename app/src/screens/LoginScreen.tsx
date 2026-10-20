import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { login, normalizeBaseUrl, type Session } from '../api';
import { useTheme } from '../theme';

export default function LoginScreen({ onLogin }: { onLogin: (s: Session) => void }) {
  const t = useTheme();
  const [url, setUrl] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      onLogin(await login(normalizeBaseUrl(url), password));
    } catch (e: any) {
      setError(e?.message ?? 'Gagal terhubung');
    } finally {
      setBusy(false);
    }
  };

  const input = [styles.input, { backgroundColor: t.card, color: t.text, borderColor: t.border }];

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={styles.container}
      >
        <Text style={[styles.title, { color: t.text }]}>Casa Files</Text>
        <Text style={{ color: t.muted, marginBottom: 24 }}>
          Hubungkan ke server casa-files di CasaOS kamu.
        </Text>

        <Text style={[styles.label, { color: t.muted }]}>Alamat server</Text>
        <TextInput
          style={input}
          placeholder="192.168.1.10:8088 atau https://casaos.tailnet.ts.net"
          placeholderTextColor={t.muted}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          value={url}
          onChangeText={setUrl}
        />

        <Text style={[styles.label, { color: t.muted }]}>Password</Text>
        <TextInput
          style={input}
          placeholder="APP_PASSWORD"
          placeholderTextColor={t.muted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
        />

        {error && <Text style={{ color: t.danger, marginTop: 8 }}>{error}</Text>}

        <Pressable
          style={[styles.button, { backgroundColor: t.accent, opacity: busy || !url ? 0.6 : 1 }]}
          disabled={busy || !url}
          onPress={submit}
        >
          {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Masuk</Text>}
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 24, justifyContent: 'center' },
  title: { fontSize: 32, fontWeight: '700', marginBottom: 4 },
  label: { fontSize: 13, marginTop: 12, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16 },
  button: { marginTop: 24, borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
});

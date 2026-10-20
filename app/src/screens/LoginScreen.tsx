import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, View, type TextInputInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowRight, CircleAlert, Lock, Server } from 'lucide-react-native';
import { login, normalizeBaseUrl, type Session } from '../api';
import { font, radius, useTheme } from '../theme';
import { Button, Input, Txt } from '../components/ui';
import { HeroArt, LogoMark } from '../components/Logo';

const GUIDE_URL = 'https://github.com/avenlabs/file-manager-homelab#1-jalankan-server-di-casaos';

export default function LoginScreen({ onLogin }: { onLogin: (s: Session) => void }) {
  const t = useTheme();
  const [url, setUrl] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInputInstance>(null);

  const submit = async () => {
    if (!url) return;
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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.sheet }}>
      <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.container}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
        >
          <View style={styles.brand}>
            <LogoMark size={34} color={t.text} starColor={t.sheet} />
            <Text style={[styles.wordmark, { color: t.text }]}>casa files</Text>
          </View>

          <HeroArt height={150} />

          <Text style={[styles.headline, { color: t.text }]}>Semua file homelab,{'\n'}di genggaman.</Text>
          <Txt variant="muted" style={{ textAlign: 'center', lineHeight: 21, marginTop: 10 }}>
            Upload foto & video langsung ke server CasaOS kamu.
          </Txt>

          <View style={{ gap: 14, marginTop: 26 }}>
            <View style={{ gap: 6 }}>
              <Txt variant="label">Alamat server</Txt>
              <Input
                icon={Server}
                placeholder="192.168.1.10:8088"
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="url"
                textContentType="URL"
                returnKeyType="next"
                submitBehavior="submit"
                value={url}
                onChangeText={setUrl}
                onSubmitEditing={() => passwordRef.current?.focus()}
              />
              <Txt variant="small" style={{ fontSize: 11.5 }}>
                IP server + port casa-files (bukan port dashboard CasaOS)
              </Txt>
            </View>
            <View style={{ gap: 6 }}>
              <Txt variant="label">Password</Txt>
              <Input
                ref={passwordRef}
                icon={Lock}
                placeholder="Password saat install server"
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                textContentType="password"
                returnKeyType="go"
                value={password}
                onChangeText={setPassword}
                onSubmitEditing={submit}
              />
            </View>

            {error && (
              <View style={[styles.alert, { backgroundColor: '#f6dcd5' }]}>
                <CircleAlert size={18} color={t.danger} />
                <Txt variant="label" style={{ color: t.danger, flex: 1, lineHeight: 19 }}>
                  {error}
                </Txt>
              </View>
            )}

            <Button label="Hubungkan" iconRight={ArrowRight} loading={busy} disabled={!url} onPress={submit} style={{ marginTop: 4 }} />
          </View>

          <Text style={[styles.footer, { color: t.mutedText }]}>
            Belum install server?{' '}
            <Text style={{ color: t.primary, fontFamily: font.bold }} onPress={() => Linking.openURL(GUIDE_URL)}>
              Lihat panduan
            </Text>
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 20 },
  brand: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 22 },
  wordmark: { fontFamily: font.extrabold, fontSize: 26, letterSpacing: -0.8 },
  headline: { fontFamily: font.bold, fontSize: 30, lineHeight: 35, letterSpacing: -0.9, textAlign: 'center', marginTop: 26 },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.md, padding: 12 },
  footer: { fontFamily: font.medium, fontSize: 13.5, textAlign: 'center', marginTop: 22 },
});

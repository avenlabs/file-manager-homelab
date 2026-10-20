import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View, type TextInputInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { ArrowRight, CircleAlert, HardDrive, Lock, Server } from 'lucide-react-native';
import { login, normalizeBaseUrl, type Session } from '../api';
import { radius, useTheme } from '../theme';
import { Button, Input, Txt } from '../components/ui';
import GridBackdrop from '../components/GridBackdrop';

export default function LoginScreen({ onLogin }: { onLogin: (s: Session) => void }) {
  const t = useTheme();
  const [url, setUrl] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<TextInputInstance>(null);

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

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <GridBackdrop />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
          <ScrollView
            contentContainerStyle={styles.container}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode={Platform.OS === 'ios' ? 'interactive' : 'on-drag'}
          >
            <View style={{ flex: 1, justifyContent: 'center', paddingVertical: 24 }}>
              {/* Logo: kotak ikon dengan border gradient */}
              <LinearGradient colors={t.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.logoRing}>
                <View style={[styles.logo, { backgroundColor: t.bg }]}>
                  <HardDrive size={22} color={t.text} strokeWidth={1.6} />
                </View>
              </LinearGradient>

              <Txt variant="caption" style={{ marginTop: 28 }}>
                Self-hosted · CasaOS
              </Txt>
              <Txt variant="title" style={{ fontSize: 34, marginTop: 6 }}>
                Casa Files
              </Txt>
              <Txt variant="muted" style={{ marginTop: 6, lineHeight: 20 }}>
                File pribadimu, di server sendiri.{'\n'}Masuk untuk terhubung ke homelab.
              </Txt>

              <View style={{ gap: 14, marginTop: 32 }}>
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
                  <Txt variant="mono" style={{ fontSize: 11 }}>
                    IP server (Jetson) + port casa-files, bukan port dashboard CasaOS
                  </Txt>
                </View>
                <View style={{ gap: 6 }}>
                  <Txt variant="label">Password</Txt>
                  <Input
                    ref={passwordRef}
                    icon={Lock}
                    placeholder="••••••••"
                    secureTextEntry
                    autoCapitalize="none"
                    autoCorrect={false}
                    textContentType="password"
                    returnKeyType="go"
                    value={password}
                    onChangeText={setPassword}
                    onSubmitEditing={submit}
                  />
                  <Txt variant="mono" style={{ fontSize: 11 }}>
                    Password yang dibuat saat install server
                  </Txt>
                </View>

                {error && (
                  <View style={[styles.alert, { borderColor: t.danger + '55', backgroundColor: t.danger + '14' }]}>
                    <CircleAlert size={16} color={t.danger} />
                    <Txt variant="muted" style={{ color: t.danger, flex: 1 }}>
                      {error}
                    </Txt>
                  </View>
                )}

                <Button
                  label="Hubungkan"
                  iconRight={ArrowRight}
                  loading={busy}
                  disabled={!url}
                  onPress={submit}
                  style={{ marginTop: 6 }}
                />
              </View>
            </View>

            <Txt variant="mono" style={{ textAlign: 'center', color: t.subtleText, paddingBottom: 8 }}>
              Akses dari luar rumah? Pakai Tailscale.
            </Txt>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 24 },
  logoRing: { width: 52, height: 52, borderRadius: radius.lg + 2, padding: 1.5 },
  logo: { flex: 1, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
  alert: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: radius.md, padding: 12 },
});

import type { ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronRight, LogOut, X } from 'lucide-react-native';
import type { Session } from '../api';
import { useTheme } from '../theme';
import { LogoMark } from '../components/Logo';
import { Button, IconButton, Txt } from '../components/ui';
import type { ViewMode } from './BrowserScreen';

const GUIDE_URL = 'https://github.com/avenlabs/file-manager-homelab#readme';

export default function SettingsScreen({
  session,
  view,
  showHidden,
  onChangeView,
  onChangeHidden,
  onOpenAnalytics,
  onClose,
  onLogout,
}: {
  session: Session;
  view: ViewMode;
  showHidden: boolean;
  onChangeView: (v: ViewMode) => void;
  onChangeHidden: (v: boolean) => void;
  onOpenAnalytics: () => void;
  onClose: () => void;
  onLogout: () => void;
}) {
  const t = useTheme();
  const host = session.baseUrl.replace(/^https?:\/\//, '');
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: t.bg }}>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={{ height: 40, justifyContent: 'center' }}>
          <LogoMark size={32} />
        </View>
        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Txt variant="display" dark>
              Pengaturan
            </Txt>
            <Txt variant="muted" dark style={{ marginTop: 6 }}>
              Atur app & lihat info server:
            </Txt>
          </View>
          <IconButton icon={X} variant="plain" color={t.textOnDark} onPress={onClose} accessibilityLabel="Tutup" />
        </View>

        <View style={{ marginTop: 22 }}>
          <Row title="Analitik storage" subtitle="Total storage, lokasi, kategori & file terbesar" onPress={onOpenAnalytics} />
          <Row
            title="Tampilan file"
            subtitle={view === 'grid' ? 'Grid — cocok untuk foto' : 'List — nama & detail lengkap'}
            right={
              <View style={[styles.toggle, { backgroundColor: t.bgRaised }]}>
                {(['list', 'grid'] as const).map((v) => (
                  <Pressable
                    key={v}
                    onPress={() => onChangeView(v)}
                    style={[styles.toggleItem, view === v && { backgroundColor: t.primary }]}
                  >
                    <Txt variant="label" dark style={view === v && { color: t.primaryText }}>
                      {v === 'list' ? 'List' : 'Grid'}
                    </Txt>
                  </Pressable>
                ))}
              </View>
            }
          />
          <Row
            title="File tersembunyi"
            subtitle="Tampilkan file & folder berawalan titik"
            right={
              <Switch
                value={showHidden}
                onValueChange={onChangeHidden}
                trackColor={{ true: t.primary, false: t.lineDark }}
                thumbColor={t.textOnDark}
              />
            }
          />
          <Row title="Server" subtitle={host} />
          <Row title="Panduan & bantuan" subtitle="Cara install server & akses dari luar rumah" onPress={() => Linking.openURL(GUIDE_URL)} />
        </View>

        <View style={{ flex: 1 }} />
        <Button label="Keluar" icon={LogOut} onPress={onLogout} style={{ marginTop: 28 }} />
        <Txt variant="small" dark style={{ textAlign: 'center', marginTop: 12 }}>
          Terhubung ke {host}
        </Txt>
      </ScrollView>
    </SafeAreaView>
  );
}

function Row({ title, subtitle, right, onPress }: { title: string; subtitle?: string; right?: ReactNode; onPress?: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [styles.row, { borderBottomColor: t.lineDark, opacity: pressed ? 0.6 : 1 }]}
    >
      <View style={{ flex: 1 }}>
        <Txt variant="title" dark style={{ fontSize: 19 }}>
          {title}
        </Txt>
        {subtitle && (
          <Txt variant="muted" dark style={{ marginTop: 6, fontSize: 13.5 }} numberOfLines={2}>
            {subtitle}
          </Txt>
        )}
      </View>
      {right ?? (onPress && <ChevronRight size={24} color={t.textOnDark} strokeWidth={2} />)}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flexGrow: 1, paddingHorizontal: 22, paddingTop: 8, paddingBottom: 24 },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 20, borderBottomWidth: 1 },
  toggle: { flexDirection: 'row', borderRadius: 12, padding: 3 },
  toggleItem: { paddingHorizontal: 12, height: 32, borderRadius: 10, justifyContent: 'center' },
});

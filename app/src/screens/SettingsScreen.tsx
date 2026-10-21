import { useState, type ReactNode } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChartPie, ChevronRight, Unplug, X } from 'lucide-react-native';
import type { SourceConfig } from '../providers/types';
import { DEVICE_ID, useSources } from '../sources';
import { useTheme } from '../theme';
import { LogoMark } from '../components/Logo';
import { ConfirmSheet } from '../components/Sheets';
import { SourceIcon } from '../components/SourceIcon';
import { IconButton, Txt } from '../components/ui';

const GUIDE_URL = 'https://github.com/avenlabs/file-manager-homelab#readme';

const detail = (s: SourceConfig) =>
  s.kind === 'device' ? 'Selalu tersedia' : s.kind === 'casaos' ? s.baseUrl.replace(/^https?:\/\//, '') : (s.email ?? '');

export default function SettingsScreen({
  onOpenAnalytics,
  onClose,
}: {
  onOpenAnalytics: (sourceId: string) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const { sources, removeSource, prefs, setPrefs } = useSources();
  const [toRemove, setToRemove] = useState<SourceConfig | null>(null);

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
              Sumber terhubung & tampilan:
            </Txt>
          </View>
          <IconButton icon={X} variant="plain" color={t.textOnDark} onPress={onClose} accessibilityLabel="Tutup" />
        </View>

        <Txt variant="caption" dark style={{ marginTop: 26 }}>
          Sumber penyimpanan
        </Txt>
        {sources.map((s) => (
          <View key={s.id} style={[styles.source, { borderBottomColor: t.lineDark }]}>
            <SourceIcon kind={s.kind} size={42} />
            <View style={{ flex: 1 }}>
              <Txt variant="body" dark>
                {s.label}
              </Txt>
              <Txt variant="small" dark numberOfLines={1} style={{ marginTop: 2 }}>
                {detail(s)}
              </Txt>
            </View>
            {s.kind === 'casaos' && (
              <IconButton icon={ChartPie} variant="dark" size={38} onPress={() => onOpenAnalytics(s.id)} accessibilityLabel={`Analitik ${s.label}`} />
            )}
            {s.id !== DEVICE_ID && (
              <IconButton icon={Unplug} variant="dark" size={38} color="#ff8a7a" onPress={() => setToRemove(s)} accessibilityLabel={`Putuskan ${s.label}`} />
            )}
          </View>
        ))}

        <Txt variant="caption" dark style={{ marginTop: 26 }}>
          Tampilan
        </Txt>
        <Row
          title="Tampilan file"
          subtitle={prefs.view === 'grid' ? 'Grid — cocok untuk foto' : 'List — nama & detail lengkap'}
          right={
            <View style={[styles.toggle, { backgroundColor: t.bgRaised }]}>
              {(['list', 'grid'] as const).map((v) => (
                <Pressable key={v} onPress={() => setPrefs({ view: v })} style={[styles.toggleItem, prefs.view === v && { backgroundColor: t.primary }]}>
                  <Txt variant="label" dark style={prefs.view === v && { color: t.primaryText }}>
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
              value={prefs.showHidden}
              onValueChange={(showHidden) => setPrefs({ showHidden })}
              trackColor={{ true: t.primary, false: t.lineDark }}
              thumbColor={t.textOnDark}
            />
          }
        />
        <Row title="Panduan & bantuan" subtitle="Install server CasaOS, setup Google Drive & Dropbox" onPress={() => Linking.openURL(GUIDE_URL)} />
      </ScrollView>

      <ConfirmSheet
        visible={!!toRemove}
        title={`Putuskan ${toRemove?.label ?? ''}?`}
        message="Akses app ke sumber ini dihapus dari HP. File di sumbernya tidak ikut terhapus. Bisa dihubungkan lagi kapan saja."
        confirmLabel="Putuskan"
        destructive
        onConfirm={() => toRemove && removeSource(toRemove.id)}
        onClose={() => setToRemove(null)}
      />
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
  container: { flexGrow: 1, paddingHorizontal: 22, paddingTop: 8, paddingBottom: 32 },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  source: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderBottomWidth: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 20, borderBottomWidth: 1 },
  toggle: { flexDirection: 'row', borderRadius: 12, padding: 3 },
  toggleItem: { paddingHorizontal: 12, height: 32, borderRadius: 10, justifyContent: 'center' },
});

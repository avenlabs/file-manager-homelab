import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronRight, ClipboardPaste, Plus } from 'lucide-react-native';
import { formatBytes, type StorageInfo } from '../api';
import { isDropboxConfigured, isGoogleConfigured } from '../providers/oauth';
import type { SourceConfig } from '../providers/types';
import { useSources } from '../sources';
import { radius, useTheme } from '../theme';
import { useUploadQueue } from '../uploads';
import { Screen } from '../components/Screen';
import { BottomSheet } from '../components/Sheets';
import { SourceIcon, sourceKindLabel, type SourceKind } from '../components/SourceIcon';
import { FailedSheet, UploadPanel } from '../components/UploadPanel';
import { Bar, Hatch, Txt } from '../components/ui';

function subtitleOf(s: SourceConfig) {
  switch (s.kind) {
    case 'device':
      return 'Galeri foto & video, dan folder di HP';
    case 'casaos':
      return s.baseUrl.replace(/^https?:\/\//, '');
    default:
      return s.email ?? sourceKindLabel[s.kind];
  }
}

/** Beranda: semua sumber penyimpanan + tambah sumber baru. Tidak ada login wajib. */
export default function HomeScreen({
  onOpenSource,
  onOpenMenu,
  onConnectCasaOS,
}: {
  onOpenSource: (id: string) => void;
  onOpenMenu: () => void;
  onConnectCasaOS: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { sources, addGoogleDrive, addDropbox, clipboard } = useSources();
  const uploads = useUploadQueue();
  const [adding, setAdding] = useState(false);
  const [connecting, setConnecting] = useState<SourceKind | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showFailed, setShowFailed] = useState(false);
  const activeUploads = uploads.items.filter((i) => i.status === 'uploading' || i.status === 'queued' || i.status === 'retrying').length;

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  const connect = async (kind: 'gdrive' | 'dropbox') => {
    setAdding(false);
    setConnecting(kind);
    try {
      const id = await (kind === 'gdrive' ? addGoogleDrive() : addDropbox());
      onOpenSource(id);
    } catch (e: any) {
      setToast(e?.message ?? 'Gagal menghubungkan');
    } finally {
      setConnecting(null);
    }
  };

  const options: { kind: SourceKind; description: string; onPress?: () => void; note?: string }[] = [
    { kind: 'casaos', description: 'Server homelab dengan casa-files-server', onPress: () => (setAdding(false), onConnectCasaOS()) },
    {
      kind: 'gdrive',
      description: 'Lihat, upload & salin file Google Drive',
      onPress: isGoogleConfigured() ? () => connect('gdrive') : undefined,
      note: isGoogleConfigured() ? undefined : 'Belum dikonfigurasi di build ini',
    },
    {
      kind: 'dropbox',
      description: 'Lihat, upload & salin file Dropbox',
      onPress: isDropboxConfigured() ? () => connect('dropbox') : undefined,
      note: isDropboxConfigured() ? undefined : 'Belum dikonfigurasi di build ini',
    },
    { kind: 'mega', description: 'Penyimpanan terenkripsi MEGA', note: 'Segera hadir' },
  ];

  return (
    <Screen title="Halo!" subtitle="Pilih penyimpanan:" badge={activeUploads} onMenu={onOpenMenu}>
      <ScrollView contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: insets.bottom + 180 }}>
        {sources.length === 1 && (
          <View style={[styles.welcome, { backgroundColor: t.bg }]}>
            <Txt variant="heading" dark>
              Satu app untuk semua file kamu
            </Txt>
            <Txt variant="muted" dark style={{ marginTop: 6, lineHeight: 20 }}>
              Mulai dengan file di HP ini, atau tambahkan server CasaOS, Google Drive, dan Dropbox. Tambahkan hanya
              yang kamu butuhkan.
            </Txt>
          </View>
        )}

        {sources.map((s) => (
          <SourceCard key={s.id} source={s} onPress={() => onOpenSource(s.id)} />
        ))}

        <Pressable onPress={() => setAdding(true)} accessibilityLabel="Tambah sumber" style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}>
          <Hatch style={[styles.add, { borderRadius: radius.xl }]}>
            <View style={[styles.addIcon, { backgroundColor: t.primary }]}>
              <Plus size={22} color={t.primaryText} strokeWidth={2.4} />
            </View>
            <View style={{ flex: 1 }}>
              <Txt variant="body">Tambah sumber</Txt>
              <Txt variant="small" style={{ marginTop: 2 }}>
                Server CasaOS · Google Drive · Dropbox
              </Txt>
            </View>
          </Hatch>
        </Pressable>

        {clipboard && (
          <View style={[styles.hint, { backgroundColor: t.card }]}>
            <ClipboardPaste size={18} color={t.mutedText} />
            <Txt variant="small" style={{ flex: 1 }}>
              {clipboard.items.length} item di clipboard. Buka sumber & folder tujuan, lalu tap Tempel.
            </Txt>
          </View>
        )}
      </ScrollView>

      <View style={[styles.dock, { paddingBottom: insets.bottom + 14 }]} pointerEvents="box-none">
        {toast && (
          <View style={[styles.toast, { backgroundColor: t.bg }]}>
            <Txt variant="label" dark numberOfLines={3}>
              {toast}
            </Txt>
          </View>
        )}
        <UploadPanel onShowFailed={() => setShowFailed(true)} />
      </View>

      {connecting && (
        <View style={[StyleSheet.absoluteFill, styles.busy]}>
          <ActivityIndicator color={t.primary} size="large" />
          <Txt variant="label" style={{ marginTop: 12 }}>
            Menghubungkan {sourceKindLabel[connecting]}…
          </Txt>
        </View>
      )}

      <BottomSheet visible={adding} onClose={() => setAdding(false)}>
        <View style={{ paddingHorizontal: 24, marginBottom: 8 }}>
          <Txt variant="title">Tambah sumber</Txt>
          <Txt variant="muted" style={{ marginTop: 4 }}>
            Hubungkan hanya yang kamu butuhkan. Bisa diputus kapan saja.
          </Txt>
        </View>
        {options.map((o) => (
          <Pressable
            key={o.kind}
            disabled={!o.onPress}
            onPress={o.onPress}
            style={({ pressed }) => [styles.option, { opacity: !o.onPress ? 0.45 : 1 }, pressed && { backgroundColor: t.panel }]}
          >
            <SourceIcon kind={o.kind} size={46} />
            <View style={{ flex: 1 }}>
              <Txt variant="body">{sourceKindLabel[o.kind]}</Txt>
              <Txt variant="small" style={{ marginTop: 2 }}>
                {o.note ?? o.description}
              </Txt>
            </View>
            {o.onPress && <ChevronRight size={20} color={t.mutedText} />}
          </Pressable>
        ))}
      </BottomSheet>
      <FailedSheet visible={showFailed} onClose={() => setShowFailed(false)} />
    </Screen>
  );
}

function SourceCard({ source, onPress }: { source: SourceConfig; onPress: () => void }) {
  const t = useTheme();
  const { provider } = useSources();
  const p = provider(source.id);
  const [info, setInfo] = useState<StorageInfo | null>(null);
  useEffect(() => {
    let alive = true;
    p?.storage?.()
      .then((i) => alive && setInfo(i))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [p]);
  const ratio = info?.total ? info.used / info.total : 0;
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`Buka ${source.label}`}
      style={({ pressed }) => [styles.card, { backgroundColor: t.card, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <SourceIcon kind={source.kind} />
        <View style={{ flex: 1 }}>
          <Txt variant="heading" numberOfLines={1}>
            {source.label}
          </Txt>
          <Txt variant="small" numberOfLines={1} style={{ marginTop: 2 }}>
            {subtitleOf(source)}
          </Txt>
        </View>
        <ChevronRight size={22} color={t.mutedText} strokeWidth={2.2} />
      </View>
      {info && (
        <View style={{ marginTop: 14 }}>
          <Bar value={ratio} color={ratio > 0.9 ? t.danger : t.primary} />
          <Txt variant="small" style={{ marginTop: 6, fontSize: 11.5 }}>
            {formatBytes(info.used)} dari {formatBytes(info.total)} terpakai · sisa {formatBytes(info.free)}
          </Txt>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  welcome: { borderRadius: radius.xl, padding: 18 },
  card: { borderRadius: radius.xl, padding: 16 },
  add: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  addIcon: { width: 52, height: 52, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.lg },
  option: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 20, paddingVertical: 10, marginHorizontal: 8, borderRadius: radius.lg },
  dock: { position: 'absolute', left: 14, right: 14, bottom: 0, gap: 10 },
  toast: { alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.lg, maxWidth: '100%' },
  busy: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(217,219,193,0.85)' },
});

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  ApiError,
  fileUrl,
  formatBytes,
  isImage,
  isVideo,
  joinPath,
  listDir,
  mkdir,
  parentPath,
  remove,
  rename,
  storageInfo,
  type Entry,
  type Session,
  type StorageInfo,
} from '../api';
import { useTheme, type Theme } from '../theme';
import { useUploads, type PickedFile } from '../useUploads';
import { ActionSheet, PromptSheet, type SheetAction } from '../components/Sheets';
import PreviewModal, { shareEntry } from '../components/PreviewModal';

const baseName = (uri: string) => decodeURIComponent(uri.split('/').pop() || `file-${Date.now()}`);

export default function BrowserScreen({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [storage, setStorage] = useState<StorageInfo | null>(null);
  const [preview, setPreview] = useState<Entry | null>(null);
  const [sheet, setSheet] = useState<{ title?: string; actions: SheetAction[] } | null>(null);
  const [prompt, setPrompt] = useState<{ title: string; initial?: string; confirm: string; run: (v: string) => Promise<unknown> } | null>(null);

  const pathRef = useRef(path);
  pathRef.current = path;

  const load = useCallback(
    async (p: string) => {
      setLoading(true);
      setError(null);
      try {
        const res = await listDir(session, p);
        if (pathRef.current === p) setEntries(res.entries);
      } catch (e: any) {
        if (e instanceof ApiError && e.status === 401) return onLogout();
        setError(e?.message ?? 'Gagal memuat');
      } finally {
        setLoading(false);
      }
    },
    [session, onLogout],
  );

  const refreshStorage = useCallback(() => {
    storageInfo(session).then(setStorage).catch(() => {});
  }, [session]);

  useEffect(() => {
    load(path);
  }, [path, load]);
  useEffect(refreshStorage, [refreshStorage]);

  // Tombol back Android: naik satu folder.
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (pathRef.current === '/') return false;
      setPath(parentPath(pathRef.current));
      return true;
    });
    return () => sub.remove();
  }, []);

  const onUploadDone = useCallback(
    (destDir: string) => {
      if (destDir === pathRef.current) load(destDir);
      refreshStorage();
    },
    [load, refreshStorage],
  );
  const uploads = useUploads(session, onUploadDone);

  // ---------- aksi ----------

  const pickMedia = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return Alert.alert('Izin ditolak', 'Aktifkan izin di Settings untuk melanjutkan.');
    const opts: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images', 'videos'],
      quality: 1,
      // Kirim file asli (HEIC/HEVC) tanpa konversi di iOS.
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Current,
    };
    const res = fromCamera
      ? await ImagePicker.launchCameraAsync(opts)
      : await ImagePicker.launchImageLibraryAsync({ ...opts, allowsMultipleSelection: true, selectionLimit: 0 });
    if (res.canceled) return;
    const files: PickedFile[] = res.assets.map((a) => ({
      uri: a.uri,
      name: a.fileName || baseName(a.uri),
      mimeType: a.mimeType,
      size: a.fileSize,
    }));
    uploads.enqueue(files, path);
  };

  const pickDocuments = async () => {
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (res.canceled) return;
    uploads.enqueue(
      res.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size })),
      path,
    );
  };

  const runSafe = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      load(path);
      refreshStorage();
    } catch (e: any) {
      Alert.alert('Gagal', e?.message ?? String(e));
    }
  };

  const openAddMenu = () =>
    setSheet({
      title: `Upload ke ${path}`,
      actions: [
        { label: 'Foto & Video dari Galeri', onPress: () => pickMedia(false) },
        { label: 'Ambil dengan Kamera', onPress: () => pickMedia(true) },
        { label: 'File Lain', onPress: pickDocuments },
        {
          label: 'Folder Baru',
          onPress: () =>
            setPrompt({ title: 'Folder baru', confirm: 'Buat', run: (name) => mkdir(session, joinPath(path, name)) }),
        },
      ],
    });

  const openEntryMenu = (e: Entry) =>
    setSheet({
      title: e.name,
      actions: [
        ...(!e.isDir
          ? [{ label: 'Bagikan / Simpan ke Perangkat', onPress: () => runSafe(() => shareEntry(session, e)) }]
          : []),
        {
          label: 'Ganti Nama',
          onPress: () =>
            setPrompt({
              title: 'Ganti nama',
              initial: e.name,
              confirm: 'Simpan',
              run: (name) => rename(session, e.path, joinPath(parentPath(e.path), name)),
            }),
        },
        {
          label: 'Hapus',
          destructive: true,
          onPress: () =>
            Alert.alert('Hapus?', `"${e.name}" akan dihapus permanen${e.isDir ? ' beserta isinya' : ''}.`, [
              { text: 'Batal', style: 'cancel' },
              { text: 'Hapus', style: 'destructive', onPress: () => runSafe(() => remove(session, e.path)) },
            ]),
        },
      ],
    });

  const openSettings = () =>
    setSheet({
      title: session.baseUrl,
      actions: [{ label: 'Logout', destructive: true, onPress: onLogout }],
    });

  // ---------- render ----------

  const renderItem = ({ item }: { item: Entry }) => (
    <Pressable
      style={({ pressed }) => [styles.row, { backgroundColor: pressed ? t.border : t.card, borderBottomColor: t.border }]}
      onPress={() => (item.isDir ? setPath(item.path) : setPreview(item))}
      onLongPress={() => openEntryMenu(item)}
    >
      <Thumb entry={item} session={session} t={t} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 16 }} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>
          {item.isDir ? 'Folder' : formatBytes(item.size)} · {new Date(item.modTime).toLocaleDateString()}
        </Text>
      </View>
      <Pressable hitSlop={12} onPress={() => openEntryMenu(item)}>
        <Text style={{ color: t.muted, fontSize: 20, paddingHorizontal: 6 }}>⋯</Text>
      </Pressable>
    </Pressable>
  );

  const crumbs = path === '/' ? ['Storage'] : ['Storage', ...path.split('/').filter(Boolean)];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={styles.header}>
        {path !== '/' ? (
          <Pressable hitSlop={10} onPress={() => setPath(parentPath(path))}>
            <Text style={{ color: t.accent, fontSize: 26, width: 32 }}>‹</Text>
          </Pressable>
        ) : (
          <View style={{ width: 32 }} />
        )}
        <Text style={[styles.headerTitle, { color: t.text }]} numberOfLines={1}>
          {crumbs[crumbs.length - 1]}
        </Text>
        <Pressable hitSlop={10} onPress={openSettings}>
          <Text style={{ color: t.accent, fontSize: 20, width: 32, textAlign: 'right' }}>⚙︎</Text>
        </Pressable>
      </View>

      <Text style={{ color: t.muted, fontSize: 12, paddingHorizontal: 16 }} numberOfLines={1}>
        {crumbs.join(' / ')}
      </Text>
      {storage && <StorageBar info={storage} t={t} />}

      {error ? (
        <View style={styles.empty}>
          <Text style={{ color: t.danger, marginBottom: 12 }}>{error}</Text>
          <Pressable onPress={() => load(path)}>
            <Text style={{ color: t.accent }}>Coba lagi</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={entries}
          keyExtractor={(e) => e.path}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={loading && entries.length > 0} onRefresh={() => load(path)} />}
          contentContainerStyle={{ paddingBottom: 120 + insets.bottom }}
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator style={{ marginTop: 40 }} />
            ) : (
              <Text style={[styles.empty, { color: t.muted }]}>Folder kosong. Tekan + untuk upload.</Text>
            )
          }
        />
      )}

      <UploadPanel uploads={uploads} t={t} bottom={insets.bottom} />

      <Pressable
        style={[styles.fab, { backgroundColor: t.accent, bottom: 24 + insets.bottom }]}
        onPress={openAddMenu}
      >
        <Text style={{ color: '#fff', fontSize: 30, lineHeight: 32 }}>+</Text>
      </Pressable>

      <ActionSheet title={sheet?.title} actions={sheet?.actions ?? null} onClose={() => setSheet(null)} />
      <PromptSheet
        visible={!!prompt}
        title={prompt?.title ?? ''}
        initial={prompt?.initial}
        confirmLabel={prompt?.confirm ?? 'OK'}
        onClose={() => setPrompt(null)}
        onSubmit={(v) => {
          const run = prompt!.run;
          setPrompt(null);
          runSafe(() => run(v));
        }}
      />
      <PreviewModal session={session} entry={preview} onClose={() => setPreview(null)} />
    </SafeAreaView>
  );
}

function Thumb({ entry, session, t }: { entry: Entry; session: Session; t: Theme }) {
  if (isImage(entry)) {
    return (
      <Image
        source={{ uri: fileUrl(session, entry.path) }}
        style={[styles.thumb, { backgroundColor: t.border }]}
        contentFit="cover"
        cachePolicy="disk"
        recyclingKey={entry.path}
      />
    );
  }
  const icon = entry.isDir ? '📁' : isVideo(entry) ? '🎬' : entry.mime?.startsWith('audio/') ? '🎵' : '📄';
  return (
    <View style={[styles.thumb, { alignItems: 'center', justifyContent: 'center' }]}>
      <Text style={{ fontSize: 26 }}>{icon}</Text>
    </View>
  );
}

function StorageBar({ info, t }: { info: StorageInfo; t: Theme }) {
  const pct = info.total ? info.used / info.total : 0;
  return (
    <View style={{ paddingHorizontal: 16, paddingVertical: 10 }}>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: t.border, overflow: 'hidden' }}>
        <View style={{ width: `${pct * 100}%`, height: '100%', backgroundColor: pct > 0.9 ? t.danger : t.accent }} />
      </View>
      <Text style={{ color: t.muted, fontSize: 12, marginTop: 4 }}>
        {formatBytes(info.used)} dari {formatBytes(info.total)} terpakai · sisa {formatBytes(info.free)}
      </Text>
    </View>
  );
}

function UploadPanel({ uploads, t, bottom }: { uploads: ReturnType<typeof useUploads>; t: Theme; bottom: number }) {
  const { items, cancel, clearFinished } = uploads;
  if (items.length === 0) return null;
  const running = items.filter((i) => i.status === 'uploading' || i.status === 'queued');
  const failed = items.filter((i) => i.status === 'error');
  const sent = items.reduce((s, i) => s + (i.status === 'done' ? i.total : i.sent), 0);
  const total = items.reduce((s, i) => s + i.total, 0);
  const current = items.find((i) => i.status === 'uploading');

  return (
    <View style={[styles.panel, { backgroundColor: t.card, borderColor: t.border, bottom: 24 + bottom }]}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontWeight: '600' }}>
          {running.length > 0
            ? `Mengupload ${items.length - running.length + 1}/${items.length}`
            : `Upload selesai${failed.length ? ` · ${failed.length} gagal` : ''}`}
        </Text>
        <Text style={{ color: t.muted, fontSize: 12 }} numberOfLines={1}>
          {current
            ? `${current.name} · ${formatBytes(current.sent)}/${formatBytes(current.total)}`
            : failed[0]
              ? `${failed[0].name}: ${failed[0].error}`
              : `${formatBytes(sent)} terkirim`}
        </Text>
        <View style={{ height: 4, borderRadius: 2, backgroundColor: t.border, marginTop: 6, overflow: 'hidden' }}>
          <View style={{ width: `${total ? (sent / total) * 100 : 0}%`, height: '100%', backgroundColor: t.accent }} />
        </View>
      </View>
      <Pressable
        hitSlop={10}
        onPress={() => (running.length > 0 ? running.forEach((i) => cancel(i.id)) : clearFinished())}
      >
        <Text style={{ color: running.length > 0 ? t.danger : t.accent, marginLeft: 12 }}>
          {running.length > 0 ? 'Batal' : 'Tutup'}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8 },
  headerTitle: { flex: 1, fontSize: 22, fontWeight: '700', textAlign: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  thumb: { width: 44, height: 44, borderRadius: 6 },
  empty: { textAlign: 'center', marginTop: 40, alignItems: 'center' },
  fab: {
    position: 'absolute',
    right: 20,
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
  },
  panel: {
    position: 'absolute',
    left: 16,
    right: 92,
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
});

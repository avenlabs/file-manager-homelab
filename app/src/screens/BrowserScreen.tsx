import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  Archive,
  Camera,
  ChevronLeft,
  CloudUpload,
  Ellipsis,
  FileText,
  Film,
  Folder,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Images,
  LayoutGrid,
  List,
  LogOut,
  Music,
  Pencil,
  Play,
  Plus,
  Settings2,
  Share2,
  Trash2,
  X,
} from 'lucide-react-native';
import {
  ApiError,
  fileUrl,
  formatBytes,
  formatDate,
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
import { radius, useTheme } from '../theme';
import { storage } from '../storage';
import { useUploads, type PickedFile } from '../useUploads';
import { ActionSheet, PromptSheet, type SheetAction } from '../components/Sheets';
import PreviewModal, { shareEntry } from '../components/PreviewModal';
import { Button, Card, GradientBar, IconButton, IconTile, Txt, type Icon } from '../components/ui';

const VIEW_KEY = 'casa-files-view';
const GRID_COLS = 3;
const GRID_GAP = 8;
const PAD = 16;

const baseName = (uri: string) => decodeURIComponent(uri.split('/').pop() || `file-${Date.now()}`);

function iconFor(e: Entry): Icon {
  if (e.isDir) return Folder;
  if (isImage(e)) return Images;
  if (isVideo(e)) return Film;
  if (e.mime?.startsWith('audio/')) return Music;
  if (/\.(zip|tar|gz|7z|rar)$/i.test(e.name)) return Archive;
  return FileText;
}

export default function BrowserScreen({ session, onLogout }: { session: Session; onLogout: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [view, setView] = useState<'list' | 'grid'>('list');
  const [preview, setPreview] = useState<Entry | null>(null);
  const [sheet, setSheet] = useState<{ title?: string; actions: SheetAction[] } | null>(null);
  const [prompt, setPrompt] = useState<{
    title: string;
    description?: string;
    initial?: string;
    confirm: string;
    run: (v: string) => Promise<unknown>;
  } | null>(null);

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
    storageInfo(session).then(setInfo).catch(() => {});
  }, [session]);

  useEffect(() => {
    load(path);
  }, [path, load]);
  useEffect(refreshStorage, [refreshStorage]);
  useEffect(() => {
    storage.get(VIEW_KEY).then((v) => (v === 'grid' || v === 'list') && setView(v)).catch(() => {});
  }, []);

  const toggleView = () => {
    const next = view === 'list' ? 'grid' : 'list';
    setView(next);
    storage.set(VIEW_KEY, next).catch(() => {});
  };

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
        { label: 'Foto & Video', description: 'Pilih banyak sekaligus, kualitas asli', icon: Images, onPress: () => pickMedia(false) },
        { label: 'Kamera', description: 'Ambil foto atau video lalu upload', icon: Camera, onPress: () => pickMedia(true) },
        { label: 'File', description: 'Dokumen, arsip, atau file apa pun', icon: FileText, onPress: pickDocuments },
        {
          label: 'Folder baru',
          description: 'Buat folder di lokasi ini',
          icon: FolderPlus,
          onPress: () =>
            setPrompt({
              title: 'Folder baru',
              description: `Dibuat di ${path}`,
              confirm: 'Buat',
              run: (name) => mkdir(session, joinPath(path, name)),
            }),
        },
      ],
    });

  const openEntryMenu = (e: Entry) =>
    setSheet({
      title: e.name,
      actions: [
        ...(!e.isDir
          ? [{ label: 'Bagikan / Simpan', description: 'Simpan ke Photos atau app lain', icon: Share2, onPress: () => runSafe(() => shareEntry(session, e)) }]
          : []),
        {
          label: 'Ganti nama',
          icon: Pencil,
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
          description: 'Tidak bisa dibatalkan',
          icon: Trash2,
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
      title: session.baseUrl.replace(/^https?:\/\//, ''),
      actions: [{ label: 'Keluar', description: 'Putuskan dari server ini', icon: LogOut, destructive: true, onPress: onLogout }],
    });

  const open = (e: Entry) => (e.isDir ? setPath(e.path) : setPreview(e));

  // ---------- render ----------

  const tileSize = (width - PAD * 2 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;
  const folders = entries.filter((e) => e.isDir).length;
  const files = entries.length - folders;
  const segments = path.split('/').filter(Boolean);
  const title = segments.length ? segments[segments.length - 1] : 'Storage';

  const renderRow = ({ item }: { item: Entry }) => (
    <Pressable
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.muted }]}
      onPress={() => open(item)}
      onLongPress={() => openEntryMenu(item)}
    >
      {isImage(item) ? (
        <Thumb entry={item} session={session} size={44} />
      ) : (
        <IconTile icon={iconFor(item)} size={44} />
      )}
      <View style={{ flex: 1 }}>
        <Txt variant="body" numberOfLines={1}>
          {item.name}
        </Txt>
        <Txt variant="mono" style={{ marginTop: 3 }}>
          {item.isDir ? 'folder' : formatBytes(item.size)} · {formatDate(item.modTime)}
        </Txt>
      </View>
      <IconButton icon={Ellipsis} variant="ghost" size={32} color={t.mutedText} onPress={() => openEntryMenu(item)} />
    </Pressable>
  );

  const renderTile = ({ item }: { item: Entry }) => (
    <Pressable
      style={({ pressed }) => [{ width: tileSize, opacity: pressed ? 0.75 : 1 }]}
      onPress={() => open(item)}
      onLongPress={() => openEntryMenu(item)}
    >
      {isImage(item) ? (
        <Thumb entry={item} session={session} size={tileSize} />
      ) : (
        <View
          style={[
            styles.tile,
            { width: tileSize, height: tileSize, backgroundColor: t.muted, borderColor: t.border },
          ]}
        >
          {(() => {
            const I = iconFor(item);
            return <I size={tileSize * 0.28} color={t.text} strokeWidth={1.4} />;
          })()}
          {isVideo(item) && (
            <View style={[styles.badge, { backgroundColor: t.bg + 'cc', borderColor: t.border }]}>
              <Play size={10} color={t.text} fill={t.text} />
              <Txt variant="mono" style={{ fontSize: 10, color: t.text }}>
                {item.name.split('.').pop()?.toUpperCase()}
              </Txt>
            </View>
          )}
        </View>
      )}
      <Txt variant="label" numberOfLines={1} style={{ marginTop: 6 }}>
        {item.name}
      </Txt>
      <Txt variant="mono" numberOfLines={1} style={{ fontSize: 11, marginTop: 1 }}>
        {item.isDir ? 'folder' : formatBytes(item.size)}
      </Txt>
    </Pressable>
  );

  const header = (
    <View>
      {info && path === '/' && <StorageCard info={info} />}
      <View style={styles.sectionHeader}>
        <Txt variant="caption">
          {folders} folder · {files} file
        </Txt>
        {loading && entries.length > 0 && <ActivityIndicator size="small" color={t.subtleText} />}
      </View>
    </View>
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      {/* Top bar */}
      <View style={styles.topBar}>
        {path !== '/' ? (
          <IconButton icon={ChevronLeft} onPress={() => setPath(parentPath(path))} />
        ) : (
          <LinearGradient colors={t.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.logoRing}>
            <View style={[styles.logo, { backgroundColor: t.bg }]}>
              <HardDrive size={16} color={t.text} strokeWidth={1.75} />
            </View>
          </LinearGradient>
        )}
        <View style={{ flex: 1 }} />
        <IconButton icon={view === 'list' ? LayoutGrid : List} onPress={toggleView} />
        <IconButton icon={Settings2} onPress={openSettings} />
      </View>

      <View style={{ paddingHorizontal: PAD, paddingTop: 14, paddingBottom: 12 }}>
        <Txt variant="mono" numberOfLines={1}>
          ~{path === '/' ? '/' : path}
        </Txt>
        <Txt variant="title" numberOfLines={1} style={{ marginTop: 4 }}>
          {title}
        </Txt>
      </View>

      {error ? (
        <View style={styles.centerBox}>
          <Txt variant="muted" style={{ color: t.danger, marginBottom: 14 }}>
            {error}
          </Txt>
          <Button label="Coba lagi" variant="outline" onPress={() => load(path)} />
        </View>
      ) : (
        <FlatList
          key={view}
          data={entries}
          numColumns={view === 'grid' ? GRID_COLS : 1}
          keyExtractor={(e) => e.path}
          renderItem={view === 'grid' ? renderTile : renderRow}
          columnWrapperStyle={view === 'grid' ? { gap: GRID_GAP, paddingHorizontal: PAD } : undefined}
          ItemSeparatorComponent={
            view === 'grid'
              ? () => <View style={{ height: 14 }} />
              : () => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.border, marginLeft: PAD + 44 + 14 }} />
          }
          ListHeaderComponent={header}
          refreshControl={<RefreshControl tintColor={t.mutedText} refreshing={false} onRefresh={() => load(path)} />}
          contentContainerStyle={{ paddingBottom: 140 + insets.bottom }}
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator style={{ marginTop: 40 }} color={t.mutedText} />
            ) : (
              <View style={[styles.empty, { borderColor: t.border }]}>
                <IconTile icon={FolderOpen} size={48} color={t.mutedText} />
                <Txt variant="heading" style={{ marginTop: 14 }}>
                  Folder kosong
                </Txt>
                <Txt variant="muted" style={{ marginTop: 4, textAlign: 'center' }}>
                  Tap Upload untuk menambah foto, video, atau file.
                </Txt>
              </View>
            )
          }
        />
      )}

      {/* Dock bawah: panel upload + tombol upload */}
      <View style={[styles.dock, { paddingBottom: insets.bottom + 16 }]} pointerEvents="box-none">
        <UploadPanel uploads={uploads} />
        <LinearGradient colors={t.gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.fabRing}>
          <Button label="Upload" icon={Plus} onPress={openAddMenu} style={styles.fab} />
        </LinearGradient>
      </View>

      <ActionSheet title={sheet?.title} actions={sheet?.actions ?? null} onClose={() => setSheet(null)} />
      <PromptSheet
        visible={!!prompt}
        title={prompt?.title ?? ''}
        description={prompt?.description}
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

function Thumb({ entry, session, size }: { entry: Entry; session: Session; size: number }) {
  const t = useTheme();
  return (
    <Image
      source={{ uri: fileUrl(session, entry.path) }}
      style={{
        width: size,
        height: size,
        borderRadius: size > 60 ? radius.lg : radius.md + 2,
        backgroundColor: t.muted,
        borderWidth: StyleSheet.hairlineWidth * 2,
        borderColor: t.border,
      }}
      contentFit="cover"
      cachePolicy="disk"
      recyclingKey={entry.path}
      transition={150}
    />
  );
}

function StorageCard({ info }: { info: StorageInfo }) {
  const t = useTheme();
  const pct = info.total ? info.used / info.total : 0;
  return (
    <Card style={{ marginHorizontal: PAD, marginBottom: 8, padding: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <HardDrive size={15} color={t.mutedText} strokeWidth={1.75} />
        <Txt variant="label" style={{ flex: 1 }}>
          Penyimpanan
        </Txt>
        <Txt variant="mono" style={{ color: t.text }}>
          {Math.round(pct * 100)}%
        </Txt>
      </View>
      <View style={{ marginVertical: 12 }}>
        <GradientBar value={pct} height={6} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Txt variant="mono">
          {formatBytes(info.used)} / {formatBytes(info.total)}
        </Txt>
        <Txt variant="mono">{formatBytes(info.free)} bebas</Txt>
      </View>
    </Card>
  );
}

function UploadPanel({ uploads }: { uploads: ReturnType<typeof useUploads> }) {
  const t = useTheme();
  const { items, cancel, clearFinished } = uploads;
  if (items.length === 0) return null;
  const running = items.filter((i) => i.status === 'uploading' || i.status === 'queued');
  const failed = items.filter((i) => i.status === 'error');
  const sent = items.reduce((s, i) => s + (i.status === 'done' ? i.total : i.sent), 0);
  const total = items.reduce((s, i) => s + i.total, 0);
  const current = items.find((i) => i.status === 'uploading');
  const doneCount = items.length - running.length;

  return (
    <Card style={{ padding: 14, marginBottom: 12, width: '100%' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <IconTile icon={CloudUpload} size={38} />
        <View style={{ flex: 1 }}>
          <Txt variant="label">
            {running.length > 0
              ? `Mengupload ${Math.min(doneCount + 1, items.length)} dari ${items.length}`
              : `Upload selesai${failed.length ? ` · ${failed.length} gagal` : ''}`}
          </Txt>
          <Txt variant="mono" numberOfLines={1} style={{ marginTop: 2 }}>
            {current
              ? `${current.name}`
              : failed[0]
                ? `${failed[0].name}: ${failed[0].error}`
                : `${formatBytes(sent)} terkirim`}
          </Txt>
        </View>
        <IconButton
          icon={X}
          variant="ghost"
          size={32}
          color={t.mutedText}
          onPress={() => (running.length > 0 ? running.forEach((i) => cancel(i.id)) : clearFinished())}
        />
      </View>
      <View style={{ marginTop: 12 }}>
        <GradientBar value={total ? sent / total : 0} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <Txt variant="mono" style={{ fontSize: 11 }}>
          {formatBytes(sent)} / {formatBytes(total)}
        </Txt>
        <Txt variant="mono" style={{ fontSize: 11 }}>
          {total ? Math.round((sent / total) * 100) : 0}%
        </Txt>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  topBar: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: PAD, paddingTop: 6 },
  logoRing: { width: 36, height: 36, borderRadius: radius.md + 2, padding: 1.25 },
  logo: { flex: 1, borderRadius: radius.md + 1, alignItems: 'center', justifyContent: 'center' },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: PAD,
    paddingTop: 16,
    paddingBottom: 10,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: PAD, paddingVertical: 10 },
  tile: {
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    left: 6,
    bottom: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radius.full,
    borderWidth: StyleSheet.hairlineWidth * 2,
  },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  empty: {
    marginHorizontal: PAD,
    marginTop: 8,
    paddingVertical: 36,
    paddingHorizontal: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderRadius: radius.xl,
  },
  dock: { position: 'absolute', left: PAD, right: PAD, bottom: 0, alignItems: 'center' },
  fabRing: {
    borderRadius: radius.full,
    padding: 1.5,
    shadowColor: '#818cf8',
    shadowOpacity: 0.45,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  fab: { borderRadius: radius.full, paddingHorizontal: 26, height: 50, minWidth: 140, borderWidth: 0 },
});

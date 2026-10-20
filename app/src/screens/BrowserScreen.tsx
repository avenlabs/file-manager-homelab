import { createElement, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useFocusEffect } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import {
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  CloudUpload,
  Copy,
  Ellipsis,
  ExternalLink,
  FileUp,
  Flag,
  Folder,
  FolderInput,
  FolderPlus,
  Images,
  LayoutGrid,
  List,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Share2,
  Trash2,
  TriangleAlert,
  X,
} from 'lucide-react-native';
import {
  ApiError,
  copyItems,
  deleteItems,
  fileUrl,
  formatBytes,
  formatDate,
  joinPath,
  listDir,
  mkdir,
  moveItems,
  parentPath,
  rename,
  setFlag,
  type Entry,
  type Session,
} from '../api';
import { categoryOf, extLabel, iconFor, previewKind, type Category } from '../fileTypes';
import { flagColors, flagLabels, font, radius, useTheme, type FlagColor } from '../theme';
import { useUploads, type PickedFile, type UploadSummary } from '../useUploads';
import { ActionSheet, BottomSheet, ConfirmSheet, FlagSheet, PromptSheet, type SheetAction } from '../components/Sheets';
import PreviewModal, { openWithApp, shareEntry } from '../components/PreviewModal';
import { Screen } from '../components/Screen';
import { Bar, Button, Hatch, IconButton, Input, Segmented, Txt } from '../components/ui';

export type ViewMode = 'list' | 'grid';
type Filter = 'all' | 'image' | 'video' | 'document';
type Clipboard = { mode: 'copy' | 'move'; paths: string[]; from: string };

const GRID_COLS = 3;
const GRID_GAP = 10;
const PAD = 14;

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'Semua' },
  { value: 'image', label: 'Foto' },
  { value: 'video', label: 'Video' },
  { value: 'document', label: 'Dokumen' },
];

const baseName = (p: string) => decodeURIComponent(p.split('/').pop() || `file-${Date.now()}`);
const tap = () => Haptics.selectionAsync().catch(() => {});

export default function BrowserScreen({
  session,
  view,
  showHidden,
  onChangeView,
  onLogout,
  onOpenMenu,
}: {
  session: Session;
  view: ViewMode;
  showHidden: boolean;
  onChangeView: (v: ViewMode) => void;
  onLogout: () => void;
  onOpenMenu: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();

  const [path, setPath] = useState('/');
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [flagFilter, setFlagFilter] = useState<FlagColor | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [preview, setPreview] = useState<Entry | null>(null);
  const [sheet, setSheet] = useState<{ title?: string; actions: SheetAction[] } | null>(null);
  const [flagTarget, setFlagTarget] = useState<string[] | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => void } | null>(null);
  const [prompt, setPrompt] = useState<{
    title: string;
    description?: string;
    initial?: string;
    confirm: string;
    run: (v: string) => Promise<unknown>;
  } | null>(null);

  const pathRef = useRef(path);
  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  // Ambil isi folder; hasil diabaikan jika user sudah pindah folder.
  const fetchDir = useCallback(
    (p: string) =>
      listDir(session, p, showHidden)
        .then((res) => {
          if (pathRef.current !== p) return;
          setEntries(res.entries);
          setError(null);
        })
        .catch((e: any) => {
          if (e instanceof ApiError && e.status === 401) return onLogout();
          setError(e?.message ?? 'Gagal memuat');
        })
        .finally(() => setLoading(false)),
    [session, onLogout, showHidden],
  );

  useEffect(() => {
    fetchDir(path);
  }, [path, fetchDir]);

  const load = (p: string) => {
    setLoading(true);
    fetchDir(p);
  };

  const navigate = (p: string) => {
    setSelected(null);
    setFlagFilter(null);
    setSearch(null);
    setLoading(true);
    setEntries([]);
    setPath(p);
  };

  // Tombol back Android: keluar mode pilih / pencarian, lalu naik satu folder.
  const backRef = useRef<() => boolean>(() => false);
  useEffect(() => {
    backRef.current = () => {
      if (selected) return setSelected(null), true;
      if (search !== null) return setSearch(null), true;
      if (path === '/') return false;
      navigate(parentPath(path));
      return true;
    };
  });
  // Hanya aktif saat layar ini fokus, agar tidak mencegat tombol back di layar lain.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => backRef.current());
      return () => sub.remove();
    }, []),
  );

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(id);
  }, [toast]);

  const onUploadDone = useCallback(
    (destDir: string) => {
      if (destDir === pathRef.current) fetchDir(destDir);
    },
    [fetchDir],
  );
  const [showFailed, setShowFailed] = useState(false);
  const onUploadsSettled = useCallback((sum: UploadSummary) => {
    // Kegagalan ditampilkan lewat kartu peringatan di panel upload.
    if (sum.failed.length) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
    } else if (sum.done || sum.skipped) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    }
  }, []);
  const uploads = useUploads(session, onUploadDone, onUploadsSettled);
  const activeUploads = uploads.items.filter((i) => i.status === 'uploading' || i.status === 'queued' || i.status === 'retrying').length;

  // ---------- data turunan ----------

  const visible = useMemo(() => {
    const q = search?.trim().toLowerCase();
    return entries.filter((e) => {
      if (q && !e.name.toLowerCase().includes(q)) return false;
      if (flagFilter && e.flag !== flagFilter) return false;
      if (filter !== 'all' && (e.isDir || categoryOf(e) !== (filter as Category))) return false;
      return true;
    });
  }, [entries, search, flagFilter, filter]);

  const flagCounts = useMemo(() => {
    const m = new Map<FlagColor, number>();
    for (const e of entries) if (e.flag) m.set(e.flag, (m.get(e.flag) ?? 0) + 1);
    return m;
  }, [entries]);

  const selectedEntries = useMemo(
    () => (selected ? entries.filter((e) => selected.has(e.path)) : []),
    [entries, selected],
  );
  const allSelected = !!selected && visible.length > 0 && visible.every((e) => selected.has(e.path));

  // ---------- aksi ----------

  const run = async (label: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(label);
    try {
      await fn();
      if (done) setToast(done);
    } catch (e: any) {
      setToast(e?.message ?? String(e));
    } finally {
      setBusy(null);
      load(pathRef.current);
    }
  };

  const toggleSelect = (e: Entry) => {
    tap();
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(e.path)) next.delete(e.path);
      else next.add(e.path);
      return next;
    });
  };

  const startSelect = (e?: Entry) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setSelected(new Set(e ? [e.path] : []));
  };

  const toggleSelectAll = () => {
    tap();
    setSelected(allSelected ? new Set() : new Set(visible.map((e) => e.path)));
  };

  const toClipboard = (mode: Clipboard['mode'], paths: string[]) => {
    setClipboard({ mode, paths, from: path });
    setSelected(null);
    setToast(`${paths.length} item siap ${mode === 'copy' ? 'disalin' : 'dipindah'}. Buka folder tujuan lalu tempel.`);
  };

  const paste = () => {
    if (!clipboard) return;
    const { mode, paths } = clipboard;
    setClipboard(null);
    run(
      'paste',
      () => (mode === 'copy' ? copyItems(session, paths, path) : moveItems(session, paths, path)),
      `${paths.length} item ${mode === 'copy' ? 'disalin' : 'dipindah'} ke ${path === '/' ? 'Storage' : baseName(path)}`,
    );
  };

  const askDelete = (paths: string[]) =>
    setConfirm({
      title: `Hapus ${paths.length} item?`,
      message: 'File dan folder (beserta isinya) akan dihapus permanen dari server. Tidak bisa dibatalkan.',
      run: () => {
        setSelected(null);
        run('delete', () => deleteItems(session, paths), `${paths.length} item dihapus`);
      },
    });

  const applyFlag = (color: FlagColor | null) => {
    const paths = flagTarget ?? [];
    setFlagTarget(null);
    setSelected(null);
    run('flag', () => setFlag(session, paths, color), color ? `Flag ${flagLabels[color].toLowerCase()} dipasang` : 'Flag dihapus');
  };

  const pickMedia = async (fromCamera: boolean) => {
    const perm = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) return setToast('Izin ditolak. Aktifkan izin di Settings.');
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

  const newFolder = () =>
    setPrompt({
      title: 'Folder baru',
      description: `Dibuat di ${path === '/' ? 'Storage' : path}`,
      confirm: 'Buat',
      run: (name) => mkdir(session, joinPath(path, name)),
    });

  const openAddMenu = () =>
    setSheet({
      title: `Tambah ke ${path === '/' ? 'Storage' : baseName(path)}`,
      actions: [
        { label: 'Foto & Video', description: 'Pilih banyak sekaligus, kualitas asli', icon: Images, onPress: () => pickMedia(false) },
        { label: 'Kamera', description: 'Ambil foto atau video lalu upload', icon: Camera, onPress: () => pickMedia(true) },
        { label: 'File', description: 'Dokumen, arsip, atau file apa pun', icon: FileUp, onPress: pickDocuments },
        { label: 'Folder baru', description: 'Buat folder di lokasi ini', icon: FolderPlus, onPress: newFolder },
      ],
    });

  const openEntryMenu = (e: Entry) => {
    const kind = previewKind(e);
    setSheet({
      title: e.name,
      actions: [
        ...(!e.isDir
          ? [
              ...(kind === 'office' || kind === 'other'
                ? [{ label: kind === 'office' ? 'Buka di Google Drive' : 'Buka dengan…', icon: ExternalLink, onPress: () => run('open', () => openWithApp(session, e)) }]
                : []),
              { label: 'Bagikan / Simpan', icon: Share2, onPress: () => run('share', () => shareEntry(session, e)) },
            ]
          : []),
        { label: 'Salin', icon: Copy, onPress: () => toClipboard('copy', [e.path]) },
        { label: 'Pindah', icon: FolderInput, onPress: () => toClipboard('move', [e.path]) },
        { label: 'Beri flag', icon: Flag, onPress: () => setFlagTarget([e.path]) },
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
        { label: 'Hapus', icon: Trash2, destructive: true, onPress: () => askDelete([e.path]) },
      ],
    });
  };

  const onItemPress = (e: Entry) => {
    if (selected) return toggleSelect(e);
    if (e.isDir) return navigate(e.path);
    setPreview(e);
  };
  const onItemLongPress = (e: Entry) => (selected ? toggleSelect(e) : startSelect(e));

  // ---------- render ----------

  const tileSize = (width - PAD * 2 - 16 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;
  const folderName = path === '/' ? 'Storage' : baseName(path);
  const parentName = path === '/' ? null : parentPath(path) === '/' ? 'Storage' : baseName(parentPath(path));

  const renderItem = ({ item }: { item: Entry }) => {
    const isSel = !!selected?.has(item.path);
    return view === 'grid' ? (
      <GridItem
        entry={item}
        session={session}
        size={tileSize}
        selecting={!!selected}
        selected={isSel}
        onPress={onItemPress}
        onLongPress={onItemLongPress}
      />
    ) : (
      <ListItem
        entry={item}
        session={session}
        selecting={!!selected}
        selected={isSel}
        onPress={onItemPress}
        onLongPress={onItemLongPress}
        onMore={openEntryMenu}
      />
    );
  };

  const toolbar =
    search !== null ? (
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Input icon={Search} autoFocus placeholder={`Cari di ${folderName}`} value={search} onChangeText={setSearch} />
        </View>
        <IconButton icon={X} variant="dark" onPress={() => setSearch(null)} accessibilityLabel="Tutup pencarian" />
      </View>
    ) : (
      <>
        <Segmented options={FILTERS} value={filter} onChange={setFilter} />
        <View style={{ flex: 1 }} />
        <IconButton icon={Search} variant="plain" color={t.textOnDark} onPress={() => setSearch('')} accessibilityLabel="Cari" />
      </>
    );

  return (
    <Screen
      title={path === '/' ? 'Halo!' : folderName}
      subtitle={path === '/' ? 'Kelola file di homelab kamu:' : `~${path}`}
      badge={activeUploads}
      onMenu={onOpenMenu}
      toolbar={toolbar}
    >
      {/* Strip navigasi (seperti strip tanggal di referensi) */}
      <View style={styles.strip}>
        {selected ? (
          <>
            <IconButton icon={X} size={36} onPress={() => setSelected(null)} accessibilityLabel="Keluar mode pilih" />
            <View style={styles.stripCenter}>
              <Txt variant="heading">{selected.size} dipilih</Txt>
              <Txt variant="caption">{folderName}</Txt>
            </View>
            <Pressable onPress={toggleSelectAll} hitSlop={8} style={[styles.pill, { backgroundColor: t.card }]}>
              <Txt variant="label">{allSelected ? 'Batal semua' : 'Pilih semua'}</Txt>
            </Pressable>
          </>
        ) : (
          <>
            {parentName && (
              <IconButton
                icon={ChevronLeft}
                size={36}
                onPress={() => navigate(parentPath(path))}
                accessibilityLabel="Kembali ke folder induk"
              />
            )}
            <View style={{ flex: 1 }}>
              <Txt variant="caption" numberOfLines={1}>
                {parentName ? `${parentName} /` : 'Lokasi'}
              </Txt>
              <Txt variant="heading" numberOfLines={1}>
                {visible.length} item{visible.length !== entries.length ? ` dari ${entries.length}` : ''}
              </Txt>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Pressable onPress={() => startSelect()} hitSlop={8} style={[styles.pill, { backgroundColor: t.card }]}>
                <Txt variant="label">Pilih</Txt>
              </Pressable>
              <IconButton
                icon={view === 'list' ? LayoutGrid : List}
                size={36}
                onPress={() => onChangeView(view === 'list' ? 'grid' : 'list')}
                accessibilityLabel="Ganti tampilan"
              />
            </View>
          </>
        )}
      </View>

      {flagCounts.size > 0 && (
        <View style={styles.flagRow}>
          <FlagChip label="Semua" active={!flagFilter} onPress={() => setFlagFilter(null)} />
          {[...flagCounts.entries()].map(([c, n]) => (
            <FlagChip key={c} color={c} label={String(n)} active={flagFilter === c} onPress={() => setFlagFilter(flagFilter === c ? null : c)} />
          ))}
        </View>
      )}

      <View style={[styles.panel, { backgroundColor: t.panel }]}>
        {error ? (
          <View style={styles.centerBox}>
            <Txt variant="muted" style={{ color: t.danger, marginBottom: 14, textAlign: 'center' }}>
              {error}
            </Txt>
            <Button label="Coba lagi" size="sm" onPress={() => load(path)} />
          </View>
        ) : (
          <FlatList
            key={view}
            data={visible}
            numColumns={view === 'grid' ? GRID_COLS : 1}
            keyExtractor={(e) => e.path}
            renderItem={renderItem}
            extraData={selected}
            columnWrapperStyle={view === 'grid' ? { gap: GRID_GAP } : undefined}
            ItemSeparatorComponent={() => <View style={{ height: view === 'grid' ? 14 : 8 }} />}
            refreshControl={<RefreshControl refreshing={false} onRefresh={() => load(path)} tintColor={t.mutedText} />}
            contentContainerStyle={{ padding: 8, paddingBottom: 170 + insets.bottom }}
            ListEmptyComponent={
              loading ? (
                <ActivityIndicator style={{ marginTop: 40 }} color={t.mutedText} />
              ) : (
                <EmptyState filtered={visible.length !== entries.length} onAdd={openAddMenu} />
              )
            }
          />
        )}
      </View>

      {/* Dock bawah */}
      <View style={[styles.dock, { paddingBottom: insets.bottom + 14 }]} pointerEvents="box-none">
        {toast && (
          <View style={[styles.toast, { backgroundColor: t.bg }]}>
            <Txt variant="label" dark numberOfLines={3}>
              {toast}
            </Txt>
          </View>
        )}
        <UploadPanel uploads={uploads} onShowFailed={() => setShowFailed(true)} />

        {selected ? (
          <View style={[styles.actionBar, { backgroundColor: t.bg }]}>
            <ActionBtn icon={Copy} label="Salin" disabled={!selected.size} onPress={() => toClipboard('copy', [...selected])} />
            <ActionBtn icon={FolderInput} label="Pindah" disabled={!selected.size} onPress={() => toClipboard('move', [...selected])} />
            <ActionBtn icon={Flag} label="Flag" disabled={!selected.size} onPress={() => setFlagTarget([...selected])} />
            <ActionBtn
              icon={Share2}
              label="Bagikan"
              disabled={selectedEntries.length !== 1 || selectedEntries[0].isDir}
              onPress={() => run('share', () => shareEntry(session, selectedEntries[0]))}
            />
            <ActionBtn icon={Trash2} label="Hapus" danger disabled={!selected.size} onPress={() => askDelete([...selected])} />
          </View>
        ) : clipboard ? (
          <View style={[styles.clipBar, { backgroundColor: t.bg }]}>
            <View style={{ flex: 1 }}>
              <Txt variant="label" dark>
                {clipboard.paths.length} item {clipboard.mode === 'copy' ? 'disalin' : 'akan dipindah'}
              </Txt>
              <Txt variant="small" dark numberOfLines={1}>
                Buka folder tujuan, lalu tempel
              </Txt>
            </View>
            <IconButton icon={X} variant="dark" size={38} onPress={() => setClipboard(null)} accessibilityLabel="Batal" />
            <Button
              label="Tempel"
              icon={ClipboardPaste}
              size="sm"
              loading={busy === 'paste'}
              disabled={clipboard.mode === 'move' && clipboard.from === path}
              onPress={paste}
            />
          </View>
        ) : (
          <View style={{ alignSelf: 'flex-end' }}>
            <Pressable
              onPress={openAddMenu}
              accessibilityLabel="Upload atau buat folder"
              style={({ pressed }) => [styles.fab, { backgroundColor: pressed ? t.primaryPressed : t.primary }]}
            >
              <Plus size={28} color={t.primaryText} strokeWidth={2.4} />
            </Pressable>
          </View>
        )}
      </View>

      {busy && busy !== 'paste' && (
        <View style={[StyleSheet.absoluteFill, styles.busy]} pointerEvents="none">
          <ActivityIndicator color={t.primary} size="large" />
        </View>
      )}

      <ActionSheet title={sheet?.title} actions={sheet?.actions ?? null} onClose={() => setSheet(null)} />
      <FlagSheet
        visible={!!flagTarget}
        count={flagTarget?.length ?? 0}
        current={(() => {
          const fl = entries.filter((e) => flagTarget?.includes(e.path)).map((e) => e.flag ?? null);
          return fl.length && fl.every((f) => f === fl[0]) ? fl[0] : null;
        })()}
        onPick={applyFlag}
        onClose={() => setFlagTarget(null)}
      />
      <ConfirmSheet
        visible={!!confirm}
        title={confirm?.title ?? ''}
        message={confirm?.message}
        confirmLabel="Hapus"
        destructive
        onConfirm={() => confirm?.run()}
        onClose={() => setConfirm(null)}
      />
      <PromptSheet
        visible={!!prompt}
        title={prompt?.title ?? ''}
        description={prompt?.description}
        initial={prompt?.initial}
        icon={Folder}
        confirmLabel={prompt?.confirm ?? 'OK'}
        onClose={() => setPrompt(null)}
        onSubmit={(v) => {
          const fn = prompt!.run;
          setPrompt(null);
          run('prompt', () => fn(v));
        }}
      />
      <FailedSheet
        visible={showFailed}
        uploads={uploads}
        onClose={() => setShowFailed(false)}
      />
      <PreviewModal session={session} entry={preview} onClose={() => setPreview(null)} />
    </Screen>
  );
}

// ---------- item ----------

type ItemProps = {
  entry: Entry;
  session: Session;
  selecting: boolean;
  selected: boolean;
  onPress: (e: Entry) => void;
  onLongPress: (e: Entry) => void;
};

function Thumb({ entry, session, size, rounded }: { entry: Entry; session: Session; size: number; rounded: number }) {
  const t = useTheme();
  if (previewKind(entry) === 'image') {
    return (
      <Image
        source={{ uri: fileUrl(session, entry.path) }}
        style={{ width: size, height: size, borderRadius: rounded, backgroundColor: t.panel }}
        contentFit="cover"
        cachePolicy="disk"
        recyclingKey={entry.path}
        transition={150}
      />
    );
  }
  const folder = entry.isDir;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: rounded,
        backgroundColor: folder ? t.primary : t.bg,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      }}
    >
      {createElement(iconFor(entry), {
        size: size * (folder ? 0.42 : 0.36),
        color: folder ? t.primaryText : t.textOnDark,
        strokeWidth: 1.9,
      })}
      {!folder && (
        <Text style={{ color: t.mutedOnDark, fontFamily: font.bold, fontSize: Math.max(8, size * 0.15) }} numberOfLines={1}>
          {extLabel(entry)}
        </Text>
      )}
    </View>
  );
}

function SelectMark({ selected }: { selected: boolean }) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.check,
        selected ? { backgroundColor: t.primary, borderColor: t.primary } : { borderColor: t.stripe, backgroundColor: t.card },
      ]}
    >
      {selected && <Check size={14} color={t.primaryText} strokeWidth={3} />}
    </View>
  );
}

const ListItem = memo(function ListItem({
  entry,
  session,
  selecting,
  selected,
  onPress,
  onLongPress,
  onMore,
}: ItemProps & { onMore: (e: Entry) => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => onPress(entry)}
      onLongPress={() => onLongPress(entry)}
      delayLongPress={350}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: selected ? '#fdebdc' : t.card, borderColor: selected ? t.primary : 'transparent', opacity: pressed ? 0.85 : 1 },
      ]}
    >
      <Thumb entry={entry} session={session} size={50} rounded={16} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {entry.flag && <View style={[styles.flagDot, { backgroundColor: flagColors[entry.flag] }]} />}
          <Txt variant="body" numberOfLines={1} style={{ flexShrink: 1 }}>
            {entry.name}
          </Txt>
        </View>
        <Txt variant="small" numberOfLines={1} style={{ marginTop: 3 }}>
          {entry.isDir ? 'Folder' : `${extLabel(entry)} · ${formatBytes(entry.size)}`} · {formatDate(entry.modTime)}
        </Txt>
      </View>
      {selecting ? (
        <SelectMark selected={selected} />
      ) : entry.isDir ? (
        <ChevronRight size={20} color={t.mutedText} strokeWidth={2.2} />
      ) : (
        <IconButton icon={Ellipsis} variant="plain" size={34} color={t.mutedText} onPress={() => onMore(entry)} accessibilityLabel="Aksi lain" />
      )}
    </Pressable>
  );
});

const GridItem = memo(function GridItem({ entry, session, size, selecting, selected, onPress, onLongPress }: ItemProps & { size: number }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => onPress(entry)}
      onLongPress={() => onLongPress(entry)}
      delayLongPress={350}
      style={({ pressed }) => [{ width: size, opacity: pressed ? 0.8 : 1 }]}
    >
      <View style={{ borderRadius: 20, borderWidth: 2.5, borderColor: selected ? t.primary : 'transparent', padding: 0 }}>
        <Thumb entry={entry} session={session} size={size - 5} rounded={17} />
        {entry.flag && <View style={[styles.flagCorner, { backgroundColor: flagColors[entry.flag], borderColor: t.panel }]} />}
        {selecting && (
          <View style={{ position: 'absolute', top: 6, right: 6 }}>
            <SelectMark selected={selected} />
          </View>
        )}
      </View>
      <Txt variant="label" numberOfLines={1} style={{ marginTop: 6, paddingHorizontal: 2 }}>
        {entry.name}
      </Txt>
      <Txt variant="small" numberOfLines={1} style={{ fontSize: 11, paddingHorizontal: 2 }}>
        {entry.isDir ? 'Folder' : formatBytes(entry.size)}
      </Txt>
    </Pressable>
  );
});

// ---------- bagian kecil ----------

function FlagChip({ color, label, active, onPress }: { color?: FlagColor; label: string; active: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? t.bg : t.card }]}
      accessibilityLabel={color ? `Filter flag ${flagLabels[color]}` : 'Semua flag'}
    >
      {color && <View style={[styles.flagDot, { backgroundColor: flagColors[color], width: 10, height: 10 }]} />}
      <Text style={{ fontFamily: font.bold, fontSize: 12.5, color: active ? t.textOnDark : t.text }}>{label}</Text>
    </Pressable>
  );
}

function EmptyState({ filtered, onAdd }: { filtered: boolean; onAdd: () => void }) {
  const t = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {[0, 1, 2, 3].map((i) => (
        <Hatch key={i} bg={t.panel} style={{ height: 46, alignItems: 'center', justifyContent: 'center' }}>
          {i === 1 && <Txt variant="small">{filtered ? 'Tidak ada yang cocok' : 'Folder kosong'}</Txt>}
        </Hatch>
      ))}
      {!filtered && <Button label="Upload file" icon={Plus} size="sm" onPress={onAdd} style={{ alignSelf: 'center', marginTop: 10 }} />}
    </View>
  );
}

function ActionBtn({
  icon: I,
  label,
  onPress,
  disabled,
  danger,
}: {
  icon: typeof Copy;
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  const t = useTheme();
  const color = danger ? '#ff8a7a' : t.textOnDark;
  return (
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => [styles.actionBtn, { opacity: disabled ? 0.35 : pressed ? 0.6 : 1 }]}>
      <I size={21} color={color} strokeWidth={2} />
      <Text style={{ color, fontFamily: font.semibold, fontSize: 11 }}>{label}</Text>
    </Pressable>
  );
}

function UploadPanel({ uploads, onShowFailed }: { uploads: ReturnType<typeof useUploads>; onShowFailed: () => void }) {
  const t = useTheme();
  const { items, summary, running, cancelAll, retryFailed, clearFinished } = uploads;
  if (items.length === 0) return null;

  const finished = (s: string) => s === 'done' || s === 'skipped';
  const sent = items.reduce((acc, i) => acc + (finished(i.status) ? i.size : i.sent), 0);
  const total = items.reduce((acc, i) => acc + i.size, 0);
  const handled = summary.done + summary.skipped + summary.failed.length + summary.cancelled;
  const current = items.find((i) => i.status === 'uploading') ?? items.find((i) => i.status === 'retrying');
  const retrying = items.find((i) => i.status === 'retrying');
  const failed = summary.failed.length;

  // Selesai, ada yang gagal → kartu peringatan.
  if (!running && failed) {
    return (
      <View style={[styles.upload, { backgroundColor: '#f8e4b4' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={[styles.uploadIcon, { backgroundColor: '#b7791f' }]}>
            <TriangleAlert size={20} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <Txt variant="label">{failed} file gagal diupload</Txt>
            <Txt variant="small" style={{ marginTop: 2, color: '#6b5420' }} numberOfLines={2}>
              {summary.done} berhasil{summary.skipped ? ` · ${summary.skipped} dilewati (sudah ada)` : ''} · {summary.failed[0].error}
            </Txt>
          </View>
          <IconButton icon={X} variant="plain" size={32} color="#6b5420" onPress={clearFinished} accessibilityLabel="Tutup" />
        </View>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
          <Button label="Lihat alasan" size="sm" variant="light" onPress={onShowFailed} style={{ flex: 1 }} />
          <Button label="Coba lagi" icon={RotateCcw} size="sm" onPress={retryFailed} style={{ flex: 1 }} />
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.upload, { backgroundColor: t.card }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={[styles.uploadIcon, { backgroundColor: running ? t.primary : t.success }]}>
          {running ? <CloudUpload size={20} color={t.primaryText} /> : <Check size={20} color="#fff" strokeWidth={2.6} />}
        </View>
        <View style={{ flex: 1 }}>
          <Txt variant="label">
            {running
              ? `Mengupload ${Math.min(handled + 1, items.length)} dari ${items.length}`
              : `Upload selesai · ${summary.done} file`}
          </Txt>
          <Txt variant="small" numberOfLines={1} style={{ marginTop: 2 }}>
            {running
              ? current
                ? `${current.name} · ${formatBytes(current.sent)} / ${formatBytes(current.size)}`
                : 'Menyiapkan…'
              : summary.skipped
                ? `${summary.skipped} dilewati karena sudah ada di server`
                : `${formatBytes(total)} terkirim`}
          </Txt>
        </View>
        <IconButton
          icon={X}
          variant="plain"
          size={32}
          color={t.mutedText}
          onPress={running ? cancelAll : clearFinished}
          accessibilityLabel={running ? 'Batalkan semua upload' : 'Tutup'}
        />
      </View>

      {retrying && (
        <View style={[styles.retryRow, { backgroundColor: '#f8e4b4' }]}>
          <RotateCcw size={14} color="#8a5a12" />
          <Txt variant="small" numberOfLines={2} style={{ flex: 1, color: '#6b5420' }}>
            {retrying.name}: mencoba ulang {retrying.attempt}/5 · {retrying.error}
          </Txt>
        </View>
      )}

      {running && (
        <>
          <View style={{ marginTop: 12 }}>
            <Bar value={total ? sent / total : 0} />
          </View>
          <View style={{ flexDirection: 'row', marginTop: 6, gap: 10 }}>
            <Txt variant="small" style={{ flex: 1, fontSize: 11 }}>
              {formatBytes(sent)} / {formatBytes(total)} · {total ? Math.floor((sent / total) * 100) : 0}%
            </Txt>
            {summary.skipped > 0 && <Txt variant="small" style={{ fontSize: 11 }}>{summary.skipped} dilewati</Txt>}
            {failed > 0 && (
              <Pressable onPress={onShowFailed} hitSlop={8}>
                <Txt variant="small" style={{ fontSize: 11, color: t.danger }}>
                  {failed} gagal ›
                </Txt>
              </Pressable>
            )}
          </View>
        </>
      )}
    </View>
  );
}

/** Daftar file yang gagal beserta alasannya. */
function FailedSheet({
  visible,
  uploads,
  onClose,
}: {
  visible: boolean;
  uploads: ReturnType<typeof useUploads>;
  onClose: () => void;
}) {
  const t = useTheme();
  const failed = uploads.summary.failed;
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: 24 }}>
        <Txt variant="title">{failed.length} file gagal diupload</Txt>
        <Txt variant="muted" style={{ marginTop: 4, lineHeight: 20 }}>
          File lain tetap dilanjutkan. Coba lagi akan melanjutkan dari bagian yang sudah terkirim.
        </Txt>
      </View>
      <ScrollView style={{ maxHeight: 340, marginTop: 14 }} contentContainerStyle={{ paddingHorizontal: 16 }}>
        {failed.map((f) => (
          <View key={f.id} style={[styles.failRow, { backgroundColor: t.panel }]}>
            <TriangleAlert size={18} color={t.danger} />
            <View style={{ flex: 1 }}>
              <Txt variant="label" numberOfLines={1}>
                {f.name}
              </Txt>
              <Txt variant="small" style={{ marginTop: 2 }}>
                {f.error || 'Gagal tanpa keterangan'}
              </Txt>
              <Txt variant="small" style={{ marginTop: 2, fontSize: 11 }}>
                {formatBytes(f.sent)} / {formatBytes(f.size)} terkirim · ke {f.destDir}
              </Txt>
            </View>
          </View>
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20, marginTop: 14 }}>
        <Button label="Tutup" variant="outline" onPress={onClose} style={{ flex: 1 }} />
        <Button
          label="Coba lagi"
          icon={RotateCcw}
          disabled={!failed.length}
          onPress={() => {
            uploads.retryFailed();
            onClose();
          }}
          style={{ flex: 1.3 }}
        />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: PAD, paddingTop: 16, paddingBottom: 12, gap: 8 },
  stripCenter: { flex: 1, alignItems: 'center' },
  pill: { height: 36, paddingHorizontal: 14, borderRadius: radius.md, justifyContent: 'center' },
  flagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: PAD, paddingBottom: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 12, borderRadius: radius.full },
  panel: { flex: 1, marginHorizontal: 8, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10, paddingRight: 12, borderRadius: radius.lg, borderWidth: 2 },
  flagDot: { width: 9, height: 9, borderRadius: 5 },
  flagCorner: { position: 'absolute', left: 7, top: 7, width: 14, height: 14, borderRadius: 7, borderWidth: 2.5 },
  check: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  centerBox: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  dock: { position: 'absolute', left: PAD, right: PAD, bottom: 0, gap: 10 },
  toast: { alignSelf: 'center', paddingHorizontal: 16, paddingVertical: 12, borderRadius: radius.lg, maxWidth: '100%' },
  fab: {
    width: 64,
    height: 64,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  actionBar: { flexDirection: 'row', borderRadius: radius.xl, paddingVertical: 10, paddingHorizontal: 6 },
  actionBtn: { flex: 1, alignItems: 'center', gap: 4, paddingVertical: 4 },
  clipBar: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radius.xl, padding: 12, paddingLeft: 18 },
  upload: { borderRadius: radius.xl, padding: 14 },
  uploadIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  retryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, padding: 8, borderRadius: 12 },
  failRow: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: 16, marginBottom: 8 },
  busy: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(43,43,39,0.15)' },
});

import { createElement, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  FlatList,
  Pressable,
  RefreshControl,
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
  ChartPie,
  Camera,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
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
  Search,
  Share2,
  Trash2,
  X,
} from 'lucide-react-native';
import { ApiError, formatDate, formatSize } from '../api';
import { categoryOf, extLabel, iconFor, previewKind, type Category } from '../fileTypes';
import { AuthExpiredError } from '../providers/oauth';
import type { FileItem, Folder as FolderRef, MediaSource, StorageProvider } from '../providers/types';
import { useSources } from '../sources';
import { flagColors, flagLabels, font, radius, useTheme, type FlagColor } from '../theme';
import { useUploadQueue } from '../uploads';
import type { PickedFile } from '../useUploads';
import { ActionSheet, ConfirmSheet, FlagSheet, PromptSheet, type SheetAction } from '../components/Sheets';
import PreviewModal, { openItem, shareItem } from '../components/PreviewModal';
import { FailedSheet, UploadPanel } from '../components/UploadPanel';
import { Screen } from '../components/Screen';
import { sourceKindLabel } from '../components/SourceIcon';
import { Button, Hatch, IconButton, Input, Segmented, Txt } from '../components/ui';

export type ViewMode = 'list' | 'grid';
type Filter = 'all' | 'image' | 'video' | 'document';

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
  provider,
  onExit,
  onOpenMenu,
  onOpenAnalytics,
}: {
  provider: StorageProvider;
  onExit: () => void;
  onOpenMenu: () => void;
  onOpenAnalytics: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { prefs, setPrefs, clipboard, setClipboard, provider: providerById, sources } = useSources();
  const uploads = useUploadQueue();
  const view = prefs.view;

  const [stack, setStack] = useState<FolderRef[]>([provider.root]);
  const folder = stack[stack.length - 1];
  const caps = provider.caps(folder.id);
  const [entries, setEntries] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<{ message: string; auth?: boolean } | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [flagFilter, setFlagFilter] = useState<FlagColor | null>(null);
  const [search, setSearch] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string> | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [preview, setPreview] = useState<FileItem | null>(null);
  const [showFailed, setShowFailed] = useState(false);
  const [sheet, setSheet] = useState<{ title?: string; actions: SheetAction[] } | null>(null);
  const [flagTarget, setFlagTarget] = useState<FileItem[] | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => void } | null>(null);
  const [prompt, setPrompt] = useState<{
    title: string;
    description?: string;
    initial?: string;
    confirm: string;
    run: (v: string) => Promise<unknown>;
  } | null>(null);

  const folderRef = useRef(folder.id);
  useEffect(() => {
    folderRef.current = folder.id;
  }, [folder.id]);

  // Ambil isi folder; hasil diabaikan jika user sudah pindah folder.
  const fetchDir = useCallback(
    (id: string) =>
      provider
        .list(id, { hidden: prefs.showHidden })
        .then((items) => {
          if (folderRef.current !== id) return;
          setEntries(items);
          setError(null);
        })
        .catch((e: any) => {
          if (folderRef.current !== id) return;
          const auth = e instanceof AuthExpiredError || (e instanceof ApiError && e.status === 401);
          setError({
            message: auth
              ? `Akses ke ${provider.label} sudah tidak berlaku. Hubungkan ulang lewat Beranda → Tambah sumber → ${sourceKindLabel[provider.kind]} (dengan akun/server yang sama).`
              : (e?.message ?? 'Gagal memuat'),
            auth,
          });
        })
        .finally(() => setLoading(false)),
    [provider, prefs.showHidden],
  );

  useEffect(() => {
    fetchDir(folder.id);
  }, [folder.id, fetchDir]);

  // Refresh otomatis jika upload ke folder ini selesai.
  useEffect(() => {
    if (uploads.lastDone?.sourceId === provider.id && uploads.lastDone.dir === folderRef.current) fetchDir(folderRef.current);
  }, [uploads.lastDone, provider.id, fetchDir]);

  const load = () => {
    setLoading(true);
    fetchDir(folder.id);
  };

  const resetView = () => {
    setSelected(null);
    setFlagFilter(null);
    setSearch(null);
    setLoading(true);
    setEntries([]);
  };
  const openFolder = (f: FolderRef) => {
    resetView();
    setStack((s) => [...s, f]);
  };
  const goUp = () => {
    if (stack.length === 1) return onExit();
    resetView();
    setStack((s) => s.slice(0, -1));
  };

  // Tombol back Android: keluar mode pilih / pencarian, naik folder, lalu kembali ke Beranda.
  const backRef = useRef<() => boolean>(() => false);
  useEffect(() => {
    backRef.current = () => {
      if (selected) return setSelected(null), true;
      if (search !== null) return setSearch(null), true;
      goUp();
      return true;
    };
  });
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => backRef.current());
      return () => sub.remove();
    }, []),
  );

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 2800);
    return () => clearTimeout(id);
  }, [toast]);

  const activeUploads = uploads.items.filter((i) => i.status === 'uploading' || i.status === 'queued' || i.status === 'retrying').length;
  const target = provider.uploader
    ? { sourceId: provider.id, adapter: provider.uploader, dir: folder.id, label: `${provider.label} / ${folder.name}` }
    : null;

  // ---------- data turunan ----------

  const visible = useMemo(() => {
    const q = search?.trim().toLowerCase();
    return entries.filter((e) => {
      if (e.action) return !q && filter === 'all' && !flagFilter;
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

  const selectable = visible.filter((e) => !e.action);
  const selectedItems = useMemo(() => (selected ? entries.filter((e) => selected.has(e.path)) : []), [entries, selected]);
  const allSelected = !!selected && selectable.length > 0 && selectable.every((e) => selected.has(e.path));

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
      fetchDir(folderRef.current);
    }
  };

  const toggleSelect = (e: FileItem) => {
    if (e.action) return;
    tap();
    setSelected((prev) => {
      const next = new Set(prev ?? []);
      if (next.has(e.path)) next.delete(e.path);
      else next.add(e.path);
      return next;
    });
  };

  const startSelect = (e?: FileItem) => {
    if (e?.action) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setSelected(new Set(e ? [e.path] : []));
  };

  const toggleSelectAll = () => {
    tap();
    setSelected(allSelected ? new Set() : new Set(selectable.map((e) => e.path)));
  };

  const toClipboard = (mode: 'copy' | 'move', items: FileItem[]) => {
    setClipboard({ mode, sourceId: provider.id, fromFolder: folder.id, items });
    setSelected(null);
    setToast(`${items.length} item siap ${mode === 'copy' ? 'disalin' : 'dipindah'}. Buka folder tujuan (sumber mana pun) lalu Tempel.`);
  };

  const clipSource = clipboard ? (clipboard.sourceId === provider.id ? provider : providerById(clipboard.sourceId)) : null;
  const sameSource = clipboard?.sourceId === provider.id;
  const canPaste =
    !!clipboard &&
    !!clipSource &&
    (sameSource ? caps.copyMove && !(clipboard.mode === 'move' && clipboard.fromFolder === folder.id) : caps.upload && !!target);

  const paste = () => {
    if (!clipboard || !clipSource) return;
    const { mode, items } = clipboard;
    setClipboard(null);
    if (sameSource) {
      return run(
        'paste',
        () => (mode === 'copy' ? provider.copy(items, folder.id) : provider.move(items, folder.id)),
        `${items.length} item ${mode === 'copy' ? 'disalin' : 'dipindah'} ke ${folder.name}`,
      );
    }
    // Antar sumber: unduh dari sumber asal lalu upload ke sini lewat antrian upload (tahan gangguan).
    const files = items.filter((i) => !i.isDir && !i.cloudDoc);
    const skipped = items.length - files.length;
    const picked: PickedFile[] = files.map((item) => ({
      name: item.name,
      size: item.size >= 0 ? item.size : undefined,
      prepare: async () => {
        const f = await clipSource.download(item);
        return { uri: f.uri, size: f.size };
      },
      after: mode === 'move' ? () => clipSource.remove([item]) : undefined,
    }));
    if (picked.length && target) uploads.enqueue(picked, target);
    setToast(
      `${picked.length} file masuk antrian ${mode === 'copy' ? 'salin' : 'pindah'} dari ${clipSource.label}` +
        (skipped ? ` · ${skipped} folder/dokumen Google dilewati (belum didukung antar sumber)` : ''),
    );
  };

  const askDelete = (items: FileItem[]) =>
    setConfirm({
      title: `Hapus ${items.length} item?`,
      message:
        provider.kind === 'gdrive'
          ? 'Item dipindahkan ke Sampah Google Drive (masih bisa dipulihkan dari Google Drive).'
          : provider.kind === 'device'
            ? 'Item dihapus dari HP ini. Tidak bisa dibatalkan.'
            : 'File dan folder (beserta isinya) akan dihapus permanen. Tidak bisa dibatalkan.',
      run: () => {
        setSelected(null);
        run('delete', () => provider.remove(items), `${items.length} item dihapus`);
      },
    });

  const applyFlag = (color: FlagColor | null) => {
    const items = flagTarget ?? [];
    setFlagTarget(null);
    setSelected(null);
    if (!provider.setFlag) return;
    run('flag', () => provider.setFlag!(items, color), color ? `Flag ${flagLabels[color].toLowerCase()} dipasang` : 'Flag dihapus');
  };

  const pickMedia = async (fromCamera: boolean) => {
    if (!target) return;
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
    uploads.enqueue(
      res.assets.map((a) => ({ uri: a.uri, name: a.fileName || baseName(a.uri), mimeType: a.mimeType, size: a.fileSize })),
      target,
    );
  };

  const pickDocuments = async () => {
    if (!target) return;
    const res = await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true });
    if (res.canceled) return;
    uploads.enqueue(
      res.assets.map((a) => ({ uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size })),
      target,
    );
  };

  const newFolder = () =>
    setPrompt({
      title: 'Folder baru',
      description: `Dibuat di ${folder.name}`,
      confirm: 'Buat',
      run: (name) => provider.mkdir(folder.id, name),
    });

  const openAddMenu = () =>
    setSheet({
      title: `Tambah ke ${folder.name}`,
      actions: [
        ...(caps.upload
          ? [
              { label: 'Foto & Video', description: 'Pilih banyak sekaligus, kualitas asli', icon: Images, onPress: () => pickMedia(false) },
              { label: 'Kamera', description: 'Ambil foto atau video lalu simpan di sini', icon: Camera, onPress: () => pickMedia(true) },
              { label: 'File', description: 'Dokumen, arsip, atau file apa pun', icon: FileUp, onPress: pickDocuments },
            ]
          : []),
        ...(caps.write ? [{ label: 'Folder baru', description: 'Buat folder di lokasi ini', icon: FolderPlus, onPress: newFolder }] : []),
      ],
    });

  const openEntryMenu = (e: FileItem) => {
    if (e.action) return;
    const kind = previewKind(e);
    const external = e.cloudDoc || kind === 'office' || kind === 'other';
    setSheet({
      title: e.name,
      actions: [
        ...(!e.isDir
          ? [
              ...(external
                ? [{ label: kind === 'office' || e.cloudDoc ? 'Buka di Google Drive' : 'Buka dengan…', icon: ExternalLink, onPress: () => run('open', () => openItem(provider, e)) }]
                : []),
              ...(!e.cloudDoc ? [{ label: 'Bagikan / Simpan', icon: Share2, onPress: () => run('share', () => shareItem(provider, e)) }] : []),
              { label: 'Salin', description: 'Tempel di folder atau sumber lain', icon: Copy, onPress: () => toClipboard('copy', [e]) },
            ]
          : []),
        ...(caps.copyMove || caps.remove ? [{ label: 'Pindah', icon: FolderInput, onPress: () => toClipboard('move', [e]) }] : []),
        ...(caps.flags ? [{ label: 'Beri flag', icon: Flag, onPress: () => setFlagTarget([e]) }] : []),
        ...(caps.write
          ? [
              {
                label: 'Ganti nama',
                icon: Pencil,
                onPress: () =>
                  setPrompt({ title: 'Ganti nama', initial: e.name, confirm: 'Simpan', run: (name) => provider.rename(e, name) }),
              },
            ]
          : []),
        ...(caps.remove ? [{ label: 'Hapus', icon: Trash2, destructive: true, onPress: () => askDelete([e]) }] : []),
      ],
    });
  };

  const onItemPress = (e: FileItem) => {
    if (e.action) return void run('action', () => provider.runAction!(e.action!));
    if (selected) return toggleSelect(e);
    if (e.isDir) return openFolder({ id: e.path, name: e.name });
    setPreview(e);
  };
  const onItemLongPress = (e: FileItem) => (selected ? toggleSelect(e) : startSelect(e));

  // ---------- render ----------

  const tileSize = (width - PAD * 2 - 16 - GRID_GAP * (GRID_COLS - 1)) / GRID_COLS;
  const atRoot = stack.length === 1;
  const parentName = atRoot ? 'Beranda' : stack[stack.length - 2].name;
  const canAdd = caps.upload || caps.write;

  const renderItem = ({ item }: { item: FileItem }) => {
    const isSel = !!selected?.has(item.path);
    const props = { entry: item, provider, selecting: !!selected, selected: isSel, onPress: onItemPress, onLongPress: onItemLongPress };
    return view === 'grid' ? <GridItem {...props} size={tileSize} /> : <ListItem {...props} onMore={openEntryMenu} />;
  };

  const toolbar =
    search !== null ? (
      <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Input icon={Search} autoFocus placeholder={`Cari di ${folder.name}`} value={search} onChangeText={setSearch} />
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

  const multipleSources = sources.length > 1;

  return (
    <Screen
      title={atRoot ? provider.label : folder.name}
      subtitle={atRoot ? provider.subtitle : stack.map((f) => f.name).join(' / ')}
      badge={activeUploads}
      onBack={goUp}
      onMenu={onOpenMenu}
      toolbar={toolbar}
    >
      {/* Strip navigasi */}
      <View style={styles.strip}>
        {selected ? (
          <>
            <IconButton icon={X} size={36} onPress={() => setSelected(null)} accessibilityLabel="Keluar mode pilih" />
            <View style={styles.stripCenter}>
              <Txt variant="heading">{selected.size} dipilih</Txt>
              <Txt variant="caption">{folder.name}</Txt>
            </View>
            <Pressable onPress={toggleSelectAll} hitSlop={8} style={[styles.pill, { backgroundColor: t.card }]}>
              <Txt variant="label">{allSelected ? 'Batal semua' : 'Pilih semua'}</Txt>
            </Pressable>
          </>
        ) : (
          <>
            <IconButton icon={ChevronLeft} size={36} onPress={goUp} accessibilityLabel="Kembali ke folder induk" />
            <View style={{ flex: 1 }}>
              <Txt variant="caption" numberOfLines={1}>
                {parentName} /
              </Txt>
              <Txt variant="heading" numberOfLines={1}>
                {selectable.length} item{selectable.length !== entries.filter((e) => !e.action).length ? ` dari ${entries.filter((e) => !e.action).length}` : ''}
              </Txt>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {provider.features.analytics && (
                <IconButton icon={ChartPie} size={36} onPress={onOpenAnalytics} accessibilityLabel="Analitik storage" />
              )}
              <Pressable onPress={() => startSelect()} hitSlop={8} style={[styles.pill, { backgroundColor: t.card }]}>
                <Txt variant="label">Pilih</Txt>
              </Pressable>
              <IconButton
                icon={view === 'list' ? LayoutGrid : List}
                size={36}
                onPress={() => setPrefs({ view: view === 'list' ? 'grid' : 'list' })}
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
              {error.message}
            </Txt>
            <Button label={error.auth ? 'Ke Beranda' : 'Coba lagi'} size="sm" onPress={error.auth ? onExit : load} />
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
            refreshControl={<RefreshControl refreshing={false} onRefresh={load} tintColor={t.mutedText} />}
            contentContainerStyle={{ padding: 8, paddingBottom: 170 + insets.bottom }}
            ListEmptyComponent={
              loading ? (
                <ActivityIndicator style={{ marginTop: 40 }} color={t.mutedText} />
              ) : (
                <EmptyState filtered={visible.length !== entries.length} onAdd={canAdd ? openAddMenu : undefined} />
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
        <UploadPanel onShowFailed={() => setShowFailed(true)} />

        {selected ? (
          <View style={[styles.actionBar, { backgroundColor: t.bg }]}>
            <ActionBtn
              icon={Copy}
              label="Salin"
              disabled={!selectedItems.some((i) => !i.isDir) && !caps.copyMove}
              onPress={() => toClipboard('copy', selectedItems)}
            />
            <ActionBtn icon={FolderInput} label="Pindah" disabled={!selected.size || !(caps.copyMove || caps.remove)} onPress={() => toClipboard('move', selectedItems)} />
            {caps.flags && <ActionBtn icon={Flag} label="Flag" disabled={!selected.size} onPress={() => setFlagTarget(selectedItems)} />}
            <ActionBtn
              icon={Share2}
              label="Bagikan"
              disabled={selectedItems.length !== 1 || selectedItems[0].isDir}
              onPress={() => run('share', () => shareItem(provider, selectedItems[0]))}
            />
            <ActionBtn icon={Trash2} label="Hapus" danger disabled={!selected.size || !caps.remove} onPress={() => askDelete(selectedItems)} />
          </View>
        ) : clipboard ? (
          <View style={[styles.clipBar, { backgroundColor: t.bg }]}>
            <View style={{ flex: 1 }}>
              <Txt variant="label" dark>
                {clipboard.items.length} item {clipboard.mode === 'copy' ? 'disalin' : 'akan dipindah'}
              </Txt>
              <Txt variant="small" dark numberOfLines={1}>
                {canPaste
                  ? multipleSources && !sameSource
                    ? `Dari ${clipSource?.label ?? 'sumber lain'} → ${provider.label}`
                    : 'Buka folder tujuan, lalu tempel'
                  : 'Tidak bisa ditempel di folder ini'}
              </Txt>
            </View>
            <IconButton icon={X} variant="dark" size={38} onPress={() => setClipboard(null)} accessibilityLabel="Batal" />
            <Button label="Tempel" icon={ClipboardPaste} size="sm" loading={busy === 'paste'} disabled={!canPaste} onPress={paste} />
          </View>
        ) : canAdd ? (
          <View style={{ alignSelf: 'flex-end' }}>
            <Pressable
              onPress={openAddMenu}
              accessibilityLabel="Upload atau buat folder"
              style={({ pressed }) => [styles.fab, { backgroundColor: pressed ? t.primaryPressed : t.primary }]}
            >
              <Plus size={28} color={t.primaryText} strokeWidth={2.4} />
            </Pressable>
          </View>
        ) : null}
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
          const fl = (flagTarget ?? []).map((e) => e.flag ?? null);
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
      <FailedSheet visible={showFailed} onClose={() => setShowFailed(false)} />
      <PreviewModal provider={provider} entry={preview} onClose={() => setPreview(null)} />
    </Screen>
  );
}

// ---------- item ----------

type ItemProps = {
  entry: FileItem;
  provider: StorageProvider;
  selecting: boolean;
  selected: boolean;
  onPress: (e: FileItem) => void;
  onLongPress: (e: FileItem) => void;
};

/** Thumbnail dari provider (bisa async, mis. galeri HP / Google Drive). */
function useThumb(provider: StorageProvider, entry: FileItem): MediaSource | null {
  const sync = useMemo(() => {
    if (entry.isDir || entry.action) return null;
    if (!entry.thumb && previewKind(entry) !== 'image' && !entry.path.startsWith('asset:')) return null;
    return provider.thumbnail(entry);
  }, [provider, entry]);
  const [resolved, setResolved] = useState<{ path: string; src: MediaSource | null } | null>(null);
  useEffect(() => {
    if (!(sync instanceof Promise)) return;
    let alive = true;
    sync.then((src) => alive && setResolved({ path: entry.path, src })).catch(() => {});
    return () => {
      alive = false;
    };
  }, [sync, entry.path]);
  if (sync instanceof Promise) return resolved?.path === entry.path ? resolved.src : null;
  return sync;
}

function Thumb({ entry, provider, size, rounded }: { entry: FileItem; provider: StorageProvider; size: number; rounded: number }) {
  const t = useTheme();
  const src = useThumb(provider, entry);
  if (src) {
    return (
      <Image
        source={src}
        style={{ width: size, height: size, borderRadius: rounded, backgroundColor: t.panel }}
        contentFit="cover"
        cachePolicy="disk"
        recyclingKey={entry.path}
        transition={150}
      />
    );
  }
  const folder = entry.isDir;
  const action = !!entry.action;
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: rounded,
        backgroundColor: action ? t.card : folder ? t.primary : t.bg,
        borderWidth: action ? 2 : 0,
        borderStyle: 'dashed',
        borderColor: t.stripe,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
      }}
    >
      {createElement(action ? Plus : iconFor(entry), {
        size: size * (folder || action ? 0.42 : 0.36),
        color: action ? t.mutedText : folder ? t.primaryText : t.textOnDark,
        strokeWidth: 1.9,
      })}
      {!folder && !action && (
        <Text style={{ color: t.mutedOnDark, fontFamily: font.bold, fontSize: Math.max(8, size * 0.15) }} numberOfLines={1}>
          {entry.cloudDoc ? 'GOOGLE' : extLabel(entry)}
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

function metaLine(e: FileItem) {
  if (e.action) return 'Pilih folder di HP untuk ditampilkan di sini';
  if (e.isDir) return e.count != null ? `${e.count} item` : e.size < 0 ? 'Folder' : `Folder · ${formatDate(e.modTime)}`;
  return `${e.cloudDoc ? 'Dokumen Google' : extLabel(e)}${e.size >= 0 ? ` · ${formatSize(e.size)}` : ''} · ${formatDate(e.modTime)}`;
}

const ListItem = memo(function ListItem({
  entry,
  provider,
  selecting,
  selected,
  onPress,
  onLongPress,
  onMore,
}: ItemProps & { onMore: (e: FileItem) => void }) {
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
      <Thumb entry={entry} provider={provider} size={50} rounded={16} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          {entry.flag && <View style={[styles.flagDot, { backgroundColor: flagColors[entry.flag] }]} />}
          <Txt variant="body" numberOfLines={1} style={{ flexShrink: 1 }}>
            {entry.name}
          </Txt>
        </View>
        <Txt variant="small" numberOfLines={1} style={{ marginTop: 3 }}>
          {metaLine(entry)}
        </Txt>
      </View>
      {entry.action ? null : selecting ? (
        <SelectMark selected={selected} />
      ) : entry.isDir ? (
        <ChevronRight size={20} color={t.mutedText} strokeWidth={2.2} />
      ) : (
        <IconButton icon={Ellipsis} variant="plain" size={34} color={t.mutedText} onPress={() => onMore(entry)} accessibilityLabel="Aksi lain" />
      )}
    </Pressable>
  );
});

const GridItem = memo(function GridItem({ entry, provider, size, selecting, selected, onPress, onLongPress }: ItemProps & { size: number }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={() => onPress(entry)}
      onLongPress={() => onLongPress(entry)}
      delayLongPress={350}
      style={({ pressed }) => [{ width: size, opacity: pressed ? 0.8 : 1 }]}
    >
      <View style={{ borderRadius: 20, borderWidth: 2.5, borderColor: selected ? t.primary : 'transparent' }}>
        <Thumb entry={entry} provider={provider} size={size - 5} rounded={17} />
        {entry.flag && <View style={[styles.flagCorner, { backgroundColor: flagColors[entry.flag], borderColor: t.panel }]} />}
        {selecting && !entry.action && (
          <View style={{ position: 'absolute', top: 6, right: 6 }}>
            <SelectMark selected={selected} />
          </View>
        )}
      </View>
      <Txt variant="label" numberOfLines={1} style={{ marginTop: 6, paddingHorizontal: 2 }}>
        {entry.name}
      </Txt>
      <Txt variant="small" numberOfLines={1} style={{ fontSize: 11, paddingHorizontal: 2 }}>
        {entry.isDir ? 'Folder' : entry.size >= 0 ? formatSize(entry.size) : formatDate(entry.modTime)}
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

function EmptyState({ filtered, onAdd }: { filtered: boolean; onAdd?: () => void }) {
  const t = useTheme();
  return (
    <View style={{ gap: 8 }}>
      {[0, 1, 2, 3].map((i) => (
        <Hatch key={i} bg={t.panel} style={{ height: 46, alignItems: 'center', justifyContent: 'center' }}>
          {i === 1 && <Txt variant="small">{filtered ? 'Tidak ada yang cocok' : 'Folder kosong'}</Txt>}
        </Hatch>
      ))}
      {!filtered && onAdd && <Button label="Tambah file" icon={Plus} size="sm" onPress={onAdd} style={{ alignSelf: 'center', marginTop: 10 }} />}
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
  busy: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(43,43,39,0.15)' },
});

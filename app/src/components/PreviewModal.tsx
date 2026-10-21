import { createElement, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { WebView } from 'react-native-webview';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { ArrowLeft, ExternalLink, Music, Share2 } from 'lucide-react-native';
import { formatBytes, formatDate, formatSize, type Entry } from '../api';
import type { FileItem, MediaSource, StorageProvider } from '../providers/types';
import { extLabel, iconFor, mimeOf, previewKind } from '../fileTypes';
import { flagColors, font, radius, useTheme } from '../theme';
import { Button, IconButton, IconTile, Txt } from './ui';

const TEXT_PREVIEW_BYTES = 256 * 1024;

/** Download ke cache lalu buka share sheet (di iOS ada "Save Image/Video" ke Photos). */
export async function shareItem(provider: StorageProvider, item: FileItem) {
  if (item.cloudDoc && item.webUrl) return void Linking.openURL(item.webUrl);
  if (Platform.OS === 'web') return void Linking.openURL((await provider.source(item)).uri);
  const file = await provider.download(item);
  await Sharing.shareAsync(file.uri, { mimeType: mimeOf(item) });
}

/**
 * Buka file di aplikasi lain. Dipakai untuk dokumen Office (diserahkan ke Google Drive /
 * Docs / Sheets / Slides) dan tipe yang tidak bisa di-preview di app.
 * File yang sudah ada di Google Drive langsung dibuka di Drive; selain itu:
 * Android: intent VIEW → pemilih aplikasi. iOS: share sheet ("Buka di…" / Drive).
 */
export async function openItem(provider: StorageProvider, item: FileItem) {
  if (item.webUrl) return void Linking.openURL(item.webUrl);
  if (Platform.OS === 'web') return void Linking.openURL((await provider.source(item)).uri);
  const file = await provider.download(item);
  if (Platform.OS === 'android') {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: file.contentUri,
        type: mimeOf(item),
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      });
      return;
    } catch {
      // Tidak ada aplikasi yang bisa membuka tipe ini → jatuh ke share sheet.
    }
  }
  await Sharing.shareAsync(file.uri, { mimeType: mimeOf(item), dialogTitle: 'Buka dengan' });
}

function VideoPreview({ src }: { src: MediaSource }) {
  const player = useVideoPlayer(src, (p) => p.play());
  return <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain" />;
}

function AudioPreview({ src, entry }: { src: MediaSource; entry: Entry }) {
  const t = useTheme();
  const player = useVideoPlayer(src, (p) => p.play());
  return (
    <View style={styles.center}>
      <IconTile icon={Music} size={140} bg={t.primary} color={t.primaryText} />
      <Txt variant="heading" dark style={{ marginTop: 18, textAlign: 'center' }} numberOfLines={2}>
        {entry.name}
      </Txt>
      <VideoView player={player} nativeControls style={{ width: '100%', height: 90, marginTop: 18 }} />
    </View>
  );
}

function TextPreview({ src, size }: { src: MediaSource; size: number }) {
  const t = useTheme();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(src.uri, { headers: { ...src.headers, Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` } })
      .then((r) => r.text())
      .then(setText)
      .catch((e) => setError(String(e?.message ?? e)));
  }, [src]);
  if (error) return <Txt dark variant="muted" style={{ margin: 24 }}>{error}</Txt>;
  if (text === null) return <ActivityIndicator style={{ flex: 1 }} color={t.textOnDark} />;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingTop: 80, paddingBottom: 220 }}>
      <Text selectable style={[styles.code, { color: t.textOnDark }]}>
        {text}
      </Text>
      {size > TEXT_PREVIEW_BYTES && (
        <Txt variant="small" dark style={{ marginTop: 16 }}>
          Menampilkan {formatBytes(TEXT_PREVIEW_BYTES)} pertama dari {formatBytes(size)}.
        </Txt>
      )}
    </ScrollView>
  );
}

/** Tampilan untuk file yang dibuka di aplikasi lain (Office, PDF di Android, tipe lain). */
function ExternalPreview({ entry, office, cloudDoc }: { entry: Entry; office?: boolean; cloudDoc?: boolean }) {
  const t = useTheme();
  return (
    <View style={styles.center}>
      <View style={[styles.docTile, { backgroundColor: t.bgRaised }]}>
        {createElement(iconFor(entry), { size: 52, color: t.textOnDark, strokeWidth: 1.5 })}
        <View style={[styles.extBadge, { backgroundColor: t.primary }]}>
          <Text style={{ color: t.primaryText, fontFamily: font.bold, fontSize: 12 }}>{extLabel(entry)}</Text>
        </View>
      </View>
      <Txt variant="muted" dark style={{ textAlign: 'center', marginTop: 22, maxWidth: 280, lineHeight: 20 }}>
        {cloudDoc
          ? 'Dokumen Google dibuka di aplikasi Google Drive / Docs / Sheets / Slides.'
          : office
          ? 'Dokumen Office dibuka lewat Google Drive / Docs / Sheets / Slides agar bisa dilihat & diedit dengan lengkap.'
          : 'Pratinjau tidak tersedia untuk tipe ini. Buka dengan aplikasi lain di HP kamu.'}
      </Txt>
    </View>
  );
}

export default function PreviewModal({
  provider,
  entry,
  onClose,
}: {
  provider: StorageProvider;
  entry: FileItem | null;
  onClose: () => void;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState<'share' | 'open' | null>(null);
  // Error & sumber media disimpan per file agar otomatis berganti saat membuka file lain.
  const [failure, setFailure] = useState<{ path: string; message: string } | null>(null);
  const [loaded, setLoaded] = useState<{ path: string; src: MediaSource } | null>(null);
  const kind = entry?.cloudDoc ? 'clouddoc' : entry ? previewKind(entry) : 'other';
  const pdfInline = kind === 'pdf' && Platform.OS === 'ios';
  const external = kind === 'office' || kind === 'other' || kind === 'clouddoc' || (kind === 'pdf' && !pdfInline);

  useEffect(() => {
    if (!entry || external) return;
    let alive = true;
    provider
      .source(entry)
      .then((src) => alive && setLoaded({ path: entry.path, src }))
      .catch((e) => alive && setFailure({ path: entry.path, message: e?.message ?? String(e) }));
    return () => {
      alive = false;
    };
  }, [provider, entry, external]);

  if (!entry) return null;
  const error = failure?.path === entry.path ? failure.message : null;
  const src = loaded?.path === entry.path ? loaded.src : null;

  const run = async (which: 'share' | 'open') => {
    setBusy(which);
    setFailure(null);
    try {
      await (which === 'share' ? shareItem(provider, entry) : openItem(provider, entry));
    } catch (e: any) {
      setFailure({ path: entry.path, message: e?.message ?? String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={[styles.root, { backgroundColor: t.bg }]}>
        {external ? (
          <ExternalPreview entry={entry} office={kind === 'office'} cloudDoc={kind === 'clouddoc'} />
        ) : !src ? (
          <ActivityIndicator style={{ flex: 1 }} color={t.textOnDark} />
        ) : kind === 'image' ? (
          <Image source={src} style={StyleSheet.absoluteFill} contentFit="contain" transition={200} />
        ) : kind === 'video' ? (
          <VideoPreview src={src} />
        ) : kind === 'audio' ? (
          <AudioPreview src={src} entry={entry} />
        ) : kind === 'text' ? (
          <TextPreview src={src} size={entry.size} />
        ) : (
          <WebView source={src} style={{ flex: 1, marginTop: 70, marginBottom: 190 }} />
        )}

        <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
          <IconButton icon={ArrowLeft} variant="glass" size={42} onPress={onClose} accessibilityLabel="Tutup" />
        </SafeAreaView>

        {kind !== 'video' && (
          <SafeAreaView edges={['bottom']} style={styles.bottom} pointerEvents="box-none">
            <View style={[styles.info, { backgroundColor: t.card }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                {entry.flag && <View style={[styles.flagDot, { backgroundColor: flagColors[entry.flag] }]} />}
                <Txt variant="heading" numberOfLines={1} style={{ flex: 1 }}>
                  {entry.name}
                </Txt>
              </View>
              <Txt variant="small" style={{ marginTop: 4 }}>
                {extLabel(entry)} · {formatSize(entry.size)} · {formatDate(entry.modTime)}
              </Txt>
              {error && (
                <Txt variant="small" style={{ color: t.danger, marginTop: 8 }}>
                  {error}
                </Txt>
              )}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 }}>
                {external ? (
                  <>
                    <Button
                      label={kind === 'office' || kind === 'clouddoc' ? 'Buka di Google Drive' : 'Buka dengan…'}
                      icon={ExternalLink}
                      loading={busy === 'open'}
                      onPress={() => run('open')}
                      style={{ flex: 1 }}
                    />
                    {busy === 'share' ? (
                      <ActivityIndicator style={{ width: 54 }} color={t.text} />
                    ) : (
                      <Pressable
                        onPress={() => run('share')}
                        accessibilityLabel="Bagikan"
                        style={({ pressed }) => [styles.shareBtn, { backgroundColor: t.panel, opacity: pressed ? 0.7 : 1 }]}
                      >
                        <Share2 size={20} color={t.text} />
                      </Pressable>
                    )}
                  </>
                ) : (
                  <Button
                    label="Bagikan / Simpan"
                    icon={Share2}
                    loading={busy === 'share'}
                    onPress={() => run('share')}
                    style={{ flex: 1 }}
                  />
                )}
              </View>
            </View>
          </SafeAreaView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28, paddingBottom: 200 },
  docTile: { width: 132, height: 160, borderRadius: radius.xl, alignItems: 'center', justifyContent: 'center' },
  extBadge: { position: 'absolute', bottom: 14, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 8 },
  code: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }), fontSize: 12.5, lineHeight: 19 },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', padding: 14 },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12 },
  info: { borderRadius: radius.xl, padding: 18 },
  flagDot: { width: 10, height: 10, borderRadius: 5 },
  shareBtn: { width: 54, height: 54, borderRadius: radius.lg, alignItems: 'center', justifyContent: 'center' },
});

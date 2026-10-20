import { createElement, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { WebView } from 'react-native-webview';
import * as IntentLauncher from 'expo-intent-launcher';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { ArrowLeft, ExternalLink, Music, Share2 } from 'lucide-react-native';
import { fileUrl, formatBytes, formatDate, type Entry, type Session } from '../api';
import { extLabel, iconFor, mimeOf, previewKind } from '../fileTypes';
import { flagColors, font, radius, useTheme } from '../theme';
import { Button, IconButton, IconTile, Txt } from './ui';

const TEXT_PREVIEW_BYTES = 256 * 1024;

async function downloadToCache(session: Session, entry: Entry): Promise<File> {
  const dir = new Directory(Paths.cache, 'shared');
  dir.create({ idempotent: true, intermediates: true });
  const dest = new File(dir, entry.name);
  if (dest.exists) dest.delete();
  return File.downloadFileAsync(fileUrl(session, entry.path), dest);
}

/** Download ke cache lalu buka share sheet (di iOS ada "Save Image/Video" ke Photos). */
export async function shareEntry(session: Session, entry: Entry) {
  if (Platform.OS === 'web') return void Linking.openURL(fileUrl(session, entry.path, true));
  const file = await downloadToCache(session, entry);
  await Sharing.shareAsync(file.uri, { mimeType: mimeOf(entry) });
}

/**
 * Buka file di aplikasi lain. Dipakai untuk dokumen Office (diserahkan ke Google Drive /
 * Docs / Sheets / Slides) dan tipe yang tidak bisa di-preview di app.
 * Android: intent VIEW → pemilih aplikasi. iOS: share sheet ("Buka di…" / Drive).
 */
export async function openWithApp(session: Session, entry: Entry) {
  if (Platform.OS === 'web') return void Linking.openURL(fileUrl(session, entry.path, true));
  const file = await downloadToCache(session, entry);
  if (Platform.OS === 'android') {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: file.contentUri,
        type: mimeOf(entry),
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
      });
      return;
    } catch {
      // Tidak ada aplikasi yang bisa membuka tipe ini → jatuh ke share sheet.
    }
  }
  await Sharing.shareAsync(file.uri, { mimeType: mimeOf(entry), dialogTitle: 'Buka dengan' });
}

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => p.play());
  return <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain" />;
}

function AudioPreview({ uri, entry }: { uri: string; entry: Entry }) {
  const t = useTheme();
  const player = useVideoPlayer(uri, (p) => p.play());
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

function TextPreview({ uri, size }: { uri: string; size: number }) {
  const t = useTheme();
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    fetch(uri, { headers: { Range: `bytes=0-${TEXT_PREVIEW_BYTES - 1}` } })
      .then((r) => r.text())
      .then(setText)
      .catch((e) => setError(String(e?.message ?? e)));
  }, [uri]);
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
function ExternalPreview({ entry, office }: { entry: Entry; office?: boolean }) {
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
        {office
          ? 'Dokumen Office dibuka lewat Google Drive / Docs / Sheets / Slides agar bisa dilihat & diedit dengan lengkap.'
          : 'Pratinjau tidak tersedia untuk tipe ini. Buka dengan aplikasi lain di HP kamu.'}
      </Txt>
    </View>
  );
}

export default function PreviewModal({
  session,
  entry,
  onClose,
}: {
  session: Session;
  entry: Entry | null;
  onClose: () => void;
}) {
  const t = useTheme();
  const [busy, setBusy] = useState<'share' | 'open' | null>(null);
  // Error disimpan per file agar otomatis hilang saat membuka file lain.
  const [failure, setFailure] = useState<{ path: string; message: string } | null>(null);
  if (!entry) return null;
  const error = failure?.path === entry.path ? failure.message : null;
  const uri = fileUrl(session, entry.path);
  const kind = previewKind(entry);
  const pdfInline = kind === 'pdf' && Platform.OS === 'ios';
  const external = kind === 'office' || kind === 'other' || (kind === 'pdf' && !pdfInline);

  const run = async (which: 'share' | 'open') => {
    setBusy(which);
    setFailure(null);
    try {
      await (which === 'share' ? shareEntry(session, entry) : openWithApp(session, entry));
    } catch (e: any) {
      setFailure({ path: entry.path, message: e?.message ?? String(e) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={[styles.root, { backgroundColor: t.bg }]}>
        {kind === 'image' ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" transition={200} />
        ) : kind === 'video' ? (
          <VideoPreview uri={uri} />
        ) : kind === 'audio' ? (
          <AudioPreview uri={uri} entry={entry} />
        ) : kind === 'text' ? (
          <TextPreview uri={uri} size={entry.size} />
        ) : pdfInline ? (
          <WebView source={{ uri }} style={{ flex: 1, marginTop: 70, marginBottom: 190 }} />
        ) : (
          <ExternalPreview entry={entry} office={kind === 'office'} />
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
                {extLabel(entry)} · {formatBytes(entry.size)} · {formatDate(entry.modTime)}
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
                      label={kind === 'office' ? 'Buka di Google Drive' : 'Buka dengan…'}
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

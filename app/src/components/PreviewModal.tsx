import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { BlurView } from 'expo-blur';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Download, FileText, X } from 'lucide-react-native';
import { fileUrl, formatBytes, formatDate, isImage, isVideo, type Entry, type Session } from '../api';
import { radius } from '../theme';
import { IconButton, Txt } from './ui';

/** Download file ke cache lalu buka share sheet (di iOS ada opsi "Save Image/Video" ke Photos). */
export async function shareEntry(session: Session, entry: Entry) {
  const dir = new Directory(Paths.cache, 'shared');
  dir.create({ idempotent: true, intermediates: true });
  const dest = new File(dir, entry.name);
  if (dest.exists) dest.delete();
  const file = await File.downloadFileAsync(fileUrl(session, entry.path), dest);
  await Sharing.shareAsync(file.uri, { mimeType: entry.mime || undefined });
}

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri, (p) => p.play());
  return <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls contentFit="contain" />;
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
  const [sharing, setSharing] = useState(false);
  if (!entry) return null;
  const uri = fileUrl(session, entry.path);

  const share = async () => {
    setSharing(true);
    try {
      await shareEntry(session, entry);
    } catch (e: any) {
      Alert.alert('Gagal mengunduh', e?.message ?? String(e));
    } finally {
      setSharing(false);
    }
  };

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.root}>
        {isImage(entry) ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" transition={200} />
        ) : isVideo(entry) ? (
          <VideoPreview uri={uri} />
        ) : (
          <View style={styles.center}>
            <View style={styles.fileTile}>
              <FileText size={36} color="#fafafa" strokeWidth={1.4} />
            </View>
            <Txt variant="mono" style={{ color: '#a1a1aa', marginTop: 4 }}>
              {entry.mime || 'file'}
            </Txt>
          </View>
        )}

        <SafeAreaView edges={['top']} style={styles.top} pointerEvents="box-none">
          <IconButton icon={X} variant="glass" size={40} onPress={onClose} />
          {sharing ? (
            <View style={styles.spinner}>
              <ActivityIndicator color="#fafafa" />
            </View>
          ) : (
            <IconButton icon={Download} variant="glass" size={40} onPress={share} />
          )}
        </SafeAreaView>

        {!isVideo(entry) && (
          <SafeAreaView edges={['bottom']} style={styles.bottom} pointerEvents="box-none">
            <BlurView intensity={40} tint="dark" style={styles.info}>
              <Txt variant="body" numberOfLines={1} style={{ color: '#fafafa' }}>
                {entry.name}
              </Txt>
              <Txt variant="mono" style={{ color: '#a1a1aa', marginTop: 2 }}>
                {formatBytes(entry.size)} · {formatDate(entry.modTime)}
              </Txt>
            </BlurView>
          </SafeAreaView>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  fileTile: {
    width: 88,
    height: 88,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: '#27272a',
    backgroundColor: '#18181b',
    alignItems: 'center',
    justifyContent: 'center',
  },
  top: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', justifyContent: 'space-between', padding: 12 },
  spinner: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  bottom: { position: 'absolute', bottom: 0, left: 0, right: 0, padding: 12 },
  info: {
    borderRadius: radius.lg,
    paddingHorizontal: 16,
    paddingVertical: 12,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: 'rgba(255,255,255,0.12)',
    backgroundColor: 'rgba(24,24,27,0.55)',
  },
});

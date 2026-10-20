import { useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image } from 'expo-image';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { fileUrl, formatBytes, isImage, isVideo, type Entry, type Session } from '../api';

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
    <Modal visible animationType="slide" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape']}>
      <View style={styles.root}>
        {isImage(entry) ? (
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="contain" transition={150} />
        ) : isVideo(entry) ? (
          <VideoPreview uri={uri} />
        ) : (
          <View style={styles.center}>
            <Text style={{ fontSize: 64 }}>📄</Text>
            <Text style={styles.name}>{entry.name}</Text>
            <Text style={{ color: '#aaa' }}>{formatBytes(entry.size)}</Text>
          </View>
        )}
        <SafeAreaView edges={['top']} style={styles.bar} pointerEvents="box-none">
          <Pressable onPress={onClose} style={styles.btn} hitSlop={10}>
            <Text style={styles.btnText}>✕</Text>
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {entry.name}
          </Text>
          <Pressable onPress={share} style={styles.btn} hitSlop={10} disabled={sharing}>
            {sharing ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnText}>⤓</Text>}
          </Pressable>
        </SafeAreaView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 },
  name: { color: '#fff', fontSize: 17, textAlign: 'center' },
  bar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', padding: 8 },
  btn: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontSize: 18 },
  title: { flex: 1, color: '#fff', textAlign: 'center', marginHorizontal: 8, fontWeight: '600', textShadowColor: '#000', textShadowRadius: 4 },
});

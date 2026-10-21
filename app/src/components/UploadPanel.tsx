import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Check, CloudUpload, RotateCcw, TriangleAlert, X } from 'lucide-react-native';
import { formatBytes } from '../api';
import { radius, useTheme } from '../theme';
import { useUploadQueue } from '../uploads';
import { BottomSheet } from './Sheets';
import { Bar, Button, IconButton, Txt } from './ui';

/** Panel progres antrian upload global + kartu peringatan jika ada yang gagal. */
export function UploadPanel({ onShowFailed }: { onShowFailed: () => void }) {
  const t = useTheme();
  const { items, summary, running, cancelAll, retryFailed, clearFinished } = useUploadQueue();
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
export function FailedSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const t = useTheme();
  const uploads = useUploadQueue();
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
                {formatBytes(f.sent)} / {formatBytes(f.size)} terkirim · ke {f.destLabel}
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
  upload: { borderRadius: radius.xl, padding: 14 },
  uploadIcon: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  retryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, padding: 8, borderRadius: 12 },
  failRow: { flexDirection: 'row', gap: 12, padding: 12, borderRadius: 16, marginBottom: 8 },
});

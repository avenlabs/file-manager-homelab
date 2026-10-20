import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RefreshCw } from 'lucide-react-native';
import { formatBytes, formatDate, formatDuration, getStats, type Entry, type Session, type Stats } from '../api';
import { categoryColors, categoryLabels, iconFor, type Category } from '../fileTypes';
import { flagColors, font, radius, useTheme } from '../theme';
import { Screen } from '../components/Screen';
import PreviewModal from '../components/PreviewModal';
import { Bar, Button, Hatch, IconTile, Segmented, Txt } from '../components/ui';

type Tab = 'summary' | 'files';

const nf = new Intl.NumberFormat('id-ID');
const pct = (n: number) => `${n >= 0.1 || n === 0 ? Math.round(n * 100) : '<1'}%`;

function timeAgo(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'baru saja';
  if (s < 3600) return `${Math.floor(s / 60)} menit lalu`;
  return `${Math.floor(s / 3600)} jam lalu`;
}

export default function AnalyticsScreen({ session, onBack }: { session: Session; onBack: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('summary');
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Entry | null>(null);

  const fetchStats = useCallback(
    (refresh: boolean) =>
      getStats(session, refresh)
        .then((s) => {
          setStats(s);
          setError(null);
        })
        .catch((e: any) =>
          setError(
            e?.status === 404
              ? 'Server belum mendukung analitik. Update server dengan menjalankan ulang install.sh.'
              : (e?.message ?? 'Gagal memuat'),
          ),
        )
        .finally(() => setLoading(false)),
    [session],
  );

  useEffect(() => {
    fetchStats(false);
  }, [fetchStats]);

  const load = (refresh = false) => {
    setLoading(true);
    fetchStats(refresh);
  };

  return (
    <Screen
      title="Analitik"
      subtitle="Ringkasan storage homelab kamu:"
      onBack={onBack}
      toolbar={
        <Segmented
          options={[
            { value: 'summary', label: 'Ringkasan' },
            { value: 'files', label: 'File' },
          ]}
          value={tab}
          onChange={setTab}
        />
      }
    >
      {!stats ? (
        <View style={styles.center}>
          {error ? (
            <>
              <Txt variant="muted" style={{ color: t.danger, textAlign: 'center', marginBottom: 14 }}>
                {error}
              </Txt>
              <Button label="Coba lagi" size="sm" onPress={() => load()} />
            </>
          ) : (
            <>
              <ActivityIndicator color={t.mutedText} />
              <Txt variant="small" style={{ marginTop: 10 }}>
                Memindai storage…
              </Txt>
            </>
          )}
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 12, gap: 12, paddingBottom: insets.bottom + 24 }}
          refreshControl={<RefreshControl refreshing={loading} onRefresh={() => load(true)} tintColor={t.mutedText} />}
        >
          {tab === 'summary' ? (
            <>
              <DiskCard stats={stats} />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <StatTile label="File" value={nf.format(stats.files)} />
                <StatTile label="Folder" value={nf.format(stats.folders)} />
                <StatTile label="Diberi flag" value={nf.format(stats.flagged)} />
              </View>
              <CategoryCard stats={stats} />
              <LocationCard stats={stats} />
            </>
          ) : (
            <>
              <ExtensionCard stats={stats} />
              <FileListCard title="File terbesar" files={stats.largest} metric="size" onOpen={setPreview} />
              <FileListCard title="Terakhir diubah" files={stats.recent} metric="date" onOpen={setPreview} />
            </>
          )}

          <View style={styles.footer}>
            <Txt variant="small" style={{ flex: 1 }}>
              Dipindai {timeAgo(stats.computedAt)} · {nf.format(stats.durationMs)} ms
            </Txt>
            <Button label="Pindai ulang" icon={RefreshCw} size="sm" variant="dark" loading={loading} onPress={() => load(true)} />
          </View>
        </ScrollView>
      )}
      <PreviewModal session={session} entry={preview} onClose={() => setPreview(null)} />
    </Screen>
  );
}

function SectionTitle({ title, right }: { title: string; right?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', marginBottom: 14 }}>
      <Txt variant="heading" style={{ flex: 1 }}>
        {title}
      </Txt>
      {right && <Txt variant="small">{right}</Txt>}
    </View>
  );
}

/** Hero: kapasitas disk (bagian dari keseluruhan: terpakai vs bebas). */
function DiskCard({ stats }: { stats: Stats }) {
  const t = useTheme();
  const { total, used, free } = stats.disk;
  const ratio = total ? used / total : 0;
  const warn = ratio >= 0.9;
  return (
    <View style={[styles.card, { backgroundColor: t.card }]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ flex: 1 }}>
          <Txt variant="caption">Disk terpakai</Txt>
          <Text style={[styles.hero, { color: t.text }]}>{formatBytes(used)}</Text>
          <Txt variant="muted">dari {formatBytes(total)}</Txt>
        </View>
        <View style={[styles.pctBadge, { backgroundColor: warn ? t.danger : t.primary }]}>
          <Text style={{ color: '#fff', fontFamily: font.bold, fontSize: 16 }}>{pct(ratio)}</Text>
        </View>
      </View>

      <View style={{ flexDirection: 'row', height: 18, gap: 2, marginTop: 18 }}>
        <View style={{ flex: Math.max(ratio, 0.001), backgroundColor: warn ? t.danger : t.primary, borderRadius: 6 }} />
        <Hatch style={{ flex: Math.max(1 - ratio, 0.001), borderRadius: 6 }} />
      </View>
      <View style={{ flexDirection: 'row', gap: 18, marginTop: 12 }}>
        <Legend swatch={<View style={[styles.swatch, { backgroundColor: warn ? t.danger : t.primary }]} />} label="Terpakai" value={formatBytes(used)} />
        <Legend swatch={<Hatch style={[styles.swatch, { borderRadius: 3 }]} />} label="Bebas" value={formatBytes(free)} />
      </View>
      {warn && (
        <Txt variant="small" style={{ color: t.danger, marginTop: 10 }}>
          Ruang hampir penuh. Hapus atau pindahkan file besar.
        </Txt>
      )}
    </View>
  );
}

function Legend({ swatch, label, value }: { swatch: React.ReactNode; label: string; value: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      {swatch}
      <Txt variant="small">{label}</Txt>
      <Txt variant="label">{value}</Txt>
    </View>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  const t = useTheme();
  return (
    <View style={[styles.tile, { backgroundColor: t.card }]}>
      <Text style={{ fontFamily: font.bold, fontSize: 24, letterSpacing: -0.6, color: t.text }} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Txt variant="small" style={{ marginTop: 2 }}>
        {label}
      </Txt>
    </View>
  );
}

/** Komposisi isi Casa Files per kategori: bar bertumpuk + tabel (legend sekaligus nilai). */
function CategoryCard({ stats }: { stats: Stats }) {
  const t = useTheme();
  const [active, setActive] = useState<Category | null>(null);
  const cats = stats.categories.filter((c) => c.count > 0);
  const total = stats.totalSize || 1;
  const focus = cats.find((c) => c.key === active);

  return (
    <View style={[styles.card, { backgroundColor: t.card }]}>
      <SectionTitle title="Isi storage" right={formatBytes(stats.totalSize)} />
      {cats.length === 0 ? (
        <Hatch style={{ height: 46, alignItems: 'center', justifyContent: 'center' }}>
          <Txt variant="small">Belum ada file</Txt>
        </Hatch>
      ) : (
        <>
          {/* Tooltip untuk segmen yang di-tap */}
          <View style={{ height: 22, justifyContent: 'center', marginBottom: 6 }}>
            {focus ? (
              <Txt variant="label">
                {categoryLabels[focus.key as Category]} · {formatBytes(focus.size)} · {pct(focus.size / total)} · {nf.format(focus.count)} file
              </Txt>
            ) : (
              <Txt variant="small">Tap segmen atau baris untuk detail</Txt>
            )}
          </View>
          <View style={{ flexDirection: 'row', height: 22, gap: 2 }}>
            {cats.map((c) => (
              <Pressable
                key={c.key}
                onPress={() => setActive(active === c.key ? null : (c.key as Category))}
                hitSlop={{ top: 12, bottom: 12 }}
                style={{
                  flex: Math.max(c.size / total, 0.012),
                  backgroundColor: categoryColors[c.key as Category],
                  borderRadius: 4,
                  opacity: active && active !== c.key ? 0.3 : 1,
                }}
                accessibilityLabel={`${categoryLabels[c.key as Category]} ${formatBytes(c.size)}`}
              />
            ))}
          </View>
          <View style={{ marginTop: 14 }}>
            {cats.map((c) => (
              <Pressable
                key={c.key}
                onPress={() => setActive(active === c.key ? null : (c.key as Category))}
                style={[styles.catRow, { borderTopColor: t.line, opacity: active && active !== c.key ? 0.45 : 1 }]}
              >
                <View style={[styles.swatch, { backgroundColor: categoryColors[c.key as Category] }]} />
                <Txt variant="body" style={{ flex: 1 }}>
                  {categoryLabels[c.key as Category]}
                </Txt>
                <Txt variant="small" style={{ width: 70, textAlign: 'right' }}>
                  {nf.format(c.count)} file
                </Txt>
                <Txt variant="label" style={{ width: 72, textAlign: 'right' }}>
                  {formatBytes(c.size)}
                </Txt>
                <Txt variant="small" style={{ width: 40, textAlign: 'right' }}>
                  {pct(c.size / total)}
                </Txt>
              </Pressable>
            ))}
          </View>
        </>
      )}
    </View>
  );
}

function LocationCard({ stats }: { stats: Stats }) {
  const t = useTheme();
  const { location: l, server: s } = stats;
  const rows: [string, string | undefined][] = [
    ['Folder storage', l.root],
    ['Mount point', l.mountPoint],
    ['Filesystem', l.fsType],
    ['Device', l.device],
    ['Hostname', s.hostname],
    ['Sistem', `${s.os} / ${s.arch}`],
    ['Versi server', `${s.version} (${s.goVersion})`],
    ['Server aktif', formatDuration(s.uptimeSeconds)],
    ['Mesin menyala', s.hostUptimeSeconds ? formatDuration(s.hostUptimeSeconds) : undefined],
  ];
  return (
    <View style={[styles.card, { backgroundColor: t.bg }]}>
      <Txt variant="heading" dark style={{ marginBottom: 6 }}>
        Lokasi storage
      </Txt>
      {rows
        .filter(([, v]) => !!v)
        .map(([k, v]) => (
          <View key={k} style={[styles.kv, { borderTopColor: t.lineDark }]}>
            <Txt variant="small" dark style={{ width: 120 }}>
              {k}
            </Txt>
            <Txt variant="label" dark style={{ flex: 1, textAlign: 'right' }} numberOfLines={1} ellipsizeMode="middle">
              {v}
            </Txt>
          </View>
        ))}
    </View>
  );
}

/** Ekstensi teratas berdasarkan ukuran (satu seri → satu warna, tanpa legend). */
function ExtensionCard({ stats }: { stats: Stats }) {
  const t = useTheme();
  const max = Math.max(1, ...stats.extensions.map((e) => e.size));
  return (
    <View style={[styles.card, { backgroundColor: t.card }]}>
      <SectionTitle title="Ekstensi terbesar" right={`${stats.extensions.length} teratas`} />
      {stats.extensions.map((e) => (
        <View key={e.key} style={{ marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', marginBottom: 5 }}>
            <Txt variant="label" style={{ flex: 1 }}>
              .{e.key}
            </Txt>
            <Txt variant="small">
              {nf.format(e.count)} file · <Text style={{ fontFamily: font.bold, color: t.text }}>{formatBytes(e.size)}</Text>
            </Txt>
          </View>
          <Bar value={e.size / max} height={8} />
        </View>
      ))}
    </View>
  );
}

function FileListCard({
  title,
  files,
  metric,
  onOpen,
}: {
  title: string;
  files: Entry[];
  metric: 'size' | 'date';
  onOpen: (e: Entry) => void;
}) {
  const t = useTheme();
  return (
    <View style={[styles.card, { backgroundColor: t.card }]}>
      <SectionTitle title={title} />
      {files.map((f, i) => (
        <Pressable
          key={f.path}
          onPress={() => onOpen(f)}
          style={({ pressed }) => [styles.fileRow, i > 0 && { borderTopWidth: 1, borderTopColor: t.line }, pressed && { opacity: 0.6 }]}
        >
          <IconTile icon={iconFor(f)} size={40} bg={t.panel} />
          <View style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {f.flag && <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: flagColors[f.flag] }} />}
              <Txt variant="label" numberOfLines={1} style={{ flexShrink: 1 }}>
                {f.name}
              </Txt>
            </View>
            <Txt variant="small" numberOfLines={1} style={{ marginTop: 2 }}>
              {f.path.slice(0, f.path.length - f.name.length - 1) || '/'}
            </Txt>
          </View>
          <Txt variant="label">{metric === 'size' ? formatBytes(f.size) : formatDate(f.modTime)}</Txt>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card: { borderRadius: radius.xl, padding: 18 },
  hero: { fontFamily: font.extrabold, fontSize: 40, letterSpacing: -1.5, marginTop: 4 },
  pctBadge: { borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 8 },
  swatch: { width: 12, height: 12, borderRadius: 4 },
  tile: { flex: 1, borderRadius: radius.lg, padding: 14 },
  catRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderTopWidth: 1 },
  kv: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, borderTopWidth: 1 },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 6, paddingTop: 4 },
});

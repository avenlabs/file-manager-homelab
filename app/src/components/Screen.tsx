import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ArrowLeft, Menu, X } from 'lucide-react-native';
import { radius, useTheme } from '../theme';
import { LogoMark } from './Logo';
import { Badge, IconButton, Txt } from './ui';

const today = () =>
  new Date().toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'short' });

/**
 * Kerangka layar: header gelap (logo/kembali, tanggal + badge, judul besar, baris tab)
 * dan sheet terang membulat di bawahnya, mengikuti desain referensi.
 */
export function Screen({
  title,
  subtitle,
  badge,
  onBack,
  onMenu,
  onClose,
  toolbar,
  children,
}: {
  title: string;
  subtitle?: string;
  badge?: number;
  onBack?: () => void;
  onMenu?: () => void;
  onClose?: () => void;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  const t = useTheme();
  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={styles.header}>
        <View style={styles.topRow}>
          {onBack ? (
            <IconButton icon={ArrowLeft} variant="dark" size={38} onPress={onBack} accessibilityLabel="Kembali" />
          ) : (
            <LogoMark size={32} />
          )}
          <View style={{ flex: 1 }} />
          <Txt variant="small" dark style={{ marginRight: 8 }}>
            {today()}
          </Txt>
          {!!badge && <Badge value={badge} />}
        </View>

        <View style={styles.titleRow}>
          <View style={{ flex: 1 }}>
            <Txt variant="display" dark numberOfLines={1}>
              {title}
            </Txt>
            {subtitle && (
              <Txt variant="muted" dark numberOfLines={1} style={{ marginTop: 6 }}>
                {subtitle}
              </Txt>
            )}
          </View>
          {onMenu && <IconButton icon={Menu} variant="plain" color={t.textOnDark} size={40} onPress={onMenu} accessibilityLabel="Menu" />}
          {onClose && <IconButton icon={X} variant="plain" color={t.textOnDark} size={40} onPress={onClose} accessibilityLabel="Tutup" />}
        </View>

        {toolbar && <View style={styles.toolbar}>{toolbar}</View>}
      </View>

      <View style={[styles.sheet, { backgroundColor: t.sheet }]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 14 },
  topRow: { flexDirection: 'row', alignItems: 'center', height: 40 },
  titleRow: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  toolbar: { flexDirection: 'row', alignItems: 'center', marginTop: 18 },
  sheet: {
    flex: 1,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    overflow: 'hidden',
  },
});

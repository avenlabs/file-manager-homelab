import { StyleSheet, View } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Path, Rect } from 'react-native-svg';
import { radius, useTheme } from '../theme';

// Bintang empat sudut dengan sisi melengkung ke dalam.
const STAR = 'M50 0 C54 34 66 46 100 50 C66 54 54 66 50 100 C46 66 34 54 0 50 C34 46 46 34 50 0 Z';

/** Logo: bintang di dalam belah ketupat membulat. */
export function LogoMark({ size = 30, color, starColor }: { size?: number; color?: string; starColor?: string }) {
  const t = useTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Rect x={15} y={15} width={70} height={70} rx={18} transform="rotate(45 50 50)" fill={color ?? t.textOnDark} />
      <G transform="translate(25 25) scale(0.5)">
        <Path d={STAR} fill={starColor ?? t.bg} />
      </G>
    </Svg>
  );
}

/** Kartu hero gelap dengan pola busur konsentris dan bintang oranye (layar login). */
export function HeroArt({ height = 170 }: { height?: number }) {
  const t = useTheme();
  const rings = [18, 30, 42, 54, 66, 78];
  const corners: [number, number][] = [
    [0, 0],
    [200, 0],
    [0, 120],
    [200, 120],
  ];
  return (
    <View style={[styles.hero, { height, backgroundColor: t.bg }]}>
      <Svg width="100%" height="100%" viewBox="0 0 200 120" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <ClipPath id="heroClip">
            <Rect width={200} height={120} />
          </ClipPath>
        </Defs>
        <G clipPath="url(#heroClip)">
          {corners.map(([cx, cy]) =>
            rings.map((r) => (
              <Circle key={`${cx}-${cy}-${r}`} cx={cx} cy={cy} r={r} fill="none" stroke={t.lineDark} strokeWidth={0.8} />
            )),
          )}
          <G transform="translate(70 30) scale(0.6)">
            <Path d={STAR} fill={t.primary} />
          </G>
          <G transform="translate(88 48) scale(0.24)">
            <Path d={STAR} fill={t.card} />
          </G>
        </G>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { borderRadius: radius.xl, overflow: 'hidden' },
});

import { StyleSheet, View } from 'react-native';
import Svg, { Defs, Path, Pattern, RadialGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../theme';

/** Latar grid halus yang memudar ke tepi + cahaya gradient lembut di atas. */
export default function GridBackdrop({ cell = 28 }: { cell?: number }) {
  const t = useTheme();
  return (
    // Dibungkus View pointerEvents="none" agar latar tidak pernah menangkap sentuhan.
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
    <Svg style={StyleSheet.absoluteFill}>
      <Defs>
        <Pattern id="grid" width={cell} height={cell} patternUnits="userSpaceOnUse">
          <Path d={`M ${cell} 0 L 0 0 0 ${cell}`} fill="none" stroke={t.grid} strokeWidth={1} />
        </Pattern>
        <RadialGradient id="fade" cx="50%" cy="30%" r="75%">
          <Stop offset="0" stopColor={t.bg} stopOpacity={0} />
          <Stop offset="1" stopColor={t.bg} stopOpacity={1} />
        </RadialGradient>
        <RadialGradient id="glow" cx="50%" cy="0%" r="60%">
          <Stop offset="0" stopColor={t.gradient[1]} stopOpacity={t.dark ? 0.22 : 0.14} />
          <Stop offset="0.5" stopColor={t.gradient[0]} stopOpacity={t.dark ? 0.06 : 0.04} />
          <Stop offset="1" stopColor={t.bg} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      <Rect width="100%" height="100%" fill="url(#grid)" />
      <Rect width="100%" height="100%" fill="url(#fade)" />
      <Rect width="100%" height="60%" fill="url(#glow)" />
    </Svg>
    </View>
  );
}

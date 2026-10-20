import { useRef, useState, type ComponentType, type ReactNode, type Ref } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputInstance,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native';
import Svg, { Defs, Line, Pattern, Rect } from 'react-native-svg';
import type { LucideProps } from 'lucide-react-native';
import { font, radius, useTheme } from '../theme';

export type Icon = ComponentType<LucideProps>;

type TxtVariant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'muted' | 'caption' | 'small';

/** Teks dengan varian tipografi. `dark` = teks di atas permukaan gelap. */
export function Txt({
  variant = 'body',
  dark,
  style,
  ...rest
}: TextProps & { variant?: TxtVariant; dark?: boolean }) {
  const t = useTheme();
  const ink = dark ? t.textOnDark : t.text;
  const muted = dark ? t.mutedOnDark : t.mutedText;
  const v = {
    display: { fontFamily: font.bold, fontSize: 34, letterSpacing: -1, lineHeight: 40, color: ink },
    title: { fontFamily: font.bold, fontSize: 24, letterSpacing: -0.6, color: ink },
    heading: { fontFamily: font.bold, fontSize: 17, letterSpacing: -0.3, color: ink },
    body: { fontFamily: font.semibold, fontSize: 15, letterSpacing: -0.1, color: ink },
    label: { fontFamily: font.semibold, fontSize: 13, color: ink },
    muted: { fontFamily: font.medium, fontSize: 14, color: muted },
    small: { fontFamily: font.medium, fontSize: 12, color: muted },
    caption: {
      fontFamily: font.bold,
      fontSize: 10.5,
      letterSpacing: 0.8,
      color: muted,
      textTransform: 'uppercase' as const,
    },
  }[variant];
  return <Text {...rest} style={[v, style]} />;
}

type ButtonVariant = 'primary' | 'dark' | 'light' | 'outline' | 'danger';

export function Button({
  label,
  icon: IconCmp,
  iconRight: IconRight,
  variant = 'primary',
  loading,
  disabled,
  size = 'md',
  style,
  ...rest
}: Omit<PressableProps, 'style'> & {
  label: string;
  icon?: Icon;
  iconRight?: Icon;
  variant?: ButtonVariant;
  size?: 'sm' | 'md';
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const bg = { primary: t.primary, dark: t.bg, light: t.card, outline: 'transparent', danger: t.danger }[variant];
  const fg = { primary: t.primaryText, dark: t.textOnDark, light: t.text, outline: t.text, danger: '#fff' }[variant];
  return (
    <Pressable
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        size === 'sm' && { height: 40, paddingHorizontal: 16 },
        {
          backgroundColor: pressed && variant === 'primary' ? t.primaryPressed : bg,
          borderColor: variant === 'outline' ? t.stripe : 'transparent',
          opacity: disabled ? 0.45 : pressed && variant !== 'primary' ? 0.8 : 1,
        },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {IconCmp && <IconCmp size={size === 'sm' ? 15 : 17} color={fg} strokeWidth={2.2} />}
          <Text style={{ color: fg, fontFamily: font.bold, fontSize: size === 'sm' ? 13.5 : 15.5 }}>{label}</Text>
          {IconRight && <IconRight size={17} color={fg} strokeWidth={2.2} />}
        </>
      )}
    </Pressable>
  );
}

/**
 * Tombol ikon bulat.
 * dark = di atas header gelap, light = di atas sheet terang, primary = oranye, plain = tanpa latar.
 */
export function IconButton({
  icon: IconCmp,
  onPress,
  variant = 'light',
  size = 40,
  color,
  disabled,
  accessibilityLabel,
}: {
  icon: Icon;
  onPress?: () => void;
  variant?: 'dark' | 'light' | 'primary' | 'plain' | 'glass';
  size?: number;
  color?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const bg = { dark: t.bgRaised, light: t.card, primary: t.primary, plain: 'transparent', glass: 'rgba(54,54,47,0.88)' }[variant];
  const fg =
    color ?? { dark: t.textOnDark, light: t.text, primary: t.primaryText, plain: t.text, glass: t.textOnDark }[variant];
  return (
    <Pressable
      hitSlop={8}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => ({
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: bg,
        opacity: disabled ? 0.4 : pressed ? 0.7 : 1,
      })}
    >
      <IconCmp size={size * 0.46} color={fg} strokeWidth={2} />
    </Pressable>
  );
}

/**
 * Input teks. Seluruh kotak bisa di-tap untuk fokus (bukan hanya baris teksnya),
 * dan `ref` diteruskan ke TextInput agar layar bisa memindah fokus ke kolom berikutnya.
 */
export function Input({
  icon: IconCmp,
  style,
  ref,
  ...rest
}: TextInputProps & { icon?: Icon; ref?: Ref<TextInputInstance> }) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const inner = useRef<TextInputInstance>(null);
  const setRef = (node: TextInputInstance | null) => {
    inner.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) (ref as { current: TextInputInstance | null }).current = node;
  };
  return (
    <Pressable
      onPress={() => inner.current?.focus()}
      style={[styles.input, { borderColor: focused ? t.primary : t.line, backgroundColor: t.card }]}
    >
      {IconCmp && <IconCmp size={18} color={focused ? t.primary : t.subtleText} strokeWidth={2} />}
      <TextInput
        ref={setRef}
        placeholderTextColor={t.subtleText}
        {...rest}
        onFocus={(e) => {
          setFocused(true);
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          rest.onBlur?.(e);
        }}
        style={[
          {
            flex: 1,
            alignSelf: 'stretch',
            color: t.text,
            fontFamily: font.semibold,
            fontSize: 15,
            paddingVertical: 0,
            outlineStyle: 'none',
          } as any,
          style,
        ]}
      />
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[{ backgroundColor: t.card, borderRadius: radius.lg }, style]}>{children}</View>;
}

/** Tab pill seperti "Day / Week / Month" di desain referensi. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 4 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            hitSlop={4}
            style={{
              paddingHorizontal: 14,
              height: 36,
              borderRadius: radius.md,
              justifyContent: 'center',
              backgroundColor: active ? t.primary : 'transparent',
            }}
          >
            <Text
              style={{
                fontFamily: font.bold,
                fontSize: 14,
                color: active ? t.primaryText : t.textOnDark,
              }}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Badge angka oranye kecil (seperti notifikasi di header referensi). */
export function Badge({ value }: { value: number | string }) {
  const t = useTheme();
  return (
    <View
      style={{
        minWidth: 22,
        height: 22,
        paddingHorizontal: 6,
        borderRadius: 7,
        backgroundColor: t.primary,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: t.primaryText, fontFamily: font.bold, fontSize: 11.5 }}>{value}</Text>
    </View>
  );
}

/** Kotak ikon membulat. */
export function IconTile({
  icon: IconCmp,
  size = 46,
  bg,
  color,
}: {
  icon: Icon;
  size?: number;
  bg?: string;
  color?: string;
}) {
  const t = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.32,
        backgroundColor: bg ?? t.panel,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <IconCmp size={size * 0.44} color={color ?? t.text} strokeWidth={1.9} />
    </View>
  );
}

let hatchId = 0;

/** Pola garis diagonal (seperti slot "No Meetings" di referensi). */
export function Hatch({
  style,
  color,
  bg,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  color?: string;
  bg?: string;
  children?: ReactNode;
}) {
  const t = useTheme();
  const [id] = useState(() => `hatch${hatchId++}`);
  return (
    <View style={[{ overflow: 'hidden', borderRadius: radius.md, backgroundColor: bg ?? t.panel }, style]}>
      <Svg width="100%" height="100%" style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <Pattern id={id} width={9} height={9} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <Line x1={0} y1={0} x2={0} y2={9} stroke={color ?? t.stripe} strokeWidth={3} />
          </Pattern>
        </Defs>
        <Rect width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
      {children}
    </View>
  );
}

/** Bar tunggal sederhana (progress / magnitude). */
export function Bar({ value, color, height = 8, track }: { value: number; color?: string; height?: number; track?: string }) {
  const t = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View style={{ height, borderRadius: height, backgroundColor: track ?? t.panel, overflow: 'hidden' }}>
      <View style={{ width: `${pct * 100}%`, height: '100%', borderRadius: height, backgroundColor: color ?? t.primary }} />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 54,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 22,
  },
  input: {
    height: 54,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
  },
});

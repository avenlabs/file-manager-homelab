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
import { LinearGradient } from 'expo-linear-gradient';
import type { LucideProps } from 'lucide-react-native';
import { font, radius, useTheme } from '../theme';

export type Icon = ComponentType<LucideProps>;

type TxtVariant = 'title' | 'heading' | 'body' | 'label' | 'muted' | 'mono' | 'caption';

/** Teks dengan varian tipografi (Geist / Geist Mono). */
export function Txt({ variant = 'body', style, ...rest }: TextProps & { variant?: TxtVariant }) {
  const t = useTheme();
  const v = {
    title: { fontFamily: font.semibold, fontSize: 28, letterSpacing: -0.8, color: t.text },
    heading: { fontFamily: font.semibold, fontSize: 17, letterSpacing: -0.3, color: t.text },
    body: { fontFamily: font.medium, fontSize: 15, letterSpacing: -0.1, color: t.text },
    label: { fontFamily: font.medium, fontSize: 13, color: t.text },
    muted: { fontFamily: font.regular, fontSize: 14, color: t.mutedText },
    mono: { fontFamily: font.mono, fontSize: 12, color: t.mutedText },
    caption: { fontFamily: font.monoMedium, fontSize: 11, letterSpacing: 1, color: t.subtleText, textTransform: 'uppercase' as const },
  }[variant];
  return <Text {...rest} style={[v, style]} />;
}

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'destructive';

export function Button({
  label,
  icon: IconCmp,
  iconRight: IconRight,
  variant = 'primary',
  loading,
  disabled,
  style,
  ...rest
}: Omit<PressableProps, 'style'> & {
  label: string;
  icon?: Icon;
  iconRight?: Icon;
  variant?: ButtonVariant;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const t = useTheme();
  const bg = { primary: t.primary, outline: 'transparent', ghost: 'transparent', destructive: t.danger }[variant];
  const fg = { primary: t.primaryText, outline: t.text, ghost: t.text, destructive: '#fff' }[variant];
  return (
    <Pressable
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: bg,
          borderColor: variant === 'outline' ? t.border : 'transparent',
          opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
        },
        style,
      ]}
      {...rest}
    >
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <>
          {IconCmp && <IconCmp size={16} color={fg} strokeWidth={2} />}
          <Text style={{ color: fg, fontFamily: font.medium, fontSize: 15 }}>{label}</Text>
          {IconRight && <IconRight size={16} color={fg} strokeWidth={2} />}
        </>
      )}
    </Pressable>
  );
}

export function IconButton({
  icon: IconCmp,
  onPress,
  variant = 'outline',
  size = 36,
  color,
  disabled,
}: {
  icon: Icon;
  onPress?: () => void;
  variant?: 'outline' | 'ghost' | 'glass';
  size?: number;
  color?: string;
  disabled?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      hitSlop={8}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        {
          width: size,
          height: size,
          borderRadius: variant === 'glass' ? size / 2 : radius.md,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: variant === 'outline' ? StyleSheet.hairlineWidth * 2 : 0,
          borderColor: t.border,
          backgroundColor: variant === 'glass' ? 'rgba(24,24,27,0.7)' : pressed ? t.muted : 'transparent',
          opacity: pressed ? 0.8 : 1,
        },
      ]}
    >
      <IconCmp size={size * 0.47} color={color ?? (variant === 'glass' ? '#fafafa' : t.text)} strokeWidth={1.75} />
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
      style={[
        styles.input,
        { borderColor: focused ? t.ring : t.border, backgroundColor: t.dark ? t.muted + '80' : t.bg },
        focused && { shadowColor: t.gradient[1], shadowOpacity: 0.35, shadowRadius: 8, shadowOffset: { width: 0, height: 0 } },
      ]}
    >
      {IconCmp && <IconCmp size={16} color={t.subtleText} strokeWidth={1.75} />}
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
            fontFamily: font.regular,
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
  return (
    <View style={[{ backgroundColor: t.card, borderColor: t.border, borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: radius.lg }, style]}>
      {children}
    </View>
  );
}

/** Progress bar tipis dengan gradient aksen. */
export function GradientBar({ value, height = 4 }: { value: number; height?: number }) {
  const t = useTheme();
  const pct = Math.max(0, Math.min(1, value));
  return (
    <View style={{ height, borderRadius: height, backgroundColor: t.muted, overflow: 'hidden' }}>
      <LinearGradient
        colors={t.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={{ width: `${pct * 100}%`, height: '100%', borderRadius: height }}
      />
    </View>
  );
}

/** Kotak ikon kecil berborder, gaya "outline" shadcn. */
export function IconTile({ icon: IconCmp, size = 40, color }: { icon: Icon; size?: number; color?: string }) {
  const t = useTheme();
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: radius.md + 2,
        backgroundColor: t.muted,
        borderColor: t.border,
        borderWidth: StyleSheet.hairlineWidth * 2,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <IconCmp size={size * 0.45} color={color ?? t.text} strokeWidth={1.6} />
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    height: 46,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 18,
  },
  input: {
    height: 46,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth * 2,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
  },
});

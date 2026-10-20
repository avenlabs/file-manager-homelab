import { useColorScheme } from 'react-native';

// Token warna mengikuti palet "zinc" shadcn/ui, plus gradient aksen untuk sentuhan futuristik.
const dark = {
  dark: true,
  bg: '#09090b',
  card: '#0f0f12',
  muted: '#18181b',
  border: '#27272a',
  text: '#fafafa',
  mutedText: '#a1a1aa',
  subtleText: '#71717a',
  primary: '#fafafa',
  primaryText: '#09090b',
  danger: '#f87171',
  ring: '#52525b',
  gradient: ['#22d3ee', '#818cf8', '#c084fc'] as readonly [string, string, string],
  overlay: 'rgba(0,0,0,0.6)',
  grid: 'rgba(255,255,255,0.06)',
};

const light: typeof dark = {
  dark: false,
  bg: '#ffffff',
  card: '#ffffff',
  muted: '#f4f4f5',
  border: '#e4e4e7',
  text: '#09090b',
  mutedText: '#71717a',
  subtleText: '#a1a1aa',
  primary: '#18181b',
  primaryText: '#fafafa',
  danger: '#dc2626',
  ring: '#a1a1aa',
  gradient: ['#06b6d4', '#6366f1', '#a855f7'],
  overlay: 'rgba(9,9,11,0.35)',
  grid: 'rgba(9,9,11,0.05)',
};

export const font = {
  regular: 'Geist_400Regular',
  medium: 'Geist_500Medium',
  semibold: 'Geist_600SemiBold',
  bold: 'Geist_700Bold',
  mono: 'GeistMono_400Regular',
  monoMedium: 'GeistMono_500Medium',
};

export const radius = { sm: 6, md: 8, lg: 12, xl: 16, full: 999 };

export function useTheme() {
  return useColorScheme() === 'light' ? light : dark;
}

export type Theme = ReturnType<typeof useTheme>;

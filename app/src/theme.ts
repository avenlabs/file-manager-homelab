// Design token: palet hangat dua-nada (charcoal + sage/cream) dengan aksen oranye,
// sudut sangat membulat. Desainnya memang dua-nada (header gelap + sheet terang),
// jadi tidak ada mode gelap/terang terpisah.
const palette = {
  // permukaan gelap
  bg: '#2b2b27',
  bgRaised: '#36362f',
  lineDark: '#45453d',
  textOnDark: '#f3f1e3',
  mutedOnDark: '#a9a899',

  // permukaan terang
  sheet: '#d9dbc1',
  panel: '#e5e6d0',
  card: '#fbf9e8',
  stripe: '#c8caad',
  line: '#d2d3b9',
  text: '#23231f',
  mutedText: '#6f705f',
  subtleText: '#9c9d89',

  // aksen
  primary: '#e8682f',
  primaryPressed: '#cf5823',
  primaryText: '#fffaf0',
  primarySoft: '#f6c9a9',
  danger: '#d8453b',
  success: '#3e8f5c',
  overlay: 'rgba(28,28,24,0.55)',
};

export const flagColors = {
  red: '#d8453b',
  orange: '#e8682f',
  yellow: '#e2a521',
  green: '#3e8f5c',
  blue: '#3b74c9',
  purple: '#7a55c7',
  gray: '#8a8b7b',
} as const;

export type FlagColor = keyof typeof flagColors;

export const flagLabels: Record<FlagColor, string> = {
  red: 'Merah',
  orange: 'Oranye',
  yellow: 'Kuning',
  green: 'Hijau',
  blue: 'Biru',
  purple: 'Ungu',
  gray: 'Abu',
};

export const font = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
};

export const radius = { sm: 10, md: 14, lg: 20, xl: 28, sheet: 34, full: 999 };

export function useTheme() {
  return palette;
}

export type Theme = typeof palette;

import { useColorScheme } from 'react-native';

export function useTheme() {
  const dark = useColorScheme() === 'dark';
  return {
    dark,
    bg: dark ? '#0f1115' : '#f5f6f8',
    card: dark ? '#1a1d23' : '#ffffff',
    text: dark ? '#e8eaed' : '#14171c',
    muted: dark ? '#8b919c' : '#69707d',
    border: dark ? '#2a2e36' : '#e3e5e9',
    accent: '#2f7cf6',
    danger: '#e5484d',
  };
}

export type Theme = ReturnType<typeof useTheme>;

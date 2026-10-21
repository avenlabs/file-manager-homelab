import { View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Server, Smartphone } from 'lucide-react-native';
import type { ProviderKind } from '../providers/types';
import { useTheme } from '../theme';

export type SourceKind = ProviderKind | 'mega';

/** Ikon sederhana per jenis sumber (bukan logo resmi). */
export function SourceIcon({ kind, size = 52 }: { kind: SourceKind; size?: number }) {
  const t = useTheme();
  const bg = { device: t.bgRaised, casaos: t.primary, gdrive: '#e8f0fe', dropbox: '#e3edfc', mega: '#fbe3e1' }[kind];
  const g = size * 0.5;
  return (
    <View
      style={{ width: size, height: size, borderRadius: size * 0.32, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}
    >
      {kind === 'device' && <Smartphone size={g} color={t.textOnDark} strokeWidth={1.9} />}
      {kind === 'casaos' && <Server size={g} color={t.primaryText} strokeWidth={1.9} />}
      {kind === 'gdrive' && (
        <Svg width={g} height={g} viewBox="0 0 24 24">
          <Path d="M8.2 3h7.6l7 12-3.8 6.5L12 9.5z" fill="#f4b400" />
          <Path d="M8.2 3 1.2 15 5 21.5 12 9.5z" fill="#0f9d58" />
          <Path d="M5 21.5h14l3.8-6.5H8.8z" fill="#4285f4" />
        </Svg>
      )}
      {kind === 'dropbox' && (
        <Svg width={g} height={g} viewBox="0 0 24 24">
          <Path
            d="M6 2 0 6l6 4-6 4 6 4 6-4 6 4 6-4-6-4 6-4-6-4-6 4zm0 16.3 6 4 6-4-6-4z"
            fill="#0061fe"
          />
        </Svg>
      )}
      {kind === 'mega' && (
        <Svg width={g} height={g} viewBox="0 0 24 24">
          <Path d="M12 1a11 11 0 1 0 0 22 11 11 0 0 0 0-22zm5.5 15.5h-2v-6l-3.3 3.3h-.4L8.5 10.5v6h-2v-9h1.6L12 11.4l3.9-3.9h1.6z" fill="#d9272e" />
        </Svg>
      )}
    </View>
  );
}

export const sourceKindLabel: Record<SourceKind, string> = {
  device: 'HP ini',
  casaos: 'Server CasaOS',
  gdrive: 'Google Drive',
  dropbox: 'Dropbox',
  mega: 'MEGA',
};

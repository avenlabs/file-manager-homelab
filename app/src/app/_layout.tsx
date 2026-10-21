import { ActivityIndicator, View } from 'react-native';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { SourcesProvider, useSources } from '../sources';
import { UploadsProvider } from '../uploads';
import { useTheme } from '../theme';

function RootStack() {
  const t = useTheme();
  const { ready } = useSources();
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  if (!ready || !fontsLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: t.bg }}>
        <ActivityIndicator color={t.mutedOnDark} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="source/[id]" />
        <Stack.Screen name="connect/casaos" />
        <Stack.Screen name="analytics/[id]" />
        <Stack.Screen name="settings" options={{ animation: 'slide_from_bottom' }} />
      </Stack>
    </>
  );
}

export default function RootLayout() {
  return (
    <SourcesProvider>
      <UploadsProvider>
        <RootStack />
      </UploadsProvider>
    </SourcesProvider>
  );
}

import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme';

export type SheetAction = { label: string; onPress: () => void; destructive?: boolean };

/** Bottom sheet daftar aksi (Alert Android hanya mendukung 3 tombol). */
export function ActionSheet({
  title,
  actions,
  onClose,
}: {
  title?: string;
  actions: SheetAction[] | null;
  onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!actions} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: t.card, paddingBottom: insets.bottom + 8 }]}>
        {title && (
          <Text style={[styles.title, { color: t.muted }]} numberOfLines={1}>
            {title}
          </Text>
        )}
        {actions?.map((a) => (
          <Pressable
            key={a.label}
            style={[styles.row, { borderTopColor: t.border }]}
            onPress={() => {
              onClose();
              a.onPress();
            }}
          >
            <Text style={{ fontSize: 17, color: a.destructive ? t.danger : t.text }}>{a.label}</Text>
          </Pressable>
        ))}
        <Pressable style={[styles.row, { borderTopColor: t.border }]} onPress={onClose}>
          <Text style={{ fontSize: 17, color: t.muted }}>Batal</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

/** Pengganti Alert.prompt (yang hanya ada di iOS). */
export function PromptSheet({
  visible,
  title,
  initial,
  confirmLabel,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  title: string;
  initial?: string;
  confirmLabel: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const [value, setValue] = useState(initial ?? '');
  useEffect(() => {
    if (visible) setValue(initial ?? '');
  }, [visible, initial]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.center}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.dialog, { backgroundColor: t.card }]}>
          <Text style={{ fontSize: 17, fontWeight: '600', color: t.text, marginBottom: 12 }}>{title}</Text>
          <TextInput
            autoFocus
            value={value}
            onChangeText={setValue}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.input, { color: t.text, borderColor: t.border }]}
            onSubmitEditing={() => value.trim() && onSubmit(value.trim())}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 20, marginTop: 16 }}>
            <Pressable onPress={onClose}>
              <Text style={{ color: t.muted, fontSize: 16 }}>Batal</Text>
            </Pressable>
            <Pressable disabled={!value.trim()} onPress={() => onSubmit(value.trim())}>
              <Text style={{ color: t.accent, fontSize: 16, fontWeight: '600' }}>{confirmLabel}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingTop: 8 },
  title: { textAlign: 'center', paddingVertical: 10, fontSize: 13, paddingHorizontal: 16 },
  row: { paddingVertical: 16, alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth },
  center: { flex: 1, justifyContent: 'center', padding: 24, backgroundColor: 'rgba(0,0,0,0.4)' },
  dialog: { borderRadius: 14, padding: 20 },
  input: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16 },
});

import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, useTheme } from '../theme';
import { Button, IconTile, Input, Txt, type Icon } from './ui';

export type SheetAction = {
  label: string;
  description?: string;
  icon?: Icon;
  onPress: () => void;
  destructive?: boolean;
};

/** Drawer bawah berisi daftar aksi (Alert Android hanya mendukung 3 tombol). */
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
      <Pressable style={[styles.backdrop, { backgroundColor: t.overlay }]} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: t.card, borderColor: t.border, paddingBottom: insets.bottom + 12 }]}>
        <View style={[styles.handle, { backgroundColor: t.border }]} />
        {title && (
          <Txt variant="mono" numberOfLines={1} style={{ paddingHorizontal: 20, paddingBottom: 8 }}>
            {title}
          </Txt>
        )}
        {actions?.map((a) => (
          <Pressable
            key={a.label}
            style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.muted }]}
            onPress={() => {
              onClose();
              a.onPress();
            }}
          >
            {a.icon && <IconTile icon={a.icon} size={38} color={a.destructive ? t.danger : t.text} />}
            <View style={{ flex: 1 }}>
              <Txt variant="body" style={a.destructive && { color: t.danger }}>
                {a.label}
              </Txt>
              {a.description && (
                <Txt variant="muted" style={{ fontSize: 13, marginTop: 1 }}>
                  {a.description}
                </Txt>
              )}
            </View>
          </Pressable>
        ))}
        <Button label="Batal" variant="outline" onPress={onClose} style={{ marginHorizontal: 16, marginTop: 8 }} />
      </View>
    </Modal>
  );
}

/** Dialog input teks (pengganti Alert.prompt yang hanya ada di iOS). */
export function PromptSheet({
  visible,
  title,
  description,
  initial,
  confirmLabel,
  onSubmit,
  onClose,
}: {
  visible: boolean;
  title: string;
  description?: string;
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
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={[styles.center, { backgroundColor: t.overlay }]}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={[styles.dialog, { backgroundColor: t.card, borderColor: t.border }]}>
          <Txt variant="heading">{title}</Txt>
          {description && <Txt variant="muted" style={{ marginTop: 4 }}>{description}</Txt>}
          <View style={{ marginTop: 16 }}>
            <Input
              autoFocus
              value={value}
              onChangeText={setValue}
              autoCapitalize="none"
              autoCorrect={false}
              onSubmitEditing={() => value.trim() && onSubmit(value.trim())}
            />
          </View>
          <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
            <Button label="Batal" variant="outline" onPress={onClose} style={{ flex: 1 }} />
            <Button
              label={confirmLabel}
              disabled={!value.trim()}
              onPress={() => onSubmit(value.trim())}
              style={{ flex: 1 }}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: {
    borderTopLeftRadius: radius.xl + 4,
    borderTopRightRadius: radius.xl + 4,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderBottomWidth: 0,
    paddingTop: 10,
  },
  handle: { width: 40, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10, marginHorizontal: 4, borderRadius: radius.lg },
  center: { flex: 1, justifyContent: 'center', padding: 20 },
  dialog: { borderRadius: radius.xl, padding: 20, borderWidth: StyleSheet.hairlineWidth * 2 },
});

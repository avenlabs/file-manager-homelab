import { useRef, useState, type ReactNode, type Ref } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, View, type TextInputInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, FlagOff } from 'lucide-react-native';
import { flagColors, flagLabels, radius, useTheme, type FlagColor } from '../theme';
import { Button, IconTile, Input, Txt, type Icon } from './ui';

export type SheetAction = {
  label: string;
  description?: string;
  icon?: Icon;
  onPress: () => void;
  destructive?: boolean;
};

export function BottomSheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={[styles.backdrop, { backgroundColor: t.overlay }]} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: t.card, paddingBottom: insets.bottom + 16 }]}>
        <View style={[styles.handle, { backgroundColor: t.stripe }]} />
        {children}
      </View>
    </Modal>
  );
}

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
  return (
    <BottomSheet visible={!!actions} onClose={onClose}>
      {title && (
        <Txt variant="caption" numberOfLines={1} style={{ paddingHorizontal: 24, paddingBottom: 10 }}>
          {title}
        </Txt>
      )}
      {actions?.map((a) => (
        <Pressable
          key={a.label}
          style={({ pressed }) => [styles.row, pressed && { backgroundColor: t.panel }]}
          onPress={() => {
            onClose();
            a.onPress();
          }}
        >
          {a.icon && (
            <IconTile
              icon={a.icon}
              size={44}
              bg={a.destructive ? '#f7d9d4' : t.panel}
              color={a.destructive ? t.danger : t.text}
            />
          )}
          <View style={{ flex: 1 }}>
            <Txt variant="body" style={a.destructive && { color: t.danger }}>
              {a.label}
            </Txt>
            {a.description && (
              <Txt variant="small" style={{ marginTop: 2 }}>
                {a.description}
              </Txt>
            )}
          </View>
        </Pressable>
      ))}
      <Button label="Batal" variant="outline" onPress={onClose} style={{ marginHorizontal: 20, marginTop: 10 }} />
    </BottomSheet>
  );
}

/** Pilih warna flag untuk item yang dipilih. */
export function FlagSheet({
  visible,
  count,
  current,
  onPick,
  onClose,
}: {
  visible: boolean;
  count: number;
  current?: FlagColor | null;
  onPick: (color: FlagColor | null) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: 24 }}>
        <Txt variant="title">Beri flag</Txt>
        <Txt variant="muted" style={{ marginTop: 4 }}>
          {count} item dipilih
        </Txt>
        <View style={styles.colors}>
          {(Object.keys(flagColors) as FlagColor[]).map((c) => (
            <Pressable
              key={c}
              onPress={() => onPick(c)}
              style={{ alignItems: 'center', gap: 6, width: 42 }}
              accessibilityLabel={`Flag ${flagLabels[c]}`}
            >
              <View style={[styles.swatch, { backgroundColor: flagColors[c] }]}>
                {current === c && <Check size={22} color="#fff" strokeWidth={3} />}
              </View>
              <Txt variant="small">{flagLabels[c]}</Txt>
            </Pressable>
          ))}
        </View>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 8 }}>
          <Button label="Hapus flag" icon={FlagOff} variant="outline" onPress={() => onPick(null)} style={{ flex: 1 }} />
          <Button label="Batal" variant="light" onPress={onClose} style={{ flex: 1, backgroundColor: t.panel }} />
        </View>
      </View>
    </BottomSheet>
  );
}

/** Dialog konfirmasi (dipakai untuk hapus; Alert bawaan tidak tampil di web). */
export function ConfirmSheet({
  visible,
  title,
  message,
  confirmLabel,
  destructive,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <BottomSheet visible={visible} onClose={onClose}>
      <View style={{ paddingHorizontal: 24 }}>
        <Txt variant="title">{title}</Txt>
        {message && (
          <Txt variant="muted" style={{ marginTop: 6, lineHeight: 20 }}>
            {message}
          </Txt>
        )}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 22 }}>
          <Button label="Batal" variant="outline" onPress={onClose} style={{ flex: 1 }} />
          <Button
            label={confirmLabel}
            variant={destructive ? 'danger' : 'primary'}
            onPress={() => {
              onClose();
              onConfirm();
            }}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    </BottomSheet>
  );
}

/** Dialog input teks (pengganti Alert.prompt yang hanya ada di iOS). */
export function PromptSheet(props: {
  visible: boolean;
  title: string;
  description?: string;
  initial?: string;
  confirmLabel: string;
  icon?: Icon;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const t = useTheme();
  const inputRef = useRef<TextInputInstance>(null);
  // autoFocus di dalam Modal tidak selalu jalan (Android/web); fokuskan setelah modal tampil.
  const focusInput = () => {
    setTimeout(() => inputRef.current?.focus(), 80);
  };

  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onClose} onShow={focusInput}>
      <KeyboardAvoidingView behavior="padding" style={[styles.center, { backgroundColor: t.overlay }]}>
        <Pressable style={StyleSheet.absoluteFill} onPress={props.onClose} />
        {/* Di-mount ulang setiap dibuka sehingga nilai awal selalu dari `initial`. */}
        {props.visible && <PromptForm {...props} inputRef={inputRef} />}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PromptForm({
  title,
  description,
  initial,
  confirmLabel,
  icon,
  onSubmit,
  onClose,
  inputRef,
}: {
  title: string;
  description?: string;
  initial?: string;
  confirmLabel: string;
  icon?: Icon;
  onSubmit: (value: string) => void;
  onClose: () => void;
  inputRef: Ref<TextInputInstance>;
}) {
  const t = useTheme();
  const [value, setValue] = useState(initial ?? '');
  return (
    <View style={[styles.dialog, { backgroundColor: t.card }]}>
      <Txt variant="title">{title}</Txt>
      {description && (
        <Txt variant="muted" style={{ marginTop: 4 }}>
          {description}
        </Txt>
      )}
      <View style={{ marginTop: 18 }}>
        <Input
          ref={inputRef}
          icon={icon}
          autoFocus
          value={value}
          onChangeText={setValue}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={() => value.trim() && onSubmit(value.trim())}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: 10, marginTop: 18 }}>
        <Button label="Batal" variant="outline" onPress={onClose} style={{ flex: 1 }} />
        <Button label={confirmLabel} disabled={!value.trim()} onPress={() => onSubmit(value.trim())} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1 },
  sheet: { borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, paddingTop: 12 },
  handle: { width: 44, height: 5, borderRadius: 3, alignSelf: 'center', marginBottom: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginHorizontal: 8,
    borderRadius: radius.lg,
  },
  colors: { flexDirection: 'row', marginTop: 20, marginBottom: 14, justifyContent: 'space-between' },
  swatch: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, justifyContent: 'center', padding: 20 },
  dialog: { borderRadius: radius.xl, padding: 22 },
});

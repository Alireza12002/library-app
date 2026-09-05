/**
 * SettingsSheet — reader settings bottom sheet.
 *
 * Pure presentational component; all state and callbacks provided by parent.
 *
 * The body is a ScrollView: the sheet is capped at 80% of the screen and its
 * content (mode + theme + fit mode + optional appearance/gap sections) is taller
 * than that on small phones, so a plain View clipped the last rows with no way
 * to reach them. Bounding the sheet and scrolling inside it is the fix — raising
 * the cap would just push the overflow off a different screen size.
 */
import { memo } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Divider, Icon, IconButton, Section, Text } from '@/components/ui';
import { useTheme } from '@/theme';
import type { ReadingSettings, FitMode } from '@/core/entities/readingSettings';
import type { PdfEngineCapabilities } from '@/core/ports/pdfEngine';

export interface SettingsSheetProps {
  settings: ReadingSettings;
  capabilities: PdfEngineCapabilities;
  /**
   * Bottom safe-area inset, in points. The sheet is absolutely positioned at
   * bottom: 0 over a full-screen route, so its last row would otherwise sit
   * under the system navigation area. Device-measured, never hardcoded.
   */
  bottomInset?: number;
  onUpdate: (patch: Partial<ReadingSettings>) => void;
  onClose: () => void;
  onReset: () => void;
}

const LAYOUT_OPTIONS = [
  { value: 'pdf', label: 'PDF Layout', description: 'Original document layout' },
  { value: 'reflow', label: 'Reflow Text', description: 'Continuous, reflowable text' },
] as const;

const THEME_OPTIONS = [
  { value: 'light', label: 'Light', description: 'White background' },
  { value: 'sepia', label: 'Sepia', description: 'Warm paper tone' },
  { value: 'dark', label: 'Dark', description: 'Dark background' },
] as const;

const FIT_MODE_OPTIONS = [
  { value: 'width', label: 'Fit Width', description: 'Page fits screen width' },
  { value: 'height', label: 'Fit Height', description: 'Page fits screen height' },
  { value: 'both', label: 'Fit Both', description: 'Page fits both dimensions' },
] as const;

export const SettingsSheet = memo(function SettingsSheet({
  settings,
  capabilities,
  bottomInset = 0,
  onUpdate,
  onClose,
  onReset,
}: SettingsSheetProps) {
  const { colors, spacing } = useTheme();

  const fitModeOptions = FIT_MODE_OPTIONS.filter((opt) =>
    capabilities.fitModes.includes(opt.value as FitMode),
  );

  const canInvertPages = capabilities.invertPages;
  const canPageGap = capabilities.pageGap;

  return (
    <View style={[styles.sheet, { backgroundColor: colors.surface }]}>
      <View style={styles.sheetHeader}>
        <Text variant="label">Reader Settings</Text>
        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Reset to defaults"
            onPress={onReset}
            hitSlop={8}
          >
            <Text variant="caption" tone="accent">
              Reset
            </Text>
          </Pressable>
          <IconButton
            name="close"
            size={20}
            tone="muted"
            onPress={onClose}
            accessibilityLabel="Close settings"
          />
        </View>
      </View>

      <Divider />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          // Safe-area inset lives on the scroll CONTENT, not the container, so
          // the last row can be scrolled clear of the system nav area instead of
          // being permanently padded away from it.
          { paddingBottom: spacing.xxl + bottomInset },
        ]}
        showsVerticalScrollIndicator
        // Lets a drag that starts on a settings row still scroll the sheet.
        keyboardShouldPersistTaps="handled"
        // Dismisses the keyboard on drag if a future revision adds a text input.
        keyboardDismissMode="on-drag"
      >
        {/* Reading Mode */}
        <Section title="Reading Mode" description="Switch between original pages and reflowed text">
          {LAYOUT_OPTIONS.map((opt) => (
            <SettingRow
              key={opt.value}
              label={opt.label}
              description={opt.description}
              selected={settings.mode === opt.value}
              onPress={() => onUpdate({ mode: opt.value as ReadingSettings['mode'] })}
            />
          ))}
        </Section>

        <Divider style={{ marginVertical: spacing.md }} />

        {/* Theme */}
        <Section title="Theme">
          {THEME_OPTIONS.map((opt) => (
            <SettingRow
              key={opt.value}
              label={opt.label}
              description={opt.description}
              selected={settings.theme === opt.value}
              onPress={() => onUpdate({ theme: opt.value as ReadingSettings['theme'] })}
            />
          ))}
        </Section>

        <Divider style={{ marginVertical: spacing.md }} />

        {/* PDF-specific settings (only when in PDF mode) */}
        {settings.mode === 'pdf' && (
          <>
            {/* Fit Mode */}
            <Section
              title="Fit Mode"
              description={
                fitModeOptions.length > 0
                  ? 'Select how pages fit the screen'
                  : 'No fit modes available'
              }
            >
              {fitModeOptions.map((opt) => (
                <SettingRow
                  key={opt.value}
                  label={opt.label}
                  description={opt.description}
                  selected={settings.fitMode === opt.value}
                  onPress={() => onUpdate({ fitMode: opt.value as FitMode })}
                />
              ))}
            </Section>

            {canInvertPages && (
              <>
                <Divider style={{ marginVertical: spacing.md }} />
                <Section title="Page Appearance">
                  <SettingRow
                    label="Invert Pages"
                    description="Dark mode for PDF content"
                    selected={settings.invertPages}
                    type="toggle"
                    value={settings.invertPages}
                    onToggle={(value) => onUpdate({ invertPages: value })}
                  />
                </Section>
              </>
            )}

            {canPageGap && (
              <>
                <Divider style={{ marginVertical: spacing.md }} />
                <Section title="Page Gap" description="Adjust spacing between pages">
                  <SettingRow
                    label="Page Gap"
                    description={settings.pageGap === 0 ? 'Default' : `${settings.pageGap}pt`}
                    selected={false}
                    type="slider"
                    value={settings.pageGap}
                    min={0}
                    max={20}
                    step={1}
                  />
                </Section>
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
});

interface SettingRowProps {
  label: string;
  description: string;
  selected: boolean;
  onPress?: () => void;
  disabled?: boolean;
  type?: 'radio' | 'toggle' | 'slider';
  value?: boolean | number;
  min?: number;
  max?: number;
  step?: number;
  onToggle?: (value: boolean) => void;
  onChange?: (value: number) => void;
}

function SettingRow({
  label,
  description,
  selected,
  onPress,
  disabled,
  type = 'radio',
  value,
  min,
  max,
  onToggle,
}: SettingRowProps) {
  const { colors } = useTheme();

  if (type === 'toggle') {
    return (
      <Pressable
        accessibilityRole="switch"
        accessibilityState={{ checked: !!value }}
        accessibilityLabel={label}
        onPress={() => onToggle?.(!value)}
        disabled={disabled}
        style={({ pressed }) => [
          styles.settingRow,
          { backgroundColor: pressed ? colors.surfaceMuted : colors.surface },
        ]}
        hitSlop={12}
      >
        <View style={styles.settingInfo}>
          <Text variant="body" tone={disabled ? 'muted' : 'default'}>
            {label}
          </Text>
          <Text variant="caption" tone="muted">
            {description}
          </Text>
        </View>
        <View style={styles.toggleContainer}>
          <View
            style={[styles.toggleTrack, { backgroundColor: value ? colors.accent : colors.border }]}
          >
            <View style={[styles.toggleThumb, { transform: [{ translateX: value ? 20 : 0 }] }]} />
          </View>
        </View>
      </Pressable>
    );
  }

  if (type === 'slider') {
    const numValue = typeof value === 'number' ? value : 0;
    const numMin = min ?? 0;
    const numMax = max ?? 100;
    const percentage = numMax > numMin ? (numValue - numMin) / (numMax - numMin) : 0;

    return (
      <View style={styles.settingRow}>
        <View style={styles.settingInfo}>
          <Text variant="body" tone={disabled ? 'muted' : 'default'}>
            {label}
          </Text>
          <Text variant="caption" tone="muted">
            {description}
          </Text>
        </View>
        <View style={styles.sliderContainer}>
          <View style={styles.sliderTrack}>
            <View style={[styles.sliderThumb, { left: `${percentage * 100}%` }]} />
          </View>
        </View>
      </View>
    );
  }

  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={`${label}${selected ? ', selected' : ''}`}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.settingRow,
        { backgroundColor: pressed ? colors.surfaceMuted : colors.surface },
        selected && { borderLeftColor: colors.accent, borderLeftWidth: 3 },
      ]}
      hitSlop={12}
    >
      <View style={styles.settingInfo}>
        <Text variant="body" tone={disabled ? 'muted' : selected ? 'accent' : 'default'}>
          {label}
        </Text>
        <Text variant="caption" tone="muted">
          {description}
        </Text>
      </View>
      {selected && <Icon name="checkmark" size={20} tone="accent" />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    // Bounds the sheet; the ScrollView inside handles any overflow.
    maxHeight: '80%',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    elevation: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  scroll: {
    // flexShrink lets the scroll view take only the space the sheet's maxHeight
    // leaves after the header, instead of a percentage guess.
    flexShrink: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
    // Keeps rows tappable at accessibility minimum on every text scale.
    minHeight: 44,
  },
  settingInfo: {
    flex: 1,
    gap: 2,
  },
  toggleContainer: {
    width: 44,
    height: 24,
    justifyContent: 'center',
  },
  toggleTrack: {
    width: '100%',
    height: '100%',
    borderRadius: 12,
  },
  toggleThumb: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
  sliderContainer: {
    width: 120,
    height: 32,
    justifyContent: 'center',
  },
  sliderTrack: {
    flex: 1,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(0,0,0,0.1)',
  },
  sliderThumb: {
    position: 'absolute',
    top: -8,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 2,
  },
});

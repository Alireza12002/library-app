/**
 * SettingsSheet — reader settings bottom sheet.
 * Pure presentational component; all state and callbacks provided by parent.
 */
import { Pressable, StyleSheet, View } from 'react-native';
import { Divider, Icon, IconButton, Section, Text } from '@/components/ui';
import { useTheme } from '@/theme';
import type { ReadingSettings, FitMode } from '@/core/entities/readingSettings';
import type { PdfEngineCapabilities } from '@/core/ports/pdfEngine';

export interface SettingsSheetProps {
  settings: ReadingSettings;
  capabilities: PdfEngineCapabilities;
  onUpdate: (patch: Partial<ReadingSettings>) => void;
  onClose: () => void;
  onReset: () => void;
}

export function SettingsSheet({
  settings,
  capabilities,
  onUpdate,
  onClose,
  onReset,
}: SettingsSheetProps) {
  const { colors, spacing } = useTheme();

  // Layout mode - only 'pdf' is available (reflow is Phase 8)
  const layoutOptions = [
    { value: 'pdf', label: 'PDF Layout', description: 'Original document layout' },
  ];

  // Theme options
  const themeOptions = [
    { value: 'light', label: 'Light', description: 'White background' },
    { value: 'sepia', label: 'Sepia', description: 'Warm paper tone' },
    { value: 'dark', label: 'Dark', description: 'Dark background' },
  ];

  // Fit mode options - filter by engine capabilities
  const fitModeOptions = [
    { value: 'width', label: 'Fit Width', description: 'Page fits screen width' },
    { value: 'height', label: 'Fit Height', description: 'Page fits screen height' },
    { value: 'both', label: 'Fit Both', description: 'Page fits both dimensions' },
  ].filter((opt) => capabilities.fitModes.includes(opt.value as FitMode));

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

      <View style={styles.sheetContent}>
        {/* Reading Mode */}
        <Section title="Reading Mode" description="Reflow mode coming in a future update">
          {layoutOptions.map((opt) => (
            <SettingRow
              key={opt.value}
              label={opt.label}
              description={opt.description}
              selected={settings.mode === opt.value}
              onPress={() => onUpdate({ mode: opt.value as ReadingSettings['mode'] })}
              disabled={layoutOptions.length === 1}
            />
          ))}
        </Section>

        <Divider style={{ marginVertical: spacing.md }} />

        {/* Theme */}
        <Section title="Theme">
          {themeOptions.map((opt) => (
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

            <Divider style={{ marginVertical: spacing.md }} />

            {/* Invert Pages */}
            {canInvertPages && (
              <>
                <Section title="Page Appearance">
                  <SettingRow
                    label="Invert Pages"
                    description="Dark mode for PDF content"
                    selected={settings.invertPages}
                    onPress={() => onUpdate({ invertPages: !settings.invertPages })}
                    type="toggle"
                    value={settings.invertPages}
                    onToggle={(value) => onUpdate({ invertPages: value })}
                  />
                </Section>

                <Divider style={{ marginVertical: spacing.md }} />
              </>
            )}

            {/* Page Gap */}
            {canPageGap && (
              <Section title="Page Gap" description="Adjust spacing between pages">
                <SettingRow
                  label="Page Gap"
                  description={settings.pageGap === 0 ? 'Default' : `${settings.pageGap}pt`}
                  selected={false}
                  onPress={() => {}}
                  type="slider"
                  value={settings.pageGap}
                  min={0}
                  max={20}
                  step={1}
                  onChange={(value) => onUpdate({ pageGap: value })}
                />
              </Section>
            )}
          </>
        )}

        <View style={styles.bottomSpacer} />
      </View>
    </View>
  );
}

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
  step,
  onToggle,
  onChange,
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
  sheetContent: {
    maxHeight: '70%',
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 4,
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
  bottomSpacer: {
    height: 32,
  },
});

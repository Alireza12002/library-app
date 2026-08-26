import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Row, Screen, Section, Text } from '@/components/ui';
import { useTheme } from '@/theme';

/**
 * Settings screen — placeholder sections only.
 *
 * Every row is static: the real controls are wired to settingsService in
 * Phase 8 (docs/ARCHITECTURE.md §10). Nothing here reads or writes state, so
 * no value shown below is a claim about stored data.
 */
export default function SettingsScreen() {
  const { spacing } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <Screen scroll>
      <View style={{ paddingTop: insets.top + spacing.xl, paddingBottom: spacing.xl }}>
        <Text variant="displayLarge">Settings</Text>
      </View>

      <View style={{ gap: spacing.xxl, paddingBottom: spacing.xxxl }}>
        <Section title="Reading" description="Page layout and navigation while reading.">
          <Row label="Reading mode" value="Not configurable yet" />
          <Row label="Page orientation" value="Not configurable yet" />
          <Row label="Fit mode" value="Not configurable yet" last />
        </Section>

        <Section title="Appearance" description="Theme and page rendering.">
          <Row label="Theme" value="Follows system" />
          <Row label="Invert page colors" value="Not configurable yet" last />
        </Section>

        <Section title="Typography" description="Applies to reflow mode once it exists.">
          <Row label="Font" value="Not configurable yet" />
          <Row label="Font size" value="Not configurable yet" />
          <Row label="Line height" value="Not configurable yet" last />
        </Section>

        <Section title="About">
          <Row label="Version" value="0.1.0" last />
        </Section>
      </View>
    </Screen>
  );
}

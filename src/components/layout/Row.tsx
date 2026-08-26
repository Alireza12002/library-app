import { StyleSheet, Text, View } from 'react-native';

import { theme } from '@/theme';

interface RowProps {
  label: string;
  /** Right-hand text: the current value, or what will live here later. */
  value?: string;
  /** Removes the divider — set on the last row of a Section. */
  last?: boolean;
}

/**
 * Static label/value row inside a Section. Non-interactive by design:
 * real controls arrive with settingsService in Phase 8 (ARCHITECTURE.md §10).
 */
export function Row({ label, value, last = false }: RowProps) {
  return (
    <View style={[styles.root, last ? null : styles.divider]}>
      <Text style={styles.label}>{label}</Text>
      {value ? <Text style={styles.value}>{value}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
  },
  divider: {
    borderBottomColor: theme.colors.border,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  label: {
    ...theme.typography.body,
    color: theme.colors.text,
    flexShrink: 1,
  },
  value: {
    ...theme.typography.body,
    color: theme.colors.textMuted,
  },
});

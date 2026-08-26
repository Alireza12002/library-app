import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '@/theme';

interface SectionProps {
  title: string;
  /** Short explanation of what the section will control. */
  description?: string;
  children?: ReactNode;
}

/**
 * Titled group of rows — the settings screen's structural unit.
 * Presentation only (ARCHITECTURE.md §1, L5).
 */
export function Section({ title, description, children }: SectionProps) {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{title}</Text>
      {description ? <Text style={styles.description}>{description}</Text> : null}
      {children ? <View style={styles.body}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: theme.spacing.xs,
  },
  title: {
    ...theme.typography.label,
    color: theme.colors.text,
  },
  description: {
    ...theme.typography.caption,
    color: theme.colors.textMuted,
  },
  body: {
    marginTop: theme.spacing.sm,
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 12,
    overflow: 'hidden',
  },
});

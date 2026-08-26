import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { theme } from '@/theme';

interface EmptyStateProps {
  title: string;
  description: string;
  /** Optional call-to-action rendered under the copy. */
  action?: ReactNode;
}

/**
 * Centered empty-state block: what is missing and what to do about it.
 * Presentation only (ARCHITECTURE.md §1, L5).
 */
export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <View style={styles.root}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  title: {
    ...theme.typography.heading,
    color: theme.colors.text,
    textAlign: 'center',
  },
  description: {
    ...theme.typography.body,
    color: theme.colors.textMuted,
    textAlign: 'center',
    maxWidth: 300,
  },
  action: {
    marginTop: theme.spacing.md,
  },
});

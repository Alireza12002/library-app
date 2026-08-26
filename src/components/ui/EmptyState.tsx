import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

import { useTheme } from '@/theme';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export interface EmptyStateProps {
  title: string;
  description: string;
  /** Shown above the copy inside an accent wash, matching the active-tab chip. */
  icon?: IconName;
  /** Optional call to action, typically a <Button />. */
  action?: ReactNode;
}

/**
 * Centred empty-state block: what is missing, and what to do about it.
 *
 * NOTE: the reference screenshot shows the populated state only, so this
 * composition (washed icon + serif heading + muted body) is extrapolated from
 * the established language. Pending design review.
 */
export function EmptyState({ title, description, icon, action }: EmptyStateProps) {
  const { colors, radius, spacing } = useTheme();

  return (
    <View style={[styles.root, { gap: spacing.sm }]}>
      {icon ? (
        <View
          style={[
            styles.iconWash,
            {
              backgroundColor: colors.accentWash,
              borderRadius: radius.lg,
              marginBottom: spacing.sm,
            },
          ]}
        >
          <Icon name={icon} size={28} tone="accent" />
        </View>
      ) : null}
      <Text variant="displayMedium" center>
        {title}
      </Text>
      <Text variant="body" tone="muted" center style={styles.description}>
        {description}
      </Text>
      {action ? <View style={{ marginTop: spacing.lg }}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    alignItems: 'center',
  },
  iconWash: {
    width: 64,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  description: {
    maxWidth: 300,
  },
});

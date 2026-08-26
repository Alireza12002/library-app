import type { ReactNode } from 'react';
import { View } from 'react-native';

import { useTheme } from '@/theme';

import { Card } from './Card';
import { Text } from './Text';

export interface SectionProps {
  title: string;
  /** Short explanation of what the section covers. */
  description?: string;
  /** Rows are grouped inside a card; plain content renders bare. */
  children?: ReactNode;
  /** Wrap children in a Card. Defaults to true. */
  grouped?: boolean;
}

/** Titled group of content — the settings screen's structural unit. */
export function Section({ title, description, children, grouped = true }: SectionProps) {
  const { spacing } = useTheme();

  return (
    <View style={{ gap: spacing.xs }}>
      <Text variant="label">{title}</Text>
      {description ? (
        <Text variant="caption" tone="muted">
          {description}
        </Text>
      ) : null}
      {children ? (
        <View style={{ marginTop: spacing.sm }}>
          {grouped ? <Card padded={false}>{children}</Card> : children}
        </View>
      ) : null}
    </View>
  );
}

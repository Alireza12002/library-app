/**
 * Design system primitives (ARCHITECTURE.md §1, L5).
 *
 * Screens compose these instead of defining styles. Every one is presentation
 * only — none may import services, data, files or the PDF adapter.
 * Keep this set small: add a primitive when a shape repeats, not speculatively.
 */
export { Screen, type ScreenProps } from './Screen';
export { Text, type TextProps, type TextVariant, type TextTone } from './Text';
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from './Button';
export { Icon, type IconProps, type IconName } from './Icon';
export { IconButton, type IconButtonProps } from './IconButton';
export { Card, type CardProps } from './Card';
export { EmptyState, type EmptyStateProps } from './EmptyState';
export { Divider, type DividerProps } from './Divider';
export { Section, type SectionProps } from './Section';
export { Row, type RowProps } from './Row';
export { TabBarIcon, type TabBarIconProps } from './TabBarIcon';

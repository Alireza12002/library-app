# Reflow Reader Template

This is a template file for the Reflow Reader component. Copy and modify as needed.

```tsx
import { FlatList, StyleSheet, View, Text, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useMemo, useCallback, useRef, useEffect } from 'react';

import { Screen } from '@/components/ui';
import { useTheme, READER_THEMES, type ReaderThemeTokens } from '@/theme';
import type { TextBlock } from '@/features/reader/textParser';
import type { ReflowReaderState } from '@/features/reader/hooks/useReflowReader';
import type { ReadingSettings } from '@/core/entities/readingSettings';

interface ReflowReaderProps {
  state: ReflowReaderState;
  settings: ReadingSettings;
  ensurePagesLoaded: (startPage: number, endPage: number) => Promise<void>;
  refreshPage: (page: number) => Promise<void>;
  onScroll: (event: { nativeEvent: { contentOffset: { y: number } } }) => void;
  updateReadingPosition: (scrollY: number, visibleBlocks: { index: number; text: string }[]) => void;
  restoreReadingPosition: () => { blockIndex: number; charOffset: number; scrollY: number } | null;
}

const BLOCK_TYPES_WITH_MARGIN = ['paragraph', 'heading', 'blockquote', 'list_item'] as const;

function getBlockStyle(
  type: TextBlock['type'],
  settings: ReadingSettings,
  theme: ReaderThemeTokens
): object {
  // ... block styling logic
}

function RenderBlock({
  block,
  index,
  settings,
  theme,
}: {
  block: TextBlock;
  index: number;
  settings: ReadingSettings;
  theme: ReaderThemeTokens;
}) {
  // ... render block
}

function LoadingIndicator() {
  // ... loading indicator
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  // ... error state
}

function TextlessState() {
  // ... textless state
}

export function ReflowReader({
  state,
  settings,
  ensurePagesLoaded,
  refreshPage,
  onScroll,
  updateReadingPosition,
  restoreReadingPosition,
}: ReflowReaderProps) {
  // ... component implementation
}

const styles = StyleSheet.create({
  // ... style definitions
});
```

## Usage

Import and use in the Reader screen:

```tsx
import { ReflowReader } from '@/features/reader/components';

<ReflowReader
  state={reflow.state}
  settings={settings}
  ensurePagesLoaded={reflow.ensurePagesLoaded}
  refreshPage={reflow.refreshPage}
  onScroll={handleReflowScroll}
  updateReadingPosition={reflow.updateReadingPosition}
  restoreReadingPosition={reflow.restoreReadingPosition}
/>
```
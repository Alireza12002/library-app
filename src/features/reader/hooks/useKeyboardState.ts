/**
 * Keyboard geometry hook (ARCHITECTURE.md §3, L5).
 *
 * Reports the keyboard height the OS actually measured, so layout decisions never
 * rely on a guessed offset. Two callers need it:
 *  - safe-area maths: while the keyboard is up it covers the system navigation
 *    area, so adding `insets.bottom` on top of keyboard avoidance double-pads;
 *  - anything that must know whether the keyboard is currently visible.
 *
 * Event choice matters. iOS emits `keyboardWillShow` before the animation, which
 * lets layout move in step with the keyboard; Android only emits `keyboardDidShow`.
 * `keyboardWillChangeFrame` covers iPad's floating/split keyboard, where height
 * changes without a hide/show pair.
 */
import { useEffect, useState } from 'react';
import { Keyboard, Platform, type KeyboardEvent } from 'react-native';

export interface KeyboardState {
  /** Height in points, 0 when hidden. */
  height: number;
  isVisible: boolean;
}

export function useKeyboardState(): KeyboardState {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const onShow = (event: KeyboardEvent): void => {
      setHeight(event.endCoordinates.height);
    };
    const onHide = (): void => {
      setHeight(0);
    };

    const subscriptions =
      Platform.OS === 'ios'
        ? [
            Keyboard.addListener('keyboardWillShow', onShow),
            Keyboard.addListener('keyboardWillHide', onHide),
            // Floating/split keyboard resizes without a hide/show pair.
            Keyboard.addListener('keyboardWillChangeFrame', onShow),
          ]
        : [
            Keyboard.addListener('keyboardDidShow', onShow),
            Keyboard.addListener('keyboardDidHide', onHide),
          ];

    return () => {
      for (const subscription of subscriptions) subscription.remove();
    };
  }, []);

  return { height, isVisible: height > 0 };
}

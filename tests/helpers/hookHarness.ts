/**
 * Minimal React-compatible hook runtime (test-only, ARCHITECTURE.md §9).
 *
 * The project has no renderer in its test dependencies, but the reader's
 * open flow lives entirely in hooks, so it needs to be executable. This
 * implements the parts of React's contract that decide whether a hook settles:
 *
 * - `useState` setters bail out on `Object.is` equality (React's own rule);
 * - `useMemo` / `useCallback` recompute only when a dep changes identity;
 * - `useEffect` runs after each render and cleans up before re-running;
 * - renders repeat while state keeps changing, exactly like React's loop.
 *
 * `driveHook` reports whether the loop reached a fixed point, so a dependency
 * cycle shows up as `settled: false` instead of a hang.
 *
 * Test-only: nothing in the app imports this file. Tests alias `react` to it
 * for the module under test.
 */

interface Slot {
  kind: 'state' | 'ref' | 'memo' | 'effect';
  value: unknown;
  current: unknown;
  deps: readonly unknown[] | undefined;
  fn: (() => void | (() => void)) | undefined;
  cleanup: (() => void) | undefined;
  pending: boolean;
  runs: number;
}

function emptySlot(kind: Slot['kind']): Slot {
  return {
    kind,
    value: undefined,
    current: undefined,
    deps: undefined,
    fn: undefined,
    cleanup: undefined,
    pending: false,
    runs: 0,
  };
}

let slots: Slot[] = [];
let cursor = 0;
let dirty = false;
let effectIndexes: number[] = [];

function slotAt(index: number, kind: Slot['kind']): Slot {
  const existing = slots[index];
  if (existing) return existing;
  const created = emptySlot(kind);
  slots[index] = created;
  return created;
}

function sameDeps(a: readonly unknown[] | undefined, b: readonly unknown[] | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) return false;
  }
  return true;
}

export function useState<S>(initial: S | (() => S)): [S, (next: S | ((prev: S) => S)) => void] {
  const index = cursor++;
  const first = !(index in slots);
  const slot = slotAt(index, 'state');
  if (first) {
    slot.value = typeof initial === 'function' ? (initial as () => S)() : initial;
  }

  const setState = (next: S | ((prev: S) => S)): void => {
    const value =
      typeof next === 'function' ? (next as (prev: S) => S)(slot.value as S) : next;
    // React bails out when the next value is Object.is-equal to the current one.
    if (!Object.is(value, slot.value)) {
      slot.value = value;
      dirty = true;
    }
  };

  return [slot.value as S, setState];
}

export function useRef<T>(initial: T): { current: T } {
  const index = cursor++;
  const first = !(index in slots);
  const slot = slotAt(index, 'ref');
  if (first) slot.current = initial;
  return slot as unknown as { current: T };
}

export function useMemo<T>(factory: () => T, deps: readonly unknown[]): T {
  const index = cursor++;
  const existing = slots[index];
  if (!existing || !sameDeps(existing.deps, deps)) {
    const slot = emptySlot('memo');
    slot.deps = deps;
    slot.value = factory();
    slots[index] = slot;
  }
  return slots[index]!.value as T;
}

export function useCallback<T>(fn: T, deps: readonly unknown[]): T {
  // Deliberately not implemented via useMemo: a nested hook call here would be
  // flagged by react-hooks/exhaustive-deps, and this slot is simpler anyway.
  const index = cursor++;
  const existing = slots[index];
  if (!existing || !sameDeps(existing.deps, deps)) {
    const slot = emptySlot('memo');
    slot.deps = deps;
    slot.value = fn;
    slots[index] = slot;
  }
  return slots[index]!.value as T;
}

export function useEffect(fn: () => void | (() => void), deps?: readonly unknown[]): void {
  const index = cursor++;
  const existing = slots[index];
  if (!existing) {
    const slot = emptySlot('effect');
    slot.deps = deps;
    slot.fn = fn;
    slot.pending = true;
    slots[index] = slot;
  } else if (deps === undefined || !sameDeps(existing.deps, deps)) {
    existing.deps = deps;
    existing.fn = fn;
    existing.pending = true;
  } else {
    existing.fn = fn;
    existing.pending = false;
  }
  if (!effectIndexes.includes(index)) effectIndexes.push(index);
}

export interface DriveResult<T> {
  /** False when state never stopped changing — i.e. a dependency cycle. */
  settled: boolean;
  /** How many times the render function ran. */
  passes: number;
  /** Run count per useEffect, in hook order. */
  effectRuns: number[];
  /** The value returned by each render pass. */
  snapshots: T[];
}

const flushMicrotasks = (): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, 0);
  });

/**
 * Renders until state settles, running effects between passes and letting any
 * promises awaited inside them resolve.
 */
export async function driveHook<T>(
  render: () => T,
  options?: { maxPasses?: number; settleTicks?: number },
): Promise<DriveResult<T>> {
  const maxPasses = options?.maxPasses ?? 25;
  const settleTicks = options?.settleTicks ?? 6;

  slots = [];
  effectIndexes = [];
  const snapshots: T[] = [];

  const effectRuns = (): number[] =>
    slots.filter((slot) => slot.kind === 'effect').map((slot) => slot.runs);

  for (let pass = 0; pass < maxPasses; pass++) {
    cursor = 0;
    dirty = false;
    snapshots.push(render());

    // Commit phase: run every effect whose deps changed.
    for (const index of [...effectIndexes]) {
      const slot = slots[index];
      if (!slot || slot.kind !== 'effect' || !slot.pending || !slot.fn) continue;
      slot.pending = false;
      if (slot.cleanup) slot.cleanup();
      slot.runs++;
      const cleanup = slot.fn();
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    }

    for (let tick = 0; tick < settleTicks; tick++) {
      await flushMicrotasks();
    }

    if (!dirty) {
      return { settled: true, passes: pass + 1, effectRuns: effectRuns(), snapshots };
    }
  }

  return { settled: false, passes: maxPasses, effectRuns: effectRuns(), snapshots };
}

/** Runs pending cleanups, mirroring unmount. */
export function unmountHook(): void {
  for (const slot of slots) {
    if (slot.kind === 'effect' && slot.cleanup) slot.cleanup();
  }
  slots = [];
  effectIndexes = [];
}

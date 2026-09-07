/**
 * Reflow responsiveness tests (ARCHITECTURE.md §9).
 *
 * The reading measure is the property that separates real reflow from a scaled
 * page: it must come from the live window width, never from the PDF's page box.
 * The renderer computes it inline, so the rule is extracted here as a pure
 * function and pinned — a regression to page-derived width is exactly the failure
 * the user reported, and it is invisible in a typecheck.
 */
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { readingColumnWidth, SIDE_MARGIN_RATIO } from '@/features/reader/readingLayout';

describe('reading column width', () => {
  test('derives from window width, not from any page size', () => {
    const narrow = readingColumnWidth(360, 0);
    const wide = readingColumnWidth(768, 0);

    assert.ok(wide > narrow, 'a wider window must give a wider measure');
    // Proportional to the window: this is what "adapts to device width" means.
    assert.equal(narrow, Math.floor(360 * (1 - SIDE_MARGIN_RATIO * 2)));
    assert.equal(wide, Math.floor(768 * (1 - SIDE_MARGIN_RATIO * 2)));
  });

  test('never exceeds the window, whatever the content-width setting', () => {
    // An 800pt-wide PDF paragraph must not produce an 800pt column on a phone —
    // that is precisely the horizontal-scrolling failure.
    for (const windowWidth of [320, 360, 411, 480, 768, 1024]) {
      const width = readingColumnWidth(windowWidth, 800);
      assert.ok(
        width <= windowWidth,
        `column ${width} exceeded window ${windowWidth}`,
      );
    }
  });

  test('leaves side margins at every width', () => {
    for (const windowWidth of [320, 360, 411, 480, 768, 1024]) {
      const width = readingColumnWidth(windowWidth, 0);
      assert.ok(width < windowWidth, `no margin at window ${windowWidth}`);
    }
  });

  test('a content-width cap narrows the column on a wide screen', () => {
    // Long lines are hard to read, so the setting may narrow the measure...
    const capped = readingColumnWidth(1024, 500);
    assert.equal(capped, 500);
  });

  test('a content-width cap wider than the screen is ignored', () => {
    // ...but it must never widen it past what fits.
    const uncapped = readingColumnWidth(360, 0);
    const attempted = readingColumnWidth(360, 900);
    assert.equal(attempted, uncapped);
  });

  test('rotating a phone changes the measure', () => {
    const portrait = readingColumnWidth(411, 0);
    const landscape = readingColumnWidth(869, 0);

    assert.ok(landscape > portrait * 1.5, 'landscape should reflow noticeably wider');
  });

  test('degenerate window sizes still return something usable', () => {
    assert.ok(readingColumnWidth(0, 0) >= 0);
    assert.ok(Number.isFinite(readingColumnWidth(1, 0)));
  });
});

describe('image scaling to the reading column', () => {
  /**
   * Mirrors the renderer's rule: fill the column, preserve aspect ratio, never
   * upscale past intrinsic size.
   */
  function scale(
    intrinsic: { width: number; height: number },
    columnWidth: number,
  ): { width: number; height: number } {
    const width = Math.min(columnWidth, intrinsic.width);
    return { width, height: intrinsic.height * (width / intrinsic.width) };
  }

  test('a figure wider than the column is scaled down to fit', () => {
    const result = scale({ width: 1600, height: 900 }, 330);

    assert.equal(result.width, 330);
    assert.equal(Math.round(result.height), Math.round(900 * (330 / 1600)));
  });

  test('aspect ratio is preserved', () => {
    const intrinsic = { width: 800, height: 600 };
    const result = scale(intrinsic, 300);

    const originalRatio = intrinsic.width / intrinsic.height;
    const scaledRatio = result.width / result.height;
    assert.ok(Math.abs(originalRatio - scaledRatio) < 0.0001);
  });

  test('a small figure is not upscaled into blur', () => {
    const result = scale({ width: 120, height: 80 }, 330);

    assert.equal(result.width, 120, 'should keep its intrinsic width');
    assert.equal(result.height, 80);
  });

  test('the same figure adapts as the column changes', () => {
    const intrinsic = { width: 1200, height: 800 };

    const onPhone = scale(intrinsic, 330);
    const onTablet = scale(intrinsic, 700);

    assert.ok(onTablet.width > onPhone.width, 'wider column ⇒ larger figure');
    assert.ok(onTablet.height > onPhone.height);
  });
});

/**
 * TextParser tests (ARCHITECTURE.md §9).
 * Uses Node's native test runner.
 */
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import {
  parseExtractedText,
  flattenParsedPages,
  type ParsedPage,
} from '@/features/reader/textParser';

describe('TextParser', () => {
  describe('parseExtractedText', () => {
    test('should parse a simple page into paragraphs', () => {
      const input = [{ pageIndex: 0, text: 'First paragraph.\n\nSecond paragraph.' }];

      const result = parseExtractedText(input);

      assert.equal(result.length, 1);
      assert.ok(result[0]);
      assert.equal(result[0].pageIndex, 0);
      assert.equal(result[0].blocks.length, 2);
      assert.ok(result[0].blocks[0]);
      assert.ok(result[0].blocks[1]);
      assert.equal(result[0].blocks[0].type, 'paragraph');
      assert.equal(result[0].blocks[0].text, 'First paragraph.');
      assert.equal(result[0].blocks[1].type, 'paragraph');
      assert.equal(result[0].blocks[1].text, 'Second paragraph.');
    });

    test('should handle broken line wrapping', () => {
      const input = [
        { pageIndex: 0, text: 'This is a long sentence\nthat wraps across\nmultiple lines.' },
      ];

      const result = parseExtractedText(input);

      assert.ok(result[0]);
      assert.ok(result[0].blocks[0]);
      assert.equal(result[0].blocks.length, 1);
      assert.equal(
        result[0].blocks[0].text,
        'This is a long sentence that wraps across multiple lines.',
      );
    });

    test('should not join lines that end with punctuation', () => {
      const input = [{ pageIndex: 0, text: 'First sentence.\nNext sentence starts here.' }];

      const result = parseExtractedText(input);

      assert.ok(result[0]);
      assert.ok(result[0].blocks[0]);
      assert.ok(result[0].blocks[1]);
      assert.equal(result[0].blocks.length, 2);
      assert.equal(result[0].blocks[0].text, 'First sentence.');
      assert.equal(result[0].blocks[1].text, 'Next sentence starts here.');
    });

    test('should not join lines where next starts with uppercase', () => {
      const input = [{ pageIndex: 0, text: 'This continues\nBut Not This' }];

      const result = parseExtractedText(input);

      // "But Not This" starts with uppercase, so it's a new paragraph
      assert.ok(result[0]);
      assert.equal(result[0].blocks.length, 2);
    });

    test('should classify headings', () => {
      const input = [{ pageIndex: 0, text: 'Chapter One\n\nContent here.' }];

      const result = parseExtractedText(input);

      assert.ok(result[0]);
      assert.ok(result[0].blocks[0]);
      assert.ok(result[0].blocks[1]);
      assert.equal(result[0].blocks[0].type, 'heading');
      assert.equal(result[0].blocks[0].text, 'Chapter One');
      assert.equal(result[0].blocks[1].type, 'paragraph');
    });

    test('should classify list items', () => {
      const input = [{ pageIndex: 0, text: '- First item\n- Second item\n\nRegular paragraph.' }];

      const result = parseExtractedText(input);

      assert.ok(result[0]);
      assert.ok(result[0].blocks[0]);
      assert.ok(result[0].blocks[1]);
      assert.ok(result[0].blocks[2]);
      assert.equal(result[0].blocks[0].type, 'list_item');
      assert.equal(result[0].blocks[0].text, '- First item');
      assert.equal(result[0].blocks[1].type, 'list_item');
      assert.equal(result[0].blocks[1].text, '- Second item');
      assert.equal(result[0].blocks[2].type, 'paragraph');
    });

    test('should classify numbered list items', () => {
      const input = [{ pageIndex: 0, text: '1. First item\n2. Second item' }];

      const result = parseExtractedText(input);

      assert.ok(result[0]);
      assert.ok(result[0].blocks[0]);
      assert.ok(result[0].blocks[1]);
      assert.equal(result[0].blocks[0].type, 'list_item');
      assert.equal(result[0].blocks[1].type, 'list_item');
    });

    test('should classify blockquotes', () => {
      const input = [{ pageIndex: 0, text: '> This is a quote\n\nRegular text.' }];

      const result = parseExtractedText(input);

      assert.ok(result[0]);
      assert.ok(result[0].blocks[0]);
      assert.ok(result[0].blocks[1]);
      assert.equal(result[0].blocks[0].type, 'blockquote');
      assert.equal(result[0].blocks[0].text, '> This is a quote');
      assert.equal(result[0].blocks[1].type, 'paragraph');
    });

    test('should normalize excessive whitespace', () => {
      const input = [{ pageIndex: 0, text: 'Word1    Word2\n\n\nWord3\t\tWord4' }];

      const result = parseExtractedText(input);

      assert.ok(result[0]);
      assert.ok(result[0].blocks[0]);
      assert.ok(result[0].blocks[1]);
      assert.equal(result[0].blocks[0].text, 'Word1 Word2');
      assert.equal(result[0].blocks[1].text, 'Word3 Word4');
    });

    test('should skip empty pages', () => {
      const input = [
        { pageIndex: 0, text: '' },
        { pageIndex: 1, text: 'Content' },
      ];

      const result = parseExtractedText(input);

      assert.equal(result.length, 1);
      assert.ok(result[0]);
      assert.equal(result[0].pageIndex, 1);
    });

    test('should handle pages with only whitespace', () => {
      const input = [
        { pageIndex: 0, text: '   \n\n\t  ' },
        { pageIndex: 1, text: 'Real content' },
      ];

      const result = parseExtractedText(input);

      assert.equal(result.length, 1);
      assert.ok(result[0]);
      assert.equal(result[0].pageIndex, 1);
    });

    test('should remove repeated headers across pages', () => {
      const input = [
        { pageIndex: 0, text: 'Document Title\n\nPage 1 content.' },
        { pageIndex: 1, text: 'Document Title\n\nPage 2 content.' },
        { pageIndex: 2, text: 'Document Title\n\nPage 3 content.' },
      ];

      const result = parseExtractedText(input, { removeRepeatedHeadersFooters: true });

      // "Document Title" appears on all 3 pages at the top, should be removed
      assert.ok(result[0]);
      assert.ok(result[1]);
      assert.ok(result[2]);
      assert.ok(result[0].blocks[0]);
      assert.ok(result[1].blocks[0]);
      assert.ok(result[2].blocks[0]);
      assert.equal(result[0].blocks[0].text, 'Page 1 content.');
      assert.equal(result[1].blocks[0].text, 'Page 2 content.');
      assert.equal(result[2].blocks[0].text, 'Page 3 content.');
    });

    test('should remove repeated footers across pages', () => {
      const input = [
        { pageIndex: 0, text: 'Page 1 content.\n\nPage Footer' },
        { pageIndex: 1, text: 'Page 2 content.\n\nPage Footer' },
        { pageIndex: 2, text: 'Page 3 content.\n\nPage Footer' },
      ];

      const result = parseExtractedText(input, { removeRepeatedHeadersFooters: true });

      assert.ok(result[0]);
      assert.ok(result[1]);
      assert.ok(result[2]);
      const page0LastIdx = result[0].blocks.length - 1;
      const page1LastIdx = result[1].blocks.length - 1;
      const page2LastIdx = result[2].blocks.length - 1;
      assert.ok(result[0].blocks[page0LastIdx]);
      assert.ok(result[1].blocks[page1LastIdx]);
      assert.ok(result[2].blocks[page2LastIdx]);
      assert.equal(result[0].blocks[page0LastIdx].text, 'Page 1 content.');
      assert.equal(result[1].blocks[page1LastIdx].text, 'Page 2 content.');
      assert.equal(result[2].blocks[page2LastIdx].text, 'Page 3 content.');
    });

    test('should not remove page numbers from content', () => {
      const input = [
        { pageIndex: 0, text: 'Content page 1.\n\n1' },
        { pageIndex: 1, text: 'Content page 2.\n\n2' },
        { pageIndex: 2, text: 'Content page 3.\n\n3' },
      ];

      const result = parseExtractedText(input, { removeRepeatedHeadersFooters: true });

      // Page numbers are detected and should not be treated as repeated headers/footers
      // (They're filtered out in the header/footer candidate collection)
      assert.ok(result[0]);
      assert.ok(result[1]);
      assert.ok(result[2]);
      assert.ok(result[0].blocks[0]);
      assert.ok(result[1].blocks[0]);
      assert.ok(result[2].blocks[0]);
      assert.equal(result[0].blocks[0].text, 'Content page 1.');
      assert.equal(result[1].blocks[0].text, 'Content page 2.');
      assert.equal(result[2].blocks[0].text, 'Content page 3.');
    });

    test('should preserve pageIndex in blocks', () => {
      const input = [
        { pageIndex: 5, text: 'Content on page 5.' },
        { pageIndex: 10, text: 'Content on page 10.' },
      ];

      const result = parseExtractedText(input);

      assert.equal(result.length, 2);
      assert.ok(result[0]);
      assert.ok(result[1]);
      assert.equal(result[0].pageIndex, 5);
      assert.equal(result[1].pageIndex, 10);
      assert.ok(result[0].blocks.length > 0, 'First page should have blocks');
      assert.ok(result[1].blocks.length > 0, 'Second page should have blocks');
      assert.ok(result[0].blocks[0]);
      assert.ok(result[1].blocks[0]);
      assert.equal(result[0].blocks[0].pageIndex, 5);
      assert.equal(result[1].blocks[0].pageIndex, 10);
    });

    test('should handle ALL CAPS headings', () => {
      const input = [{ pageIndex: 0, text: 'INTRODUCTION\n\nFirst paragraph.' }];

      const result = parseExtractedText(input);

      assert.ok(result[0]);
      assert.ok(result[0].blocks[0]);
      assert.equal(result[0].blocks[0].type, 'heading');
      assert.equal(result[0].blocks[0].text, 'INTRODUCTION');
    });

    test('should handle bullet points with different bullets', () => {
      const input = [{ pageIndex: 0, text: '\u2022 Bullet one\n* Bullet two\n- Bullet three' }];

      const result = parseExtractedText(input);

      assert.ok(result[0]);
      assert.equal(result[0].blocks.length, 3);
      assert.ok(result[0].blocks[0]);
      assert.ok(result[0].blocks[1]);
      assert.ok(result[0].blocks[2]);
      assert.equal(result[0].blocks[0].type, 'list_item');
      assert.equal(result[0].blocks[1].type, 'list_item');
      assert.equal(result[0].blocks[2].type, 'list_item');
    });

    test('should respect options to disable header/footer removal', () => {
      const input = [
        { pageIndex: 0, text: 'Repeated Header\n\nContent 1' },
        { pageIndex: 1, text: 'Repeated Header\n\nContent 2' },
      ];

      const result = parseExtractedText(input, { removeRepeatedHeadersFooters: false });

      assert.ok(result[0]);
      assert.ok(result[1]);
      assert.ok(result[0].blocks[0]);
      assert.ok(result[1].blocks[0]);
      assert.equal(result[0].blocks[0].text, 'Repeated Header');
      assert.equal(result[1].blocks[0].text, 'Repeated Header');
    });

    test('should handle code blocks (indented)', () => {
      const input = [{ pageIndex: 0, text: '    function foo() {\n        return 42;\n    }' }];

      const result = parseExtractedText(input);

      assert.ok(result[0]);
      assert.ok(result[0].blocks[0]);
      assert.equal(result[0].blocks[0].type, 'code');
    });
  });

  describe('flattenParsedPages', () => {
    test('should flatten multiple pages into single array', () => {
      const pages: ParsedPage[] = [
        { pageIndex: 0, blocks: [{ type: 'paragraph', text: 'Page 1', pageIndex: 0 }] },
        { pageIndex: 1, blocks: [{ type: 'paragraph', text: 'Page 2', pageIndex: 1 }] },
      ];

      const flattened = flattenParsedPages(pages);

      assert.equal(flattened.length, 2);
      assert.ok(flattened[0]);
      assert.ok(flattened[1]);
      assert.equal(flattened[0].text, 'Page 1');
      assert.equal(flattened[1].text, 'Page 2');
      assert.equal(flattened[0].pageIndex, 0);
      assert.equal(flattened[1].pageIndex, 1);
    });

    test('should handle empty pages', () => {
      const pages: ParsedPage[] = [
        { pageIndex: 0, blocks: [] },
        { pageIndex: 1, blocks: [{ type: 'paragraph', text: 'Page 2', pageIndex: 1 }] },
      ];

      const flattened = flattenParsedPages(pages);

      assert.equal(flattened.length, 1);
      assert.ok(flattened[0]);
      assert.equal(flattened[0].text, 'Page 2');
    });
  });
});

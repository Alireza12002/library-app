# Text Anchor for Reflow Reader Position Restoration

## Anchor Definition

- **Source**: First ~50 characters of a text block in the continuous blocks array
- **Purpose**: Verification of reading position on reflow mode re-entry
- **Format**: `block.text.slice(0, 50)` — first 50 characters of block text

## Usage

### Setting the Anchor

When updating reading position on scroll:

```typescript
const anchorBlock = visibleBlocks[0]!;
const textAnchor = anchorBlock.text.slice(0, 50);
```

### Restoring Position

```typescript
// Try text anchor match first
if (pos.blockIndex < state.blocks.length) {
  const block = state.blocks[pos.blockIndex]!;
  const currentAnchor = block.text.slice(0, 50);
  if (currentAnchor === pos.textAnchor) {
    // Anchor matches — restore exact position
    return { blockIndex: pos.blockIndex, charOffset: pos.charOffset, scrollY: pos.scrollY };
  }
}
```

### Fallback: Text Search

```typescript
// Anchor doesn't match — try to find by text search
if (pos.textAnchor) {
  for (let i = 0; i < state.blocks.length; i++) {
    if (state.blocks[i]!.text.startsWith(pos.textAnchor)) {
      return { blockIndex: i, charOffset: pos.charOffset, scrollY: pos.scrollY ?? 0 };
    }
  }
}
```

### Final Fallback: Scroll Y Only

```typescript
// Fallback to scroll Y only
return { blockIndex: 0, charOffset: 0, scrollY: pos.scrollY ?? 0 };
```

## Key Principles

1. **Anchor length**: ~50 characters provides enough uniqueness without being too long
2. **Verification before restore**: Always check anchor matches before restoring position
3. **Text search fallback**: Search for blocks starting with the anchor text
4. **Scroll Y fallback**: Final fallback when neither anchor nor text search works
5. **Debounced updates**: 100ms debounce on position updates to avoid jitter

## Edge Cases

- **Empty blocks**: Handle gracefully — skip anchor extraction
- **Short blocks**: If block.text < 50 chars, use the full text as anchor
- **Re-extraction**: After cache invalidation, anchors may change — always verify
- **Scanned PDFs**: isTextless === true — no anchor possible, use PDF mode
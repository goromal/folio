import { expect, test } from 'vitest';
import { rangeToAnchor, anchorToRange, type PassageAnchor } from './anchors';

// Pure-DOM tests — no React needed; keep this file .ts (no JSX).
function mount(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  document.body.appendChild(root);
  return root;
}

const DOC =
  '<p data-block-id="10" data-block-type="heading">Chapter One</p>' +
  '<p data-block-id="11" data-block-type="para">The quick brown fox.</p>' +
  '<p data-block-id="12" data-block-type="para"></p>';

function textNodeOf(root: HTMLElement, blockId: number): Text {
  return root.querySelector(`[data-block-id="${blockId}"]`)!.firstChild as Text;
}

test('rangeToAnchor maps a within-block selection to (block, offset)', () => {
  const root = mount(DOC);
  const range = document.createRange();
  range.setStart(textNodeOf(root, 11), 4); // "quick"
  range.setEnd(textNodeOf(root, 11), 9);
  expect(rangeToAnchor(range)).toEqual({
    start_block: 11, start_off: 4, end_block: 11, end_off: 9,
  });
});

test('anchor round-trips back to the same selected text', () => {
  const root = mount(DOC);
  const anchor: PassageAnchor = { start_block: 11, start_off: 4, end_block: 11, end_off: 9 };
  const range = anchorToRange(root, anchor)!;
  expect(range.toString()).toBe('quick');
});

test('cross-block selection', () => {
  const root = mount(DOC);
  const range = document.createRange();
  range.setStart(textNodeOf(root, 10), 0);
  range.setEnd(textNodeOf(root, 11), 3); // "The"
  expect(rangeToAnchor(range)).toEqual({
    start_block: 10, start_off: 0, end_block: 11, end_off: 3,
  });
});

test('collapsed selection returns null', () => {
  const root = mount(DOC);
  const range = document.createRange();
  range.setStart(textNodeOf(root, 11), 4);
  range.setEnd(textNodeOf(root, 11), 4);
  expect(rangeToAnchor(range)).toBeNull();
});

test('anchorToRange clamps an out-of-bounds end_off to the block end', () => {
  const root = mount(DOC);
  // "The quick brown fox." is 20 chars; an agent-set end_off of 20000 means "to end".
  const anchor: PassageAnchor = { start_block: 11, start_off: 0, end_block: 11, end_off: 20000 };
  const range = anchorToRange(root, anchor)!;
  expect(range).not.toBeNull();
  expect(range.toString()).toBe('The quick brown fox.');
});

test('anchorToRange returns null for an empty block', () => {
  const root = mount(DOC);
  const anchor: PassageAnchor = { start_block: 12, start_off: 0, end_block: 12, end_off: 0 };
  expect(anchorToRange(root, anchor)).toBeNull();
});
